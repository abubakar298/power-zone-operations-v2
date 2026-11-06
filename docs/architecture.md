# Milestone 1 architecture

The repository was empty when inspected. V1 was not modified. The entire handover package was reviewed before implementation. The owner's locked handover takes precedence over differences in reference screens or formulas.

## Request flow

React calls the same-origin JSON API. Express enforces request origin, content type, size limits, security headers and authentication. Authentication services validate inputs, hash passwords and create or revoke sessions. Repositories use parameterized PostgreSQL queries and explicit transactions. The entry point manages HTTP startup, database pooling, scheduled expiry cleanup and graceful shutdown.

## Authentication

- Initial setup requires the deployment's unpredictable setup secret and creates one Admin in a transaction that locks the singleton bootstrap row. Concurrent setup requests cannot produce two first administrators. No bootstrap-reset endpoint exists.
- Passwords use Node's asynchronous scrypt with N=131072, r=8, p=1, a random salt and constant-time verification. Setup requires 12–128 characters. Unknown emails perform the same derivation and return the same error as incorrect passwords.
- Login creates a random 256-bit opaque session token. Only its SHA-256 digest is persisted. Cookies are HttpOnly and SameSite=Strict; production uses Secure and the `__Host-` prefix. No token or user session is stored in browser local storage.
- Sessions have a 12-hour absolute expiry. Every authenticated request joins the session to the current active user. Disabling a user invalidates access immediately. Database failure does not grant access.
- Logging in again with an existing cookie revokes that cookie and creates a fresh token. Logout requires a per-session CSRF token, revokes the database session and clears the cookie. This affects the current browser session, not all devices.
- Mutation requests require the configured Origin and JSON, including login/setup. Logout additionally verifies CSRF. No cross-origin API access is enabled.
- Rate-limit counters are atomic PostgreSQL upserts and survive restarts and multiple API instances. Limits are 10 setup requests per IP, 30 login requests per IP and 10 login requests per email per 15 minutes. Successful requests count too. These are engineering defaults, not commercial business rules.
- Session expiry and stale rate-limit records are cleaned every 15 minutes. Passwords, cookies, setup secrets, CSRF tokens and database credentials are excluded from logs. Audit entries record setup, successful login and logout.

## Persistence and migrations

Milestone 1 contains only roles, users, bootstrap status, sessions, authentication counters, audit entries and migration history. It defines Admin, Management and Employee, but does not invent permissions for future business modules or expose user management yet.

The migration runner uses a PostgreSQL advisory lock to serialize concurrent runners. Each migration runs in a transaction and records its checksum. Repeated runs skip completed migrations; missing or altered applied migrations fail. There is no reset or destructive seed command. Production migrations run before starting the server, never per request. Apply schema changes through new migration files.

Production uses the external PostgreSQL database configured through `DATABASE_URL`. Embedded PostgreSQL and PGlite are development/test tools only and excluded from production deployment dependencies.

## Future invariants

Historical BOQ revisions and saved pricing/issued quotation versions must be append-only snapshots tied to the exact source revision. Master updates must not rewrite them. A future migration should enforce this at database level before those modules are released. Monetary values should use decimal arithmetic and PostgreSQL numeric fields; quantity and currency formatting must meet the accountant's readability requirements. Customer IDs/names/short codes are preserved; site codes are text with leading zeros intact. New BOQ creates a new site; revision is the existing-site workflow.

Detailed technical specifications belong in BOQ costing and store issuance. Quotation scope, labels, markup and mandatory wording must follow the locked handover without copying internal specs automatically. None of these later modules is implemented in Milestone 1.

## UI

The owner supplied a dashboard reference during implementation. The shell adopts its light background, outlined rounded panels, sidebar, restrained purple accents and dark primary account action. Data comes from the authenticated API; there are no fabricated project counts or charts. Upcoming modules are static roadmap information, not interactive unfinished routes. Dashboard and My account are working shell views. Navigation collapses into a mobile menu. Errors and loading states are visible and accessible.

## Subsequent milestones

Account lifecycle and immutable survey/BOQ R0 persistence now extend this foundation through separate service/repository/HTTP modules. See milestone-accounts.md and milestone-3-survey-boq.md for current behavior and validation.

Costing review and revision workflows are documented in milestone-4-boq-review.md. PostgreSQL append-only review submissions/decisions and BOQ revisions preserve the exact approved costing; current master changes do not rewrite it.

Commercial pricing and customer quotation snapshots are separate append-only tables referencing the exact approved BOQ revision. The customer snapshot deliberately contains no internal cost, rate or markup fields; quotation descriptions originate from the Quotation Print reference rather than BOQ technical specifications. See milestone-5-commercial-quotations.md.
