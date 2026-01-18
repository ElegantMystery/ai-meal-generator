package com.mealgen.backend.auth.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    private String name;

    // e.g. "google"
    private String provider;

    // e.g. Google "sub" id
    private String providerId;

    // BCrypt hashed password for local authentication (null for OAuth-only users)
    @Column(name = "password_hash")
    private String passwordHash;
}
