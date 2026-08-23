# Configuration reference

Copy `.env.example` to `.env` for local Compose. Never commit real values.

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | RAG/database scripts | PostgreSQL connection URI |
| `POSTGRES_PASSWORD` | PostgreSQL/backend | Local database password |
| `OPENAI_API_KEY` | Embedding backfills | Not used for plan generation |
| `MINIMAX_API_KEY` | Agentic generation | Mapped to the Anthropic SDK credential |
| `ANTHROPIC_BASE_URL` | Agentic generation | Defaults to MiniMax's compatible endpoint |
| `AGENT_MODEL` | Agentic generation | Defaults to `MiniMax-M3` |
| `AGENT_MAX_TURNS` | Agentic generation | Bounded agent-loop turn count |
| `RAG_ENV` | RAG security | Use `development`/`test` only outside production |
| `RAG_SHARED_SECRET` | Backend-to-RAG auth | Required and nonblank in production |
| `GOOGLE_CLIENT_ID` | User authentication | Google OAuth2 client |
| `GOOGLE_CLIENT_SECRET` | User authentication | Google OAuth2 secret |
| `STRIPE_SECRET_KEY` | Billing | Use a Stripe test-mode key locally |
| `STRIPE_WEBHOOK_SECRET` | Billing webhooks | Stripe endpoint signing secret |
| `STRIPE_PRO_PRICE_ID` | Billing | Recurring PRO price identifier |
| `EMBED_MODEL` | Embedding backfills | Defaults to `text-embedding-3-small` |
| `BATCH_SIZE` | Embedding backfills | Backfill batch size |
| `SPOONACULAR_API_KEY` | Recipe import | Only for the Spoonacular script |

Production-only Spring and infrastructure settings are injected by the deployment
environment. Stripe behavior is documented in `stripe-webhook-operations.md`.
