package com.mealgen.backend.mealplan;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.repository.GenerationRequestRepository;
import com.mealgen.backend.support.PostgresIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class GenerationRequestPostgresConcurrencyTest extends PostgresIntegrationTest {
    @Autowired UserRepository userRepository;
    @Autowired GenerationRequestRepository generationRequestRepository;
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    void concurrentDuplicateSubmitsCreateOneLogicalRequest() throws Exception {
        User user = userRepository.saveAndFlush(User.builder()
                .email("generation-race@example.com")
                .plansGeneratedCount(0)
                .build());
        int contenders = 8;
        CountDownLatch ready = new CountDownLatch(contenders);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> results = new ArrayList<>();
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

        try (var executor = Executors.newFixedThreadPool(contenders)) {
            for (int index = 0; index < contenders; index++) {
                results.add(executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    return new TransactionTemplate(transactionManager).execute(status ->
                            generationRequestRepository.insertPending(
                                    UUID.randomUUID(), user.getId(), "same-key", "same-fingerprint", now));
                }));
            }
            ready.await();
            start.countDown();

            int owners = 0;
            for (Future<Integer> result : results) owners += result.get();
            assertThat(owners).isEqualTo(1);
            assertThat(generationRequestRepository
                    .findByUserIdAndIdempotencyKey(user.getId(), "same-key"))
                    .isPresent();
        } finally {
            generationRequestRepository.deleteAll();
            userRepository.deleteById(user.getId());
        }
    }
}
