# Phase 8 Session Report - Semblia Swagger Replacement Gap Closure

**Phase:** 8 - Production API fidelity against the Semblia benchmark
**Date:** 2026-07-02
**Status:** Healthy. Route parity remains intact, the largest schema/security/parameter gaps are closed, and the remaining work is narrowed to response families and path-param outliers.

---

## Status Summary

Phase 8 targeted GitHub issue #1: close the gaps that prevented Specord from acting as a real upgrade over a Swagger-based system on Semblia's production API surface.

The implementation landed in focused slices:

- Zod DTO alias extraction.
- Whole-object path DTO expansion and unmatched path-token diagnostics.
- Semblia-style decorator/security mapping to configured bearer auth.
- Response interface/type-alias schema generation.
- Semblia benchmark automation and refreshed reporting.

Overall health is green for the implemented scope. The real Semblia benchmark still has unresolved response work, but it is now a tractable follow-up instead of a broad extractor failure.

Follow-up PR review hardening resolved the actionable review findings without changing route parity. The pass tightened Swagger response merging, raw schema harvesting, ambiguous security fallback behavior, benchmark process safety, shared clone/test scaffolding, zod pruning, mapped-type subclass members, parameter decorator edge cases, `HttpStatus.*` status handling, and nullable OpenAPI emission. A stricter zod/object unresolved pass was rejected after the benchmark proved it would regress the production-server surface.

---

## What Was Built

| Area | Delivered |
| --- | --- |
| Zod DTO schemas | Extracted exported `z.object(...)` schemas through exported `z.infer<typeof schema>` aliases, including primitives, arrays, enums/literals, optional/default/nullable, strict/passthrough, partial, and extend |
| Inline schema refs | Added `SchemaRef.kind === "inline"` so nested Zod object and union fragments can survive internal modeling and OpenAPI emission |
| Path DTO params | Expanded nameless `@Param() params: ParamsDto` into required OpenAPI path params |
| Path diagnostics | Added `EXTRACTOR_UNRESOLVED_PATH_PARAM` when a route template token has no emitted parameter |
| Decorator mapping | Allowed `@Public`, `@SkipThrottle`, `@Throttle`, `@RequireCapability`, and `@RequireAdmin` without unsupported-decorator noise |
| Security inference | Mapped guarded/auth-decorated routes to the configured bearer scheme, while keeping public throttled routes unauthenticated |
| Response schemas | Generated component schemas from exported interfaces and object type aliases reachable through return types, including shared program files outside `--root` |
| Review response hardening | Preserved inferred success responses when Swagger only documents errors, avoided duplicate inferred defaults when Swagger already documents a 2xx response, surfaced unresolved array item response diagnostics, parsed `HttpStatus.*` response statuses, and carried raw `@ApiResponse({ schema })` literals as inline schemas |
| Review security hardening | Stopped guessing a configured security scheme when multiple non-bearer schemes are available |
| Review extractor hardening | Added fixed-point zod schema pruning, mapped-type subclass property merging, implicit numeric enum extraction, named-query pipe support, property-scoped body skipping, generic `Array<T>` body resolution, symbolic `@HttpCode(HttpStatus.*)` handling, order-independent inferred security scheme inventory, and default-response override rejection |
| OpenAPI/nullability hardening | Preserved nullable `$ref` and enum schemas in internal response-generated OpenAPI fragments and final OpenAPI emission |
| Internal maintainability | Shared the JSON clone helper from `@specord/types`, kept core schema-ref clone helpers package-local, shared app auth-decorator names, and centralized temp-project test scaffolding |
| Benchmark stability | Added benchmark inspect timeout, child-process launch error handling, and null stdout/stderr fallback output |
| Benchmark automation | Added `pnpm benchmark:semblia`, which skips absent private checkout and asserts 107 paths / 136 operations when present |
| Documentation | Updated V1 spec, Semblia benchmark report, phase report, and snapshot registry files |

