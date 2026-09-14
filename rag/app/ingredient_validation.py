"""Deterministic validation of ingredient claims in generated dish copy."""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional, Sequence

from .validators import MealPlanDoc

_PREPARATION_MODIFIERS = {
    "canned", "chopped", "cooked", "crushed", "diced", "dried", "fresh",
    "frozen", "grated", "grilled", "ground", "minced", "organic", "peeled",
    "raw", "roasted", "seeded", "shredded", "sliced", "whole",
}

_EQUIVALENT_ALIAS_GROUPS = (
    ("scallion", "green onion"),
    ("branzino", "sea bass"),
    ("garbanzo", "garbanzo bean", "chickpea"),
    ("shrimp", "prawn"),
    ("toast", "bread"),
    ("marinara", "marinara sauce"),
)

_PASTA_SHAPES = (
    "spaghetti", "farfalle", "penne", "linguine", "fettuccine", "rigatoni",
    "macaroni", "orzo", "rotini", "fusilli", "tagliatelle",
)


def _singularize(token: str) -> str:
    if len(token) > 4 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 4 and token.endswith("oes"):
        return token[:-2]
    if len(token) > 4 and token.endswith(("ches", "shes", "sses", "xes", "zes")):
        return token[:-2]
    if len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    return token


def normalize_ingredient(value: str) -> str:
    folded = unicodedata.normalize("NFKC", str(value)).casefold()
    words = re.sub(r"[\W_]+", " ", folded, flags=re.UNICODE).split()
    normalized = [
        _singularize(word) for word in words if word not in _PREPARATION_MODIFIERS
    ]
    return " ".join(normalized)


_NORMALIZED_ALIAS_GROUPS = tuple(
    tuple(normalize_ingredient(term) for term in group)
    for group in _EQUIVALENT_ALIAS_GROUPS
)
_ALIAS_CANONICAL = {
    alias: group[0]
    for group in _NORMALIZED_ALIAS_GROUPS
    for alias in group
}


def _canonical(term: str) -> str:
    return _ALIAS_CANONICAL.get(term, term)


def _parse_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return None
    return value


def _recipe_ingredient_names(value: Any) -> Iterable[str]:
    parsed = _parse_json(value)
    if isinstance(parsed, list):
        for ingredient in parsed:
            if isinstance(ingredient, dict) and ingredient.get("name"):
                yield str(ingredient["name"])
            elif isinstance(ingredient, str):
                yield ingredient


def build_ingredient_vocabulary(recipe_rows: Iterable[Mapping[str, Any]]) -> set[str]:
    vocabulary = {
        normalized
        for row in recipe_rows
        for name in _recipe_ingredient_names(row.get("ingredients_json"))
        if (
            (normalized := normalize_ingredient(name))
            and len(normalized) <= 80
            and len(normalized.split()) <= 8
        )
    }
    for group in _NORMALIZED_ALIAS_GROUPS:
        if any(term in vocabulary for term in group):
            vocabulary.update(group)
    pasta_terms = {"pasta", *_PASTA_SHAPES}
    if vocabulary.intersection(pasta_terms):
        vocabulary.update(pasta_terms)
    return vocabulary


def parse_product_ingredients(value: Any) -> Optional[list[str]]:
    """Extract parsed product ingredient names; None means metadata unavailable."""
    if value is None:
        return None
    parsed = _parse_json(value)
    if not isinstance(parsed, dict):
        return None
    parsed = parsed.get("parsed", parsed)
    if not isinstance(parsed, dict):
        return None
    ingredients = parsed.get("ingredients_list")
    if not isinstance(ingredients, list):
        return None
    names = []
    for ingredient in ingredients:
        if isinstance(ingredient, dict) and ingredient.get("name"):
            names.append(str(ingredient["name"]))
        elif isinstance(ingredient, str):
            names.append(ingredient)
    return names


@dataclass(frozen=True)
class ProductIngredientData:
    id: int
    name: str
    ingredients: Optional[Sequence[str]]


class _PhraseIndex:
    """Request-scoped first-token index for bounded phrase matching work."""

    def __init__(self, vocabulary: set[str]):
        self._by_first: dict[str, list[tuple[tuple[str, ...], str]]] = {}
        for phrase in vocabulary:
            tokens = tuple(phrase.split())
            if tokens:
                self._by_first.setdefault(tokens[0], []).append((tokens, phrase))
        for candidates in self._by_first.values():
            candidates.sort(key=lambda candidate: (-len(candidate[0]), candidate[1]))

    def matches(self, text: Optional[str]) -> list[tuple[int, int, str]]:
        tokens = normalize_ingredient(text or "").split()
        matches: list[tuple[int, int, str]] = []
        for start, token in enumerate(tokens):
            for phrase_tokens, phrase in self._by_first.get(token, ()):
                end = start + len(phrase_tokens)
                if tuple(tokens[start:end]) == phrase_tokens:
                    matches.append((start, end, phrase))
        return matches


def _longest_mentions(text: Optional[str], index: _PhraseIndex) -> list[str]:
    occupied: set[int] = set()
    mentions: list[str] = []
    matches = sorted(
        index.matches(text),
        key=lambda match: (-(match[1] - match[0]), -len(match[2]), match[0], match[2]),
    )
    for start, end, phrase in matches:
        span = set(range(start, end))
        if occupied.isdisjoint(span):
            mentions.append(phrase)
            occupied.update(span)
    return mentions


def _source_concepts(source: str, index: _PhraseIndex) -> set[str]:
    normalized = normalize_ingredient(source)
    matched = {phrase for _, _, phrase in index.matches(normalized)}
    concepts = {_canonical(phrase) for phrase in matched}
    matched_shapes = matched.intersection(_PASTA_SHAPES)
    if matched_shapes:
        concepts.add("pasta")
    elif "pasta" in matched and (normalized == "pasta" or normalized.endswith(" pasta")):
        # A genuinely generic pasta product can cover a requested specific shape.
        concepts.update(_PASTA_SHAPES)
    if normalized:
        concepts.add(_canonical(normalized))
    return concepts


def validate_ingredient_mentions(
    doc: MealPlanDoc,
    products: Mapping[int, ProductIngredientData],
    vocabulary: set[str],
    *,
    max_errors: int = 8,
    max_mentions_per_error: int = 5,
) -> list[str]:
    """Return bounded repair errors without echoing generated descriptions."""
    errors: list[str] = []
    index = _PhraseIndex(vocabulary)
    for day_number, day in enumerate(doc.plan, start=1):
        for meal in day.meals:
            for dish_number, dish in enumerate(meal.dishes, start=1):
                selected_concepts: set[str] = set()
                for item in dish.items:
                    product = products.get(item.id)
                    product_name = product.name if product else item.name
                    selected_concepts.update(_source_concepts(product_name, index))
                    if product and product.ingredients is not None:
                        for ingredient in product.ingredients:
                            selected_concepts.update(_source_concepts(ingredient, index))

                claims = {
                    _canonical(mention)
                    for value in (dish.dishName, dish.description)
                    for mention in _longest_mentions(value, index)
                }
                unsupported = sorted(claims - selected_concepts)
                if unsupported:
                    shown = unsupported[:max_mentions_per_error]
                    suffix = " and more" if len(unsupported) > len(shown) else ""
                    errors.append(
                        f"Day {day_number} {meal.name} dish {dish_number} mentions "
                        f"unsupported ingredients: {', '.join(shown)}{suffix}. "
                        "Add a selected product containing them or revise the dish copy."
                    )
                    if len(errors) >= max_errors:
                        return errors
    return errors
