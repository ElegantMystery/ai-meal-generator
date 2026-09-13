package com.mealgen.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Jackson 2 compatibility for persistence and Stripe payloads. Spring Boot 4's
 * HTTP stack uses Jackson 3, while the stored JSON-node contract remains on
 * Jackson 2 until a separately planned migration.
 */
@Configuration(proxyBeanMethods = false)
public class JacksonCompatibilityConfiguration {

    @Bean
    ObjectMapper jackson2ObjectMapper() {
        return JsonMapper.builder().findAndAddModules().build();
    }
}
