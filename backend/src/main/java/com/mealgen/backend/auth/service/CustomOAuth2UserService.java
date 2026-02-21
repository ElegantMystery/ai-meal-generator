package com.mealgen.backend.auth.service;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CustomOAuth2UserService extends OidcUserService {

    private final UserRepository userRepository;
    private static final Logger logger = LoggerFactory.getLogger(CustomOAuth2UserService.class);

    @Override
    @Transactional
    public OidcUser loadUser(OidcUserRequest userRequest) {
        try {
            // Get user info from Google via OIDC
            OidcUser oidcUser = super.loadUser(userRequest);

            String registrationId = userRequest.getClientRegistration().getRegistrationId(); // "google"

            // Standard Google OIDC claims
            String sub = oidcUser.getSubject();
            String email = oidcUser.getAttribute("email");
            String name = oidcUser.getAttribute("name");

            if (email == null || email.isEmpty()) {
                logger.error("Email is null or empty from OIDC attributes");
                throw new IllegalStateException("Email is required but not provided by OIDC provider");
            }

            if (sub == null || sub.isEmpty()) {
                logger.error("Sub (provider ID) is null or empty from OIDC attributes");
                throw new IllegalStateException("Provider ID is required but not provided by OIDC provider");
            }


            // Create or update local user
            boolean[] isNewUser = {false};
            User user = userRepository.findByEmail(email)
                    .orElseGet(() -> {
                        isNewUser[0] = true;
                        return User.builder()
                                .email(email)
                                .name(name)
                                .provider(registrationId)
                                .providerId(sub)
                                .build();
                    });

            // Update user fields if needed (handles account linking for local users)
            boolean isLinking = user.getId() != null && "local".equals(user.getProvider());
            if (isLinking) {
                logger.info("Linking OAuth provider {} to existing local user: id={}", registrationId, user.getId());
            }

            if (user.getProviderId() == null || !user.getProviderId().equals(sub)) {
                user.setProviderId(sub);
            }
            if (user.getProvider() == null || !user.getProvider().equals(registrationId)) {
                user.setProvider(registrationId);
            }
            if (name != null && (user.getName() == null || !user.getName().equals(name))) {
                user.setName(name);
            }

            // Save user (will update if exists, insert if new) — log after save so we have the ID
            User savedUser = userRepository.save(user);
            if (isNewUser[0]) {
                MDC.put("event", "SIGNUP_SUCCESS");
                MDC.put("provider", registrationId);
                logger.info("New OAuth user created: id={}", savedUser.getId());
                MDC.remove("event");
                MDC.remove("provider");
            } else {
                MDC.put("event", "OAUTH_LOGIN_SUCCESS");
                MDC.put("provider", registrationId);
                logger.info("OAuth user logged in: id={}", savedUser.getId());
                MDC.remove("event");
                MDC.remove("provider");
            }

            // Return OidcUser for Spring Security
            return new DefaultOidcUser(
                    oidcUser.getAuthorities(),
                    oidcUser.getIdToken(),
                    oidcUser.getUserInfo()
            );
        } catch (Exception e) {
            logger.error("Error processing OIDC user: {}", e.getMessage(), e);
            throw e; // Re-throw to let Spring Security handle it
        }
    }
}
