# Semblia API Benchmark - 2026-07-02

## Status Summary

Goal: benchmark Specord against the real Semblia `apps/api_v2` surface as a private dogfood target and close the production-server gaps from GitHub issue #1.

Benchmark checkout:

- Clone: `C:\workspace\specord\testing\semblia-api`
- API package: `apps/api_v2`
- Config: local `apps/api_v2/specord.config.ts` with document metadata and three security schemes
- Specord command: `corepack.cmd pnpm benchmark:semblia`

The Semblia checkout stays under ignored `testing/`; only benchmark automation and reports are tracked in Specord.

## Setup Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Semblia checkout present | Pass | `testing/semblia-api/apps/api_v2` exists locally |
| Semblia dependencies present | Pass | Previous setup installed the benchmark workspace dependencies |
| Specord route parity script | Pass | `corepack.cmd pnpm benchmark:semblia` completed |
| Route parity | Pass | 107 paths and 136 operations |

## Output Comparison

| Source | Paths | Operations | Schemas | Security schemes | Query params | Path params | Request bodies |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Runtime Swagger baseline | 107 | 136 | 0 | 3 | 0 | 1 | 0 |
| Specord before issue #1 work | 107 | 136 | 0 | 3 | 15 | 1 | 44 |
| Specord after issue #1 work | 107 | 136 | 155 | 3 | 37 | 123 | 44 |

## Specord Inspect Metrics

| Metric | Before | After |
| --- | ---: | ---: |
| Controllers | 33 | 33 |
| Operations | 136 | 136 |
| Unique paths | 107 | 107 |
| Operation IDs | 136 | 136 |
| Operations with params | 16 | 88 |
| Total params | 16 | 160 |
| Path params | 1 | 123 |
| Query params | 15 | 37 |
| Operations with request bodies | 44 | 44 |
| Responses | 136 | 136 |
| Inferred responses | 15 | 58 |
| Unresolved responses | 121 | 78 |
| Inferred security states | 45 | 39 |
| Overridden security states | 0 | 97 |
| Unresolved security states | 91 | 0 |
| Schemas | 0 | 155 |
| Total diagnostics | 328 | 94 |

Diagnostic mix after issue #1 work:

| Code | Count |
| --- | ---: |
| `EXTRACTOR_UNRESOLVED_PATH_PARAM` | 16 |
| `EXTRACTOR_UNRESOLVED_RESPONSE` | 78 |

## What Was Closed

- Zod DTO aliases are now schema components, covering Semblia's `z.object(...)` plus `z.infer<typeof schema>` DTO style.
- Whole-object `@Param() params: ParamsDto` parameters expand into required OpenAPI path parameters.
- Missing path-template parameter coverage now emits `EXTRACTOR_UNRESOLVED_PATH_PARAM`.
- Semblia-style public/throttle/capability decorators no longer create unsupported-decorator noise.
- Guarded routes map to configured bearer security, reducing unresolved security from 91 to 0.
- Exported response interfaces and type aliases from shared TypeScript program files can become component schemas, including external files outside `--root`.
- A reproducible opt-in benchmark script now protects Semblia route parity.

## Remaining Gaps

- 78 responses remain unresolved. These are now narrower and should be investigated by return-type family, especially dynamic exports, framework response wrappers, and complex generic aliases.
- 16 path parameters still lack emitted parameter objects. The remaining cases likely need route-token aliasing, decorated parameter helpers, or DTO/schema patterns not yet covered.
- Zod support is intentionally pragmatic rather than exhaustive; transforms, effects, discriminated unions, records, maps, and advanced refinements still need targeted expansion.
- Response schema generation is conservative for classes and library/framework types so file streams and manual responses stay unresolved instead of being guessed.

## Product Implication

Specord now materially beats the runtime Swagger baseline on Semblia's real source: same route coverage, far more parameters, real request bodies, 155 schemas, and complete configured auth requirements. It is still not ready as a drop-in canonical source until the remaining unresolved response families and path-param outliers are reduced or made easy to override.

## Next Implementation Backlog

1. Cluster the 78 unresolved response diagnostics by return-type text and controller family.
2. Add targeted support for the largest remaining response-wrapper patterns.
3. Investigate the 16 unresolved path params and decide whether alias mapping or additional DTO extraction is the right fix.
4. Add a JSON output mode to `benchmark:semblia` if dashboard or CI ingestion becomes useful.
