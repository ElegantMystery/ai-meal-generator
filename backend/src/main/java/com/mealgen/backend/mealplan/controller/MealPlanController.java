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
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

import static com.mealgen.backend.security.AuthenticatedPrincipal.email;

@RestController
@RequestMapping("/api/mealplans")
@RequiredArgsConstructor
public class MealPlanController {

    private static final String INVALID_SERVINGS_MESSAGE =
            "servings must be an integer between 1 and 12";
    private static final String INVALID_SERVINGS_JSON =
            "{\"error\":\"INVALID_SERVINGS\",\"message\":\""
                    + INVALID_SERVINGS_MESSAGE + "\"}";

    private final MealPlanService mealPlanService;
    private final MealPlanGenerateService mealPlanGenerateService;
    private final ShoppingListService shoppingListService;

    @GetMapping
    public List<MealPlanResponse> listMine(Authentication authentication) {
        return mealPlanService.listMine(email(authentication));
    }

    @PostMapping
    public MealPlanResponse createMine(
            Authentication authentication,
            @RequestBody MealPlanCreateRequest req
    ) {
        return mealPlanService.createMine(email(authentication), req);
    }

    @GetMapping("/{id}")
    public MealPlanResponse getMine(
            Authentication authentication,
            @PathVariable Long id
    ) {
        return mealPlanService.getMineById(email(authentication), id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteMine(
            Authentication authentication,
            @PathVariable Long id
    ) {
        mealPlanService.deleteMine(email(authentication), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/generate")
    public MealPlanResponse generate(
            Authentication authentication,
            @RequestParam(defaultValue = "TRADER_JOES") String store,
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "1") int servings
    ) {
        if (days < 1 || days > 14) {
            throw new IllegalArgumentException("days must be between 1 and 14");
        }
        validateServings(servings);
        return mealPlanGenerateService.generate(email(authentication), store, days, servings);
    }

    @PostMapping(value = "/generate-ai", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> generateAi(
            Authentication authentication,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestHeader(value = "X-Correlation-ID", required = false) String correlationId,
            @RequestParam(defaultValue = "TRADER_JOES") String store,
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "1") int servings
    ) {
        validateServings(servings);
        return mealPlanService.streamGenerateAi(
                email(authentication), store, days, servings, idempotencyKey, correlationId);
    }

    @GetMapping("/generation-requests/{id}")
    public GenerationRequestResponse generationRequest(
            Authentication authentication,
            @PathVariable UUID id
    ) {
        return mealPlanService.getGenerationRequest(email(authentication), id);
    }

    @GetMapping("/generation-requests")
    public GenerationRequestResponse generationRequestByKey(
            Authentication authentication,
            @RequestParam("idempotencyKey") String idempotencyKey
    ) {
        return mealPlanService.getGenerationRequest(email(authentication), idempotencyKey);
    }

    @GetMapping("/{id}/shopping-list")
    public ShoppingListResponse shoppingList(
            Authentication authentication,
            @PathVariable("id") Long id
    ) {
        return shoppingListService.getShoppingList(email(authentication), id);
    }

    private static void validateServings(int servings) {
        if (servings < 1 || servings > 12) {
            throw new InvalidServingsException();
        }
    }

    @ExceptionHandler(InvalidServingsException.class)
    public void handleInvalidServings(HttpServletResponse response) throws IOException {
        writeInvalidServings(response);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public void handleTypeMismatch(
            MethodArgumentTypeMismatchException error,
            HttpServletResponse response
    ) throws IOException {
        if (!"servings".equals(error.getName())) {
            throw error;
        }
        writeInvalidServings(response);
    }

    private static void writeInvalidServings(
            HttpServletResponse response
    ) {
        response.setStatus(HttpStatus.BAD_REQUEST.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        try {
            response.getWriter().write(INVALID_SERVINGS_JSON);
        } catch (IOException error) {
            throw new IllegalStateException("Failed to write invalid servings response", error);
        }
    }

    private static final class InvalidServingsException extends ResponseStatusException {
        private InvalidServingsException() {
            super(HttpStatus.BAD_REQUEST, INVALID_SERVINGS_MESSAGE);
        }
    }
}
