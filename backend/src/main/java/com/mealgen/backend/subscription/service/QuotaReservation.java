package com.mealgen.backend.subscription.service;

import java.time.LocalDate;

/** Identifies whether a generation consumed a FREE-tier slot and in which month. */
public record QuotaReservation(boolean consumesFreeQuota, LocalDate periodStart) {

    public static QuotaReservation free(LocalDate periodStart) {
        return new QuotaReservation(true, periodStart);
    }

    public static QuotaReservation unlimited() {
        return new QuotaReservation(false, null);
    }
}
