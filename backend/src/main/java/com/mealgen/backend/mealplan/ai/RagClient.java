package com.mealgen.backend.mealplan.ai;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.util.Map;

@Service
@RequiredArgsConstructor
public class RagClient {

    private final WebClient.Builder webClientBuilder;

    @Value("${mealgen.rag.base-url}")
    private String baseUrl;

    @Value("${mealgen.rag.secret}")
    private String secret;

    // Jackson 3.x (Spring Boot 4) cannot deserialize com.fasterxml.jackson.databind.JsonNode
    // via the SSE codec — receive raw JSON strings and parse them in the service layer.
    private static final ParameterizedTypeReference<ServerSentEvent<String>> SSE_TYPE =
            new ParameterizedTypeReference<>() {};

    /**
     * Stream the agentic /generate response as Server-Sent Events.
     * Terminal events are 'complete' (success) and 'error' (failure).
     */
    public Flux<ServerSentEvent<String>> streamGenerate(Map<String, Object> payload) {
        return webClientBuilder.build()
                .post()
                .uri(baseUrl + "/generate")
                .header("X-RAG-SECRET", secret)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(payload)
                .retrieve()
                .bodyToFlux(SSE_TYPE);
    }
}
