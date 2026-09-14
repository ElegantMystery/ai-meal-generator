package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.mockito.Spy;
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

    @Spy
    private ObjectMapper objectMapper = new ObjectMapper()
            .configure(JsonParser.Feature.ALLOW_COMMENTS, true);

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

    private String planJsonWithOneAmount(long itemId, double servingsUsed, double amount, String unit) {
        return """
                {
                  "days": 1,
                  "plan": [{
                    "date": "2026-01-01",
                    "meals": [{
                      "name": "Dinner",
                      "items": [{
                        "id": %d,
                        "name": "Item %d",
                        "servingsUsed": %s,
                        "amountUsed": { "value": %s, "unit": "%s" }
                      }]
                    }]
                  }]
                }
                """.formatted(itemId, itemId, servingsUsed, amount, unit);
    }

    private String planJsonWithRepeatedAmounts(long itemId, double first, double second, String unit) {
        return """
                {
                  "days": 2,
                  "plan": [{
                    "date": "2026-01-01",
                    "meals": [
                      { "name": "Lunch", "items": [{
                        "id": %d, "name": "Item", "servingsUsed": 1,
                        "amountUsed": { "value": %s, "unit": "%s" }
                      }]},
                      { "name": "Dinner", "items": [{
                        "id": %d, "name": "Item", "servingsUsed": 1,
                        "amountUsed": { "value": %s, "unit": "%s" }
                      }]}
                    ]
                  }]
                }
                """.formatted(itemId, first, unit, itemId, second, unit);
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
        assertThat(dto.getNeededAmount()).isNull();
        assertThat(dto.getNeededUnit()).isNull();
        assertThat(dto.getQuantityEstimated()).isFalse();
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
    void qty_isOneEstimatedPackage_whenServingCountIsNull() {
        long itemId = 103L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 2.5));

        Item item = Item.builder().id(itemId).name("Butter").price(4.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        // Nutrition JSON without serving_count
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(null)));

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isEqualTo(1);
        assertThat(response.getItems().get(0).getQuantityEstimated()).isTrue();
    }

    @Test
    void qty_isOneEstimatedPackage_whenNoNutritionDataForItem() {
        long itemId = 104L;
        testMealPlan.setPlanJson(planJsonWithOneItem(itemId, 2.5));

        Item item = Item.builder().id(itemId).name("Tuna").price(2.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        // Empty nutrition result — no row for this item
        mockNutritionQuery(new ArrayList<>());

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().get(0).getQty()).isEqualTo(1);
        assertThat(response.getItems().get(0).getQuantityEstimated()).isTrue();
    }

    @Test
    void physicalMassUsesPackageSizeInsteadOfTreatingServingsAsPackages() {
        long itemId = 110L;
        testMealPlan.setPlanJson(planJsonWithOneAmount(itemId, 3.0, 170, "g"));
        Item item = Item.builder().id(itemId).name("Spaghetti").unitSize("1 lb").price(3.00).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(null)));

        ShoppingListItemDto dto = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID).getItems().getFirst();

        assertThat(dto.getQty()).isEqualTo(1);
        assertThat(dto.getNeededAmount()).isEqualTo(170.0);
        assertThat(dto.getNeededUnit()).isEqualTo("g");
        assertThat(dto.getQuantityEstimated()).isFalse();
        assertThat(dto.getLineTotal()).isEqualTo(3.00);
    }

    @Test
    void repeatedPhysicalAmountsAreSummedAndCanExceedOnePackage() {
        long itemId = 111L;
        testMealPlan.setPlanJson(planJsonWithRepeatedAmounts(itemId, 300, 250, "g"));
        Item item = Item.builder().id(itemId).name("Farfalle").unitSize("1 lb").price(2.50).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(List.of());

        ShoppingListItemDto dto = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID).getItems().getFirst();

        assertThat(dto.getQty()).isEqualTo(2);
        assertThat(dto.getNeededAmount()).isEqualTo(550.0);
        assertThat(dto.getQuantityEstimated()).isFalse();
        assertThat(dto.getLineTotal()).isEqualTo(5.00);
    }

    @Test
    void supportsPhysicalVolumeAndCountQuantities() {
        long milkId = 112L;
        long eggId = 113L;
        testMealPlan.setPlanJson("""
                { "days": 1, "plan": [{ "meals": [{ "items": [
                  { "id": 112, "servingsUsed": 1, "amountUsed": { "value": 1200, "unit": "ml" } },
                  { "id": 113, "servingsUsed": 1, "amountUsed": { "value": 13, "unit": "count" } }
                ] }] }] }
                """);
        Item milk = Item.builder().id(milkId).name("Milk").unitSize("1 l").build();
        Item eggs = Item.builder().id(eggId).name("Eggs").unitSize("1 dozen").build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(milk, eggs));
        mockNutritionQuery(List.of());

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).filteredOn(it -> it.getId().equals(milkId)).singleElement()
                .satisfies(it -> {
                    assertThat(it.getQty()).isEqualTo(2);
                    assertThat(it.getNeededUnit()).isEqualTo("ml");
                    assertThat(it.getQuantityEstimated()).isFalse();
                });
        assertThat(response.getItems()).filteredOn(it -> it.getId().equals(eggId)).singleElement()
                .satisfies(it -> {
                    assertThat(it.getQty()).isEqualTo(2);
                    assertThat(it.getNeededUnit()).isEqualTo("count");
                    assertThat(it.getQuantityEstimated()).isFalse();
                });
    }

    @Test
    void physicalAmountUsesExplicitTrailingWholeFoodsPackageSize() {
        long itemId = 114L;
        testMealPlan.setPlanJson(planJsonWithOneAmount(itemId, 3.0, 170, "g"));
        Item item = Item.builder().id(itemId).name("Organic Spaghetti, 1 lb").unitSize(null).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(List.of());

        ShoppingListItemDto dto = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID).getItems().getFirst();

        assertThat(dto.getQty()).isEqualTo(1);
        assertThat(dto.getQuantityEstimated()).isFalse();
    }

    @Test
    void compositeNameSuffixDoesNotUseInnerUnitAsAnExactPackageSize() {
        long itemId = 121L;
        testMealPlan.setPlanJson(planJsonWithOneAmount(itemId, 1.0, 700, "ml"));
        Item item = Item.builder()
                .id(itemId)
                .name("Tomato Juice 6 x 12 fl oz")
                .unitSize(null)
                .price(8.00)
                .build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(List.of());

        ShoppingListItemDto dto = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID).getItems().getFirst();

        assertThat(dto.getQty()).isEqualTo(1);
        assertThat(dto.getQuantityEstimated()).isTrue();
        assertThat(dto.getLineTotal()).isEqualTo(8.00);
    }

    @Test
    void incompatiblePhysicalUnitFallsBackToOneEstimatedPackageButKeepsNeededAmount() {
        long itemId = 115L;
        testMealPlan.setPlanJson(planJsonWithOneAmount(itemId, 2.0, 2, "count"));
        Item item = Item.builder().id(itemId).name("Romaine").unitSize("18 oz").build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(List.of());

        ShoppingListItemDto dto = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID).getItems().getFirst();

        assertThat(dto.getQty()).isEqualTo(1);
        assertThat(dto.getNeededAmount()).isEqualTo(2.0);
        assertThat(dto.getNeededUnit()).isEqualTo("count");
        assertThat(dto.getQuantityEstimated()).isTrue();
    }

    @Test
    void incompatiblePhysicalUnitUsesServingCountBeforeEstimatedFallback() {
        long itemId = 120L;
        testMealPlan.setPlanJson(planJsonWithOneAmount(itemId, 6.0, 2, "count"));
        Item item = Item.builder().id(itemId).name("Romaine").unitSize("18 oz").build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(oneNutritionRow(itemId, nutritionJson(2)));

        ShoppingListItemDto dto = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID).getItems().getFirst();

        assertThat(dto.getQty()).isEqualTo(3);
        assertThat(dto.getNeededAmount()).isEqualTo(2.0);
        assertThat(dto.getNeededUnit()).isEqualTo("count");
        assertThat(dto.getQuantityEstimated()).isFalse();
    }

    @Test
    void observedOverbuyCasesUseOnePackageWhenPhysicalNeedFits() {
        long spaghetti = 116L;
        long squash = 117L;
        long farfalle = 118L;
        long romaine = 119L;
        testMealPlan.setPlanJson("""
                { "days": 3, "plan": [{ "meals": [{ "items": [
                  { "id": 116, "servingsUsed": 3, "amountUsed": { "value": 170, "unit": "g" } },
                  { "id": 117, "servingsUsed": 2, "amountUsed": { "value": 400, "unit": "g" } },
                  { "id": 118, "servingsUsed": 2, "amountUsed": { "value": 200, "unit": "g" } },
                  { "id": 119, "servingsUsed": 1.5, "amountUsed": { "value": 300, "unit": "g" } }
                ] }] }] }
                """);
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(
                Item.builder().id(spaghetti).name("Spaghetti").unitSize("1 lb").build(),
                Item.builder().id(squash).name("Squash").unitSize("2 lb").build(),
                Item.builder().id(farfalle).name("Farfalle").unitSize("1 lb").build(),
                Item.builder().id(romaine).name("Romaine").unitSize("18 oz").build()));
        mockNutritionQuery(List.of());

        ShoppingListResponse response = shoppingListService.getShoppingList(USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).allSatisfy(it -> {
            assertThat(it.getQty()).isEqualTo(1);
            assertThat(it.getQuantityEstimated()).isFalse();
        });
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
    void configuredCompatibilityMapper_isUsedForStoredPlanJson() {
        long itemId = 401L;
        testMealPlan.setPlanJson("/* accepted by the injected mapper */\n"
                + planJsonWithOneItem(itemId, 1.0));
        Item item = Item.builder().id(itemId).name("Beans").price(1.99).build();
        when(itemRepository.findByIdIn(any())).thenReturn(List.of(item));
        mockNutritionQuery(new ArrayList<>());

        ShoppingListResponse response = shoppingListService.getShoppingList(
                USER_EMAIL, MEAL_PLAN_ID);

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getItems().getFirst().getId()).isEqualTo(itemId);
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