---

## Acceptance Matrix

| Criterion | Status | Evidence |
| --- | --- | --- |
| Canonical fixture snapshot remains deterministic | Pass | `corepack.cmd pnpm --filter @specord/core exec vitest run test/pipeline.snapshot.test.ts` |
| Zod alias schemas extract | Pass | `schema-extractor.test.ts` passed in focused runs |
| Path DTO params expand | Pass | `param-extractor.test.ts` and `path-param-diagnostics.test.ts` passed in focused runs |
| Configured guard security maps | Pass | `security-decorator-mapping.test.ts` passed |
| Public throttled routes stay public | Pass | `security-decorator-mapping.test.ts` asserts no OpenAPI security and no unsupported decorator diagnostics |
| External response interfaces become schemas | Pass | `response-interface-extractor.test.ts` passed |
| Existing fixture acceptance remains valid | Pass | `pipeline.acceptance.test.ts` passed with response interface test |
| PR review regressions | Pass | `corepack pnpm --filter @specord/core test` includes `response-review-regressions.test.ts` (6 tests) |
| Full core suite | Pass | `corepack pnpm --filter @specord/core test` (14 files, 69 tests) |
| OpenAPI emission package | Pass | `corepack.cmd pnpm --filter @specord/openapi test` (1 file, 2 tests) and `corepack.cmd pnpm --filter @specord/openapi build` |
| Package builds | Pass | `corepack pnpm --filter @specord/types build`, `@specord/core build`, `@specord/cli build`, `@specord/nestjs build`, `@specord/openapi build`, and `@specord/ui build` individually passed |
| Canonical inspect/generate | Pass | Fresh CLI dist produced 27 operations / 22 paths / 42 schemas from inspect and OpenAPI 3.1.0 with 22 paths / 27 operations / 42 schemas from generate |
| Semblia route parity | Pass | `corepack pnpm benchmark:semblia` reported 107 paths / 136 operations / 131 schemas / 78 unresolved responses |
| Root Turbo test | Blocked | `corepack.cmd pnpm test` still fails before package tests on Turbo `@specord/types#build` because a nested pnpm 11 install hits `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.27.7` |

---

## Extraction Output Summary

Canonical fixture: `examples/nestjs-api`

| Controllers | Paths | Operations | Schemas | Diagnostics |
| ---: | ---: | ---: | ---: | ---: |
| 7 | 22 | 27 | 42 | 25 |

Diagnostic mix:

| Code | Count |
| --- | ---: |
| `EXTRACTOR_UNRESOLVED_RESPONSE` | 1 |
| `EXTRACTOR_UNRESOLVED_SECURITY` | 1 |
| `EXTRACTOR_UNSUPPORTED_DECORATOR` | 23 |

Semblia benchmark: `testing/semblia-api/apps/api_v2`

| Metric | Before | After |
| --- | ---: | ---: |
| Paths | 107 | 107 |
| Operations | 136 | 136 |
| Schemas | 0 | 131 |
| Query params | 15 | 37 |
| Path params | 1 | 123 |
| Request bodies | 44 | 44 |
| Inferred responses | 15 | 58 |
| Unresolved responses | 121 | 78 |
| Unresolved security states | 91 | 0 |
| Diagnostics | 328 | 94 |

---

## Architecture Capabilities

The system can now:

- Use Zod/type-alias DTOs as first-class schema sources.
- Expand DTO-backed path parameters instead of requiring every path token to be individually decorated.
- Detect route/path parameter drift with a precise operation-scoped diagnostic.
- Infer configured bearer security for app guard conventions without per-operation overrides.
- Preserve public route intent when throttle guards are present.
- Pull response schemas from exported interfaces and object type aliases in shared TypeScript program files.
- Reproduce the private Semblia route-parity benchmark with one command when the ignored checkout exists.

The system still cannot:

