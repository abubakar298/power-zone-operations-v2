# Milestone 1 deployment

Deploy the frontend and API behind one HTTPS origin. Keep the application and PostgreSQL in Singapore. A single web service may serve compiled frontend assets while source modules remain separated.

## Build and start

Use Node.js 24 and pnpm 11.25.0 with the committed lockfile.

```
pnpm install --frozen-lockfile
pnpm build
pnpm prune --prod
```

Run `node dist/server/db/migrate-cli.js` as the pre-deploy step, then `node dist/server/main.js` as the start command. Do not remove the `migrations/` directory from the deployed artifact. The Dockerfile includes it.

Configure:

| Variable | Setting |
| --- | --- |
| NODE_ENV | production |
| PORT | Platform-provided port |
| APP_ORIGIN | Exact HTTPS origin with no trailing slash |
| DATABASE_URL | Managed PostgreSQL connection string |
| ADMIN_SETUP_TOKEN | Random secret of at least 32 characters, kept server-side |
| DATABASE_SSL | true for external TLS connections; false for a trusted private network if required by the provider |
| DATABASE_CA_FILE | Optional certificate file path for a private certificate authority |
| TRUST_PROXY_HOPS | 1 behind one trusted proxy; 0 for direct connections |

Database TLS verifies certificates. Do not disable verification. Do not allow visitors to connect around a proxy when trusting its forwarded client-IP header. The setup key must be supplied through deployment secret storage, never a `VITE_` variable, source file, quotation or public asset. After setup is complete the database flag closes setup permanently; rotating the setup key does not reopen it.

Configure the health check as `/api/health`; it checks database schema access and returns 503 when unavailable. API errors are sanitized and the server fails closed for authentication.

## Smoke acceptance

1. An anonymous browser sees setup only before the first administrator exists.
2. A bad setup key fails; a valid setup creates one administrator and directs to login.
3. Wrong credentials fail without revealing whether an email exists.
4. Correct credentials show the authenticated dashboard. Refresh preserves it.
5. Restart/redeploy the API and verify that the same database-backed browser session remains authenticated.
6. Sign out. The session cookie is removed; replaying its old value against `/api/dashboard` returns 401.
7. Sign in again successfully with a fresh session, including on a mobile viewport.
8. After setup, further setup attempts fail. Re-running migrations preserves the administrator and credentials.

Use a dedicated test environment for automation. Do not run the destructive test cleanup against an existing application database. Browser/API fixture tests own disposable databases and ignore production `DATABASE_URL`.

## Current V2 deployment — 8 October 2026 checkpoint

Both web service and PostgreSQL are paid resources in Singapore. The primary origin is https://app.powerzone.systems. Service IDs remain `srv-db1uma17lnhs73cuhfjg` and `dpg-db1uldbncjis73b1a5s0-a`. The production branch is `milestone-5/commercial-quotations`; the last verified live commit is `de49d7a3efd7aaeb8d6ea9e271eb9a8105d9fd20`. Earlier free-plan expiry guidance is historical and no longer describes this deployment.

The configured build is `corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm build && corepack pnpm prune --prod`. Startup runs `node dist/server/db/migrate-cli.js && node dist/server/main.js`. Health is `/api/health`. Database migrations use checksums, locking and transactions; startup refuses incompatible migration history.

The web service currently auto-deploys production-branch commits. Keep release candidates on a separate branch. Before merging security changes, require passing CI and controlled deployment. Never push partially tested hardening directly to the production branch. This hardening pass has not deployed.

Use the exact custom domain for APP_ORIGIN. Same-origin frontend/API need no cross-origin allowance. Production cookies are Secure, HttpOnly and SameSite Strict. The legacy onrender URL is not the approved mutation origin. Do not add permissive CORS or relax origin checks to accommodate it.

The current service and database are single-instance resources, without high availability. Verify the provider recovery window, capacity and alerts in the dashboard. Do not open public database network access for convenience. Local encrypted backups supplement managed recovery; the Mac must be available for its daily catch-up download. A real production-archive restore drill into a separate empty database remains an owner/operator action.

Before release: verify the exact candidate SHA, run the full isolated test/build/browser suite, confirm migrations on a staging database, download a fresh backup, verify role-based access and health on the target origin, and retain the preceding release for rollback. For this candidate no new schema migration is introduced. Rolling back application code must not delete business records. If any future migration is added, separately review backward compatibility and restore using the archive-matching release first.
