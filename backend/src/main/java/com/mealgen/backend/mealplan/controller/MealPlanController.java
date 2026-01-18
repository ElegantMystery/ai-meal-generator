package com.mealgen.backend.mealplan.controller;

import com.mealgen.backend.mealplan.dto.MealPlanCreateRequest;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.dto.ShoppingListResponse;
import com.mealgen.backend.mealplan.service.MealPlanGenerateService;
import com.mealgen.backend.mealplan.service.MealPlanService;
import com.mealgen.backend.mealplan.service.ShoppingListService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/mealplans")
@RequiredArgsConstructor
public class MealPlanController {

    private final MealPlanService mealPlanService;
    private final MealPlanGenerateService mealPlanGenerateService;
    private final ShoppingListService shoppingListService;

    @GetMapping
    public List<MealPlanResponse> listMine(Authentication authentication) {
        return mealPlanService.listMine(getEmail(authentication));
    }

    @PostMapping
    public MealPlanResponse createMine(
            Authentication authentication,
            @RequestBody MealPlanCreateRequest req
    ) {
        return mealPlanService.createMine(getEmail(authentication), req);
    }

    @GetMapping("/{id}")
    public MealPlanResponse getMine(
            Authentication authentication,
            @PathVariable Long id
    ) {
        return mealPlanService.getMineById(getEmail(authentication), id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteMine(
            Authentication authentication,
            @PathVariable Long id
    ) {
        mealPlanService.deleteMine(getEmail(authentication), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/generate")
    public MealPlanResponse generate(
            Authentication authentication,
            @RequestParam(defaultValue = "TRADER_JOES") String store,
            @RequestParam(defaultValue = "7") int days
    ) {
        if (days < 1 || days > 14) {
            throw new IllegalArgumentException("days must be between 1 and 14");
        }
        return mealPlanGenerateService.generate(getEmail(authentication), store, days);
    }

    @PostMapping("/generate-ai")
    public MealPlanResponse generateAi(
            Authentication authentication,
            @RequestParam(defaultValue = "TRADER_JOES") String store,
            @RequestParam(defaultValue = "7") int days
    ) {
        return mealPlanService.generateAi(getEmail(authentication), store, days);
    }

    @GetMapping("/{id}/shopping-list")
    public ShoppingListResponse shoppingList(
            Authentication authentication,
            @PathVariable("id") Long id
    ) {
        return shoppingListService.getShoppingList(getEmail(authentication), id);
    }

    private String getEmail(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new IllegalStateException("Not authenticated");
        }

        Object principal = authentication.getPrincipal();

        // Handle OAuth2 users (Google login)
        if (principal instanceof OAuth2User oauth2User) {
            Object email = oauth2User.getAttributes().get("email");
            if (email == null) throw new IllegalStateException("OAuth2 principal missing email");
            return email.toString();
        }

        // Handle local users (email/password login) - principal is the email string
        if (principal instanceof String email) {
            return email;
        }

        throw new IllegalStateException("Unknown principal type: " + principal.getClass());
    }
}
