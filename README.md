# Power Zone Operations V2

Milestone 1 implements one-time administrator setup, login, an authenticated application shell, logout and repeat login. It uses React/TypeScript, Express 5 and PostgreSQL. No customer import, BOQ, costing, commercial pricing or quotation implementation is included.

## Boundaries

```
web/                  React pages, components, API client, styles
server/app.ts         HTTP middleware and route composition
server/auth/          Authentication routes, service, crypto, repository
server/dashboard/     Authenticated shell API
server/db/            PostgreSQL pool, transactions, migration runner
migrations/           Append-only, checksummed SQL migrations
tests/                API integration and browser smoke tests
docs/                 Architecture, source review, deployment instructions
```

The production build serves the frontend and `/api` through one origin, avoiding cross-domain cookie configuration. Development uses Vite's API proxy. Business services belong in their own modules as future milestones are approved. Database queries belong in repositories, not frontend components or HTTP handlers.

## Local development

Requires Node.js 24 and pnpm 11.25.0. Install with `corepack enable` if available.

1. `pnpm install --frozen-lockfile`
2. Copy `.env.example` to `.env`, and generate an unpredictable `ADMIN_SETUP_TOKEN` of at least 32 characters.
3. Run a PostgreSQL service, or run `pnpm db:local` in a separate terminal. The local helper starts PostgreSQL 17 on loopback and stores development data under `.local/`.
4. Load `.env` into your environment. Node supports `--env-file`; for example, `node --env-file=.env --import tsx server/db/migrate-cli.ts` runs migrations.
5. Run `node --env-file=.env --import tsx --watch server/main.ts` and `pnpm dev:web` in separate terminals.
6. Open `http://localhost:5173`. Complete one-time setup with your deployment setup key, then sign in.

The setup key is never bundled into the frontend. There is no default administrator or password, public registration or reseeding over existing users. Re-running migrations does not change existing users. Setup remains closed even if the administrator is deleted.

## Verification

```
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

The default tests own a disposable native PostgreSQL 17 cluster. They do not connect to `DATABASE_URL`, seed production, or reuse your development database. Browser tests start the production build and check admin setup, invalid login, authenticated dashboard, page reload, a complete API process restart, logout, revoked cookie replay, login again, account controls and mobile layout.

Some desktop sandboxes block native PostgreSQL's shared-memory system calls. In that environment only, `TEST_PGLITE=true pnpm test` and `TEST_PGLITE=true pnpm test:e2e` explicitly use file-backed PGlite (PostgreSQL compiled to WebAssembly) behind the PostgreSQL wire protocol. This is a test fixture, not a production dependency. Native CI is the required check for locking/concurrency and production database compatibility. PGlite passes do not replace that check.

## Production

See [deployment instructions](docs/deployment.md) for database migrations, HTTPS, setup secret, trusted proxy configuration and smoke verification. The application supports deployment in Singapore as required by the handover. A deployment is not considered verified solely because the build is green.

Future saved BOQ revisions and issued quotation versions must capture inputs, rates, rules, brands and outputs in immutable snapshots. They must never be recomputed from current master data. This invariant is recorded in the architecture document; its tables and business logic are intentionally deferred.

## Current milestone checkpoint

Reviewed master data, employee account lifecycle (email activation pending), survey drafts, authenticated uploads, browser OCR review, New BOQ and immutable R0 costing are implemented. See docs/milestone-accounts.md, docs/milestone-3-survey-boq.md and docs/owner-next-steps.md. Revisions, commercial pricing and quotations remain later milestones.

The build bundles OCR worker, runtime and English language assets from locked npm dependencies; no OCR credentials or external OCR service are required. Email settings are optional until activation. Tests always use isolated PostgreSQL, never production credentials.
