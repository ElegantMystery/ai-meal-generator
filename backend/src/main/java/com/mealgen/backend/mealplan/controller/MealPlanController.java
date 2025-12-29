package com.mealgen.backend.mealplan.controller;

import com.mealgen.backend.mealplan.dto.MealPlanCreateRequest;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.dto.ShoppingListResponse;
import com.mealgen.backend.mealplan.service.MealPlanGenerateService;
import com.mealgen.backend.mealplan.service.MealPlanService;
import com.mealgen.backend.mealplan.service.ShoppingListService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
    public List<MealPlanResponse> listMine(@AuthenticationPrincipal OAuth2User principal) {
        return mealPlanService.listMine(getEmail(principal));
    }

    @PostMapping
    public MealPlanResponse createMine(
            @AuthenticationPrincipal OAuth2User principal,
            @RequestBody MealPlanCreateRequest req
    ) {
        return mealPlanService.createMine(getEmail(principal), req);
    }

    @GetMapping("/{id}")
    public MealPlanResponse getMine(
            @AuthenticationPrincipal OAuth2User principal,
            @PathVariable Long id
    ) {
        return mealPlanService.getMineById(getEmail(principal), id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteMine(
            @AuthenticationPrincipal OAuth2User principal,
            @PathVariable Long id
    ) {
        mealPlanService.deleteMine(getEmail(principal), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/generate")
    public MealPlanResponse generate(
            @AuthenticationPrincipal OAuth2User principal,
            @RequestParam(defaultValue = "TRADER_JOES") String store,
            @RequestParam(defaultValue = "7") int days
    ) {
        if (days < 1 || days > 14) {
            throw new IllegalArgumentException("days must be between 1 and 14");
        }
        return mealPlanGenerateService.generate(getEmail(principal), store, days);
    }

    @PostMapping("/generate-ai")
    public MealPlanResponse generateAi(
            @AuthenticationPrincipal OAuth2User principal,
            @RequestParam(defaultValue = "TRADER_JOES") String store,
            @RequestParam(defaultValue = "7") int days
    ) {
        return mealPlanService.generateAi(getEmail(principal), store, days);
    }

    @GetMapping("/{id}/shopping-list")
    public ShoppingListResponse shoppingList(
            @AuthenticationPrincipal OAuth2User principal,
            @PathVariable("id") Long id
    ) {
        return shoppingListService.getShoppingList(getEmail(principal), id);
    }


    private String getEmail(OAuth2User principal) {
        if (principal == null) throw new IllegalStateException("Not authenticated");
        Object email = principal.getAttributes().get("email");
        if (email == null) throw new IllegalStateException("OAuth2 principal missing email");
        return email.toString();
    }
}
