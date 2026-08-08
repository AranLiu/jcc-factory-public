# API Onboarding Final-Fix Report（历史审计记录）

> 历史资料：本文保留当时分支、提交与验证证据，仅用于审计追溯，不代表当前工作树或最新测试状态。

## Scope and boundary

- Worktree: `E:\Desktop\jcc-factory\.worktrees\api-onboarding`
- Branch: `codex/api-onboarding`
- Base: `master` merge-base `3a21f3aa0594cc86d295d11da2483d85ea3f8fe6`
- Final-review starting point: `dbfe224`
- No merge or push was performed. The linked worktree and branch are preserved.
- The pre-existing modification to `.superpowers/sdd/task-2-report.md` was not edited, staged, or committed.

## Findings resolved

### 1. Gemini connection-test subprocess

Root cause: the test launched a fixed child command without a deadline or output bound, accepted loosely structured stdout, and could expose provider diagnostics in its public result or logs.

Resolution:

- Added injectable process execution with a 30-second default timeout.
- Capped stdout and stderr independently at 64 KiB and terminate on overflow or timeout.
- Added settle-once handling so late child events cannot replace a failure.
- Parse only the final non-empty JSON line and require an object with a boolean `success` field.
- Return only fixed public messages and an optional bounded numeric response time; provider stdout, stderr, error text, and API keys are neither returned nor logged.
- Moved Python debug diagnostics to stderr, kept stdout machine-readable, and made debug failure logging generic.

TDD evidence:

- RED: five focused child-process contract tests failed; the real Python stdout-channel test also failed.
- GREEN: focused tests passed 5/5 and 1/1; the two related test files passed 16/16.

Commit: `5e3f965 fix: harden Gemini connection test process`

### 2. Immutable boot-time Gemini provenance

Root cause: database-backed runtime values were copied into `process.env`, after which mutable runtime state was incorrectly treated as original operator-supplied environment configuration.

Resolution:

- Captured and froze `GEMINI_API_KEY`, `GEMINI_DEFAULT_MODEL`, and `GEMINI_AVAILABLE_MODELS` once at module boot.
- Use the frozen snapshot for precedence and `managedByEnvironment` decisions.
- Continue applying selected values to the runtime environment for subprocess consumers without changing provenance.
- Ensure blank boot values allow immediate database rotation and non-empty boot values remain authoritative.
- Reused the same boot provenance in onboarding status, routes, connection testing, and relay model selection.

TDD evidence:

- RED: three boot-provenance tests failed; one relay-model provenance test failed.
- GREEN: the related API onboarding and Gemini runtime suites passed 24/24.

Commit: `ecf6aee fix: preserve Gemini boot environment provenance`

### 3. Write-only API secret editing

Root cause: the generic editor used the redaction sentinel as editable state, creating a risk that `[REDACTED]` could be submitted or persisted instead of a real replacement.

Resolution:

- Added pure editor-state helpers with functional state updates and cleanup.
- The Gemini API-key editor now opens with an empty password field, never derives its draft from the masked configuration value, labels configured state without showing a value, and requires an explicit replacement.
- Successful saves close the editor and clear the draft.
- The server rejects non-string, blank, overlong, control-character, and case-insensitive `[REDACTED]` inputs before persistence.
- Storage/apply failures return and log only generic messages.
- Existing relay-token write-only behavior remains covered.

TDD evidence:

- RED: two client state tests and three server/UI contract tests failed.
- GREEN: focused client tests passed 2/2; full related server tests passed 30/30; full client tests passed 35/35; production build passed.

Commit: `78732ec fix: make API secrets write-only`

### 4. Migration evidence boundary

Root cause: README described the historical live run as covering two ordered migrations without naming them, which could be read as including migration 003.

Resolution:

- README now states that the 2026-08-05 historical run covered migrations 001 and 002 and explicitly did not cover migration 003.
- Added a documentation regression test that requires the 001/002 boundary and the 003 exclusion.

TDD evidence:

- RED: the focused documentation test failed 1/1 before the README correction.
- GREEN: the documentation suite passed 10/10.

Commit: `991e1f0 docs: correct migration verification evidence`

## Live migration 003 verification

A fully disposable MySQL 8.4.5 instance was initialized under `C:\tmp\jcc-migration-003-api-onboarding`, bound only to `127.0.0.1:33367`, and used with a throwaway schema.

- Pre-existing row: `api_onboarding_completed=true` remained `true` after migration 003.
- Missing row: migration 003 inserted `api_onboarding_completed=false`.
- Cleanup: MySQL shut down normally, process exited, port 33367 closed, and the exact disposable directory was removed.
- No existing database, schema, data directory, service, or default MySQL port was used.

## Final verification

- `npm.cmd run verify`: PASS
  - Server: 173/173 tests passed.
  - Client: 35/35 tests passed across 7 files.
  - Vite production build: PASS, 3,446 modules transformed.
- Python source compilation without writing bytecode: PASS, 5 files compiled.
- `git diff --check`: PASS.
- Targeted secret/log review: connection-test failures remain generic; tests prove provider stdout, stderr, malformed output, overflow output, late close events, and API-key values are absent from returned/logged results.
- `npm.cmd run audit:all`: not completed because the sandbox denied the registry request and the approval reviewer rejected exporting dependency metadata to the npm registry.
- Safer offline substitute: root, server, and client `npm audit --offline --audit-level=high` each completed with `found 0 vulnerabilities`. This is cached/offline evidence, not a fresh registry-backed audit.

## Remaining concerns

- A real Gemini API call was not run because no real user credential was used; only contract-level subprocess and Python entrypoint tests were executed.
- A fresh online dependency audit still requires explicit authorization to send dependency metadata to the npm registry.
- `.superpowers/sdd/task-2-report.md` remains modified from before this work and is intentionally excluded.

## Final re-review follow-up: successful secret-save cleanup

The re-review identified that the prior server-side source regex could match a commented `cancelEdit(key)` and therefore did not prove runtime cleanup. Raw-byte inspection of the checked-out component showed valid UTF-8 and a physical LF between the Chinese comment and `cancelEdit(key)`, but the verification approach was still insufficient.

Resolution:

- Added the real async `saveAndCloseEditor` handler. It waits for the server save, then uses functional state setters to set `editing[key]` to `false` and delete `tempValues[key]` immediately.
- `SystemConfig.saveEdit` now delegates every successful save through this handler, so both `gemini_api_key` and `proxy_service_auth_token` plaintext replacements are removed before the success message and configuration reload.
- Removed the misleading server-side regex that only searched component source for `cancelEdit(key)`.
- Added a client behavioral test for both secret keys. It verifies the exact event order `server-success -> editing-cleared -> plaintext-removed`, verifies unrelated state is retained, and verifies that the component's real save handler delegates to the tested cleanup handler.

TDD and verification evidence:

- RED: focused client suite failed 1/3 because `saveAndCloseEditor` was absent.
- GREEN: focused client suite passed 3/3.
- Related server relay suite passed 17/17 after removing the misleading regex.
- `npm.cmd run verify`: server 173/173, client 36/36 across 7 files, and the Vite production build passed with 3,446 modules transformed.
- UTF-8 raw-byte check: strict decoding passed, no BOM, handler call begins on physical line 155, and the misleading cleanup comment is absent.
- `git diff --check`: PASS.
