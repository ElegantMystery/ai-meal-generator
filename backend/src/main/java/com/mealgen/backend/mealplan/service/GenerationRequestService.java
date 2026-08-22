package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.dto.GenerationRequestResponse;
import com.mealgen.backend.mealplan.repository.GenerationRequestRepository;
import com.mealgen.backend.subscription.service.QuotaReservation;
import com.mealgen.backend.subscription.service.SubscriptionService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class GenerationRequestService {
    private static final int MAX_IDEMPOTENCY_KEY_LENGTH = 255;

    private final GenerationRequestRepository repository;
    private final Clock clock;
    private final SubscriptionService subscriptionService;

    @Transactional
    public GenerationRequestClaim claim(User user, String idempotencyKey, String fingerprint) {
        validateIdempotencyKey(idempotencyKey);
        OffsetDateTime now = now();
        int inserted = repository.insertPending(
                UUID.randomUUID(), user.getId(), idempotencyKey, fingerprint, now);
        GenerationRequest request = repository.findByUserIdAndIdempotencyKey(user.getId(), idempotencyKey)
                .orElseThrow(() -> new IllegalStateException("Generation request claim was not persisted"));
        if (!request.getRequestFingerprint().equals(fingerprint)) {
            throw new IdempotencyConflictException();
        }
        return new GenerationRequestClaim(request, inserted == 1);
    }

    @Transactional
    public QuotaReservation start(UUID id, User user) {
        QuotaReservation reservation = subscriptionService.reserveGeneration(user);
        int updated = repository.markRunning(
                id, reservation.consumesFreeQuota(), reservation.periodStart(), now());
        if (updated != 1) {
            throw new IllegalStateException("Generation request is not pending");
        }
        return reservation;
    }

    @Transactional
    public boolean markFailed(UUID id, String failureCode) {
        return repository.markFailed(id, failureCode, now()) == 1;
    }

    @Transactional
    public boolean fail(
            UUID id,
            Long userId,
            QuotaReservation reservation,
            String failureCode
    ) {
        boolean transitioned = repository.markFailed(id, failureCode, now()) == 1;
        if (transitioned) {
            subscriptionService.releaseGeneration(userId, reservation);
        }
        return transitioned;
    }

    @Transactional(readOnly = true)
    public GenerationRequestResponse getOwned(User user, UUID id) {
        GenerationRequest request = repository.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("Generation request not found"));
        return GenerationRequestResponse.from(request);
    }

    @Transactional(readOnly = true)
    public GenerationRequestResponse getOwnedByKey(User user, String idempotencyKey) {
        validateIdempotencyKey(idempotencyKey);
        GenerationRequest request = repository
                .findByUserIdAndIdempotencyKey(user.getId(), idempotencyKey)
                .orElseThrow(() -> new IllegalArgumentException("Generation request not found"));
        return GenerationRequestResponse.from(request);
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    private static void validateIdempotencyKey(String key) {
        if (key == null || key.isBlank() || key.length() > MAX_IDEMPOTENCY_KEY_LENGTH) {
            throw new IllegalArgumentException("Idempotency-Key must contain 1 to 255 characters");
        }
    }
}
