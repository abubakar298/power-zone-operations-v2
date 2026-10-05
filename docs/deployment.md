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

## Current V2 deployment

Deployed on 5 October 2026 in Abu Bakar's workspace. Both resources use free plans in Singapore:

- Application: https://power-zone-operations-v2.onrender.com
- Web service: `srv-db1uma17lnhs73cuhfjg`
- PostgreSQL 18: `dpg-db1uldbncjis73b1a5s0-a` (`power-zone-v2-db`)
- Source branch: `milestone-1/auth-shell`
- Health check: `/api/health`

Render's native Node runtime has a read-only system directory. Its configured build command is:

```
corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm build && corepack pnpm prune --prod
```

The free plan does not support a pre-deploy command, so migrations run before server startup:

```
node dist/server/db/migrate-cli.js && node dist/server/main.js
```

Live acceptance passed on 5 October 2026: the owner created the administrator and signed in; the dashboard and account page loaded; refreshing preserved authentication; a completed redeploy preserved the same session; signing out returned to login; signing in again succeeded. Health returns 200, setup status reports setup closed, and the anonymous dashboard API returns 401. Automated native PostgreSQL and Chromium authentication tests also pass in GitHub Actions. Milestone 1 is complete; operational persistence remains subject to the free database expiry below.

The owner explicitly authorized deletion of V1's hosted web service and database to release the free database slot. Both were deleted; the V1 GitHub repository was retained.

Free web services sleep after inactivity. This free database expires on **4 November 2026**; arrange an upgrade or export before expiry. No paid resources were provisioned. Credentials and setup keys are excluded from this repository.
