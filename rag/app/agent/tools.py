"""
Agent tools for meal-plan generation.

Each tool is a Python function that the agent loop dispatches by name.
Tools are defined as plain dicts (Anthropic tool-use protocol).

The `ToolContext` carries per-request state: the store, dietary restriction,
and the captured MealPlanDoc once `submit_plan` succeeds.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from ..db import get_conn
from ..retrieval import (
    _compact_ingredients,
    _compact_nutrition,
    _fetch_by_category,
    _CATEGORY_QUOTAS_TJ,
    _CATEGORY_QUOTAS_WF,
)
from ..validators import (
    MealPlanDoc,
    flatten_dishes_to_items,
    parse_and_validate_plan_json,
    extract_item_ids,
)
from ..verify import verify_item_ids_belong_to_store

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Anthropic tool definitions (passed as `tools=` to messages.create)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "name": "list_categories",
        "description": (
            "List the high-level grocery categories available in the current store, "
            "with approximate item counts. Call this FIRST during the discover phase "
            "so you know what keywords to pass to search_items."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "search_items",
        "description": (
            "Search items by category keyword (case-insensitive substring match on "
            "category_path). Returns up to `limit` items with id, name, price, unit_size, "
            "and category_path. Use this to build a working set during discover/select."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Category keyword to match (e.g. 'Produce', 'Meat', 'Fresh Fruits & Veggies > Veggies').",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 30,
                    "default": 15,
                },
            },
            "required": ["category"],
        },
    },
    {
        "name": "get_item_details",
        "description": (
            "Fetch full nutrition facts (calories, macros, serving_count) and ingredient "
            "list for a single item id. Use during the select phase to verify protein "
            "content, allergens, or serving size before adding an item to a dish."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"item_id": {"type": "integer"}},
            "required": ["item_id"],
        },
    },
    {
        "name": "list_recipes",
        "description": (
            "Sample recipe templates to use as dish-idea inspiration. Each recipe has "
            "a dishName, ingredient name list, diets, cuisines, dishTypes. If the user "
            "has a dietary restriction it is applied automatically; pass an explicit "
            "`dietary_restriction` only to override."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 30, "default": 12},
                "dietary_restriction": {
                    "type": "string",
                    "description": "Optional explicit override (e.g. 'vegetarian', 'vegan').",
                },
                "cuisine": {
                    "type": "string",
                    "description": "Optional cuisine filter (e.g. 'italian', 'mexican').",
                },
            },
        },
    },
    {
        "name": "validate_item_ids",
        "description": (
            "Check which item_ids actually exist for the current store BEFORE calling "
            "submit_plan. Returns {valid: [...], missing: [...]}. Cheap. Call this if "
            "you are unsure whether a discovered id is real."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "item_ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "minItems": 1,
                    "maxItems": 200,
                },
            },
            "required": ["item_ids"],
        },
    },
    {
        "name": "submit_plan",
        "description": (
            "Submit the final meal-plan JSON. The plan is validated against the schema "
            "and every item_id is checked against the store. Returns {ok: true} on "
            "success (which ENDS your turn — do not call further tools), or "
            "{ok: false, errors: [...]} so you can fix and resubmit. You MUST call this "
            "exactly once with a valid plan to finish."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "plan_json": {
                    "type": "object",
                    "description": (
                        "The full meal plan: {title, startDate, endDate, "
                        "plan: [{date, meals: [{name, dishes: [{dishName, items: [{id, name, servingsUsed}]}]}]}]}"
                    ),
                },
            },
            "required": ["plan_json"],
        },
    },
]


# ---------------------------------------------------------------------------
# Per-request state passed through the tool dispatcher
# ---------------------------------------------------------------------------


@dataclass
class ToolContext:
    store: str
    days: int
    start_date: str
    dietary_restriction: Optional[str] = None
    plan_doc: Optional[MealPlanDoc] = None
    submitted: bool = False
    tool_call_count: int = 0
    categories_listed: bool = False
    items_searched: bool = False
    plan_validated: bool = False
    repair_attempted: bool = False
    summary_lines: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Tool dispatcher
# ---------------------------------------------------------------------------


def dispatch(name: str, args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    """
    Run the named tool. Returns a JSON-safe dict.

    Tools must never raise — caller-visible errors are returned as
    {'error': '...'} so the agent can react instead of the loop crashing.
    """
    ctx.tool_call_count += 1
    try:
        if name == "list_categories":
            ctx.categories_listed = True
            return _list_categories(ctx)
        if name == "search_items":
            ctx.items_searched = True
            return _search_items(args, ctx)
        if name == "get_item_details":
            return _get_item_details(args, ctx)
        if name == "list_recipes":
            return _list_recipes(args, ctx)
        if name == "validate_item_ids":
            ctx.plan_validated = True
            return _validate_item_ids(args, ctx)
        if name == "submit_plan":
            return _submit_plan(args, ctx)
        return {"error": f"unknown tool: {name}"}
    except Exception as e:
        logger.exception("Tool %s raised", name)
        return {"error": f"{type(e).__name__}: {e}"}


# ---------------------------------------------------------------------------
# Individual tool implementations
# ---------------------------------------------------------------------------


def _list_categories(ctx: ToolContext) -> Dict[str, Any]:
    quotas = (
        _CATEGORY_QUOTAS_WF
        if ctx.store.upper() == "WHOLE_FOODS"
        else _CATEGORY_QUOTAS_TJ
    )
    keywords = [kw for kw, _ in quotas]
    # Single query: left-join each keyword against matching items, group by keyword.
    # %% escapes to a literal % in the SQL sent to the DB (psycopg placeholder rule).
    placeholders = ", ".join("(%s)" for _ in keywords)
    sql = f"""
        SELECT cats.kw, COUNT(i.id) AS n
        FROM (VALUES {placeholders}) AS cats(kw)
        LEFT JOIN items i
          ON i.store ILIKE %s
         AND i.category_path ILIKE '%%' || cats.kw || '%%'
        GROUP BY cats.kw
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, keywords + [ctx.store])
        counts = {r["kw"]: int(r["n"]) for r in cur.fetchall()}
    rows = [
        {"category": kw, "approx_item_count": counts.get(kw, 0)}
        for kw, _ in quotas
    ]
    return {"store": ctx.store, "categories": rows}


