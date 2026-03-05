"""
Tests for rag/app/validators.py — dish-centric meal plan models and helpers.

TDD: These tests are written FIRST (RED), then the implementation is updated (GREEN).
"""
import json
import pytest
from pydantic import ValidationError

from app.validators import (
    PlanItem,
    Dish,
    Meal,
    DayPlan,
    MealPlanDoc,
    flatten_dishes_to_items,
    parse_and_validate_plan_json,
    extract_item_ids,
)


# ---------------------------------------------------------------------------
# PlanItem — servingsUsed field
# ---------------------------------------------------------------------------

class TestPlanItemServingsUsed:
    def test_plan_item_servings_used_defaults_to_1(self):
        item = PlanItem(id=1, name="Oats")
        assert item.servingsUsed == 1

    def test_plan_item_servings_used_explicit_value(self):
        item = PlanItem(id=2, name="Milk", servingsUsed=3)
        assert item.servingsUsed == 3

    def test_plan_item_servings_used_minimum_is_1(self):
        with pytest.raises(ValidationError):
            PlanItem(id=3, name="Eggs", servingsUsed=0)

    def test_plan_item_servings_used_capped_at_10(self):
        with pytest.raises(ValidationError):
            PlanItem(id=4, name="Bread", servingsUsed=11)

    def test_plan_item_servings_used_boundary_10_is_valid(self):
        item = PlanItem(id=5, name="Granola", servingsUsed=10)
        assert item.servingsUsed == 10

    def test_plan_item_servings_used_boundary_1_is_valid(self):
        item = PlanItem(id=6, name="Yogurt", servingsUsed=1)
        assert item.servingsUsed == 1

    def test_plan_item_id_and_name_required(self):
        with pytest.raises(ValidationError):
            PlanItem(name="Missing ID")  # type: ignore[call-arg]

    def test_plan_item_servings_used_negative_rejected(self):
        with pytest.raises(ValidationError):
            PlanItem(id=7, name="Butter", servingsUsed=-1)


# ---------------------------------------------------------------------------
# Dish model
# ---------------------------------------------------------------------------

class TestDishModel:
    def test_dish_model_valid(self):
        dish = Dish(
            dishName="Overnight Oats",
            description="A healthy breakfast.",
            estimatedCalories=350,
            items=[
                PlanItem(id=1, name="Oats", servingsUsed=2),
                PlanItem(id=2, name="Almond Milk", servingsUsed=1),
            ],
        )
        assert dish.dishName == "Overnight Oats"
        assert dish.description == "A healthy breakfast."
        assert dish.estimatedCalories == 350
        assert len(dish.items) == 2

    def test_dish_description_is_optional(self):
        dish = Dish(
            dishName="Simple Salad",
            items=[PlanItem(id=10, name="Lettuce")],
        )
        assert dish.description is None

    def test_dish_estimated_calories_is_optional(self):
        dish = Dish(
            dishName="Simple Salad",
            items=[PlanItem(id=10, name="Lettuce")],
        )
        assert dish.estimatedCalories is None

    def test_dish_requires_at_least_one_item(self):
        with pytest.raises(ValidationError):
            Dish(dishName="Empty Dish", items=[])

    def test_dish_allows_up_to_12_items(self):
        items = [PlanItem(id=i, name=f"Item {i}") for i in range(1, 13)]
        dish = Dish(dishName="Big Dish", items=items)
        assert len(dish.items) == 12

    def test_dish_rejects_more_than_12_items(self):
        items = [PlanItem(id=i, name=f"Item {i}") for i in range(1, 14)]
        with pytest.raises(ValidationError):
            Dish(dishName="Too Big Dish", items=items)

    def test_dish_name_required(self):
        with pytest.raises(ValidationError):
            Dish(items=[PlanItem(id=1, name="Oats")])  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Meal model — now has dishes list
# ---------------------------------------------------------------------------

