package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.items.model.Item;
import com.mealgen.backend.items.repository.ItemRepository;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import com.mealgen.backend.preferences.model.UserPreferences;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MealPlanGenerateService {

    private final UserRepository userRepository;
    private final UserPreferencesRepository preferencesRepository;
    private final ItemRepository itemRepository;
    private final MealPlanRepository mealPlanRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Transactional
    public MealPlanResponse generate(String email, String store, int days) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("User not found for email: " + email));

        UserPreferences prefs = preferencesRepository.findByUserId(user.getId()).orElse(null);

        List<Item> all = itemRepository.findByStoreIgnoreCase(store);
        if (all.isEmpty()) {
            throw new IllegalArgumentException("No items found for store=" + store);
        }

        // Filter by allergies (very simple string matching)
        Set<String> allergies = splitToSet(prefs == null ? null : prefs.getAllergies());
        List<Item> filtered = all.stream()
                .filter(i -> !containsAny(i.getName(), allergies))
                .collect(Collectors.toList());

        if (filtered.size() < 10) {
            // If filter too aggressive, fall back
            filtered = all;
        }

        // Categorize items using simple keyword heuristics
        List<Item> proteins = filtered.stream().filter(this::isProtein).toList();
        List<Item> veggies   = filtered.stream().filter(this::isVeggie).toList();
        List<Item> carbs     = filtered.stream().filter(this::isCarb).toList();
        List<Item> snacks    = filtered.stream().filter(this::isSnack).toList();

        // Fallback buckets (avoid empty lists)
        if (proteins.isEmpty()) proteins = filtered;
        if (veggies.isEmpty()) veggies = filtered;
        if (carbs.isEmpty()) carbs = filtered;
        if (snacks.isEmpty()) snacks = filtered;

        LocalDate start = LocalDate.now();
        LocalDate end = start.plusDays(Math.max(days, 1) - 1);

        // Deterministic randomness (so repeated calls same day are similar per user)
        long seed = Objects.hash(user.getId(), store.toUpperCase(Locale.ROOT), start.toString(), days);
        Random rng = new Random(seed);

        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("store", store.toUpperCase(Locale.ROOT));
        plan.put("days", days);

        Map<String, Object> prefSummary = new LinkedHashMap<>();
        prefSummary.put("dietaryRestrictions", prefs == null ? null : prefs.getDietaryRestrictions());
        prefSummary.put("allergies", prefs == null ? null : prefs.getAllergies());
        prefSummary.put("targetCaloriesPerDay", prefs == null ? null : prefs.getTargetCaloriesPerDay());
        plan.put("preferences", prefSummary);

        List<Map<String, Object>> dayPlans = new ArrayList<>();

        for (int d = 0; d < days; d++) {
            LocalDate date = start.plusDays(d);

            Item breakfast = pickOne(snacks, rng);
            Item lunchProtein = pickOne(proteins, rng);
            Item lunchVeg = pickOne(veggies, rng);
            Item dinnerProtein = pickOne(proteins, rng);
            Item dinnerCarb = pickOne(carbs, rng);
            Item dinnerVeg = pickOne(veggies, rng);

            Map<String, Object> dayPlan = new LinkedHashMap<>();
            dayPlan.put("date", date.toString());

            dayPlan.put("meals", List.of(
                    meal("Breakfast", List.of(breakfast)),
                    meal("Lunch", List.of(lunchProtein, lunchVeg)),
                    meal("Dinner", List.of(dinnerProtein, dinnerCarb, dinnerVeg))
            ));

            dayPlans.add(dayPlan);
        }

        plan.put("plan", dayPlans);

        String planJson;
        try {
            planJson = objectMapper.writeValueAsString(plan);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize plan JSON", e);
        }

        String title = "Generated Meal Plan (" + store.toUpperCase(Locale.ROOT) + ", " + days + " days)";

        MealPlan saved = mealPlanRepository.save(MealPlan.builder()
                .user(user)
                .title(title)
                .startDate(start)
                .endDate(end)
                .planJson(planJson)
                .build());

        return MealPlanResponse.builder()
                .id(saved.getId())
                .title(saved.getTitle())
                .startDate(saved.getStartDate() == null ? null : saved.getStartDate().toString())
                .endDate(saved.getEndDate() == null ? null : saved.getEndDate().toString())
                .planJson(saved.getPlanJson())
                .createdAt(saved.getCreatedAt() == null ? null : saved.getCreatedAt().toString())
                .build();
    }

    private Map<String, Object> meal(String name, List<Item> items) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("items", items.stream().map(i -> Map.of(
                "id", i.getId(),
                "name", i.getName(),
                "price", i.getPrice(),
                "categoryPath", i.getCategoryPath(),
                "imageUrl", i.getImageUrl()
        )).toList());
        return m;
    }

    private Item pickOne(List<Item> list, Random rng) {
        return list.get(rng.nextInt(list.size()));
    }

    private Set<String> splitToSet(String s) {
        if (s == null || s.isBlank()) return Collections.emptySet();
        // allow user to type "cilantro; blue cheese, mayo"
        return Arrays.stream(s.split("[,;]"))
                .map(String::trim)
                .filter(t -> !t.isEmpty())
                .map(String::toLowerCase)
                .collect(Collectors.toSet());
    }

    private boolean containsAny(String text, Set<String> tokens) {
        if (tokens.isEmpty() || text == null) return false;
        String t = text.toLowerCase(Locale.ROOT);
        for (String token : tokens) {
            if (!token.isBlank() && t.contains(token)) return true;
        }
        return false;
    }

    // --- Heuristics: tune later ---
    private boolean isProtein(Item i) {
        String s = (safe(i.getCategoryPath()) + " " + safe(i.getName())).toLowerCase(Locale.ROOT);
        return containsAnyToken(s, List.of(
                "chicken","beef","pork","turkey","salmon","tuna","shrimp","fish","egg","tofu",
                "sausage","ham","steak","ground","meat","protein"
        ));
    }

    private boolean isVeggie(Item i) {
        String s = (safe(i.getCategoryPath()) + " " + safe(i.getName())).toLowerCase(Locale.ROOT);
        return containsAnyToken(s, List.of(
                "vegetable","veggie","broccoli","spinach","salad","lettuce","kale","cabbage","carrot",
                "cauliflower","brussels","pepper","onion","mushroom","tomato"
        ));
    }

    private boolean isCarb(Item i) {
        String s = (safe(i.getCategoryPath()) + " " + safe(i.getName())).toLowerCase(Locale.ROOT);
        return containsAnyToken(s, List.of(
                "rice","pasta","noodle","bread","tortilla","bun","bagel","potato","quinoa","oat","cereal"
        ));
    }

    private boolean isSnack(Item i) {
        String s = (safe(i.getCategoryPath()) + " " + safe(i.getName())).toLowerCase(Locale.ROOT);
        return containsAnyToken(s, List.of(
                "snack","chips","cookie","cracker","yogurt","granola","bar","nuts","fruit","berries"
        ));
    }

    private boolean containsAnyToken(String s, List<String> tokens) {
        for (String t : tokens) if (s.contains(t)) return true;
        return false;
    }

    private String safe(String s) {
        return s == null ? "" : s;
    }
}
