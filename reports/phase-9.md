# Phase 9 Session Report - Safe Anonymous Response Inference

**Phase:** 9 - Safe anonymous response inference
**Date:** 2026-07-18
**Status:** Healthy for the implemented acceptance scope and final local verification. Default V1 output is unchanged; opt-in safe mode reduced unresolved production API surface responses from 78 to 41 while preserving route parity and valid OpenAPI. Final safety review fixes cover canonical Nest decorator provenance through aliases and local barrels, compiler-semantic `Promise`/`Observable` container resolution through aliases and qualified references, lookalike rejection, nullable anonymous roots, undefined/void-root rejection, direct and array-wrapped anonymous root-union rejection, explicit-export shadowing, recursive discovered/generated component validation, nullable-schema completeness, nested and top-level array item metadata, top-level anonymous-array route and whole-shape gating, and redirect/render boundaries. Pull request #4 remains open and unmerged; hosted checks and resolved review threads are mandatory delivery gates.

---

## Status Summary

Phase 9 delivers an explicit `inference.responses.anonymousObjects: "safe"` policy. It is disabled by default, so established V1 extraction and the canonical snapshot remain stable. When enabled, it accepts only closed compiler-visible anonymous response objects and retains conservative diagnostics for incomplete, transformed, manually handled, open, or unsupported responses.

Measured against the production server checkout, safe mode preserved 107 paths and 136 operations, raised inferred responses from 58 to 95, and reduced unresolved responses by 37 (47.4%). Generated OpenAPI validated successfully.

## What Was Built

| Area | Delivered |
| --- | --- |
| Configuration | Optional `inference.responses.anonymousObjects` policy with runtime validation for `"off"` and `"safe"` |
| Extraction | Closed anonymous response inference behind the opt-in policy |
| Safety boundary | Whole-shape rejection for index signatures, call/construct signatures, methods, classes, records, unknown members, direct and array-wrapped anonymous root unions, complex nested unions, dangling or incomplete component references, non-canonical `Date`/`Promise`/`Observable` identities, manual responses, visible response transforms, redirects, and rendered views from canonical `@nestjs/common` decorators; compiler-semantic container unwrapping supports canonical aliases and qualified references without admitting project-local lookalikes; route and whole-shape gates also cover nullable roots and array-wrapped anonymous objects, while accepted nested arrays preserve enum, format, and nullability metadata |
| Precedence | Swagger success responses and operation response overrides remain authoritative |
| Tests and docs | Focused response/config coverage, cyclic-config and controller-transform hardening, nullable-root and semantic-container regressions, normative contract, and configuration guidance |

## Acceptance Matrix

| Criterion | Status | Evidence |
| --- | --- | --- |
| Package builds | Pass | `@specord/types`, `@specord/core`, `@specord/openapi`, and `@specord/cli` builds passed with pnpm 10.33.4 |
| Focused anonymous-response suite | Pass | 57/57 tests, including nullable roots, object/array undefined-root and array void-root rejection, direct and array-wrapped anonymous root-union rejection, incomplete anonymous-array rejection, top-level array metadata preservation, manual union/nullable/array boundaries, default/off preservation, canonical aliased/qualified/nested/transformed containers, non-canonical lookalikes, and `PromiseLike` rejection |
| Core regression suite | Pass | 15 files, 132 tests passed after config, transform/non-JSON-boundary, scoped anonymous-array route and whole-shape gating, direct/mixed-root-union, decorator/type-provenance, barrel-shadowing, nullable-root/schema, semantic-container, array-metadata, and component-completeness hardening |
| Fresh uncached workspace build | Pass | `pnpm.cmd exec turbo run build --force`: 6/6 tasks, 0 cached, six packages, 5.868s |
| Fresh uncached workspace test | Pass | `pnpm.cmd exec turbo run test --force`: 12/12 tasks, 0 cached, 22 files and 160 tests across six packages, 53.51s |
| Workspace lint coverage | Not configured | `pnpm.cmd lint` exited 0, but Turbo executed 0 tasks and warned `No tasks were executed`; this is not lint coverage |
| Canonical snapshot and acceptance tests | Pass | 2 files, 16 tests passed |
| Canonical inspect/generate | Pass | Both commands exited 0; canonical model remains 7 controllers, 22 paths, 27 operations, and 42 schemas |
| Canonical snapshot artifacts | Pass | Registry, changelog, and log have no diff; snapshot content hash equals `HEAD` |
| Default production-server parity | Pass | 107 paths, 136 operations; benchmark route-parity gate passed |
| Safe-mode route parity | Pass | 107 paths, 136 operations |
| Safe-mode material improvement | Pass | Unresolved responses: 78 to 41; inferred responses: 58 to 95 |
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
| Inferred responses | 58 | 95 |
| Unresolved responses | 78 | 41 |
| Overridden responses | 0 | 0 |
| Total operation diagnostics | 94 | 57 |
| Unresolved-response diagnostics | 78 | 41 |
| Unmatched path-parameter diagnostics | 16 | 16 |

The 41 safe-mode residual responses are intentional: 27 are anonymous shapes rejected as not closed enough for safe inference (including three direct anonymous root unions and one incomplete anonymous-array item graph); 12 are named/non-reducible response shapes; and two are open `Record<string, unknown>` shapes. The unchanged 16 path-parameter diagnostics are outside this response-inference task.

