import json

import pytest

from app.ingredient_validation import (
    ProductIngredientData,
    build_ingredient_vocabulary,
    normalize_ingredient,
    parse_product_ingredients,
    validate_ingredient_mentions,
)
from app.validators import DayPlan, Dish, Meal, MealPlanDoc, PlanItem


def _item(item_id, name):
    return PlanItem(
        id=item_id,
        name=name,
        servingsUsed=1,
        amountUsed={"value": 100, "unit": "g"},
    )


def _doc(dish_name, description, items):
    return MealPlanDoc(
        title="Test",
        startDate="2026-05-12",
        endDate="2026-05-12",
        plan=[DayPlan(date="2026-05-12", meals=[Meal(
            name="Lunch",
            dishes=[Dish(dishName=dish_name, description=description, items=items)],
        )])],
    )


RECIPE_ROWS = [
    {"ingredients_json": json.dumps([
        {"name": "avocados"}, {"name": "fresh garlic"}, {"name": "honey"},
        {"name": "marinara sauce"}, {"name": "green onions"},
        {"name": "sea bass"}, {"name": "chickpeas"}, {"name": "prawns"},
        {"name": "bread"}, {"name": "pasta"},
    ])}
]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (" Fresh, chopped TOMATOES! ", "tomato"),
        ("roasted garlic", "garlic"),
        ("Green Onions", "green onion"),
        ("garlic_powder", "garlic powder"),
    ],
)
def test_normalize_ingredient(raw, expected):
    assert normalize_ingredient(raw) == expected


@pytest.mark.parametrize(
    ("dish_name", "description", "missing"),
    [
        ("Avocado Toast", "Toasted bread", "avocado"),
        ("Garlic Mushrooms", "Savory mushrooms", "garlic"),
        ("Yogurt Bowl", "Finished with honey", "honey"),
        ("Marinara Pasta", "A tomato dinner", "marinara"),
    ],
)
def test_rejects_recognized_ingredient_claim_without_coverage(
    dish_name, description, missing
):
    vocabulary = build_ingredient_vocabulary(RECIPE_ROWS)
    products = {
        1: ProductIngredientData(id=1, name="Plain Mushrooms", ingredients=[]),
        2: ProductIngredientData(id=2, name="Plain Yogurt", ingredients=[]),
        3: ProductIngredientData(id=3, name="Dry Pasta", ingredients=[]),
    }

    errors = validate_ingredient_mentions(
        _doc(dish_name, description, [_item(1, "Plain Mushrooms"), _item(2, "Plain Yogurt"), _item(3, "Dry Pasta")]),
        products,
        vocabulary,
    )

    assert len(errors) == 1
    assert missing in errors[0]
    assert "Day 1 Lunch dish 1" in errors[0]


def test_accepts_ingredient_contained_in_selected_product():
    vocabulary = build_ingredient_vocabulary(RECIPE_ROWS)
    products = {
        1: ProductIngredientData(
            id=1,
            name="Tomato Pasta Sauce",
            ingredients=["Tomatoes", "Roasted Garlic", "Olive Oil"],
        )
    }
    doc = _doc("Garlic Pasta", "Pasta with garlic", [_item(1, "Tomato Pasta Sauce")])

    assert validate_ingredient_mentions(doc, products, vocabulary) == []


@pytest.mark.parametrize(
    ("claim", "selected_name"),
    [
        ("Scallion Rice", "Green Onions"),
        ("Branzino Plate", "Sea Bass Fillet"),
        ("Garbanzo Bowl", "Canned Chickpeas"),
        ("Shrimp Plate", "Frozen Prawns"),
        ("Avocado Toast", "Sourdough Bread and Avocados"),
        ("Farfalle Primavera", "Dry Pasta"),
    ],
)
def test_accepts_supported_aliases(claim, selected_name):
    vocabulary = build_ingredient_vocabulary(RECIPE_ROWS)
    products = {1: ProductIngredientData(id=1, name=selected_name, ingredients=[])}

    assert validate_ingredient_mentions(
        _doc(claim, None, [_item(1, selected_name)]), products, vocabulary
    ) == []


def test_specific_pasta_shape_does_not_cover_sibling_shape():
    vocabulary = build_ingredient_vocabulary(RECIPE_ROWS)
    products = {1: ProductIngredientData(id=1, name="Orzo", ingredients=[])}

    errors = validate_ingredient_mentions(
        _doc("Spaghetti Dinner", None, [_item(1, "Orzo")]), products, vocabulary
    )

    assert errors and "spaghetti" in errors[0]


def test_missing_metadata_fails_closed_when_name_does_not_cover_claim():
    vocabulary = build_ingredient_vocabulary(RECIPE_ROWS)
    products = {1: ProductIngredientData(id=1, name="Plain Sauce", ingredients=None)}

    errors = validate_ingredient_mentions(
        _doc("Garlic Pasta", None, [_item(1, "Plain Sauce")]), products, vocabulary
    )

    assert errors and "garlic" in errors[0]


def test_errors_are_bounded_and_do_not_include_descriptions():
    vocabulary = build_ingredient_vocabulary(RECIPE_ROWS)
    products = {1: ProductIngredientData(id=1, name="Plain Product", ingredients=[])}
    secret_description = "honey avocado garlic marinara sauce PRIVATE DESCRIPTION"
    doc = _doc("Claim-heavy dish", secret_description, [_item(1, "Plain Product")])

    errors = validate_ingredient_mentions(doc, products, vocabulary, max_errors=1)

    assert len(errors) == 1
    assert "PRIVATE DESCRIPTION" not in errors[0]


def test_vocabulary_omits_unbounded_ingredient_names():
    too_long = "ingredient " * 50
    vocabulary = build_ingredient_vocabulary([
        {"ingredients_json": json.dumps([{"name": too_long}, {"name": "garlic"}])}
    ])

    assert "garlic" in vocabulary
    assert all(len(phrase) <= 80 for phrase in vocabulary)


def test_parses_selected_product_ingredient_metadata():
    raw = json.dumps({
        "parsed": {
            "ingredients_list": [{"name": "Tomatoes"}, {"name": "Roasted Garlic"}]
        }
    })

    assert parse_product_ingredients(raw) == ["Tomatoes", "Roasted Garlic"]
    assert parse_product_ingredients(None) is None
