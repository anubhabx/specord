# Phase 9 Session Report - Safe Anonymous Response Inference

**Phase:** 9 - Safe anonymous response inference
**Date:** 2026-07-17
**Status:** Healthy for the implemented acceptance scope. Default V1 output is unchanged; opt-in safe mode reduced unresolved production API surface responses from 78 to 37 while preserving route parity and valid OpenAPI.

---

## Status Summary

Phase 9 delivers an explicit `inference.responses.anonymousObjects: "safe"` policy. It is disabled by default, so established V1 extraction and the canonical snapshot remain stable. When enabled, it accepts only closed compiler-visible anonymous response objects and retains conservative diagnostics for incomplete, transformed, manually handled, open, or unsupported responses.

Measured against the production server checkout, safe mode preserved 107 paths and 136 operations, raised inferred responses from 58 to 99, and reduced unresolved responses by 41 (52.6%). Generated OpenAPI validated successfully.

## What Was Built

| Area | Delivered |
| --- | --- |
| Configuration | Optional `inference.responses.anonymousObjects` policy with runtime validation for `"off"` and `"safe"` |
| Extraction | Closed anonymous response inference behind the opt-in policy |
| Safety boundary | Whole-shape rejection for index signatures, call/construct signatures, methods, classes, records, unknown members, complex unions, dangling references, manual responses, and visible response transforms |
| Precedence | Swagger success responses and operation response overrides remain authoritative |
| Tests and docs | Focused response/config coverage, normative contract, and configuration guidance |

## Acceptance Matrix

| Criterion | Status | Evidence |
| --- | --- | --- |
| Package builds | Pass | `@specord/types`, `@specord/core`, `@specord/openapi`, and `@specord/cli` builds passed with pnpm 10.33.4 |
| Core regression suite | Pass | 15 files, 95 tests passed |
| Canonical snapshot and acceptance tests | Pass | 2 files, 16 tests passed |
| Canonical inspect/generate | Pass | Both commands exited 0; canonical model remains 7 controllers, 22 paths, 27 operations, and 42 schemas |
| Canonical snapshot artifacts | Pass | Registry, changelog, and log have no diff; snapshot content hash equals `HEAD` |
| Default production-server parity | Pass | 107 paths, 136 operations; benchmark route-parity gate passed |
| Safe-mode route parity | Pass | 107 paths, 136 operations |
| Safe-mode material improvement | Pass | Unresolved responses: 78 to 37; inferred responses: 58 to 99 |
| Safe-mode OpenAPI | Pass | Validation returned `valid: true`; no errors or dangling-reference failure |
| Target checkout preservation | Pass | Status before and after was only the pre-existing untracked config file; no transient compiled module remained |

## Extraction Output Summary

Canonical fixture (`examples/nestjs-api`) remains at 7 controllers, 22 paths, 27 operations, 42 schemas, and 25 diagnostics: 23 unsupported decorators, one unresolved response, and one unresolved security state.

Production API surface measurements:

| Metric | Default | Safe mode |
| --- | ---: | ---: |
| Controllers | 33 | 33 |
| Paths | 107 | 107 |
| Operations | 136 | 136 |
| Schemas | 155 | 155 |
| Parameters | 160 | 160 |
| Request bodies | 44 | 44 |
| Inferred responses | 58 | 99 |
| Unresolved responses | 78 | 37 |
| Overridden responses | 0 | 0 |
| Total operation diagnostics | 94 | 53 |
| Unresolved-response diagnostics | 78 | 37 |
| Unmatched path-parameter diagnostics | 16 | 16 |

The 37 safe-mode residual responses are intentional: 23 are anonymous shapes rejected as not closed enough for safe inference; 12 are named/non-reducible response shapes; and two are open `Record<string, unknown>` shapes. The unchanged 16 path-parameter diagnostics are outside this response-inference task.

## Architecture Capabilities

The system can infer a complete anonymous structural response only after TypeScript exposes a closed object shape and every nested member is representable without a partial or dangling schema. Nested supported primitives, literals, nullable values, arrays, dates, anonymous objects, and valid discovered or response-generated references are supported.

The system cannot infer runtime serialization/interceptor/filter effects, manually written responses, open records/index signatures, unknown or `any` members, callable/constructable objects, classes/framework wrappers, complex unions, or incomplete nested shapes. Those cases deliberately remain unresolved and retain their override path.

## Codebase Metrics

| Metric | Value |
| --- | ---: |
| Pre-report commits (`fe1a20e..055e89c`) | 10 |
| Pre-report tracked files changed | 10 |
| Pre-report insertions | 1,617 |
| Pre-report deletions | 5 |
| Current core suite | 15 files, 95 tests |
| New runtime dependencies | 0 |
| Package-manifest/lockfile dependency delta | 0 |

## Decision Log

| Decision | Rationale |
| --- | --- |
| Keep safe inference opt-in | Prevents unreviewed V1 output changes and snapshot churn |
| Require complete whole shapes | Documentation must not imply certainty when any nested member is unsupported |
| Preserve Swagger and config precedence | Explicit API documentation remains more authoritative than structural inference |
| Reject visible response-transform boundaries | Static return types cannot prove runtime serialization output |
| Keep open records unresolved | Arbitrary keys and unknown values cannot be safely modeled as a closed object |
| Retain route-parity gate separately | Response-fidelity gains must not obscure routing regressions |

The work follows the design/RFC boundary in [RFC issue #3](https://github.com/anubhabx/specord/issues/3) and the production-fidelity follow-up in [issue #1](https://github.com/anubhabx/specord/issues/1).

## Roadmap

| Next step | TODO |
| --- | --- |
| Residual response analysis | Cluster the 23 rejected anonymous shapes by specific incomplete member pattern |
| Named response families | Add only source-justified support for repeated named shapes that remain unreducible |
| Path parameters | Investigate the 16 unchanged unmatched path tokens independently |
| Verification and delivery | Task 7: full workspace verification, review, and pull-request checks |

## Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Static source type differs from runtime serialization | Medium | Keep the feature opt-in, reject visible transform/manual boundaries, and retain explicit overrides |
| A partial schema is accepted | Medium | Enforce recursive type and emitted-schema completeness; focused regression tests cover unsafe roots and nested shapes |
| Future type-family expansion changes default output | Medium | Default remains `"off"`; canonical snapshot/hash checks are mandatory |
| Residual path diagnostics are mistaken for response work | Low | Keep their count separate and schedule independent investigation |
| Production checkout state drifts | Medium | Keep benchmark local/opt-in and record target status before and after measurement |