## Architecture Capabilities

The system can infer a complete anonymous structural response only after TypeScript exposes a closed object shape and every nested member is representable without a partial, open, cyclic, or dangling schema. A root with exactly one anonymous object branch plus `null` is checked as that object and emitted with nullability intact; root `undefined` and `void` branches remain unresolved in safe mode. Nested supported primitives, literals, nullable values, arrays, dates, anonymous objects, and recursively complete discovered or response-generated references are supported.

In safe mode, TypeScript compiler identity unwraps canonical `Promise` and installed RxJS `Observable` containers through import aliases, namespace-qualified references, transforming type aliases, and nested containers. Project-local lookalikes, ambient RxJS spoofs, `PromiseLike`, and non-canonical containers remain unresolved. The default/off annotation path remains unchanged.

The system cannot infer runtime serialization/interceptor/filter effects, manually written responses, open records/index signatures, unknown or `any` members, callable/constructable objects, classes/framework wrappers, direct or array-wrapped multi-shape anonymous root unions, complex nested unions, or incomplete nested shapes. Those cases deliberately remain unresolved and retain their override path. Default/off keep the pre-existing root-union `oneOf` behavior; safe mode alone applies the stricter contract.

## Codebase Metrics

| Metric | Value |
| --- | ---: |
| Final branch commits (including report sync) | 40 |
| Final tracked files changed | 11 |
| Final insertions | 3,453 |
| Final deletions | 38 |
| Current core suite | 15 files, 132 tests |
| Fresh workspace suite | 22 files, 160 tests across six packages |
| New runtime dependencies | 0 |
| Package-manifest/lockfile dependency delta | 0 |

## Decision Log

| Decision | Rationale |
| --- | --- |
| Keep safe inference opt-in | Prevents unreviewed V1 output changes and snapshot churn |
| Require complete whole shapes | Documentation must not imply certainty when any nested member is unsupported |
| Preserve Swagger and config precedence | Explicit API documentation remains more authoritative than structural inference |
| Reject visible response-transform boundaries | Static return types cannot prove runtime serialization output |
| Treat redirects, rendered views, and anonymous arrays as route-boundary cases | Canonical non-JSON decorators and array wrappers must not bypass the same safe-mode route gate |
| Apply whole-shape validation to anonymous array graphs | An array wrapper must not retain an incomplete anonymous item, silently discard a root `undefined` or `void` branch, or let a mixed root union bypass the route gate; default/off retain legacy behavior |
| Resolve only canonical response-boundary and container identities | Canonical Nest decorators are followed through imports and barrels; safe-mode `Promise` and `Observable` wrappers use compiler-resolved identity through aliases, qualified names, and nested or transforming type aliases; project-local lookalikes are rejected while installed RxJS module augmentation remains supported |
| Treat nullable anonymous roots as one eligible branch | A root union of exactly one anonymous object plus `null` is checked whole-shape and emitted nullable; `undefined` and `void` do not silently become nullable responses |
| Reject anonymous multi-shape roots only in safe mode | Direct and array-wrapped anonymous root unions cannot inherit legacy `oneOf` emission or bypass route boundaries under the stricter policy; default/off remain unchanged |
| Validate referenced component contents recursively | A discovered or earlier-generated name is not proof that its schema is closed and complete |
| Preserve nested array metadata only in safe mode | Accepted safe responses retain enum, format, and nullability on array items without changing default/off output |
| Keep open records unresolved | Arbitrary keys and unknown values cannot be safely modeled as a closed object |
| Retain route-parity gate separately | Response-fidelity gains must not obscure routing regressions |

The work follows the design/RFC boundary in [RFC issue #3](https://github.com/anubhabx/specord/issues/3) and the production-fidelity follow-up in [issue #1](https://github.com/anubhabx/specord/issues/1).

## Roadmap

| Next step | TODO |
| --- | --- |
| Residual response analysis | Cluster the 27 rejected anonymous shapes by specific incomplete member pattern |
| Named response families | Add only source-justified support for repeated named shapes that remain unreducible |
| Path parameters | Investigate the 16 unchanged unmatched path tokens independently |
| Delivery | Keep pull request #4 open, require hosted checks and all review threads to be clean, and do not merge without separate authorization |

## Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Static source type differs from runtime serialization | Medium | Keep the feature opt-in, reject visible transform/manual/non-JSON boundaries including array wrappers, and retain explicit overrides |
| A partial or metadata-losing schema is accepted | Medium | Enforce recursive type and emitted-schema completeness; focused regression tests cover unsafe and undefined-like roots, nullable root emission, nested shapes, unsafe anonymous arrays, nullable schemas, and nested/top-level array item metadata |
| A source-spelled container alias bypasses provenance | Medium | Resolve safe-mode container identity and instantiated payloads through the TypeScript checker; reject lookalikes and cover alias, qualification, nesting, transformation, and ambient-spoof cases |
| Future type-family expansion changes default output | Medium | Default remains `"off"`; canonical snapshot/hash checks are mandatory |
| Residual path diagnostics are mistaken for response work | Low | Keep their count separate and schedule independent investigation |
| Production checkout state drifts | Medium | Keep benchmark local/opt-in and record target status before and after measurement |