class TestMealWithDishes:
    def test_meal_with_dishes_valid(self):
        meal = Meal(
            name="Breakfast",
            dishes=[
                Dish(
                    dishName="Oatmeal",
                    items=[PlanItem(id=1, name="Oats", servingsUsed=2)],
                )
            ],
            items=[PlanItem(id=1, name="Oats", servingsUsed=2)],
        )
        assert meal.name == "Breakfast"
        assert len(meal.dishes) == 1
        assert len(meal.items) == 1

    def test_meal_name_must_be_literal(self):
        with pytest.raises(ValidationError):
            Meal(
                name="Brunch",  # type: ignore[arg-type]
                dishes=[],
                items=[],
            )

    def test_meal_allows_up_to_5_dishes(self):
        dishes = [
            Dish(dishName=f"Dish {i}", items=[PlanItem(id=i, name=f"Item {i}")])
            for i in range(1, 6)
        ]
        items = [PlanItem(id=i, name=f"Item {i}") for i in range(1, 6)]
        meal = Meal(name="Dinner", dishes=dishes, items=items)
        assert len(meal.dishes) == 5

    def test_meal_rejects_more_than_5_dishes(self):
        dishes = [
            Dish(dishName=f"Dish {i}", items=[PlanItem(id=i, name=f"Item {i}")])
            for i in range(1, 7)
        ]
        with pytest.raises(ValidationError):
            Meal(name="Dinner", dishes=dishes, items=[])

    def test_meal_items_allows_up_to_20(self):
        items = [PlanItem(id=i, name=f"Item {i}") for i in range(1, 21)]
        meal = Meal(
            name="Lunch",
            dishes=[Dish(dishName="Big Meal", items=[PlanItem(id=1, name="Item 1")])],
            items=items,
        )
        assert len(meal.items) == 20

    def test_meal_items_rejects_more_than_20(self):
        items = [PlanItem(id=i, name=f"Item {i}") for i in range(1, 22)]
        with pytest.raises(ValidationError):
            Meal(
                name="Lunch",
                dishes=[Dish(dishName="X", items=[PlanItem(id=1, name="Y")])],
                items=items,
            )

    def test_meal_breakfast_lunch_dinner_valid(self):
        for meal_name in ("Breakfast", "Lunch", "Dinner"):
            meal = Meal(
                name=meal_name,  # type: ignore[arg-type]
                dishes=[Dish(dishName="D", items=[PlanItem(id=1, name="I")])],
                items=[PlanItem(id=1, name="I")],
            )
            assert meal.name == meal_name


# ---------------------------------------------------------------------------
# flatten_dishes_to_items
# ---------------------------------------------------------------------------

def _make_doc_with_dishes(meals_per_day=None) -> MealPlanDoc:
    """Helper that creates a MealPlanDoc with dishes structure (pre-flatten)."""
    if meals_per_day is None:
        meals_per_day = [
            Meal(
                name="Breakfast",
                dishes=[
                    Dish(
                        dishName="Oatmeal",
                        items=[
                            PlanItem(id=1, name="Oats", servingsUsed=2),
                            PlanItem(id=2, name="Almond Milk", servingsUsed=1),
                        ],
                    ),
                    Dish(
                        dishName="Side Fruit",
                        items=[
                            PlanItem(id=3, name="Banana", servingsUsed=1),
                            PlanItem(id=1, name="Oats", servingsUsed=1),  # duplicate id=1
                        ],
                    ),
                ],
                items=[],  # empty — flatten will populate
            ),
            Meal(
                name="Lunch",
                dishes=[
                    Dish(
                        dishName="Veggie Bowl",
                        items=[
                            PlanItem(id=4, name="Brown Rice", servingsUsed=3),
                            PlanItem(id=5, name="Black Beans", servingsUsed=2),
                        ],
                    )
                ],
                items=[],
            ),
        ]
    return MealPlanDoc(
        title="Test Plan",
        startDate="2026-03-03",
        endDate="2026-03-04",
        plan=[
            DayPlan(date="2026-03-03", meals=meals_per_day),
        ],
    )


