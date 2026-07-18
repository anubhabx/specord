# Phase 9 Safe Anonymous Response Inference Design

Date: 2026-07-17
Status: Approved for implementation

## Summary

Specord will add an explicit, opt-in response inference mode for closed anonymous
TypeScript object shapes. The default V1 contract remains conservative and
unchanged. When a user selects safe anonymous response inference, Specord may
emit an inline OpenAPI schema only when the complete compiler-visible shape can
be reduced without unknown members, dangling references, runtime evaluation, or
manual response handling.

The production-server benchmark currently reports 78 unresolved responses. A
fresh diagnostic clustering found that 76 are anonymous object shapes and two
are `Record<string, unknown>`. This makes anonymous structural responses the
largest remaining response-fidelity family, while the two open records remain
intentionally unconstrained.

## Goals

- Make source-derived response documentation materially more complete for the
  production-server benchmark.
- Preserve existing V1 output and diagnostics unless the user opts in.
- Infer only closed, fully reducible anonymous object shapes.
- Keep explicit Swagger metadata and operation overrides authoritative.
- Keep streams, manual responses, runtime transforms, open records, and unknown
  members unresolved.
- Produce deterministic inspection and OpenAPI output.

## Non-goals

- Inferring runtime interceptor, serializer, exception-filter, or middleware
  transformations.
- Inferring `Record<string, unknown>`, arbitrary index signatures, `any`, or
  `unknown` payloads.
- Supporting conditional types, callable objects, polymorphic root unions, or
  arbitrary generic wrappers.
- Changing response status selection or explicit response precedence.
- Making anonymous response inference the V1 default.
- Adding benchmark JSON output or addressing path-parameter outliers.

## Approaches Considered

### 1. Opt-in safe structural inference (selected)

Add a narrow config mode that preserves the V1 default and only accepts a
closed compiler-visible object shape. This gives the private dogfood workflow a
high-value path without silently changing established output for other users.

### 2. Enable anonymous inference by default

This would reduce diagnostics with the least configuration, but it contradicts
the normative V1 contract and would change canonical fixture output. It also
turns runtime-transform uncertainty into an implicit global assumption.

### 3. Require per-operation response overrides

Overrides remain the precision fallback, but authoring and maintaining dozens
of duplicate response schemas defeats source-first extraction and does not
improve the extractor for repeated structural patterns.

## Configuration Contract

`SpecordConfigV1` gains this optional section:

```ts
inference?: {
  responses?: {
    anonymousObjects?: "off" | "safe";
  };
};
```

The effective default is `"off"`. An omitted `inference` section, omitted
`responses` section, omitted `anonymousObjects`, or explicit `"off"` all retain
the current V1 behavior.

The config loader rejects any other runtime value with a path-specific error.
`defineConfig` provides the same restriction at TypeScript compile time.

Explicit Swagger success responses continue to short-circuit source inference.
`operations.<id>.responses` overrides remain authoritative when the pipeline
applies config overrides after extraction.

## Safe-mode Eligibility

Safe mode unwraps response containers from their compiler-resolved type rather
than their source spelling. This admits canonical imported aliases,
namespace-qualified references, and instantiated type aliases for TypeScript
`Promise<T>` and installed `rxjs` `Observable<T>`, while rejecting project-local
lookalikes. After unwrapping those containers, the root response type is
eligible only when all of the following are true:

1. It is a TypeScript object with `ObjectFlags.Anonymous`.
2. It has no alias symbol or class declaration.
3. It has no string or numeric index signature.
4. It has no call or construct signature.
5. It exposes at least one non-method property.
6. The route has no `@Res()` or `@Response()` parameter.
7. The route method and controller have no `@UseInterceptors`,
   `@SerializeOptions`, `@UseFilters`, `@Redirect`, or `@Render`
   response-boundary marker.

A root union containing `null` and exactly one non-nullish anonymous branch is
checked as that branch, then emitted with its nullability intact. `undefined`
and multi-shape root unions do not gain anonymous-root eligibility. A
multi-shape root with any direct anonymous object branch or anonymous object
beneath an array branch is explicitly rejected in safe mode and still passes
through the route-boundary gate; default/off keep their legacy `oneOf` behavior.

The same route and complete-shape gates apply to an existing top-level array
response when its item graph contains an anonymous object. This prevents an
array wrapper from bypassing a manual or transformed boundary or retaining an
incomplete anonymous item. Mixed root unions remain ineligible in safe mode.

Safe mode reasons from the TypeScript compiler's final structural type. Object
spreads are not evaluated at runtime; they are usable only when the compiler has
already produced a closed property set that passes every rule above.

