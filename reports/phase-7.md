# Phase 7 Session Report - Endpoint History and Public Beta npm Release

**Phase:** 7 - Endpoint-scoped API history and public beta package release
**Date:** 2026-06-04
**Status:** Implementation healthy. The release lane was corrected from restricted/private publication to public beta publication because npm free plans do not allow private package publishing. Public beta dry-run passes; real publish is currently blocked by npm's one-time auth flow.

---

## Status Summary

Phase 7 delivered the planned endpoint-history contract on top of the Phase 6 history engine. `specord serve` now exposes narrow operation, job, and commit history routes under `/api/specord/history`, while the legacy `/api/history` route remains available for older clients. The UI now fetches history for the selected endpoint on demand and loads global history only when the user enables the global view.

Release metadata was corrected to publish all scoped `@specord/*` packages publicly as prerelease beta packages. The workspace packages now use version `0.1.0-beta.0`, `publishConfig.access: "public"`, and root release scripts publish with `--tag beta`.

---

## What Was Built

| Area | Delivered |
| --- | --- |
| Phase plan | Added `spec/Phase-7-endpoint-history-plan.md` with route, UI, release, verification, and commit checkpoints |
| CLI history routes | Added `/api/specord/history`, `/api/specord/history/operations/:operationId`, `/api/specord/history/jobs`, and `/api/specord/history/commits/:sha` |
| Legacy compatibility | Preserved `/api/history` as the all-records compatibility endpoint |
| History filtering | Added exact `operationId` matching plus fallback `METHOD /path` matching and capped `limit` handling |
| Fixture-aligned fallback history | Updated fallback records to use real benchmark operation IDs such as `getHealth`, `loginUser`, `listProjects`, and `listTasks` |
| UI lazy loading | Changed the docs client to cache endpoint-specific history by operation key and fetch global history only on demand |
| Test hardening | Normalized snapshot report line endings in the core snapshot test so Windows CRLF checkouts pass content comparisons |
| Public beta release metadata | Changed release scripts to `--tag beta --access public`, package versions to `0.1.0-beta.0`, and all package `publishConfig.access` values to `public` |

---

## Acceptance Matrix

| Criterion | Status | Evidence |
| --- | --- | --- |
| Phase 7 plan exists | Pass | `spec/Phase-7-endpoint-history-plan.md` committed |
| Legacy global route remains available | Pass | CLI serve test fetches `/api/history` successfully |
| New global route works | Pass | CLI serve test fetches `/api/specord/history` successfully |
| Operation route works | Pass | CLI serve test fetches `/api/specord/history/operations/loginUser?limit=1` and gets one `loginUser` record |
| Fallback operation identity works | Pass | CLI serve test fetches encoded `GET /health` and gets `getHealth` |
| Jobs route works | Pass | CLI serve test verifies `local-history` job with `ready` status |
| Commit route works | Pass | CLI serve test filters `loginUser` history by commit |
| UI avoids eager global history | Pass | UI client renders first, fetches selected operation history on History tab activation, and only fetches global records for Show all |
| Public beta publish metadata | Pass | All scoped packages use version `0.1.0-beta.0` and `publishConfig.access: "public"` |
| Public beta publish dry run | Pass | `pnpm.cmd publish -r --dry-run --tag beta --access public --no-git-checks` completed for six packages |
| Real npm publish | Blocked | `pnpm.cmd release:publish` failed with npm `EOTP`; publish requires a current OTP or browser auth completion |

---

## Extraction Output Summary

Canonical fixture: `examples/nestjs-api`

| OpenAPI | Controllers | Paths | Operations | Schemas | Diagnostics |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3.1.0 | 7 | 22 | 27 | 42 | 29 |

Diagnostic mix:

| Code | Count |
| --- | ---: |
| `EXTRACTOR_UNSUPPORTED_DECORATOR` | 27 |
| `EXTRACTOR_UNRESOLVED_RESPONSE` | 1 |
| `EXTRACTOR_UNRESOLVED_SECURITY` | 1 |

Verification commands:

| Command | Result |
| --- | --- |
| `pnpm.cmd inspect -- --project examples/nestjs-api/tsconfig.json --root examples/nestjs-api/src` | Pass |
| `pnpm.cmd generate -- --project examples/nestjs-api/tsconfig.json --root examples/nestjs-api/src --pretty` | Pass, generated OpenAPI 3.1.0 with 2 unresolved warnings |
| `pnpm.cmd build` | Pass, 6/6 package builds |
| `pnpm.cmd test` | Pass, 11/11 Turborepo tasks and 76/76 Vitest tests |

---

## Architecture Capabilities

The system can now:

- Serve operation-scoped API history without requiring the UI to fetch all records up front.
- Preserve global history and legacy route compatibility.
- Expose lightweight history job status for the local cache/index surface.
- Drill into commit-scoped history records when records are already available.
- Keep git/cache failures graceful through the existing fallback behavior.
- Publish package metadata as npm public scoped beta packages.

The system still cannot:

- Publish private npm packages on the npm free plan.
- Build a full asynchronous historical indexer beyond the current snapshot/fallback record source.
- Render source-file diffs for commit drilldown; the commit route currently returns available API impact records only.

---

## Codebase Metrics

| Metric | Value |
| --- | ---: |
| Phase 7 checkpoint commits before report | 5 |
| Phase 7 files changed before report | 13 |
| Phase 7 diff before report | +515 / -39 |
| Workspace packages prepared for public beta publish | 6 |
| New dependencies | 0 |
| Workspace tests | 76 passing |

---

## Decision Log

| Decision | Rationale |
| --- | --- |
| Use `/api/specord/history` as the new base path | Keeps the planned Specord-owned route namespace distinct from the old `/api/history` compatibility endpoint |
| Keep `/api/history` | Avoids breaking existing Phase 6 docs shells or injected clients |
| Fetch endpoint history lazily in the UI | Matches the planned warm-load constraint and avoids global history work on initial render |
| Match by `operationId` and `METHOD /path` | Supports normal OpenAPI operation IDs and fallback identities for generated or missing IDs |
| Normalize newline comparisons in snapshot tests | Makes report synchronization tests platform-stable on Windows checkouts |
| Publish as public beta | npm free plan cannot publish private packages, so beta releases use public access plus the `beta` dist-tag |

---

## Roadmap

| Phase | Focus | Status |
| --- | --- | --- |
| Phase 7a | Server endpoint-history route contract | Completed |
| Phase 7b | UI operation-scoped history loading | Completed |
| Phase 7c | Private npm release metadata | Completed |
| Phase 7d | Report and real npm publish | Report completed; public beta publish blocked by npm one-time auth flow |
| Future | Background history indexer and source diff drilldown | Planned |

---

## Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| npm publish trust/session blocks publish | Medium | Retry after confirming npm trust state and authenticated session with `npm whoami` |
| Fallback history records are illustrative | Medium | Keep them fixture-aligned now; replace with real indexed records as the background indexer matures |
| Commit drilldown is record-only | Medium | Add source diff loading behind the commit route in the next history-indexing phase |
| Dynamic operation IDs may be absent | Low | Route supports `METHOD /path` fallback identity |
| Windows line endings can affect report assertions | Low | Snapshot report test now normalizes CRLF to LF before content comparison |
