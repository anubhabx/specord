# Phase 9 Session Report - Safe Anonymous Response Inference

**Phase:** 9 - Safe anonymous response inference
**Date:** 2026-07-18
**Status:** Healthy for the implemented acceptance scope and final local verification. Default V1 output is unchanged; opt-in safe mode reduced unresolved production API surface responses from 78 to 37 while preserving route parity and valid OpenAPI. Final safety review fixes cover canonical Nest decorator provenance through aliases and local barrels, built-in/container type provenance, explicit-export shadowing, recursive discovered/generated component validation, nullable-schema completeness, and nested array item metadata. Pull request #4 remains open and unmerged; hosted checks and resolved review threads are mandatory delivery gates.

---

## Status Summary

Phase 9 delivers an explicit `inference.responses.anonymousObjects: "safe"` policy. It is disabled by default, so established V1 extraction and the canonical snapshot remain stable. When enabled, it accepts only closed compiler-visible anonymous response objects and retains conservative diagnostics for incomplete, transformed, manually handled, open, or unsupported responses.

Measured against the production server checkout, safe mode preserved 107 paths and 136 operations, raised inferred responses from 58 to 99, and reduced unresolved responses by 41 (52.6%). Generated OpenAPI validated successfully.

## What Was Built

| Area | Delivered |
| --- | --- |
| Configuration | Optional `inference.responses.anonymousObjects` policy with runtime validation for `"off"` and `"safe"` |
| Extraction | Closed anonymous response inference behind the opt-in policy |
| Safety boundary | Whole-shape rejection for index signatures, call/construct signatures, methods, classes, records, unknown members, complex unions, dangling or incomplete component references, non-canonical `Date`/`Promise`/`Observable` identities, manual responses, and visible response transforms from canonical `@nestjs/common` decorators; accepted nested arrays preserve enum, format, and nullability metadata |
| Precedence | Swagger success responses and operation response overrides remain authoritative |
| Tests and docs | Focused response/config coverage, cyclic-config and controller-transform hardening, normative contract, and configuration guidance |

## Acceptance Matrix

| Criterion | Status | Evidence |
| --- | --- | --- |
| Package builds | Pass | `@specord/types`, `@specord/core`, `@specord/openapi`, and `@specord/cli` builds passed with pnpm 10.33.4 |
| Core regression suite | Pass | 15 files, 119 tests passed after config, transform-boundary, decorator/type-provenance, barrel-shadowing, nullable-schema, array-metadata, and component-completeness hardening |
| Fresh uncached workspace build | Pass | `pnpm.cmd exec turbo run build --force`: 6/6 tasks, 0 cached, six packages, 5.870s |
| Fresh uncached workspace test | Pass | `pnpm.cmd exec turbo run test --force`: 12/12 tasks, 0 cached, 22 files and 147 tests across six packages, 57.594s |
| Workspace lint coverage | Not configured | `pnpm.cmd lint` exited 0, but Turbo executed 0 tasks and warned `No tasks were executed`; this is not lint coverage |
| Canonical snapshot and acceptance tests | Pass | 2 files, 16 tests passed |
| Canonical inspect/generate | Pass | Both commands exited 0; canonical model remains 7 controllers, 22 paths, 27 operations, and 42 schemas |
| Canonical snapshot artifacts | Pass | Registry, changelog, and log have no diff; snapshot content hash equals `HEAD` |
| Default production-server parity | Pass | 107 paths, 136 operations; benchmark route-parity gate passed |
| Safe-mode route parity | Pass | 107 paths, 136 operations |
| Safe-mode material improvement | Pass | Unresolved responses: 78 to 37; inferred responses: 58 to 99 |
| Safe-mode OpenAPI | Pass | Validation returned `valid: true`; no errors or dangling-reference failure |
| Target checkout preservation | Pass | Status before and after was only the pre-existing untracked config file; no transient compiled module remained |
| Local branch audit | Pass | Worktree clean; branch diff check and public private-name scan passed |

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

The system can infer a complete anonymous structural response only after TypeScript exposes a closed object shape and every nested member is representable without a partial, open, cyclic, or dangling schema. Nested supported primitives, literals, nullable values, arrays, dates, anonymous objects, and recursively complete discovered or response-generated references are supported.

The system cannot infer runtime serialization/interceptor/filter effects, manually written responses, open records/index signatures, unknown or `any` members, callable/constructable objects, classes/framework wrappers, complex unions, or incomplete nested shapes. Those cases deliberately remain unresolved and retain their override path.

## Codebase Metrics

| Metric | Value |
| --- | ---: |
| Final branch commits (including report sync) | 29 |
| Final tracked files changed | 11 |
| Final insertions | 2,915 |
| Final deletions | 39 |
| Current core suite | 15 files, 119 tests |
| Fresh workspace suite | 22 files, 147 tests across six packages |
| New runtime dependencies | 0 |
| Package-manifest/lockfile dependency delta | 0 |

## Decision Log

| Decision | Rationale |
| --- | --- |
| Keep safe inference opt-in | Prevents unreviewed V1 output changes and snapshot churn |
| Require complete whole shapes | Documentation must not imply certainty when any nested member is unsupported |
| Preserve Swagger and config precedence | Explicit API documentation remains more authoritative than structural inference |
| Reject visible response-transform boundaries | Static return types cannot prove runtime serialization output |
| Resolve only canonical response-boundary identities | Canonical Nest decorators are followed through imports and barrels; type-name-only `Date`, `Promise`, or `Observable` matches are not trusted, while installed RxJS module augmentation remains supported |
| Validate referenced component contents recursively | A discovered or earlier-generated name is not proof that its schema is closed and complete |
| Preserve nested array metadata only in safe mode | Accepted safe responses retain enum, format, and nullability on array items without changing default/off output |
| Keep open records unresolved | Arbitrary keys and unknown values cannot be safely modeled as a closed object |
| Retain route-parity gate separately | Response-fidelity gains must not obscure routing regressions |

The work follows the design/RFC boundary in [RFC issue #3](https://github.com/anubhabx/specord/issues/3) and the production-fidelity follow-up in [issue #1](https://github.com/anubhabx/specord/issues/1).

## Roadmap

| Next step | TODO |
| --- | --- |
| Residual response analysis | Cluster the 23 rejected anonymous shapes by specific incomplete member pattern |
| Named response families | Add only source-justified support for repeated named shapes that remain unreducible |
| Path parameters | Investigate the 16 unchanged unmatched path tokens independently |
| Delivery | Keep pull request #4 open, require hosted checks and all review threads to be clean, and do not merge without separate authorization |

## Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Static source type differs from runtime serialization | Medium | Keep the feature opt-in, reject visible transform/manual boundaries, and retain explicit overrides |
| A partial or metadata-losing schema is accepted | Medium | Enforce recursive type and emitted-schema completeness; focused regression tests cover unsafe roots, nested shapes, nullable schemas, and array item metadata |
| Future type-family expansion changes default output | Medium | Default remains `"off"`; canonical snapshot/hash checks are mandatory |
| Residual path diagnostics are mistaken for response work | Low | Keep their count separate and schedule independent investigation |
| Production checkout state drifts | Medium | Keep benchmark local/opt-in and record target status before and after measurement |
