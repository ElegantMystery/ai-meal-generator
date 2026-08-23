package com.mealgen.backend.mealplan.controller;

import com.mealgen.backend.mealplan.dto.MealPlanCreateRequest;
import com.mealgen.backend.mealplan.dto.MealPlanResponse;
import com.mealgen.backend.mealplan.dto.GenerationRequestResponse;
import com.mealgen.backend.mealplan.dto.ShoppingListResponse;
import com.mealgen.backend.mealplan.service.MealPlanGenerateService;
import com.mealgen.backend.mealplan.service.MealPlanService;
import com.mealgen.backend.mealplan.service.ShoppingListService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.UUID;

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

    @PostMapping(value = "/generate-ai", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> generateAi(
            Authentication authentication,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestHeader(value = "X-Correlation-ID", required = false) String correlationId,
            @RequestParam(defaultValue = "TRADER_JOES") String store,
            @RequestParam(defaultValue = "7") int days
    ) {
        return mealPlanService.streamGenerateAi(
                getEmail(authentication), store, days, idempotencyKey, correlationId);
    }

    @GetMapping("/generation-requests/{id}")
    public GenerationRequestResponse generationRequest(
            Authentication authentication,
            @PathVariable UUID id
    ) {
        return mealPlanService.getGenerationRequest(getEmail(authentication), id);
    }

    @GetMapping("/generation-requests")
    public GenerationRequestResponse generationRequestByKey(
            Authentication authentication,
            @RequestParam("idempotencyKey") String idempotencyKey
    ) {
        return mealPlanService.getGenerationRequest(getEmail(authentication), idempotencyKey);
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

        // String principals remain supported for controller-level test authentication.
        if (principal instanceof String email) {
            return email;
        }

        throw new IllegalStateException("Unknown principal type: " + principal.getClass());
    }
}
