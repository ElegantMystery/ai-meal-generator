package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.mealplan.model.GenerationRequest;
import com.mealgen.backend.mealplan.model.GenerationRequestStatus;
import com.mealgen.backend.mealplan.repository.GenerationRequestRepository;
import com.mealgen.backend.subscription.service.QuotaReservation;
import com.mealgen.backend.subscription.service.SubscriptionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class GenerationRequestCleanupService {
    private static final int BATCH_SIZE = 100;
    private static final String ABANDONED_CODE = "GENERATION_ABANDONED";
    private static final List<GenerationRequestStatus> ACTIVE_STATUSES =
            List.of(GenerationRequestStatus.PENDING, GenerationRequestStatus.RUNNING);
    private static final List<GenerationRequestStatus> TERMINAL_STATUSES = List.of(
            GenerationRequestStatus.SUCCEEDED,
            GenerationRequestStatus.FAILED,
            GenerationRequestStatus.ABANDONED);

    private final GenerationRequestRepository repository;
    private final SubscriptionService subscriptionService;
    private final Clock clock;

    @Value("${mealgen.generation.stale-after:PT30M}")
    private Duration staleAfter;

    @Value("${mealgen.generation.retention:PT720H}")
    private Duration retention;

    @Scheduled(fixedDelayString = "${mealgen.generation.cleanup-interval:PT1H}")
    @Transactional
    public void cleanup() {
        OffsetDateTime now = OffsetDateTime.now(clock);
        List<GenerationRequest> stale = repository.lockStale(
                ACTIVE_STATUSES, now.minus(staleAfter), PageRequest.of(0, BATCH_SIZE));
        for (GenerationRequest request : stale) {
            boolean hadReservation = request.getStatus() == GenerationRequestStatus.RUNNING;
            request.setStatus(GenerationRequestStatus.ABANDONED);
            request.setFailureCode(ABANDONED_CODE);
            request.setCompletedAt(now);
            request.setUpdatedAt(now);
            if (request.isQuotaConsumed()) {
                subscriptionService.releaseGeneration(
                        request.getUser().getId(), QuotaReservation.free(request.getQuotaPeriodStart()),
                        "stale_cleanup");
                request.setQuotaConsumed(false);
                request.setQuotaPeriodStart(null);
            } else if (hadReservation) {
                subscriptionService.releaseGeneration(
                        request.getUser().getId(), QuotaReservation.unlimited(), "stale_cleanup");
            }
        }
        int deleted = repository.deleteCompletedBefore(TERMINAL_STATUSES, now.minus(retention));
        if (!stale.isEmpty() || deleted > 0) {
            log.info("Generation request cleanup abandoned={} deleted={}", stale.size(), deleted);
        }
    }
}