class TestFlattenDishesToItems:
    def test_flatten_dishes_to_items_deduplicates_and_sums_servings(self):
        """
        Item id=1 (Oats) appears in two dishes:
          - Dish 1: servingsUsed=2
          - Dish 2: servingsUsed=1
        After flatten, meal.items should have id=1 with servingsUsed=3.
        """
        doc = _make_doc_with_dishes()
        result = flatten_dishes_to_items(doc)

        breakfast = result.plan[0].meals[0]
        by_id = {it.id: it for it in breakfast.items}

        assert 1 in by_id, "Item id=1 (Oats) should be in flattened items"
        assert by_id[1].servingsUsed == 3  # 2 + 1 summed
        assert 2 in by_id
        assert by_id[2].servingsUsed == 1
        assert 3 in by_id
        assert by_id[3].servingsUsed == 1

    def test_flatten_dishes_to_items_preserves_item_name(self):
        doc = _make_doc_with_dishes()
        result = flatten_dishes_to_items(doc)

        breakfast = result.plan[0].meals[0]
        by_id = {it.id: it for it in breakfast.items}

        assert by_id[1].name == "Oats"
        assert by_id[2].name == "Almond Milk"

    def test_flatten_dishes_to_items_full_plan(self):
        """All meals across all days get their items populated."""
        doc = _make_doc_with_dishes()
        result = flatten_dishes_to_items(doc)

        for day in result.plan:
            for meal in day.meals:
                assert len(meal.items) > 0, f"Meal {meal.name} should have items after flatten"

    def test_flatten_returns_mutated_doc(self):
        doc = _make_doc_with_dishes()
        result = flatten_dishes_to_items(doc)
        # Returns the same doc (or a copy) — either is acceptable, just must not be None
        assert result is not None
        assert isinstance(result, MealPlanDoc)

    def test_meal_dishes_empty_list_is_rejected(self):
        """Meal.dishes requires at least 1 dish — empty list must raise ValidationError."""
        with pytest.raises(ValidationError):
            Meal(name="Dinner", dishes=[], items=[])

    def test_flatten_does_not_duplicate_across_meals(self):
        """
        Items from Breakfast dishes should NOT bleed into Lunch items and vice versa.
        """
        doc = _make_doc_with_dishes()
        result = flatten_dishes_to_items(doc)

        breakfast_ids = {it.id for it in result.plan[0].meals[0].items}
        lunch_ids = {it.id for it in result.plan[0].meals[1].items}

        # Oats (id=1) only in breakfast; Brown Rice (id=4) only in lunch
        assert 1 in breakfast_ids
        assert 4 not in breakfast_ids
        assert 4 in lunch_ids
        assert 1 not in lunch_ids

    def test_flatten_multi_day_plan(self):
        """Test flatten works across multiple days."""
        day1_meals = [
            Meal(
                name="Breakfast",
                dishes=[Dish(dishName="D1", items=[PlanItem(id=10, name="Item10", servingsUsed=1)])],
                items=[],
            )
        ]
        day2_meals = [
            Meal(
                name="Lunch",
                dishes=[Dish(dishName="D2", items=[PlanItem(id=20, name="Item20", servingsUsed=2)])],
                items=[],
            )
        ]
        doc = MealPlanDoc(
            title="Multi-Day",
            startDate="2026-03-03",
            endDate="2026-03-04",
            plan=[
                DayPlan(date="2026-03-03", meals=day1_meals),
                DayPlan(date="2026-03-04", meals=day2_meals),
            ],
        )
        result = flatten_dishes_to_items(doc)

        day1_items = result.plan[0].meals[0].items
        day2_items = result.plan[1].meals[0].items

        assert len(day1_items) == 1
        assert day1_items[0].id == 10
        assert len(day2_items) == 1
        assert day2_items[0].id == 20
        assert day2_items[0].servingsUsed == 2


# ---------------------------------------------------------------------------
# extract_item_ids — must walk dishes
# ---------------------------------------------------------------------------

