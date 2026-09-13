package com.mealgen.backend.security;

import com.mealgen.backend.auth.model.User;
import com.mealgen.backend.auth.repository.UserRepository;
import com.mealgen.backend.mealplan.controller.MealPlanController;
import com.mealgen.backend.mealplan.service.MealPlanGenerateService;
import com.mealgen.backend.mealplan.service.MealPlanService;
import com.mealgen.backend.mealplan.service.ShoppingListService;
import com.mealgen.backend.preferences.controller.UserPreferencesController;
import com.mealgen.backend.preferences.service.UserPreferencesService;
import com.mealgen.backend.subscription.controller.SubscriptionController;
import com.mealgen.backend.subscription.repository.SubscriptionRepository;
import com.mealgen.backend.subscription.service.SubscriptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.oauth2.core.user.OAuth2User;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ControllerPrincipalValidationTest {

    private MealPlanService mealPlanService;
    private UserPreferencesService preferencesService;
    private SubscriptionService subscriptionService;
    private UserRepository userRepository;
    private MealPlanController mealPlanController;
    private UserPreferencesController preferencesController;
    private SubscriptionController subscriptionController;

    @BeforeEach
    void setUp() {
        mealPlanService = mock(MealPlanService.class);
        preferencesService = mock(UserPreferencesService.class);
        subscriptionService = mock(SubscriptionService.class);
        userRepository = mock(UserRepository.class);
        mealPlanController = new MealPlanController(
                mealPlanService,
                mock(MealPlanGenerateService.class),
                mock(ShoppingListService.class));
        preferencesController = new UserPreferencesController(preferencesService);
        subscriptionController = new SubscriptionController(
                subscriptionService,
                userRepository,
                mock(SubscriptionRepository.class));
    }

    @Test
    void allControllersRejectSpringAnonymousAuthenticationToken() {
        Authentication anonymous = new AnonymousAuthenticationToken(
                "key", "anonymousUser", AuthorityUtils.createAuthorityList("ROLE_ANONYMOUS"));
        when(mealPlanService.listMine("anonymousUser")).thenReturn(List.of());
        when(userRepository.findByEmail("anonymousUser")).thenReturn(Optional.of(
                User.builder().id(1L).email("anonymousUser").build()));

        assertThatThrownBy(() -> mealPlanController.listMine(anonymous))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("Not authenticated");
        assertThatThrownBy(() -> preferencesController.getMyPreferences(anonymous))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("Not authenticated");
        assertThatThrownBy(() -> subscriptionController.getStatus(anonymous))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("Not authenticated");
    }

    @Test
    void rejectsGooglePrincipalWithNonTextEmail() {
        OAuth2User oauth2User = mock(OAuth2User.class);
        when(oauth2User.getAttributes()).thenReturn(Map.of("email", 42));
        Authentication authentication = authenticated(oauth2User);
        when(mealPlanService.listMine("42")).thenReturn(List.of());

        assertThatThrownBy(() -> mealPlanController.listMine(authentication))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("OAuth2 principal has invalid email");
        verifyNoInteractions(preferencesService, subscriptionService);
    }

    @Test
    void rejectsGooglePrincipalWithMissingEmail() {
        OAuth2User oauth2User = mock(OAuth2User.class);
        when(oauth2User.getAttributes()).thenReturn(Map.of());

        assertThatThrownBy(() -> mealPlanController.listMine(authenticated(oauth2User)))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("OAuth2 principal has invalid email");
        verifyNoInteractions(mealPlanService);
    }

    @Test
    void rejectsMissingAndNullPrincipalsWithoutDereferencingThem() {
        assertThatThrownBy(() -> mealPlanController.listMine(null))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("Not authenticated");

        Authentication authentication = authenticated(null);
        assertThatThrownBy(() -> preferencesController.getMyPreferences(authentication))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasMessage("Invalid authenticated principal");
    }

    @Test
    void retainsGoogleAndAuthenticatedStringPrincipals() {
        OAuth2User oauth2User = mock(OAuth2User.class);
        when(oauth2User.getAttributes()).thenReturn(Map.of("email", "google@example.com"));
        when(mealPlanService.listMine("google@example.com")).thenReturn(List.of());
        when(mealPlanService.listMine("test@example.com")).thenReturn(List.of());

        assertThat(mealPlanController.listMine(authenticated(oauth2User))).isEmpty();
        assertThat(mealPlanController.listMine(authenticated("test@example.com"))).isEmpty();
    }

    private static Authentication authenticated(Object principal) {
        Authentication authentication = mock(Authentication.class);
        when(authentication.isAuthenticated()).thenReturn(true);
        when(authentication.getPrincipal()).thenReturn(principal);
        return authentication;
    }
}
