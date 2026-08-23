package com.mealgen.backend.mealplan.service;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

@Component
@Slf4j
@RequiredArgsConstructor
public class GenerationObservability {
    public static final String EVENTS = "mealgen.generation.events";
    public static final String DURATION = "mealgen.generation.duration";
    public static final String TOKENS = "mealgen.generation.provider.tokens";
    private final MeterRegistry registry;

    public Timer.Sample started(String requestId) {
        registry.counter(EVENTS, "outcome", "started").increment();
        log("GENERATION_STARTED", requestId, null);
        return Timer.start(registry);
    }

    public void succeeded(Timer.Sample sample, String requestId) {
        registry.counter(EVENTS, "outcome", "succeeded").increment();
        sample.stop(registry.timer(DURATION, "outcome", "succeeded"));
        log("GENERATION_SUCCEEDED", requestId, null);
    }

    public void failed(Timer.Sample sample, String requestId, String code) {
        registry.counter(EVENTS, "outcome", "failed", "code", normalizeCode(code)).increment();
        sample.stop(registry.timer(DURATION, "outcome", "failed"));
        log("GENERATION_FAILED", requestId, normalizeCode(code));
    }

    public void quotaRejected(String requestId) {
        registry.counter(EVENTS, "outcome", "quota_rejected").increment();
        log("GENERATION_QUOTA_REJECTED", requestId, "quota");
    }

    public void providerTokens(long inputTokens, long outputTokens) {
        if (inputTokens > 0) registry.counter(TOKENS, "direction", "input").increment(inputTokens);
        if (outputTokens > 0) registry.counter(TOKENS, "direction", "output").increment(outputTokens);
    }

    private static String normalizeCode(String code) {
        return code != null && code.matches("GENERATION_[A-Z_]+") ? code : "GENERATION_UNKNOWN";
    }

    private static void log(String event, String requestId, String code) {
        MDC.put("event", event);
        MDC.put("correlationId", requestId);
        if (code != null) MDC.put("failureCode", code);
        try {
            log.info("Generation event={} requestId={} code={}", event, requestId, code);
        } finally {
            MDC.remove("event");
            MDC.remove("correlationId");
            MDC.remove("failureCode");
        }
    }
}
