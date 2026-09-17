package com.mealgen.backend.mealplan.controller;

import com.mealgen.backend.mealplan.service.MealPlanService;
import com.mealgen.backend.mealplan.service.ShoppingListService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import org.springframework.http.MediaType;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import reactor.core.publisher.Flux;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;

class MealPlanControllerTest {

    private MealPlanService mealPlanService;
    private MealPlanController controller;
    private Authentication authentication;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mealPlanService = mock(MealPlanService.class);
        controller = new MealPlanController(
                mealPlanService, mock(ShoppingListService.class));
        authentication = mock(Authentication.class);
        when(authentication.isAuthenticated()).thenReturn(true);
        when(authentication.getPrincipal()).thenReturn("person@example.com");
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void retiredGenerateRouteCannotCreatePlanOrConsumeQuota() throws Exception {
        mockMvc.perform(post("/api/mealplans/generate")
                        .principal(authentication))
                .andExpect(status().isMethodNotAllowed());

        verifyNoInteractions(mealPlanService);
    }

    @Test
    void generateAiPassesRequestedServingsToAiService() {
        controller.generateAi(authentication, "key", null, "TRADER_JOES", 3, 7);

        verify(mealPlanService).streamGenerateAi(
                "person@example.com", "TRADER_JOES", 3, 7, "key", null);
    }

    @Test
    void generateAiRejectsServingsAboveMaximumAsBadRequest() {
        assertThatThrownBy(() -> controller.generateAi(
                authentication, "key", null, "TRADER_JOES", 3, 13))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> org.assertj.core.api.Assertions.assertThat(
                                ((ResponseStatusException) error).getStatusCode().value())
                        .isEqualTo(400))
                .hasMessageContaining("servings must be an integer between 1 and 12");

        verifyNoInteractions(mealPlanService);
    }

    @Test
    void omittedServingsBindsToOneForAiGeneration() throws Exception {
        when(mealPlanService.streamGenerateAi(
                "person@example.com", "TRADER_JOES", 7, 1, "key", null))
                .thenReturn(Flux.empty());

        mockMvc.perform(post("/api/mealplans/generate-ai")
                        .principal(authentication)
                        .header("Idempotency-Key", "key"))
                .andExpect(status().isOk());

        verify(mealPlanService).streamGenerateAi(
                "person@example.com", "TRADER_JOES", 7, 1, "key", null);
    }

    @Test
    void invalidAndNonIntegerServingsReturnBadRequestForAiGeneration() throws Exception {
        mockMvc.perform(post("/api/mealplans/generate-ai")
                        .principal(authentication)
                        .header("Idempotency-Key", "key")
                        .accept(MediaType.TEXT_EVENT_STREAM)
                        .param("servings", "13"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(content().json("""
                        {"error":"INVALID_SERVINGS",\
                        "message":"servings must be an integer between 1 and 12"}
                        """));
        mockMvc.perform(post("/api/mealplans/generate-ai")
                        .principal(authentication)
                        .header("Idempotency-Key", "key")
                        .accept(MediaType.TEXT_EVENT_STREAM)
                        .param("servings", "1.5"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(content().json("""
                        {"error":"INVALID_SERVINGS",\
                        "message":"servings must be an integer between 1 and 12"}
                        """));

        verifyNoInteractions(mealPlanService);
    }
}
