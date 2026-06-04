# Phase 7 Endpoint History Implementation Plan

Date: 2026-06-04
Status: Planned for checkpointed implementation

## Goal

Make the Phase 6 API history surface operation-scoped by default, while keeping the legacy all-records history route available for existing docs shells. Finish by publishing the scoped `@specord/*` workspace packages to npm as public beta packages under the `beta` dist-tag.

## Architecture

The existing Phase 6 implementation computes `ApiHistoryRecord[]` from cached OpenAPI snapshots plus local fallback records. Phase 7 keeps that source of records intact and adds a narrow HTTP query contract under the docs path:

```http
GET /api/specord/history
GET /api/specord/history/operations/:operationId?limit=20
GET /api/specord/history/jobs
GET /api/specord/history/commits/:sha?operationId=:operationId
```

The docs UI should use the operation route for the active endpoint and only load global records when the user turns on the global history view.

## Phase 7a - Server Endpoint-History Routes

Files:

- Modify `packages/cli/src/commands/serve.ts`
- Modify `packages/cli/test/serve.test.ts`

Implementation:

1. Keep legacy `/<docsPath>/history` returning `{ records }`.
2. Add `/<docsPath>/specord/history` returning `{ records }`.
3. Add `/<docsPath>/specord/history/operations/:operationId?limit=20`.
4. Add `/<docsPath>/specord/history/jobs`.
5. Add `/<docsPath>/specord/history/commits/:sha?operationId=:operationId`.
6. Filter by exact `operationId`, or by fallback identity `METHOD /path`.
7. Clamp `limit` to a safe range so a malformed query cannot force huge responses.
8. Preserve cache and git failure tolerance.

Checkpoint:

```powershell
pnpm.cmd --filter @specord/cli exec vitest run test/serve.test.ts
pnpm.cmd --filter @specord/cli build
git add packages/cli/src/commands/serve.ts packages/cli/test/serve.test.ts
git commit -m "feat(cli): add endpoint history routes"
```

## Phase 7b - UI Operation-Scoped History Loading

Files:

- Modify `packages/ui/src/client.ts`
- Modify `packages/ui/test/render-docs-ui.test.ts`

Implementation:

1. Treat `historyUrl` as the history API base path.
2. Fetch the selected operation from `/operations/:operationId?limit=20`.
3. Fall back to legacy global history if the operation route is unavailable.
4. Cache operation-history responses by operation key.
5. Load all records only when the global toggle is enabled.
6. Render an endpoint-history loading state instead of showing an empty state while a fetch is active.

Checkpoint:

```powershell
pnpm.cmd --filter @specord/ui exec vitest run test/render-docs-ui.test.ts
pnpm.cmd --filter @specord/ui build
git add packages/ui/src/client.ts packages/ui/test/render-docs-ui.test.ts
git commit -m "feat(ui): load endpoint history on demand"
```

## Phase 7c - Public Beta npm Publication Metadata

Files:

- Modify `package.json`
- Modify `packages/*/package.json`

Implementation:

1. Change release scripts to publish with `--access public`.
2. Change release scripts to publish with `--tag beta`.
3. Change package versions to `0.1.0-beta.0`.
4. Change package `publishConfig.access` values to `public`.
5. Keep the root package private and unpublished.
6. Verify packed files still include `dist`, `bin` where applicable, and package README files.

Checkpoint:

```powershell
pnpm.cmd build
pnpm.cmd test
pnpm.cmd publish -r --dry-run --tag beta --access public --no-git-checks
git add package.json packages/*/package.json
git commit -m "chore(release): publish beta packages publicly"
```

## Phase 7d - Report and npm Publish

Files:

- Create or overwrite `reports/phase-7.md`

Implementation:

1. Write the cumulative Phase 7 executive report in `reports/phase-7.md`.
2. Run the full verification gates.
3. Commit the report.
4. Publish packages to the `specord` npm organization as public beta packages.

Checkpoint:

```powershell
pnpm.cmd build
pnpm.cmd test
pnpm.cmd inspect -- --project examples/nestjs-api/tsconfig.json --root examples/nestjs-api/src
pnpm.cmd generate -- --project examples/nestjs-api/tsconfig.json --root examples/nestjs-api/src --pretty
git add reports/phase-7.md
git commit -m "docs: report phase 7 endpoint history"
npm whoami
pnpm.cmd publish -r --tag beta --access public --publish-branch main
```

## Acceptance

- Endpoint history is available through operation, global, job, and commit-scoped routes.
- Legacy `/api/history` remains available.
- The UI does not eagerly fetch all history records for every operation.
- Operation history still renders with the existing visual timeline.
- Release scripts and package metadata target public beta npm publication.
- Full build, tests, fixture inspection, and fixture OpenAPI generation pass.
- Public beta npm publication completes for the workspace packages under the `beta` dist-tag.
