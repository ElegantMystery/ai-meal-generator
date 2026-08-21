package com.mealgen.backend.subscription;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.support.PostgresIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class MonthlyQuotaPostgresConcurrencyTest extends PostgresIntegrationTest {

    private static final LocalDate PERIOD_START = LocalDate.of(2026, 8, 1);

    @Autowired UserRepository userRepository;
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    void concurrentReservationsCannotExceedRemainingQuota() throws Exception {
        User user = userRepository.saveAndFlush(User.builder()
                .email("quota-race@example.com")
                .plansGeneratedCount(1)
                .quotaPeriodStart(PERIOD_START)
                .build());

        int contenderCount = 8;
        CountDownLatch ready = new CountDownLatch(contenderCount);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> attempts = new ArrayList<>();

        try (var executor = Executors.newFixedThreadPool(contenderCount)) {
            for (int i = 0; i < contenderCount; i++) {
                attempts.add(executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    return new TransactionTemplate(transactionManager).execute(status ->
                            userRepository.reserveFreeGeneration(user.getId(), PERIOD_START, 3));
                }));
            }

            ready.await();
            start.countDown();

            int successfulReservations = 0;
            for (Future<Integer> attempt : attempts) {
                successfulReservations += attempt.get();
            }

            assertThat(successfulReservations).isEqualTo(2);
            assertThat(userRepository.findById(user.getId()).orElseThrow().getPlansGeneratedCount())
                    .isEqualTo(3);
        } finally {
            userRepository.deleteById(user.getId());
        }
    }
}