## Complete-shape Requirement

Eligible roots are reduced through the existing response schema walker. The
result is accepted only when every nested schema is complete.

Supported nested forms are:

- string, number, boolean, and null primitives;
- string, number, and boolean literals or same-primitive literal enums;
- `Date` as an OpenAPI `string` with `date-time` format;
- arrays whose item shape is complete;
- nested closed anonymous objects;
- references to discovered or response-generated schemas; and
- nullable variants of an otherwise complete supported type.

The whole response remains unresolved if any nested branch contains:

- `any`, `unknown`, or `never`;
- an empty or unconstrained schema object;
- an index signature or `Record` shape;
- a dangling component reference;
- a callable, constructable, class, or framework response shape;
- a complex non-literal union or conditional type; or
- a method property omitted from the structural schema.

No partial anonymous response schema is emitted. Generated component schemas
created during a rejected attempt are discarded so enabling safe mode does not
change unrelated model output.

## Inference and Diagnostics

An accepted anonymous response uses:

```ts
inference: { status: "inferred" }
```

and does not emit `EXTRACTOR_UNRESOLVED_RESPONSE` for that operation.

A rejected candidate retains the existing unresolved response description,
inference state, diagnostic code, suggested override path, and deterministic
ordering. Its reason identifies that the anonymous shape is not closed enough
for safe inference.

Explicit operation overrides retain `inference: { status: "overridden" }` and
continue to remove only the directly resolved response diagnostic.

## Architecture and Data Flow

1. `packages/types` exposes the optional inference config shape.
2. The config loader validates the mode without adding a default object to the
   serialized user config.
3. The pipeline converts the mode to an internal boolean response-extraction
   option.
4. The response extractor checks route eligibility before allowing a root
   anonymous object.
5. The existing type walker builds a candidate inline schema.
6. A completeness check rejects unknown members, empty schemas, and dangling
   references before the response is marked inferred.
7. The OpenAPI emitter consumes the existing `SchemaRef.kind === "inline"`
   representation; no emitter model change is required.

## Testing Strategy

### Config contract

- Accept `"safe"` and `"off"`.
- Reject unsupported runtime values with the exact config path.
- Preserve absent-config behavior.

### Response extraction

- Keep an anonymous response unresolved by default.
- Infer a nested closed anonymous response in safe mode.
- Preserve literals, nullable members, arrays, and `Date` format.
- Reject root and nested `Record<string, unknown>` shapes.
- Reject `any`, `unknown`, empty objects, callables, index signatures, complex
  unions, and dangling library references.
- Reject `@Res()` / `@Response()`, response-transform-decorated, redirect, and
  rendered-view routes, including anonymous object items behind array wrappers.
- Preserve the canonical dynamic file export as unresolved.
- Preserve explicit Swagger and config response precedence.

### Acceptance gates

- Focused tests demonstrate red before implementation and green afterward.
- The complete `@specord/core` suite passes.
- Workspace tests and builds pass from the isolated worktree without cache-only
  evidence.
- Canonical inspect and generate counts remain stable under default config.
- The normalized canonical snapshot remains unchanged.
- The production-server benchmark retains 107 paths and 136 operations.
- Safe mode materially reduces the 78 unresolved responses while every
  remaining response is classified as intentionally unsafe or unsupported.
- Generated OpenAPI remains valid and contains no dangling references.

## Documentation and Reporting

- Update the normative V1 spec with the explicit safe-mode exception.
- Document the config option and conservative boundaries.
- Write a cumulative `reports/phase-9.md` with exact default and safe-mode
  counts, acceptance results, architecture capabilities, decisions, roadmap,
  and risks.
- Public issue and PR text use `production server` or `production API surface`;
  private target names do not appear in new public artifacts.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Static return type differs from runtime output | Opt-in mode, exclude visible response transforms/manual responses, document global-transform responsibility, keep overrides authoritative |
| Partial schemas appear complete | Reject empty schemas, unknown branches, dangling refs, methods, callables, and index signatures recursively |
| V1 consumers see snapshot churn | Default remains off and canonical default snapshot must remain unchanged |
| Type walker becomes difficult to reason about | Keep root eligibility and schema completeness as separate focused helpers with direct tests |
| Benchmark improvement hides route regressions | Retain the independent 107-path/136-operation parity gate |

## Decision

Proceed with opt-in safe structural inference on a focused feature branch. Do
not change the V1 default. Treat the RFC issue, this design, failing-first tests,
measured benchmark delta, and a green pull request as the delivery boundary.