def _search_items(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    category = str(args.get("category", "")).strip()
    if not category:
        return {"error": "category is required"}
    limit = max(1, min(30, int(args.get("limit", 15))))
    with get_conn() as conn, conn.cursor() as cur:
        rows = _fetch_by_category(cur, ctx.store, category, limit)
    items = [
        {
            "id": r["id"],
            "name": r["name"],
            "price": r.get("price"),
            "unit_size": r.get("unit_size"),
            "category_path": r.get("category_path"),
        }
        for r in rows
    ]
    return {"category": category, "items": items, "count": len(items)}


def _get_item_details(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    try:
        item_id = int(args["item_id"])
    except (KeyError, TypeError, ValueError):
        return {"error": "item_id must be an integer"}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.id, i.name, i.price, i.unit_size, i.category_path,
                   n.nutrition, ing.ingredients
            FROM items i
            LEFT JOIN item_nutrition n ON n.item_id = i.id
            LEFT JOIN item_ingredients ing ON ing.item_id = i.id
            WHERE i.id = %s AND i.store ILIKE %s
            """,
            (item_id, ctx.store),
        )
        row = cur.fetchone()
    if not row:
        return {"error": f"item {item_id} not found in store {ctx.store}"}
    return {
        "id": row["id"],
        "name": row["name"],
        "price": row.get("price"),
        "unit_size": row.get("unit_size"),
        "category_path": row.get("category_path"),
        "nutrition": _compact_nutrition(row.get("nutrition")),
        "ingredients": _compact_ingredients(row.get("ingredients")),
    }


def _list_recipes(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    limit = max(1, min(30, int(args.get("limit", 12))))
    diet_override = args.get("dietary_restriction")
    cuisine = args.get("cuisine")
    diet = diet_override if diet_override else ctx.dietary_restriction
    diet = diet if (diet and str(diet).lower() != "none") else None

    with get_conn() as conn, conn.cursor() as cur:
        if diet and cuisine:
            cur.execute(
                """
                SELECT title, ingredients_json, diets, cuisines, servings, dish_types
                FROM recipes
                WHERE diets @> ARRAY[%s]::text[] AND cuisines @> ARRAY[%s]::text[]
                ORDER BY RANDOM() LIMIT %s
                """,
                (diet, cuisine, limit),
            )
        elif diet:
            cur.execute(
                """
                SELECT title, ingredients_json, diets, cuisines, servings, dish_types
                FROM recipes
                WHERE diets @> ARRAY[%s]::text[]
                ORDER BY RANDOM() LIMIT %s
                """,
                (diet, limit),
            )
        elif cuisine:
            cur.execute(
                """
                SELECT title, ingredients_json, diets, cuisines, servings, dish_types
                FROM recipes
                WHERE cuisines @> ARRAY[%s]::text[]
                ORDER BY RANDOM() LIMIT %s
                """,
                (cuisine, limit),
            )
        else:
            cur.execute(
                """
                SELECT title, ingredients_json, diets, cuisines, servings, dish_types
                FROM recipes
                ORDER BY RANDOM() LIMIT %s
                """,
                (limit,),
            )
        rows = cur.fetchall()

    recipes: List[Dict[str, Any]] = []
    for r in rows:
        ing_names: List[str] = []
        if r.get("ingredients_json"):
            try:
                ings = json.loads(r["ingredients_json"])
                ing_names = [
                    i["name"] for i in ings if isinstance(i, dict) and i.get("name")
                ][:15]
            except (json.JSONDecodeError, TypeError):
                pass
        recipes.append(
            {
                "dishName": r["title"],
                "ingredients": ing_names,
                "diets": r.get("diets") or [],
                "cuisines": r.get("cuisines") or [],
                "servings": r.get("servings"),
                "dishTypes": r.get("dish_types") or [],
            }
        )
    return {
        "recipes": recipes,
        "count": len(recipes),
        "filter": {"dietary_restriction": diet, "cuisine": cuisine},
    }


def _validate_item_ids(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    ids_arg = args.get("item_ids") or []
    try:
        ids = sorted({int(x) for x in ids_arg})
    except (TypeError, ValueError):
        return {"error": "item_ids must be a list of integers"}
    if not ids:
        return {"error": "item_ids is empty"}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM items WHERE store ILIKE %s AND id = ANY(%s)",
            (ctx.store, ids),
        )
        found = {r["id"] for r in cur.fetchall()}
    missing = [i for i in ids if i not in found]
    return {"valid": sorted(found), "missing": missing}


def _submit_plan(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    plan = args.get("plan_json")
    if not isinstance(plan, dict):
        return {"ok": False, "errors": ["plan_json must be an object"]}

    # Run the existing validator: pydantic schema + servingsUsed bounds + dish/meal counts
    try:
        content = json.dumps(plan)
        doc = parse_and_validate_plan_json(content)
    except Exception as e:
        # parse_and_validate_plan_json raises HTTPException; capture the detail
        detail = getattr(e, "detail", str(e))
        if not ctx.repair_attempted:
            ctx.repair_attempted = True
        return {"ok": False, "errors": [detail] if not isinstance(detail, list) else detail}

    # Flatten dishes -> meal.items (dedupe + sum servingsUsed)
    doc = flatten_dishes_to_items(doc)

    # Verify every id belongs to the store
    ids = extract_item_ids(doc)
    try:
        verify_item_ids_belong_to_store(ctx.store, ids)
    except Exception as e:
        detail = getattr(e, "detail", str(e))
        if not ctx.repair_attempted:
            ctx.repair_attempted = True
        return {"ok": False, "errors": [detail]}

    ctx.plan_doc = doc
    ctx.submitted = True
    return {"ok": True, "message": "Plan accepted. Reply with a one-sentence confirmation and stop."}
