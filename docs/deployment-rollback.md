# Production deployment and rollback

Production deploys restart RAG, backend, and frontend in dependency order. Each
stage uses bounded Docker health polling and verifies that the running image tag
matches the intended Git SHA. A stage failure automatically restores the prior
`IMAGE_TAG` and restarts all application services at that revision.

The RAG readiness check includes `SELECT 1`, so its health covers both the RAG
process and database connectivity. The post-deploy smoke test checks the public
frontend, backend health, SSE buffering headers, and the revision served by
nginx.

## Manual rollback

On the production host, run:

```bash
cd /opt/meal-gen
sudo bash scripts/deploy/rollback_prod.sh <previous-git-sha>
```

The command pulls the requested immutable images, restarts services in dependency
order, waits for readiness, verifies all three image tags, and publishes the
restored revision through `/deploy-revision`.

Rollback immediately if a service fails readiness or revision verification, or
if the production smoke test fails after deployment. Preserve CloudWatch logs
for diagnosis; do not prune tagged rollback images.
