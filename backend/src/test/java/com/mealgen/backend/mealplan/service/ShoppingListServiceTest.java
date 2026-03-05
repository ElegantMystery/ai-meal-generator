package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.items.model.Item;
import com.mealgen.backend.items.repository.ItemRepository;
import com.mealgen.backend.mealplan.dto.ShoppingListItemDto;
import com.mealgen.backend.mealplan.dto.ShoppingListResponse;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Unit tests for ShoppingListService focusing on the servingsUsed-based qty calculation.
 *
 * TDD Red → Green → Refactor.
 * Tests written FIRST, then implementation updated to pass them.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ShoppingListServiceTest {

    @Mock
    private MealPlanRepository mealPlanRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private ItemRepository itemRepository;

    @Mock
    private EntityManager entityManager;

    @Mock
    private Query nativeQuery;

    @InjectMocks
    private ShoppingListService shoppingListService;

    private static final String USER_EMAIL = "test@example.com";
    private static final Long MEAL_PLAN_ID = 1L;

    private User testUser;
    private MealPlan testMealPlan;

    @BeforeEach
    void setUp() {
        testUser = User.builder()
                .id(10L)
                .email(USER_EMAIL)
                .name("Test User")
                .provider("local")
                .build();

        testMealPlan = MealPlan.builder()
                .id(MEAL_PLAN_ID)
                .user(testUser)
                .build();

        when(userRepository.findByEmail(USER_EMAIL)).thenReturn(Optional.of(testUser));
        when(mealPlanRepository.findById(MEAL_PLAN_ID)).thenReturn(Optional.of(testMealPlan));
    }

    // -------------------------------------------------------------------------
    // Helper methods
    // -------------------------------------------------------------------------

    /**
     * Build a planJson string with a single item appearing once with the given servingsUsed.
     */
    private String planJsonWithOneItem(long itemId, double servingsUsed) {
        return """
                {
                  "days": 1,
                  "plan": [
                    {
                      "date": "2026-01-01",
                      "meals": [
                        {
                          "name": "Dinner",
                          "items": [
                            { "id": %d, "name": "Item %d", "servingsUsed": %s }
                          ]
                        }
                      ]
                    }
                  ]
                }
                """.formatted(itemId, itemId, servingsUsed);
    }

    /**
     * Build a planJson where itemId appears in multiple meals with the given servingsUsed values.
     */
    private String planJsonWithItemInMultipleMeals(long itemId, double... servingsUsedValues) {
        StringBuilder mealsJson = new StringBuilder();
        for (int i = 0; i < servingsUsedValues.length; i++) {
            if (i > 0) mealsJson.append(",");
            mealsJson.append("""
                    {
                      "name": "Meal %d",
                      "items": [
                        { "id": %d, "name": "Item", "servingsUsed": %s }
                      ]
                    }
                    """.formatted(i + 1, itemId, servingsUsedValues[i]));
        }
        return """
                {
                  "days": 7,
                  "plan": [
                    {
                      "date": "2026-01-01",
                      "meals": [%s]
                    }
                  ]
                }
                """.formatted(mealsJson);
    }

    /** Build a nutrition JSON string for item_nutrition.nutrition column. */
    private String nutritionJson(Integer servingCount) {
        if (servingCount == null) {
            return """
                    { "parsed": { "calories": 120 } }
                    """;
        }
        return """
                { "parsed": { "serving_count": %d, "calories": 120, "protein_g": 5.0 } }
                """.formatted(servingCount);
    }

    /**
     * Set up the entity manager mock to return nutrition data for a list of item IDs.
     * Each row is Object[]{itemId (Long), nutritionJson (String)}.
     */
    @SuppressWarnings("unchecked")
    private void mockNutritionQuery(List<Object[]> nutritionRows) {
        when(entityManager.createNativeQuery(anyString())).thenReturn(nativeQuery);
        when(nativeQuery.setParameter(anyString(), any())).thenReturn(nativeQuery);
        // Raw type necessary because Query.getResultList() returns raw List
        when(nativeQuery.getResultList()).thenReturn((List) nutritionRows);
    }

    /**
     * Build a List<Object[]> with one nutrition row.
     * Using explicit typed factory avoids Java varargs Object[] inference issues.
     */
    private List<Object[]> oneNutritionRow(long itemId, String nutritionJsonStr) {
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[]{itemId, nutritionJsonStr});
        return rows;
    }

    // -------------------------------------------------------------------------
    // qty = ceil(totalServingsUsed / serving_count)
    // -------------------------------------------------------------------------

    @Test
    void qty_isOne_whenServingCount33_andTotalServingsUsed2point85() {
        // ceil(2.85 / 33) = ceil(0.086) = 1
        long itemId = 100L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 2.85));

        Item item = Item.builder().id(itemId).name("Olive Oil").price(5.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(33)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        ShoppingListItemDto dto = response.getItems().get(0);
        assertThat(dto.getId()).isEqualTo(itemId);
        assertThat(dto.getQty()).isEqualTo(1);
    }

    @Test
    void qty_isOne_whenServingCount12_andTotalServingsUsed8() {
        // ceil(8.0 / 12) = ceil(0.667) = 1
        long itemId = 101L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 8.0));

        Item item = Item.builder().id(itemId).name("Rice").price(3.49).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(12)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isEqualTo(1);
    }

    @Test
    void qty_isTwo_whenServingCount2_andTotalServingsUsed3() {
        // ceil(3.0 / 2) = ceil(1.5) = 2
        long itemId = 102L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 3.0));

        Item item = Item.builder().id(itemId).name("Salmon").price(12.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(2)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isEqualTo(2);
    }

    @Test
    void qty_isCeilOfTotalServingsUsed_whenServingCountIsNull() {
        // serving_count missing → qty = ceil(totalServingsUsed) = ceil(2.5) = 3
        long itemId = 103L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 2.5));

        Item item = Item.builder().id(itemId).name("Butter").price(4.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        // Nutrition JSON without serving_count
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(null)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isEqualTo(3);
    }

    @Test
    void qty_isCeilOfTotalServingsUsed_whenNoNutritionDataForItem() {
        // No nutrition row at all → qty = ceil(totalServingsUsed) = ceil(2.5) = 3
        long itemId = 104L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 2.5));

        Item item = Item.builder().id(itemId).name("Tuna").price(2.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        // Empty nutrition result — no row for this item
        mockNutritionQuery(new ArrayList<>());

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isEqualTo(3);
    }

    @Test
    void qty_isMinimumOne_whenServingsUsedIsVerySmall() {
        // ceil(0.1 / 33) = ceil(0.003) = 1 — minimum is always 1
        long itemId = 105L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 0.1));

        Item item = Item.builder().id(itemId).name("Salt").price(1.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(33)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isGreaterThanOrEqualTo(1);
    }

    // -------------------------------------------------------------------------
    // servingsUsed summed across multiple meals
    // -------------------------------------------------------------------------

    @Test
    void servingsUsed_isSummedAcrossMultipleMeals() {
        // Item appears in 3 meals with servingsUsed 1.0, 0.5, 1.5 → total = 3.0
        // serving_count = 2 → qty = ceil(3.0 / 2) = ceil(1.5) = 2
        long itemId = 200L;
        testMealPlan.setPlanJson(planJsonWithItemInMultipleMeals(itemId, 1.0, 0.5, 1.5));

        Item item = Item.builder().id(itemId).name("Pasta").price(2.49).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(2)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isEqualTo(2);
    }

    @Test
    void servingsUsed_summedForOliveOilScenario_seventMeals() {
        // Olive oil used 0.1 servings in each of 7 meals → total = 0.7
        // serving_count = 33 → qty = ceil(0.7 / 33) = ceil(0.021) = 1
        long itemId = 201L;
        testMealPlan.setPlanJson(planJsonWithItemInMultipleMeals(
                itemId, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1)); // 7 meals × 0.1 = 0.7

        Item item = Item.builder().id(itemId).name("Olive Oil").price(8.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(33)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        // Should be 1 bottle (not 7 — old count-based bug)
        assertThat(response.getItems().get(0).getQty()).isEqualTo(1);
    }

    @Test
    void qty_oldCountBasedBugWouldHaveGiven7_newBehaviorGives1() {
        // Regression: old code counted +1 per occurrence → 7 bottles for olive oil
        // New code sums servingsUsed and divides by serving_count → should be 1
        long itemId = 202L;
        testMealPlan.setPlanJson(planJsonWithItemInMultipleMeals(
                itemId, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1));

        Item item = Item.builder().id(itemId).name("Olive Oil").price(7.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(33)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        ShoppingListItemDto dto = response.getItems().get(0);
        // The new qty must be 1 (NOT 7)
        assertThat(dto.getQty()).isEqualTo(1);
        assertThat(dto.getQty()).isNotEqualTo(7);
    }

    // -------------------------------------------------------------------------
    // lineTotal uses qty (not occurrence count)
    // -------------------------------------------------------------------------

    @Test
    void lineTotal_isPrice_multipliedByQty() {
        // serving_count=2, servingsUsed=3.0 → qty=2; price=10.00 → lineTotal=20.00
        long itemId = 300L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 3.0));

        Item item = Item.builder().id(itemId).name("Salmon").price(10.00).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(2)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        ShoppingListItemDto dto = response.getItems().get(0);
        assertThat(dto.getQty()).isEqualTo(2);
        assertThat(dto.getLineTotal()).isEqualTo(20.00);
    }

    @Test
    void lineTotal_isNullWhenPriceIsNull() {
        long itemId = 301L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 2.0));

        Item item = Item.builder().id(itemId).name("Unprice Item").price(null).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(2)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems().get(0).getLineTotal()).isNull();
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    @Test
    void returnsEmptyList_whenPlanJsonIsNull() {
        testMealPlan.setPlanJson(null);

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).isEmpty();
        assertThat(response.getEstimatedTotal()).isEqualTo(0.0);
    }

    @Test
    void returnsEmptyList_whenPlanHasNoItems() {
        testMealPlan.setPlanJson("""
                {
                  "days": 1,
                  "plan": [
                    {
                      "date": "2026-01-01",
                      "meals": [
                        { "name": "Dinner", "items": [] }
                      ]
                    }
                  ]
                }
                """);

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).isEmpty();
    }

    @Test
    void throwsException_whenUserNotFound() {
        when(userRepository.findByEmail("unknown@example.com")).thenReturn(Optional.empty());

        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalStateException.class,
                () -> shoppingListService.getShoppingList("unknown@example.com", MEAL_PLAN_ID)
        );
    }

    @Test
    void throwsException_whenMealPlanNotFound() {
        when(mealPlanRepository.findById(999L)).thenReturn(Optional.empty());

        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> shoppingListService.getShoppingList(USER_EMAIL, 999L)
        );
    }

    @Test
    void throwsException_whenMealPlanBelongsToDifferentUser() {
        User otherUser = User.builder().id(99L).email("other@example.com").build();
        MealPlan otherPlan = MealPlan.builder().id(555L).user(otherUser).build();
        when(mealPlanRepository.findById(555L)).thenReturn(Optional.of(otherPlan));

        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalStateException.class,
                () -> shoppingListService.getShoppingList(USER_EMAIL, 555L)
        );
    }
}
