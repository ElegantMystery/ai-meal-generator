package com.mealgen.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.items.repository.ItemRepository;
import com.mealgen.backend.mealplan.ai.RagClient;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import com.mealgen.backend.mealplan.service.GenerationObservability;
import com.mealgen.backend.mealplan.service.GenerationRequestService;
import com.mealgen.backend.mealplan.service.MealPlanGenerateService;
import com.mealgen.backend.mealplan.service.MealPlanPersistenceService;
import com.mealgen.backend.mealplan.service.MealPlanService;
import com.mealgen.backend.mealplan.service.ShoppingListService;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.mealgen.backend.subscription.service.QuotaObservability;
import com.mealgen.backend.subscription.service.SubscriptionService;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class JacksonCompatibilityConfigurationTest {

    @Test
    void contextProvidesOneMapperSharedByAllJackson2Consumers() {
        try (AnnotationConfigApplicationContext context =
                     new AnnotationConfigApplicationContext()) {
            context.register(
                    JacksonCompatibilityConfiguration.class,
                    MealPlanService.class,
                    MealPlanGenerateService.class,
                    ShoppingListService.class,
                    SubscriptionService.class);
            register(context, "users", mock(UserRepository.class));
            register(context, "preferences", mock(UserPreferencesRepository.class));
            register(context, "mealPlans", mock(MealPlanRepository.class));
            register(context, "items", mock(ItemRepository.class));
            register(context, "ragClient", mock(RagClient.class));
            register(context, "persistence", mock(MealPlanPersistenceService.class));
            register(context, "generationRequests", mock(GenerationRequestService.class));
            register(context, "generationObservability", mock(GenerationObservability.class));
            register(context, "subscriptionRepository", mock(SubscriptionRepository.class));
            register(context, "quotaObservability", mock(QuotaObservability.class));
            register(context, "clock", Clock.systemUTC());
            register(context, "entityManager", mock(EntityManager.class));
            context.refresh();

            Map<String, ObjectMapper> beans = context.getBeansOfType(ObjectMapper.class);
            assertThat(beans).hasSize(1);
            ObjectMapper mapper = beans.values().iterator().next();

            MealPlanService mealPlanService = context.getBean(MealPlanService.class);
            MealPlanGenerateService generateService =
                    context.getBean(MealPlanGenerateService.class);
            ShoppingListService shoppingListService = context.getBean(ShoppingListService.class);
            SubscriptionService subscriptions = context.getBean(SubscriptionService.class);

            assertThat(ReflectionTestUtils.getField(mealPlanService, "objectMapper"))
                    .isSameAs(mapper);
            assertThat(ReflectionTestUtils.getField(generateService, "objectMapper"))
                    .isSameAs(mapper);
            assertThat(ReflectionTestUtils.getField(shoppingListService, "objectMapper"))
                    .isSameAs(mapper);
            assertThat(ReflectionTestUtils.getField(subscriptions, "objectMapper"))
                    .isSameAs(mapper);
        }
    }

    private static void register(
            AnnotationConfigApplicationContext context, String name, Object bean) {
        context.getBeanFactory().registerSingleton(name, bean);
    }
}
