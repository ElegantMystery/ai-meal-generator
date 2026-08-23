# Multi-stage build for Spring Boot backend
FROM maven:3.9-eclipse-temurin-21@sha256:52ccc14841f74717481b69c5b201aae99f6eeb5164e8aaa2a6134e371ba4cd23 AS build

WORKDIR /app

# Copy pom.xml and download dependencies (cached layer)
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy source code and package. The production workflow's build job depends on
# backend-tests for the identical Git SHA; tests run there with Docker access so
# the PostgreSQL Testcontainers suite can execute before this image is built.
COPY src ./src
RUN mvn clean package -DskipTests

# Runtime stage
FROM eclipse-temurin:21-jre@sha256:c8e00005c840f4e15a98dee36caf8b7be1e385350d63f4eb4a91e465bffa98a1

WORKDIR /app

# Create non-root user
RUN groupadd -r spring && useradd -r -g spring spring
USER spring:spring

# Copy the built JAR from build stage
COPY --from=build /app/target/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
