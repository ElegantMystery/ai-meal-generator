package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.JsonNode;
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
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ShoppingListService {

    private final MealPlanRepository mealPlanRepository;
    private final UserRepository userRepository;
    private final ItemRepository itemRepository;
    private final EntityManager entityManager;
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    /**
     * Helper class to hold parsed nutrition values
     */
    private static class NutritionValues {
        Double calories;
        Double proteinG;
        Double totalFatG;
        Double totalCarbohydrateG;
        Double sodiumMg;
        Double dietaryFiberG;
        Double totalSugarsG;
    }
    
    /**
     * Parse nutrition JSON string and extract nutrition values.
     * Returns null if parsing fails or data is missing.
     */
    private NutritionValues parseNutritionJson(String nutritionJsonStr) {
        if (nutritionJsonStr == null || nutritionJsonStr.isBlank()) {
            return null;
        }
        
        try {
            JsonNode root = objectMapper.readTree(nutritionJsonStr);
            JsonNode parsed = root.get("parsed");
            if (parsed == null || !parsed.isObject()) {
                return null;
            }
            
            NutritionValues values = new NutritionValues();
            values.calories = parsed.has("calories") && !parsed.get("calories").isNull() 
                ? parsed.get("calories").asDouble() : null;
            values.proteinG = parsed.has("protein_g") && !parsed.get("protein_g").isNull()
                ? parsed.get("protein_g").asDouble() : null;
            values.totalFatG = parsed.has("total_fat_g") && !parsed.get("total_fat_g").isNull()
                ? parsed.get("total_fat_g").asDouble() : null;
            values.totalCarbohydrateG = parsed.has("total_carbohydrate_g") && !parsed.get("total_carbohydrate_g").isNull()
                ? parsed.get("total_carbohydrate_g").asDouble() : null;
            values.sodiumMg = parsed.has("sodium_mg") && !parsed.get("sodium_mg").isNull()
                ? parsed.get("sodium_mg").asDouble() : null;
            values.dietaryFiberG = parsed.has("dietary_fiber_g") && !parsed.get("dietary_fiber_g").isNull()
                ? parsed.get("dietary_fiber_g").asDouble() : null;
            values.totalSugarsG = parsed.has("total_sugars_g") && !parsed.get("total_sugars_g").isNull()
                ? parsed.get("total_sugars_g").asDouble() : null;
            
            return values;
        } catch (Exception e) {
            // Log error but don't fail - just return null
            return null;
        }
    }

    public ShoppingListResponse getShoppingList(String email, Long mealplanId) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found"));

        MealPlan mp = mealPlanRepository.findById(mealplanId)
                .orElseThrow(() -> new IllegalArgumentException("Meal plan not found"));

        if (!mp.getUser().getId().equals(user.getId())) {
            throw new IllegalStateException("Forbidden");
        }

        String planJson = mp.getPlanJson();
        if (planJson == null || planJson.isBlank()) {
            return ShoppingListResponse.builder()
                    .mealplanId(mealplanId)
                    .items(List.of())
                    .estimatedTotal(0.0)
                    .build();
        }

        // Parse planJson once for reuse
        JsonNode root;
        try {
            root = objectMapper.readTree(planJson);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse planJson", e);
        }

        // Count item occurrences from planJson
        Map<Long, Integer> counts = new HashMap<>();
        JsonNode plan = root.get("plan");
        if (plan != null && plan.isArray()) {
            for (JsonNode day : plan) {
                JsonNode meals = day.get("meals");
                if (meals != null && meals.isArray()) {
                    for (JsonNode meal : meals) {
                        JsonNode items = meal.get("items");
                        if (items != null && items.isArray()) {
                            for (JsonNode item : items) {
                                JsonNode idNode = item.get("id");
                                if (idNode != null && idNode.canConvertToLong()) {
                                    long id = idNode.asLong();
                                    counts.put(id, counts.getOrDefault(id, 0) + 1);
                                }
                            }
                        }
                    }
                }
            }
        }

        if (counts.isEmpty()) {
            return ShoppingListResponse.builder()
                    .mealplanId(mealplanId)
                    .items(List.of())
                    .estimatedTotal(0.0)
                    .build();
        }

        List<Long> ids = new ArrayList<>(counts.keySet());
        List<Item> dbItems = itemRepository.findByIdIn(ids);

        Map<Long, Item> itemById = dbItems.stream()
                .collect(Collectors.toMap(Item::getId, it -> it));

        // Build response items, sorted by qty desc then name
        List<ShoppingListItemDto> items = ids.stream()
                .map(id -> {
                    Item it = itemById.get(id);
                    Integer qty = counts.getOrDefault(id, 0);
                    if (it == null) {
                        // Item missing from DB (should not happen if verify_id works, but safe)
                        return ShoppingListItemDto.builder()
                                .id(id)
                                .name("Unknown Item")
                                .qty(qty)
                                .build();
                    }
                    Double price = it.getPrice();
                    Double lineTotal = (price == null) ? null : price * qty;

                    return ShoppingListItemDto.builder()
                            .id(it.getId())
                            .name(it.getName())
                            .qty(qty)
                            .price(price)
                            .unitSize(it.getUnitSize())
                            .imageUrl(it.getImageUrl())
                            .lineTotal(lineTotal)
                            .build();
                })
                .sorted(Comparator
                        .comparing(ShoppingListItemDto::getQty, Comparator.reverseOrder())
                        .thenComparing(ShoppingListItemDto::getName, Comparator.nullsLast(String::compareToIgnoreCase)))
                .toList();

        double total = items.stream()
                .map(ShoppingListItemDto::getLineTotal)
                .filter(Objects::nonNull)
                .mapToDouble(Double::doubleValue)
                .sum();

        // Calculate nutrition metrics
        Map<Long, String> nutritionByItemId = fetchNutritionData(ids);
        
        // Calculate number of days
        int days = calculateDays(mp, root);
        
        // Calculate nutrition totals
        NutritionTotals nutritionTotals = calculateNutritionTotals(counts, nutritionByItemId);
        
        // Calculate per-day averages
        Double caloriesPerDay = days > 0 && nutritionTotals.totalCalories != null 
            ? Math.round(nutritionTotals.totalCalories / days * 100.0) / 100.0 : null;
        Double fatPerDay = days > 0 && nutritionTotals.totalFatG != null
            ? Math.round(nutritionTotals.totalFatG / days * 100.0) / 100.0 : null;
        Double proteinPerDay = days > 0 && nutritionTotals.totalProteinG != null
            ? Math.round(nutritionTotals.totalProteinG / days * 100.0) / 100.0 : null;
        Double carbohydratesPerDay = days > 0 && nutritionTotals.totalCarbohydrateG != null
            ? Math.round(nutritionTotals.totalCarbohydrateG / days * 100.0) / 100.0 : null;
        Double sodiumPerDay = days > 0 && nutritionTotals.totalSodiumMg != null
            ? Math.round(nutritionTotals.totalSodiumMg / days * 100.0) / 100.0 : null;
        Double fiberPerDay = days > 0 && nutritionTotals.totalFiberG != null
            ? Math.round(nutritionTotals.totalFiberG / days * 100.0) / 100.0 : null;
        Double sugarPerDay = days > 0 && nutritionTotals.totalSugarsG != null
            ? Math.round(nutritionTotals.totalSugarsG / days * 100.0) / 100.0 : null;

        return ShoppingListResponse.builder()
                .mealplanId(mealplanId)
                .store(null) // optionally parse root.get("store") if you include it
                .items(items)
                .estimatedTotal(total)
                .caloriesPerDay(caloriesPerDay)
                .fatPerDay(fatPerDay)
                .proteinPerDay(proteinPerDay)
                .carbohydratesPerDay(carbohydratesPerDay)
                .sodiumPerDay(sodiumPerDay)
                .fiberPerDay(fiberPerDay)
                .sugarPerDay(sugarPerDay)
                .build();
    }
    
    /**
     * Fetch nutrition data from item_nutrition table for given item IDs
     */
    private Map<Long, String> fetchNutritionData(List<Long> itemIds) {
        if (itemIds.isEmpty()) {
            return new HashMap<>();
        }
        
        Query query = entityManager.createNativeQuery(
            "SELECT item_id, nutrition FROM item_nutrition WHERE item_id IN :ids"
        );
        query.setParameter("ids", itemIds);
        
        @SuppressWarnings("unchecked")
        List<Object[]> results = query.getResultList();
        
        Map<Long, String> nutritionMap = new HashMap<>();
        for (Object[] row : results) {
            Long itemId = ((Number) row[0]).longValue();
            String nutrition = (String) row[1];
            nutritionMap.put(itemId, nutrition);
        }
        
        return nutritionMap;
    }
    
    /**
     * Calculate number of days in the meal plan
     */
    private int calculateDays(MealPlan mp, JsonNode root) {
        // Try to get days from dates first
        if (mp.getStartDate() != null && mp.getEndDate() != null) {
            LocalDate start = mp.getStartDate();
            LocalDate end = mp.getEndDate();
            if (!end.isBefore(start)) {
                return (int) (end.toEpochDay() - start.toEpochDay()) + 1;
            }
        }
        
        // Fallback to planJson.days
        if (root != null && root.has("days")) {
            JsonNode daysNode = root.get("days");
            if (daysNode.isInt()) {
                return daysNode.asInt();
            }
        }
        
        // Default to 1 if we can't determine
        return 1;
    }
    
    /**
     * Helper class to hold nutrition totals
     */
    private static class NutritionTotals {
        Double totalCalories;
        Double totalProteinG;
        Double totalFatG;
        Double totalCarbohydrateG;
        Double totalSodiumMg;
        Double totalFiberG;
        Double totalSugarsG;
    }
    
    /**
     * Calculate total nutrition values across all items (per-serving × quantity)
     */
    private NutritionTotals calculateNutritionTotals(Map<Long, Integer> counts, Map<Long, String> nutritionByItemId) {
        NutritionTotals totals = new NutritionTotals();
        
        for (Map.Entry<Long, Integer> entry : counts.entrySet()) {
            Long itemId = entry.getKey();
            Integer qty = entry.getValue();
            
            String nutritionJson = nutritionByItemId.get(itemId);
            if (nutritionJson == null) {
                continue;
            }
            
            NutritionValues values = parseNutritionJson(nutritionJson);
            if (values == null) {
                continue;
            }
            
            // Multiply per-serving values by quantity and add to totals
            if (values.calories != null) {
                totals.totalCalories = (totals.totalCalories == null ? 0.0 : totals.totalCalories) + (values.calories * qty);
            }
            if (values.proteinG != null) {
                totals.totalProteinG = (totals.totalProteinG == null ? 0.0 : totals.totalProteinG) + (values.proteinG * qty);
            }
            if (values.totalFatG != null) {
                totals.totalFatG = (totals.totalFatG == null ? 0.0 : totals.totalFatG) + (values.totalFatG * qty);
            }
            if (values.totalCarbohydrateG != null) {
                totals.totalCarbohydrateG = (totals.totalCarbohydrateG == null ? 0.0 : totals.totalCarbohydrateG) + (values.totalCarbohydrateG * qty);
            }
            if (values.sodiumMg != null) {
                totals.totalSodiumMg = (totals.totalSodiumMg == null ? 0.0 : totals.totalSodiumMg) + (values.sodiumMg * qty);
            }
            if (values.dietaryFiberG != null) {
                totals.totalFiberG = (totals.totalFiberG == null ? 0.0 : totals.totalFiberG) + (values.dietaryFiberG * qty);
            }
            if (values.totalSugarsG != null) {
                totals.totalSugarsG = (totals.totalSugarsG == null ? 0.0 : totals.totalSugarsG) + (values.totalSugarsG * qty);
            }
        }
        
        return totals;
    }
}