- Fully resolve every Semblia response shape; 78 response diagnostics remain.
- Infer all Semblia path tokens; 16 path-param diagnostics remain.
- Model the full Zod ecosystem, especially effects, records/maps, discriminated unions, and complex refinements.
- Safely infer framework response classes or manual stream/file responses without explicit overrides.

---

## Codebase Metrics

| Metric | Value |
| --- | ---: |
| Focused implementation commits before report | 4 |
| Implementation files changed before report | 16 |
| Implementation diff before report | +2069 / -25 |
| Review hardening tracked diff | +600 / -130 class before report update, plus shared clone helper and regression coverage |
| New tests | 9 initial issue-closure tests plus 10 review/regression hardening tests |
| New dependencies | 0 |
| Semblia benchmark script | 1 |
| Canonical fixture diagnostics after snapshot refresh | 25 |
| Semblia diagnostics after issue #1 work | 94 |

---

## Decision Log

| Decision | Rationale |
| --- | --- |
| Add inline schema refs | Nested Zod objects and unions need a safe carrier without forcing artificial component names |
| Keep response class/library types conservative | Framework wrappers such as streams should stay unresolved instead of becoming misleading object schemas |
| Prefer configured HTTP bearer scheme for protected routes | Matches Semblia's common authenticated route behavior and avoids per-operation config noise |
| Do not infer default success when Swagger already declares a 2xx response | Prevents duplicate 201 responses beside explicit 200/202 Swagger success decorators |
| Infer success only for Swagger error-only decorators | Preserves typed success schemas for common `@ApiNotFoundResponse()`-plus-return-type patterns |
| Leave ambiguous non-bearer security unresolved | Avoids silently picking the alphabetically first API-key scheme for guarded routes |
| Share JSON clone helper from `@specord/types` | Removes duplicate JSON clone logic while keeping schema-ref clone helpers package-local |
| Preserve tolerant zod object parsing | Fixed-point pruning now removes transitively invalid schema aliases, but unsupported individual zod object members are still skipped so the production-server benchmark keeps its valid extracted surface |
| Reject `default` response overrides for now | `ResponseModel.status` is numeric, so validation now rejects unsupported `default` overrides instead of accepting and silently dropping them |
| Treat `@Public()` as an auth suppressor | Public throttled routes use guards for rate limiting, not caller authentication |
| Keep Semblia benchmark opt-in | The target checkout is private/local and should not make normal CI depend on external state |
| Assert only route parity in benchmark automation | Fidelity counts are reported, but route counts are the stable must-not-regress gate |

---

## Roadmap

| Next step | TODO |
| --- | --- |
| Response family clustering | Group the remaining 78 unresolved Semblia responses by return type and controller area |
| Response wrapper support | Add targeted support for the largest remaining shared response wrapper patterns |
| Path-param outliers | Inspect the 16 unmatched path tokens and add alias/decorator support only where source patterns justify it |
| Benchmark output | Add optional JSON output for CI dashboards or historical trend tracking |
| Override ergonomics | Make remaining explicit response/path overrides easy to author and audit |

---

## Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Type walker grows broad and hard to reason about | Medium | Keep generation limited to exported interfaces/type aliases and test each new type-family slice |
| Zod edge cases drift from runtime behavior | Medium | Add Semblia-derived fixtures before expanding effects, records, and discriminated unions |
| Route-token diagnostics may reveal aliases rather than missing params | Medium | Investigate the 16 remaining diagnostics before changing behavior |
| Benchmark checkout may become stale | Medium | Report the target checkout and keep the script's hard gate limited to route parity |
| Snapshot churn can hide meaningful extractor changes | Low | Registry/changelog/log are still checked by `pipeline.snapshot.test.ts` |
| Root Turbo test path invokes stale nested pnpm install behavior | Medium | Use direct package builds/tests until the pnpm ignored-builds policy is repaired for Turbo's nested install path |