class TestExtractItemIdsWalksDishes:
    def test_extract_item_ids_walks_dishes(self):
        """
        extract_item_ids should still work correctly after flatten has populated
        meal.items from dishes.
        """
        doc = _make_doc_with_dishes()
        flat_doc = flatten_dishes_to_items(doc)
        ids = extract_item_ids(flat_doc)

        # After flatten:
        # Breakfast items: 1 (Oats), 2 (Almond Milk), 3 (Banana)
        # Lunch items: 4 (Brown Rice), 5 (Black Beans)
        assert set(ids) == {1, 2, 3, 4, 5}

    def test_extract_item_ids_returns_all_including_duplicates(self):
        """
        extract_item_ids returns a flat list (with duplicates across meals/days)
        so the validator can check them all.
        """
        doc = _make_doc_with_dishes()
        flat_doc = flatten_dishes_to_items(doc)
        ids = extract_item_ids(flat_doc)

        # All IDs should appear (there might be duplicates across days/meals,
        # but at minimum each unique ID appears at least once)
        assert len(ids) >= 5

    def test_extract_item_ids_empty_plan(self):
        doc = MealPlanDoc(
            title="Empty",
            startDate="2026-03-03",
            endDate="2026-03-03",
            plan=[],
        )
        assert extract_item_ids(doc) == []


# ---------------------------------------------------------------------------
# parse_and_validate_plan_json — dish-centric JSON
# ---------------------------------------------------------------------------

class TestParseAndValidatePlanJsonWithDishes:
    def _valid_dish_json(self) -> str:
        return json.dumps({
            "title": "My Dish Plan",
            "startDate": "2026-03-03",
            "endDate": "2026-03-03",
            "plan": [
                {
                    "date": "2026-03-03",
                    "meals": [
                        {
                            "name": "Breakfast",
                            "dishes": [
                                {
                                    "dishName": "Overnight Oats",
                                    "description": "Creamy and filling",
                                    "estimatedCalories": 400,
                                    "items": [
                                        {"id": 1, "name": "Oats", "servingsUsed": 2},
                                        {"id": 2, "name": "Almond Milk", "servingsUsed": 1},
                                    ],
                                }
                            ],
                            "items": [
                                {"id": 1, "name": "Oats", "servingsUsed": 2},
                                {"id": 2, "name": "Almond Milk", "servingsUsed": 1},
                            ],
                        }
                    ],
                }
            ],
        })

    def test_parse_valid_dish_centric_json(self):
        doc = parse_and_validate_plan_json(self._valid_dish_json())
        assert doc.title == "My Dish Plan"
        meal = doc.plan[0].meals[0]
        assert len(meal.dishes) == 1
        assert meal.dishes[0].dishName == "Overnight Oats"
        assert meal.dishes[0].estimatedCalories == 400
        assert meal.dishes[0].items[0].servingsUsed == 2

    def test_parse_empty_string_raises_500(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            parse_and_validate_plan_json("")
        assert exc_info.value.status_code == 500

    def test_parse_invalid_json_raises_500(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            parse_and_validate_plan_json("{invalid json")
        assert exc_info.value.status_code == 500

    def test_parse_schema_violation_raises_500(self):
        """servingsUsed=0 should fail validation."""
        from fastapi import HTTPException
        bad = json.dumps({
            "title": "Bad Plan",
            "startDate": "2026-03-03",
            "endDate": "2026-03-03",
            "plan": [
                {
                    "date": "2026-03-03",
                    "meals": [
                        {
                            "name": "Breakfast",
                            "dishes": [
                                {
                                    "dishName": "Bad Dish",
                                    "items": [{"id": 1, "name": "Oats", "servingsUsed": 0}],
                                }
                            ],
                            "items": [],
                        }
                    ],
                }
            ],
        })
        with pytest.raises(HTTPException) as exc_info:
            parse_and_validate_plan_json(bad)
        assert exc_info.value.status_code == 500
