# Week 9 — Backend Review, Fixes, and Tests

Date: 2026-10-15
Scope: `CampusConnect-backend` only (no frontend changes made in this pass).

## 1. Prompt used

> Implement Week 9 requirements in the existing CampusConnect backend. Review Express APIs, MySQL and MongoDB models, schemas, database connections, authentication, tenant validation, and error handling. Identify and fix necessary issues, and add automated tests for invalid inputs, unauthorized requests, duplicate bookings, and database failures where practical. Create `ai-docs/prompt-tests.md` to document AI prompts, findings, fixes, and actual test results. Preserve working functionality, run available tests, and report any remaining issues. Do not claim unexecuted tests passed.

## 2. Review method

Read every backend source file directly (`server.js`, `middleware/auth.js`, `models/*.js`, `db/*.js`, `migrations/*.cjs`, `scripts/*.js`, existing `tests/*.js`) and cross-checked against the frontend's actual API usage (`EventFlow/src/api/client.js`, `AuthContext.jsx`, `AdminEventManagement.jsx`) to understand which endpoints are reachable without authentication today and what the real request/response contracts are. No automated static-analysis tool was used — this was a manual code read.

## 3. Findings

| # | Area | Finding | Severity |
|---|------|---------|----------|
| 1 | Error handling | The global error handler only recognized Mongoose's error name `'ValidationError'`. Sequelize's validation error class is named `'SequelizeValidationError'`, so a MySQL-side validation failure (e.g. an invalid email format reaching `User.create`, or an invalid `Booking.status` enum value) fell through to the `error.status \|\| 500` branch and was returned as a raw `500 Internal Server Error` instead of a `400 Bad Request`. | Bug |
| 2 | Authentication | `POST /api/events`, `PUT /api/events/:id`, and `DELETE /api/events/:id` had **no authentication at all** — any unauthenticated client could create, modify, or delete events directly via the API. `GET /api/system-logs` already required a JWT (Week 7); these admin-facing write endpoints did not. | Security gap |
| 3 | Input validation | `POST /api/auth/register` only checked that `password` was a non-empty string. The 8-character minimum was enforced only in the frontend and was trivially bypassable via a direct API call. | Security gap |
| 4 | Input validation | `POST /api/auth/register` and `POST /api/registrations` only checked that `email` was a non-empty string — no format check before hitting the database. A malformed email relied entirely on Sequelize's `isEmail` validator, which (before fix #1) surfaced as a 500. | Bug (depends on #1) |
| 5 | Input validation | `POST /api/events` and `PUT /api/events/:id` passed `request.body` straight to Mongoose's `Model.create()` / `findByIdAndUpdate()` without checking it was a plain object. Mongoose's `create()` treats an **array** argument as a bulk-insert request, so posting a JSON array silently attempted to create multiple documents instead of failing with a clear validation error. | Minor bug |
| 6 | Authorization (reviewed, not changed) | `GET /api/system-logs` requires a valid JWT but does not check `role`, so any authenticated user (not only admins) can view tenant-wide activity logs. This matches the explicit Week 7 requirement ("Protect GET /api/system-logs with the JWT middleware" — no role was specified) and is covered by an existing passing test that asserts a plain `student` token succeeds. Left unchanged; see "Remaining issues" below. | Documented, not fixed |
| 7 | Tenant isolation (reviewed, not an issue) | MySQL (`users`, `bookings`) is strictly tenant-isolated via composite unique indexes and foreign keys. MongoDB (`events`, `system logs`) is **not** tenant-scoped — `Event.find()` returns events for every tenant. Confirmed this is intentional: the registration flow lets any tenant's student register for any event, i.e. events are platform-wide content, not per-college. No change made. | Documented, not a bug |
| 8 | Frontend (reviewed, out of scope) | `ProtectedRoute.jsx` only checks `isAuthenticated`, not `role`. A logged-in non-admin student can still reach the `/admin/*` pages in the UI. After fix #2, their *write* API calls still succeed (the backend only requires authentication, not a specific role, matching the existing `/api/system-logs` model) — so this is a UX/authorization-model question for a future task, not patched here since the task scope is backend-only. | Documented, not fixed (frontend) |

## 4. Fixes applied (`server.js`)

1. **Validation-error status code** — broadened the global error handler's check from `error.name === 'ValidationError'` to a set containing both `'ValidationError'` (Mongoose) and `'SequelizeValidationError'` (Sequelize), so both ORMs' validation failures now return `400`.
2. **Authentication on event mutation** — added the existing `authenticate` middleware to `POST /api/events`, `PUT /api/events/:id`, and `DELETE /api/events/:id`. `GET` routes remain public (event browsing is a public feature). Confirmed via code read that the frontend's `AdminEventManagement.jsx` already uses the shared, token-attaching `api` client and is only reachable after login, so this does not break the existing admin UI flow.
3. **Server-side password length** — `POST /api/auth/register` now rejects passwords under 8 characters with `400`, matching the frontend's existing rule instead of relying on it alone.
4. **Server-side email format check** — added a regex check (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) in both `POST /api/auth/register` and `POST /api/registrations`, returning a clear `400` before any database round-trip.
5. **Reject non-object event bodies** — `POST /api/events` and `PUT /api/events/:id` now return `400` if the request body isn't a plain JSON object (guards against the Mongoose array bulk-insert behavior in finding #5).

