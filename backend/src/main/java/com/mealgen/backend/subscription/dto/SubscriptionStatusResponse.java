package com.mealgen.backend.subscription.dto;

import java.time.Instant;

public record SubscriptionStatusResponse(
        String tier,
        int remainingQuota,
        boolean cancelAtPeriodEnd,
        Instant currentPeriodEnd
) {}
