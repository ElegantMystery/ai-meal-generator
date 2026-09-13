package com.mealgen.backend.subscription.controller;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.subscription.dto.SubscriptionStatusResponse;
import com.mealgen.backend.subscription.model.Subscription;
import com.mealgen.backend.subscription.model.SubscriptionTier;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.mealgen.backend.subscription.service.SubscriptionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import com.stripe.exception.StripeException;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static com.mealgen.backend.security.AuthenticatedPrincipal.email;

@RestController
@RequestMapping("/api/subscription")
@RequiredArgsConstructor
public class SubscriptionController {

    private final SubscriptionService subscriptionService;
    private final UserRepository userRepository;
    private final SubscriptionRepository subscriptionRepository;

    @GetMapping("/status")
    public ResponseEntity<SubscriptionStatusResponse> getStatus(Authentication authentication) {
        User user = resolveUser(authentication);
        SubscriptionTier tier = subscriptionService.getTier(user.getId());

        Optional<Subscription> subOpt = subscriptionRepository.findByUserId(user.getId());
        boolean cancelAtPeriodEnd = subOpt.map(Subscription::isCancelAtPeriodEnd).orElse(false);
        Instant currentPeriodEnd = subOpt.map(Subscription::getCurrentPeriodEnd).orElse(null);

        return ResponseEntity.ok(new SubscriptionStatusResponse(
                tier.name(),
                subscriptionService.getRemainingQuota(user),
                cancelAtPeriodEnd,
                currentPeriodEnd
        ));
    }

    @PostMapping("/checkout")
    public ResponseEntity<?> checkout(Authentication authentication) throws StripeException {
        User user = resolveUser(authentication);
        String url = subscriptionService.createCheckoutSession(user);
        return ResponseEntity.ok(Map.of("url", url));
    }

    @PostMapping("/portal")
    public ResponseEntity<?> portal(Authentication authentication) throws StripeException {
        User user = resolveUser(authentication);
        String url = subscriptionService.createPortalSession(user);
        return ResponseEntity.ok(Map.of("url", url));
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private User resolveUser(Authentication authentication) {
        String authenticatedEmail = email(authentication);
        return userRepository.findByEmail(authenticatedEmail)
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }
}
