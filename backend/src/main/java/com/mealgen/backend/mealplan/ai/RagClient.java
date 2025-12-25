package com.mealgen.backend.mealplan.ai;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

@Service
@RequiredArgsConstructor
public class RagClient {

    private final WebClient.Builder webClientBuilder;

    @Value("${mealgen.rag.base-url}")
    private String baseUrl;

    @Value("${mealgen.rag.secret}")
    private String secret;

    public Map callGenerate(Map payload) {
        return webClientBuilder.build()
                .post()
                .uri(baseUrl + "/generate")
                .header("X-RAG-SECRET", secret)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
    }
}
