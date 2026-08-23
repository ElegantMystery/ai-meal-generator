# Production operations index

Production serves <https://whole-haul.com> on an EC2 host reached through AWS SSM
Session Manager; SSH port 22 is not public. Resolve the instance tagged
`meal-gen-prod-app` in `us-east-1`, then use `aws ssm start-session`, or configure
SSH's `AWS-StartSSHSession` proxy command with the instance ID.

Use these focused runbooks:

- `deployment-rollback.md` — deploy gates, smoke checks, rollback, and recovery
- `observability-business-flows.md` — CloudWatch logs, metrics, alarms, and queries
- `stripe-webhook-operations.md` — webhook reconciliation and replay
- `flyway-production-reconciliation.md` — migration checksum recovery
- `security/csrf-threat-model.md` — session and browser-request protections

TLS terminates in `meal-gen-nginx`. The `meal-gen-certbot` sidecar renews through
the ACME webroot; nginx reloads periodically so renewed certificate files enter
service. For emergency renewal, connect through SSM, run certbot renewal in the
sidecar, then `nginx -s reload` in the nginx container.

Backend and RAG containers use the CloudWatch `awslogs` driver, so use `aws logs
tail /meal-gen/prod/{backend,rag}` rather than `docker logs`. Nginx logs are in
`/meal-gen/prod/nginx`.
