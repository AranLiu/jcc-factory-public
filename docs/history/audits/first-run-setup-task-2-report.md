# Task 2 Report: Protected First-Run Setup API（历史审计记录）

> 历史资料：本文保留首次管理员设置功能开发时的阶段性证据，仅用于审计追溯，不代表当前工作树或最新测试状态。

## Outcome

Implemented the public first-run administrator API boundary and handlers while preserving authentication and CSRF protection for every other API request.

## Scope

- Added `server/utils/publicApi.js` with an exact, method-sensitive allow-list for:
  - `GET /api/health`
  - `POST /api/auth/login`
  - `GET /api/auth/setup-status`
  - `POST /api/auth/setup`
- Added `GET /api/auth/setup-status` and `POST /api/auth/setup` routes.
- Added a dedicated setup rate limiter and Origin check before the setup route can continue.
- Kept setup POST behind the global CSRF middleware; login POST remains the only mutation exempt from CSRF.
- Added injectable handler factories in `server/services/firstRunSetup.js`.
- Added handler and public-boundary tests.

## HTTP Contract

- Setup status returns `{ initialized }` and creates a random, browser-readable `jcc_csrf` cookie only when setup remains available.
- Initial administrator creation returns:
  - `201` with a public user projection on success.
  - `409` with `code: "already_initialized"` after setup has closed.
  - `400` with a safe field-level response for validation failures.
  - `503` with `code: "setup_busy"` and `Retry-After: 1` when the setup lock is busy.
  - `500` with a generic response for unexpected service or cleanup failures.
- Successful responses explicitly project only `id`, `username`, `email`, `role`, and `permission`; submitted passwords and password hashes cannot be echoed even if an injected service returns extra fields.
- Error logs use fixed event text and never serialize request input or exception properties.

## Gate Order

`POST /api/auth/setup` must pass all of the following before its handler runs:

1. General API rate limiter.
2. Dedicated setup rate limiter.
3. Allowed-Origin middleware.
4. Method-sensitive public authentication bypass.
5. Normal global CSRF middleware (allowed Origin plus matching cookie/header token).

`GET /api/auth/setup-status` is public and safe-method compatible; all non-allow-listed method/path combinations still require authentication.

## TDD Evidence

### RED 1

Command from `server/`:

```text
node --test test/publicApi.test.js test/firstRunSetup.test.js
```

Observed expected failures: missing `../utils/publicApi`, missing `createSetupStatusHandler`, and missing `createSetupHandler`. Existing Task 1 service tests remained green.

### GREEN 1

Command from `server/`:

```text
node --test test/publicApi.test.js test/firstRunSetup.test.js test/csrf.test.js test/security.test.js
```

Result: 39 passed, 0 failed.

### RED 2 / GREEN 2

Strengthened the secret-safety tests so an injected service returned `password` and `password_hash`, and injected errors carried secret-bearing `name` and `code` properties. The tests failed against the first implementation, then passed after response projection and constant-only error logging were added.

Command from `server/`:

```text
node --test test/firstRunSetup.test.js
```

Final result: 23 passed, 0 failed.

## Verification

- Required Task 2 suite: 39 passed, 0 failed.
- Full server suite (`npm.cmd test` from `server/`): 114 passed, 0 failed.
- `git diff --check`: passed.

## Concerns

None.
