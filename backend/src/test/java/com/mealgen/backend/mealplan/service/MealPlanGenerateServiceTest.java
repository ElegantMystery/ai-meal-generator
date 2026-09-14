package com.mealgen.backend.mealplan.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.items.model.Item;
import com.mealgen.backend.items.repository.ItemRepository;
import com.mealgen.backend.mealplan.model.MealPlan;
import com.mealgen.backend.mealplan.repository.MealPlanRepository;
import com.mealgen.backend.preferences.repository.UserPreferencesRepository;
import com.mealgen.backend.subscription.service.QuotaReservation;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MealPlanGenerateServiceTest {

    @Mock UserRepository userRepository;
    @Mock UserPreferencesRepository preferencesRepository;
    @Mock ItemRepository itemRepository;
    @Mock MealPlanRepository mealPlanRepository;
    @Mock SubscriptionService subscriptionService;
    @Spy ObjectMapper objectMapper = new ObjectMapper();
    @InjectMocks MealPlanGenerateService service;

    private final User user = User.builder().id(9L).email("person@example.com").build();

    @BeforeEach
    void setUp() {
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        when(preferencesRepository.findByUserId(user.getId())).thenReturn(Optional.empty());
        when(subscriptionService.reserveGeneration(user))
                .thenReturn(QuotaReservation.free(LocalDate.of(2026, 9, 1)));
        when(itemRepository.findByStoreIgnoreCase("TRADER_JOES")).thenReturn(items());
        when(mealPlanRepository.save(any())).thenAnswer(invocation -> {
            MealPlan plan = invocation.getArgument(0);
            plan.setId(100L);
            return plan;
        });
    }

    @Test
    void generatedPlanRecordsHouseholdServingsAndScalesEachItemUsageOnce() throws Exception {
        service.generate(user.getEmail(), "TRADER_JOES", 1, 3);

        ArgumentCaptor<MealPlan> saved = ArgumentCaptor.forClass(MealPlan.class);
        verify(mealPlanRepository).save(saved.capture());
        JsonNode plan = objectMapper.readTree(saved.getValue().getPlanJson());
        assertThat(plan.path("servings").asInt()).isEqualTo(3);
        assertThat(plan.path("plan").get(0).path("meals").findValues("items"))
                .isNotEmpty();
        for (JsonNode item : plan.path("plan").get(0).path("meals").findValues("items")) {
            for (JsonNode usage : item) {
                assertThat(usage.path("servingsUsed").asInt()).isEqualTo(3);
                assertThat(usage.has("amountUsed")).isFalse();
            }
        }
    }

    @Test
    void omittedServingsCompatibilityOverloadUsesOneServing() throws Exception {
        service.generate(user.getEmail(), "TRADER_JOES", 1);

        ArgumentCaptor<MealPlan> saved = ArgumentCaptor.forClass(MealPlan.class);
        verify(mealPlanRepository).save(saved.capture());
        JsonNode plan = objectMapper.readTree(saved.getValue().getPlanJson());
        assertThat(plan.path("servings").asInt()).isEqualTo(1);
        JsonNode firstItem = plan.path("plan").get(0).path("meals").get(0).path("items").get(0);
        assertThat(firstItem.path("servingsUsed").asInt()).isEqualTo(1);
        assertThat(firstItem.has("amountUsed")).isFalse();
    }

    private List<Item> items() {
        return IntStream.range(0, 10)
                .mapToObj(index -> Item.builder()
                        .id((long) index + 1)
                        .store("TRADER_JOES")
                        .externalId("sku-" + index)
                        .name("Protein vegetable rice snack " + index)
                        .categoryPath("protein vegetable rice snack")
                        .unitSize("100 g")
                        .price(2.0)
                        .build())
                .toList();
    }
}
