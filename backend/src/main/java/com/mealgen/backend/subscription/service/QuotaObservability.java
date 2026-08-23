package com.mealgen.backend.subscription.service;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Component
@Slf4j
@RequiredArgsConstructor
public class QuotaObservability {

    public static final String METRIC_NAME = "mealgen.generation.quota.events";

    private final MeterRegistry meterRegistry;

    public void reserved(Long userId, QuotaReservation reservation) {
        increment("reserved", reservation);
        log.info("Generation quota reserved userId={} tier={} periodStart={}",
                userId, tier(reservation), reservation.periodStart());
    }

    public void completed(Long userId, QuotaReservation reservation) {
        increment("completed", reservation);
        log.info("Generation quota completed userId={} tier={} periodStart={}",
                userId, tier(reservation), reservation.periodStart());
    }

    public void rejected(Long userId) {
        meterRegistry.counter(METRIC_NAME, "outcome", "rejected", "tier", "free")
                .increment();
        log.info("Generation quota rejected userId={} tier=free", userId);
    }

    public void released(Long userId, QuotaReservation reservation, String reason) {
        increment("released", reservation);
        log.info("Generation quota released userId={} tier={} periodStart={} reason={}",
                userId, tier(reservation), reservation.periodStart(), reason);
    }

    public void releaseMissed(Long userId, QuotaReservation reservation, String reason) {
        meterRegistry.counter(METRIC_NAME, "outcome", "release_missed", "tier", tier(reservation))
                .increment();
        log.warn("Generation quota release changed no rows userId={} tier={} periodStart={} reason={}",
                userId, tier(reservation), reservation.periodStart(), reason);
    }

    private void increment(String outcome, QuotaReservation reservation) {
        meterRegistry.counter(METRIC_NAME, "outcome", outcome, "tier", tier(reservation))
                .increment();
    }

    private static String tier(QuotaReservation reservation) {
        return reservation.consumesFreeQuota() ? "free" : "pro";
    }
}
