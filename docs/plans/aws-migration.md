# AWS Migration Plan - AI Meal Generator

## Context

The app currently runs locally via Docker Compose (4 services: Frontend, Backend, RAG, PostgreSQL). There's no CI/CD, no HTTPS, hardcoded localhost URLs, and secrets in config files. This plan migrates to AWS using **EC2 + Docker Compose + RDS** — the most cost-effective approach for a startup with near-zero traffic. Terraform for IaC, GitHub Actions for CI/CD. No domain yet (will use EC2 public IP initially, add custom domain later).

**Future path:** When traffic grows, migrate compute from EC2 to ECS Fargate (~half day effort, images don't change). Notion tickets exist for Fargate and Bedrock migrations.

## AWS Services Needed

| Service | Purpose | Est. Cost |
|---------|---------|-----------|
| EC2 `t4g.small` | Run Docker Compose (all 3 services) | ~$12/mo |
| RDS PostgreSQL | Managed DB with pgvector, automated backups | ~$17/mo |
| Elastic IP | Static IP for EC2 | Free (while attached) |
| Secrets Manager | Store credentials & API keys | ~$2/mo |
| ECR | Docker image registry | ~$1/mo |
| CloudWatch | Logs & basic monitoring | ~$3/mo |

**Total: ~$35/mo**

## Architecture

```
Internet → EC2 (public subnet)
             ├── Nginx (80/443) → reverse proxy
             │     ├── / → Frontend (3000)
             │     └── /api/* → Backend (8080)
             ├── Frontend container (3000)
             ├── Backend container (8080)
             └── RAG container (8000) [localhost only]
                       ↓
                 RDS PostgreSQL+pgvector (5432) [private subnet]
```

- Nginx handles TLS termination (Let's Encrypt / certbot) and routing
- RAG service only accessible from backend via `localhost:8000`
- RDS in private subnet, accessible only from EC2 security group
- Docker Compose orchestrates all 3 app containers + nginx

## Implementation Phases

### Phase 1: Code Changes for Production Readiness

#### 1a. Backend — Add Actuator health checks
**File:** `backend/pom.xml`
- Add `spring-boot-starter-actuator` dependency

#### 1b. Backend — Add production profile
**File:** `backend/src/main/resources/application-prod.yaml` (new file)
```yaml
spring:
  session:
    cookie:
      sameSite: lax
      secure: true
  datasource:
    url: ${SPRING_DATASOURCE_URL}
    username: ${SPRING_DATASOURCE_USERNAME}
    password: ${SPRING_DATASOURCE_PASSWORD}
  jpa:
    show-sql: false
    properties:
      hibernate:
        format_sql: false
  security:
    oauth2:
      client:
        registration:
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
server:
  forward-headers-strategy: framework
management:
  endpoints.web.exposure.include: health
mealgen:
  rag:
    base-url: ${MEALGEN_RAG_BASEURL:http://python-rag:8000}
    secret: ${MEALGEN_RAG_SECRET}
cors:
  allowed-origins: ${CORS_ALLOWED_ORIGINS:http://localhost:3000}
frontend:
  url: ${FRONTEND_URL:http://localhost:3000}
```

#### 1c. Backend — Make CORS and OAuth URLs configurable
**File:** `backend/src/main/java/com/mealgen/backend/security/SecurityConfig.java`
- Inject `@Value("${cors.allowed-origins:http://localhost:3000}")` for CORS origins
- Inject `@Value("${frontend.url:http://localhost:3000}")` for OAuth success/logout redirect URLs
- Replace hardcoded `"http://localhost:3000"` on lines 33, 67, 71

#### 1d. RAG — Add connection pooling
**File:** `rag/requirements.txt`
- Add `psycopg_pool`

**File:** `rag/app/db.py`
- Replace direct `psycopg.connect()` with `psycopg_pool.ConnectionPool`

**File:** `rag/app/main.py`
- Add FastAPI lifespan handler to init/close pool on startup/shutdown

#### 1e. Frontend — Already configurable
`frontend/lib/api.ts` already reads `NEXT_PUBLIC_API_BASE_URL` env var — no changes needed.

---

### Phase 2: Terraform Infrastructure

Create `infra/` directory:

```
infra/
├── main.tf              # Provider config, S3 backend for state
├── variables.tf         # Input variables (region, instance type, etc.)
├── outputs.tf           # EC2 IP, RDS endpoint
├── vpc.tf               # VPC, public + private subnets
├── ec2.tf               # EC2 instance, Elastic IP, user data script
├── rds.tf               # RDS PostgreSQL instance (pgvector)
├── ecr.tf               # 3 ECR repositories
├── secrets.tf           # Secrets Manager entries
├── security-groups.tf   # EC2 SG (80, 443, 22), RDS SG (5432 from EC2 only)
└── iam.tf               # EC2 instance role (ECR pull, Secrets Manager read)
```

Key resources:
- **VPC**: 1 public subnet (EC2), 1 private subnet (RDS), no NAT gateway needed
- **EC2**: `t4g.small` (2 vCPU, 2GB ARM), Amazon Linux 2023, Elastic IP, Docker pre-installed via user data
- **RDS**: `db.t4g.micro`, PostgreSQL 16 with pgvector, 20GB GP3, private subnet, 7-day backup retention
- **ECR**: 3 repos (frontend, backend, rag) with lifecycle policy (keep last 5 images)
- **Security Groups**: EC2 allows 80/443/22 inbound; RDS allows 5432 from EC2 SG only
- **IAM**: EC2 instance role with `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `secretsmanager:GetSecretValue`

---

### Phase 3: Production Docker Compose

**File:** `docker-compose.prod.yml` (new file)
- Uses ECR images instead of local builds
- Nginx reverse proxy for routing + TLS (Let's Encrypt)
- Backend connects to RDS (env vars for endpoint, credentials)
- RAG connects to RDS + uses OpenAI API key from env
- All services set `restart: always`

**File:** `nginx/nginx.conf` (new file)
- Reverse proxy: `/api/*` → `backend:8080`, `/*` → `frontend:3000`
- TLS via Let's Encrypt certbot
- Gzip compression, security headers

---

### Phase 4: CI/CD with GitHub Actions

**File:** `.github/workflows/deploy.yml`
1. Trigger on push to `main`
2. Build 3 Docker images in parallel
3. Push to ECR with `${{ github.sha }}` tag
4. SSH into EC2 instance
5. Pull new images from ECR
6. Run `docker compose -f docker-compose.prod.yml up -d`

GitHub Secrets needed:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID`
- `EC2_HOST` (Elastic IP), `EC2_SSH_KEY` (private key for SSH)

---

### Phase 5: Database Migration

1. Terraform creates RDS instance
2. Connect to RDS via EC2: `psql -h <RDS_ENDPOINT> -U meal_user -d mealgen`
3. Run `CREATE EXTENSION IF NOT EXISTS vector;`
4. Start backend container — Flyway auto-runs all 26 migrations
5. Seed data: `pg_dump` from local → `pg_restore` to RDS (items, embeddings)

---

### Phase 6: Deploy & Verify

1. SSH into EC2, run `docker compose -f docker-compose.prod.yml up -d`
2. Verify health: `curl http://<EC2_IP>/api/actuator/health` → `{"status":"UP"}`
3. Set up TLS: run certbot for Let's Encrypt certificate (requires domain)
4. Test flows: signup, login, OAuth2, generate meal plan (rule + AI), preferences, shopping list
5. Update Google OAuth authorized redirect URIs to include production URL

---

## Files to Modify

| File | Change |
|------|--------|
| `backend/pom.xml` | Add `spring-boot-starter-actuator` |
| `backend/src/main/resources/application-prod.yaml` | **New** — production config profile |
| `backend/src/main/java/.../SecurityConfig.java` | Configurable CORS origins + OAuth URLs |
| `rag/requirements.txt` | Add `psycopg_pool` |
| `rag/app/db.py` | Connection pooling |
| `rag/app/main.py` | Lifespan pool init |
| `docker-compose.prod.yml` | **New** — production compose using ECR images + RDS |
| `nginx/nginx.conf` | **New** — reverse proxy + TLS config |
| `infra/*.tf` | **New** — Terraform files |
| `.github/workflows/deploy.yml` | **New** — CI/CD pipeline |

## Verification

1. **Local**: Run `docker-compose up --build` to verify code changes don't break existing setup
2. **Terraform**: `terraform plan` to review infrastructure before applying
3. **Deploy**: Push to main, watch GitHub Actions succeed
4. **Health**: `curl http://<EC2_IP>/api/actuator/health` returns `{"status":"UP"}`
5. **E2E**: Sign up → login → generate AI meal plan → view shopping list
6. **OAuth2**: Update Google OAuth redirect URIs, test Google login

## Future Upgrades (Notion tickets exist)

- **ECS Fargate migration**: When traffic grows, swap EC2 for Fargate (~half day, same images)
- **AWS Bedrock**: Replace OpenAI with Bedrock for embeddings + chat (lower latency, IAM auth)