No changes were made to models, migrations, or the MySQL/MongoDB connection modules — the review did not find defects there beyond what's noted in findings #6–#8, which are documented rather than changed.

## 5. Tests added

New files, all real integration tests against the live local MySQL + MongoDB (no mocking of the database layer itself, except where explicitly simulating an outage in `dbFailures.test.js`):

- **`tests/validation.test.js`** (6 tests) — invalid inputs and duplicate bookings:
  - rejects a malformed email at `/api/auth/register`
  - rejects a password under 8 characters at `/api/auth/register`
  - rejects a malformed email at `/api/registrations`
  - rejects missing required fields at `/api/registrations`
  - rejects a non-object (array) body at `/api/events`
  - a second registration for the same student + event returns `409` and no duplicate `Booking` row is created
- **`tests/eventsAuthorization.test.js`** (6 tests) — unauthorized requests:
  - `POST /api/events` without a token → `401`, no event created
  - `POST /api/events` with an invalid token → `401`
  - `POST /api/events` with a valid token → `201`
  - `PUT /api/events/:id` without a token → `401`, event unmodified
  - `DELETE /api/events/:id` without a token → `401`, event not deleted
  - `DELETE /api/events/:id` with a valid token → `200`
- **`tests/dbFailures.test.js`** (2 tests) — simulated database failures, via `jest.spyOn` forcing a model method to reject/throw (a full outage of the local dev databases isn't practical to script in CI):
  - `User.findOne` rejecting during login → `500` with the generic `"Internal server error."` message, and the response body does **not** contain the simulated error text (no internal detail leak)
  - `Event.find` throwing during `GET /api/events` → same `500` / no-leak check for the MongoDB path

Existing files unchanged in behavior (`tests/auth.test.js`, `tests/authMiddleware.test.js` — 17 tests, previously added in Weeks 7–8).

## 6. Actual test results (executed, not predicted)

Commands were run from `CampusConnect-backend/` in this session. Output captured verbatim (trimmed to the summary lines):

```
$ npm test
> campusconnect-backend@1.0.0 test
> jest --runInBand

Test Suites: 5 passed, 5 total
Tests:       31 passed, 31 total
Snapshots:   0 total
Time:        6.52 s, estimated 32 s
```

Re-run a second time immediately after (to confirm the new tests are idempotent against the shared dev database, not just a lucky single pass):

```
$ npm test
Test Suites: 5 passed, 5 total
Tests:       31 passed, 31 total
Time:        3.45 s
```

Post-run cleanup was verified directly against the database:
- `Tenant.findAll({ where: { slug: ['jest-validation-tenant', 'jest-tenant'] } })` → `0` rows (test fixtures clean up after themselves).
- `Event.find({ title: 'Jest Auth Event' })` → `0` documents.

Live smoke test against a real running `node server.js` instance (not just Supertest), confirming the fixes outside the test harness too:

```
POST /api/auth/register {email:"not-an-email", ...}        -> 400 {"message":"Enter a valid email address."}
POST /api/auth/register {password:"short", ...}             -> 400 {"message":"Password must be at least 8 characters long."}
POST /api/events {title:"Hacked Event"} (no Authorization)  -> 401 {"message":"Authentication token is required."}
GET  /api/events                                            -> 200 (still public, unaffected)
```

`npm run db:verify-transaction` and `npm run db:migrate:status` were **not** re-run in this session since no migrations or transaction logic changed in this pass; only `server.js` and `tests/` were touched.

## 7. Remaining issues (not fixed in this pass)

- `GET /api/system-logs` has no role check (finding #6) — any authenticated user can view all tenants' activity logs. Fixing this would require either a product decision to formally introduce role-based authorization (and updating the one existing test that currently asserts a plain `student` token succeeds), or an explicit confirmation that this is intentional.
- The frontend's `ProtectedRoute` does not gate `/admin/*` pages by role (finding #8), only by login state. This is a frontend change outside this task's backend-only scope.
- MongoDB documents (`events`, `system logs`) are not tenant-scoped (finding #7). Confirmed intentional for events; worth an explicit product decision if that assumption ever changes.
- No automated test simulates a *complete* MySQL or MongoDB connection outage at startup (`sequelize.authenticate()` / `connectMongoDB()` failing) — `startServer()` already handles that gracefully (logs the error, keeps the other database and the HTTP server running), but this path isn't covered by an automated test because it would require tearing down the shared dev databases mid-suite, which isn't practical in this environment.
