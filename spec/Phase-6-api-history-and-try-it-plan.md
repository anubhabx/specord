# Phase 6 API History and Try-It Plan

Date: 2026-05-18
Status: Phase 6a planning complete; Phase 6b/6c core cache and diff primitives implemented; server/UI history wiring remains planned.

## Goal

Phase 6 turns Specord's local docs surface from a static reference into a low-friction API workbench:

1. API changelog and provenance are computed from release markers and source history in the background.
2. The docs UI can execute a selected operation from the existing Try it panel without storing credentials or adding server-side proxy behavior.

The changelog/history work is intentionally planned before implementation. The Try it execution slice is small enough to implement immediately because it is browser-local and does not change extraction or OpenAPI contracts.

## Product Constraints

- First operation changelog load should read from a prepared index, not calculate history synchronously.
- Warm operation changelog target:
  - Developer laptop class: under 1 second.
  - Weak 8 GB laptop class: under 2-3 seconds.
- Cold history indexing may take longer, but it must be resumable, visible, and backgrounded.
- Source code stays clean. Developers should not annotate every controller just to get a changelog.
- Generated history is disposable and recomputable. Human notes and suppressions are small committed policy files.
- Try it execution is browser-local in this slice. No credential persistence, no server proxy, no auth vault, and no background replay.

## Release Snapshot Strategy

Specord should support a user-selected release marker during `specord init` or config authoring:

```ts
export default {
  release: {
    source: "git-tags",
    tagPattern: "v*",
    snapshotMode: "lazy",
    prewarm: "latest-2",
  },
};
```

Supported planned sources:

| Source | Release marker | Notes |
| --- | --- | --- |
| `git-tags` | Git tag resolved to commit | Recommended default for teams that deploy from tags. |
| `github-releases` | GitHub release `tag_name` resolved to commit | Requires GitHub metadata fetch, but snapshots still anchor to Git commits. |
| `package-version` | Version field changes in configured files | Useful for package-driven teams, but weaker than tags in monorepos. |
| `custom-command` | User command returns version, commit, and date records | Enterprise escape hatch for internal release systems. |

The indexer discovers all markers cheaply, then generates OpenAPI snapshots lazily by commit.

## Storage Model

Committed policy:

```text
.specord/
  release-policy.json
  suppressions.json
  notes/
    operations/
```

Ignored local cache:

```text
.git/specord/
  cache/
    snapshots/
    history/
    worktrees/
```

Cache keys include:

```text
commit sha
Specord config hash
Specord version
package lock hash when available
```

If any input changes, Specord recomputes instead of trusting stale history.

Implemented Phase 6b cache primitives:

- `resolveSnapshotCacheDir(repoRoot)` resolves the local cache directory to `.git/specord/cache/snapshots`.
- `hashSnapshotInput(value)` creates deterministic SHA-256 input hashes from strings or object values with stable key ordering.
- `createSnapshotCacheKey({ commit, configHash, specordVersion, lockfileHash })` combines the commit, config hash, Specord version, and optional lockfile hash into a stable snapshot key.
- `writeOpenApiSnapshot(...)` writes a generated OpenAPI document and metadata to the local ignored cache.
- `readOpenApiSnapshot(...)` reads only the snapshot whose computed key matches the current inputs; changed config/version/lockfile inputs become cache misses.

## Background Indexing

The history indexer runs in priority order:

1. Current operation, current branch versus selected base.
2. Current operation, latest release versus current branch.
3. All operations, current branch versus selected base.
4. All operations, latest release pair.
5. Older release history in a resumable background backfill.

The UI can show partial results:

```text
Current branch impact ready.
Latest release comparison indexing...
Older releases queued.
```

The indexer should cap concurrency:

| Device class | Default workers | Behavior |
| --- | ---: | --- |
| Weak laptop | 1 | Low priority, no eager full-history backfill. |
| Developer laptop | 2 | Prewarm latest release pair and current branch. |
| CI | CPU-aware | Build release snapshots and publish artifacts. |

## Operation History Query Model

The UI should never load global history for every operation. It asks for narrow slices:

```http
GET /api/specord/history/operations/:operationId?limit=20
GET /api/specord/history/jobs
GET /api/specord/history/commits/:sha?operationId=:operationId
```

Planned history records:

```ts
type ApiHistoryRecord = {
  operationId: string;
  method: string;
  path: string;
  version?: string;
  releaseTag?: string;
  commit: string;
  date: string;
  author?: string;
  changeType: "added" | "removed" | "changed" | "deprecated" | "security" | "implementation";
  breaking: boolean;
  confidence: "high" | "medium" | "low";
  summary: string;
  affectedFields: string[];
  sourceFiles: string[];
};
```

The changelog panel renders records for the selected operation only. A global changelog view groups records by release, tag, team, and breaking status.

Implemented Phase 6c diff primitive:

- `diffOpenApiSnapshots({ before, after, commit, date, author, releaseTag })` compares two OpenAPI documents and returns operation-scoped `ApiHistoryRecord` objects.
- Operation identity uses `operationId` when present and falls back to `METHOD /path`.
- Added and removed operations produce `added` and `removed` records.
- Security changes produce `security` records before generic `changed` records.
- New deprecation flags produce `deprecated` records before generic `changed` records.
- Other top-level operation changes produce `changed` records with stable `affectedFields`.
- Source provenance is left empty at this layer; controller/DTO/service file attribution remains part of the later indexing and commit-drilldown work.

## Provenance and Commit Drilldown

For a selected operation, Specord should index:

- Controller file and handler line span.
- Request DTO files.
- Response DTO files.
- Guards and auth decorators where visible.
- Related service files as implementation-only provenance when safely discoverable.

Commit drilldown is lazy:

1. Show source-touch summary from path-filtered Git history.
2. On click, load the relevant file diff.
3. If cached snapshots exist, show exact API impact from OpenAPI parent-versus-commit diff.
4. If snapshots are missing, enqueue impact calculation and update the panel when ready.

## Try-It Execution Slice

The immediate implementation slice enables the existing Try it panel to execute a selected operation directly from the browser.

Scope:

- Build the request URL from an explicit `appUrl`, `servers[0].url`, or same-origin fallback when the docs are mounted inside the target app.
- Replace `{path}` parameters from form values.
- Append non-empty query parameters.
- Add non-empty header parameters.
- Send JSON request bodies when present.
- Parse JSON responses when possible and show plain text otherwise.
- Show HTTP status, elapsed time, content type, and response body.
- Surface invalid JSON body input and fetch/CORS failures clearly.

Out of scope:

- Credential persistence.
- Request history persistence.
- Server-side proxying.
- Stored environments.
- OAuth/API key helpers beyond manually entered headers.
- Automatic retry or background execution.

## Acceptance

Phase 6 is accepted when:

- This plan exists as the architecture anchor for API history and background indexing.
- Try it no longer presents itself as pending-only.
- Try it renders request input hooks, a send action, and a response panel.
- Static UI tests cover the Try it execution contract.
- `@specord/ui` tests and build pass.
- Shared `@specord/cli` and `@specord/nestjs` tests remain green because both consume the same renderer.
