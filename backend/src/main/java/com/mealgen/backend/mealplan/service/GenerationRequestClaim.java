package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.mealplan.model.GenerationRequest;

public record GenerationRequestClaim(GenerationRequest request, boolean owner) {
}
