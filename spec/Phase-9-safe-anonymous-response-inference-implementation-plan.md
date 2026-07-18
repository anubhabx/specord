# Phase 9 Safe Anonymous Response Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in safe mode that infers fully closed anonymous TypeScript response objects without changing Specord V1's default output.

**Architecture:** Extend `SpecordConfigV1` with a nested response-inference policy, validate it at config load, and pass a boolean policy from the pipeline into the response extractor. The extractor will separate root eligibility, recursive TypeScript safety, and emitted-schema completeness so rejected attempts cannot leak partial schemas. Existing inline `SchemaRef` and OpenAPI emission paths remain unchanged.

**Tech Stack:** TypeScript 5.9, TypeScript Compiler API, Vitest 3.2, pnpm 10.33.4, Turborepo, OpenAPI 3.1

## Global Constraints

- Preserve the default V1 behavior and normalized canonical snapshot.
- The only new config path is `inference.responses.anonymousObjects` with values `"off" | "safe"`.
- Omitted config and `"off"` are behaviorally identical.
- Never emit a partial safe anonymous response schema.
- Explicit Swagger success responses and operation response overrides remain authoritative.
- `@Res()` / `@Response()`, visible response transforms, streams, framework classes, open records, and unknown members remain unresolved.
- Keep 107-path and 136-operation production-server route parity.
- Add no runtime dependencies.
- Use neutral `production server` wording in public artifacts.
- End each behavior slice with a focused Conventional Commit.

---

### Task 1: Add and validate the config contract

**Files:**
- Modify: `packages/types/src/config.ts`
- Modify: `packages/core/src/config/loader.ts`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Produces: `SpecordConfigV1["inference"]["responses"]["anonymousObjects"]` with `"off" | "safe"`.
- Produces: runtime validation error naming `inference.responses.anonymousObjects`.

- [ ] **Step 1: Write the failing runtime validation test**

Add these cases to `describe("config validation")` in `packages/core/test/config.test.ts`:

```ts
it.each(["off", "safe"] as const)(
  "accepts inference.responses.anonymousObjects=%s",
  (anonymousObjects) => {
    expect(() =>
      validateConfig({
        inference: { responses: { anonymousObjects } },
      }),
    ).not.toThrow();
  },
);

it("rejects unsupported anonymous response inference modes", () => {
  expect(() =>
    validateConfig({
      inference: {
        responses: { anonymousObjects: "aggressive" },
      },
    } as any),
  ).toThrow(/inference\.responses\.anonymousObjects.*off.*safe/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @specord/core exec vitest run test/config.test.ts
```

Expected: the unsupported-mode test fails because `validateConfig` currently accepts the value.

- [ ] **Step 3: Add the public config type**

Insert before `securitySchemes` in `SpecordConfigV1`:

```ts
inference?: {
  responses?: {
    anonymousObjects?: "off" | "safe";
  };
};
```

- [ ] **Step 4: Add path-specific runtime validation**

After routing validation in `validateConfig`, validate nested objects defensively:

```ts
const inference = isObject(config.inference) ? config.inference : undefined;
const responses = isObject(inference?.responses)
  ? inference.responses
  : undefined;
const anonymousObjects = responses?.anonymousObjects;

if (
  anonymousObjects !== undefined &&
  anonymousObjects !== "off" &&
  anonymousObjects !== "safe"
) {
  throw new Error(
    `[specord] Config error in inference.responses.anonymousObjects: ` +
    `expected "off" or "safe", got ${JSON.stringify(anonymousObjects)}`,
  );
}
```

- [ ] **Step 5: Verify GREEN and public type compilation**

Run:

```powershell
pnpm --filter @specord/core exec vitest run test/config.test.ts
pnpm --filter @specord/types build
pnpm --filter @specord/core build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the config slice**

```powershell
git add packages/types/src/config.ts packages/core/src/config/loader.ts packages/core/test/config.test.ts
git commit -m "feat(core): add anonymous response inference policy"
```

---

### Task 2: Infer a closed anonymous response only in safe mode

**Files:**
- Create: `packages/core/test/anonymous-response-inference.test.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/extractors/response-extractor.ts`

**Interfaces:**
- Produces: internal `ResponseExtractionOptions` with `inferSafeAnonymousObjects?: boolean`.
- Consumes: `config.inference?.responses?.anonymousObjects === "safe"`.
- Produces: inline response `SchemaRef` for a closed anonymous root.

- [ ] **Step 1: Create the focused test harness and safe-mode failing test**

Create `packages/core/test/anonymous-response-inference.test.ts` with a temp-project helper that writes one controller and calls:

```ts
inspect(
  resolveConfig(
    { project: path.join(projectRoot, "tsconfig.json"), root: srcRoot },
    anonymousObjects
      ? { inference: { responses: { anonymousObjects } } }
      : undefined,
  ),
);
```

The first fixture method is:

```ts
get(): Promise<{
  id: string;
  active: boolean;
  mode: "draft" | "live";
  updatedAt: Date;
  tags?: string[];
  metrics: { count: number | null };
}> {
  throw new Error("not implemented");
}
```

Assert that `"safe"` produces an inferred inline object containing all six
properties, `date-time` format, the literal enum, nullable count, and required
fields `id`, `active`, `mode`, `updatedAt`, and `metrics`. Assert that the
operation has no `EXTRACTOR_UNRESOLVED_RESPONSE` diagnostic.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
pnpm --filter @specord/core exec vitest run test/anonymous-response-inference.test.ts
```

Expected: safe mode still returns `inference.status === "unresolved"`.

- [ ] **Step 3: Thread the internal option through the pipeline**

Add to `response-extractor.ts`:

```ts
export interface ResponseExtractionOptions {
  inferSafeAnonymousObjects?: boolean;
}
```

Accept `options: ResponseExtractionOptions = {}` in `extractResponse`, pass it
to `inferReturnType`, and pass this object from `pipeline.ts`:

```ts
{
  inferSafeAnonymousObjects:
    userConfig.inference?.responses?.anonymousObjects === "safe",
}
```

- [ ] **Step 4: Add the minimal anonymous root gate**

Add a helper that returns true only for an alias-free TypeScript object carrying
`ObjectFlags.Anonymous`. Use it to set root `allowAnonymousObject` only when the
internal option is enabled.

```ts
function isAnonymousObjectType(type: ts.Type): boolean {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    !!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) &&
    type.aliasSymbol === undefined
  );
}
```

- [ ] **Step 5: Verify GREEN**

```powershell
pnpm --filter @specord/core exec vitest run test/anonymous-response-inference.test.ts
```

Expected: the safe closed-object test passes.

- [ ] **Step 6: Add the default-off characterization**

Run the same fixture without inference config and with explicit `"off"` in two
separate assertions. Both must retain unresolved response state and diagnostic.

- [ ] **Step 7: Re-run the focused file**

Expected: all anonymous response tests pass.

- [ ] **Step 8: Commit the opt-in happy path**

```powershell
git add packages/core/src/pipeline.ts packages/core/src/extractors/response-extractor.ts packages/core/test/anonymous-response-inference.test.ts
git commit -m "feat(core): infer closed anonymous responses in safe mode"
```

---

### Task 3: Reject unsafe roots and incomplete nested shapes

**Files:**
- Modify: `packages/core/test/anonymous-response-inference.test.ts`
- Modify: `packages/core/src/extractors/response-extractor.ts`

**Interfaces:**
- Produces: root eligibility predicate using object flags, signatures, index information, aliases, and method properties.
- Produces: recursive TypeScript safety check and emitted `SchemaRef` completeness check.

- [ ] **Step 1: Add failing root-rejection fixtures**

In safe mode, add separate operations and assert each stays unresolved:

```ts
indexed(): Promise<{ [key: string]: string; known: string }>;
callable(): Promise<{ (): string; id: string }>;
withMethod(): Promise<{ id: string; run(): string }>;
openRecord(): Promise<Record<string, unknown>>;
```

- [ ] **Step 2: Run the focused tests and verify RED**

Expected: at least the indexed, callable, or method-bearing shape is currently
accepted as a partial inline object.

- [ ] **Step 3: Strengthen root eligibility**

Require all of the following before root anonymous generation:

```ts
checker.getIndexInfosOfType(type).length === 0
checker.getSignaturesOfType(type, ts.SignatureKind.Call).length === 0
checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length === 0
checker.getPropertiesOfType(type).length > 0
checker.getPropertiesOfType(type).every((symbol) => !isMethodLikeSymbol(symbol))
```

Also reject alias symbols, class declarations, `any`, `unknown`, `never`, and
conditional roots.

- [ ] **Step 4: Verify root rejection is GREEN**

Run the focused test file and confirm every unsafe root remains unresolved.

- [ ] **Step 5: Add failing nested-incompleteness fixtures**

Add separate safe-mode operations and assert each whole response stays
unresolved with no leaked response-generated schemas:

```ts
nestedRecord(): Promise<{ data: Record<string, unknown> }>;
nestedUnknown(): Promise<{ data: unknown }>;
nestedEmpty(): Promise<{ data: {} }>;
nestedComplexUnion(): Promise<{ data: { a: string } | { b: number } }>;
nestedLibrary(): Promise<{ data: Buffer }>;
```

- [ ] **Step 6: Run the focused tests and verify RED**

Expected: one or more nested cases are currently inferred with `{}` or a
dangling `$ref` inside the inline schema.

- [ ] **Step 7: Add recursive safety and completeness helpers**

Before accepting the candidate, recursively reject TypeScript branches with
unknown flags, open index signatures, calls/constructors, method properties, or
non-literal multi-branch unions. After schema generation, recursively verify:

- `unknown` refs are incomplete;
- component refs exist in discovered or generated schema maps;
- arrays have complete items;
- inline schemas are non-empty;
- every `properties` value and `items` schema is complete;
- `oneOf` is accepted only for the existing nullable form with exactly one
  complete non-null branch and one `{ type: "null" }` branch; and
- `anyOf` / non-null `oneOf` candidates are incomplete.

Return `schemas: {}` when a safe attempt is rejected. Keep the existing
unresolved response and diagnostic contract.

- [ ] **Step 8: Verify nested rejection and happy path**

```powershell
pnpm --filter @specord/core exec vitest run test/anonymous-response-inference.test.ts
```

Expected: all safe and unsafe cases pass.

- [ ] **Step 9: Commit strict whole-shape safety**

```powershell
git add packages/core/src/extractors/response-extractor.ts packages/core/test/anonymous-response-inference.test.ts
git commit -m "fix(core): reject incomplete anonymous response schemas"
```

---

### Task 4: Preserve manual-response, transform, and explicit-response boundaries

**Files:**
- Modify: `packages/core/test/anonymous-response-inference.test.ts`
- Modify: `packages/core/src/extractors/response-extractor.ts`

**Interfaces:**
- Produces: `routeAllowsSafeAnonymousInference(route)`.
- Consumes: parameter, method, and controller decorator AST metadata.

- [ ] **Step 1: Add failing manual and transform fixtures**

Declare decorator stubs and add safe-mode routes with a closed anonymous return
type for each boundary:

```ts
manual(@Res() response: unknown): Promise<{ ok: boolean }>;
manualAlias(@Response() response: unknown): Promise<{ ok: boolean }>;

@UseInterceptors(ResponseInterceptor)
transformed(): Promise<{ ok: boolean }>;
```

Add a controller-level `@SerializeOptions({})` fixture as a separate controller.
Assert all remain unresolved.

- [ ] **Step 2: Run the focused tests and verify RED**

Expected: safe mode currently infers at least one manual or transformed route.

- [ ] **Step 3: Implement route eligibility**

Import `hasAnyDecorator`. Reject safe mode when any parameter has `Res` or
`Response`, or when the method or containing class has one of:

```ts
const RESPONSE_TRANSFORM_DECORATORS = [
  "UseInterceptors",
  "SerializeOptions",
  "UseFilters",
  "Redirect",
  "Render",
] as const;
```

Apply this route gate before retaining an existing array response when its item
graph contains an anonymous object, so an array wrapper cannot bypass the same
manual or transformed boundary.

- [ ] **Step 4: Add safe-mode precedence coverage**

Add one route with `@ApiOkResponse({ schema: ... })` and an anonymous return.
Assert the Swagger response remains `overridden`. Add one operation config
response override and assert it remains `overridden` with its diagnostic
removed.

- [ ] **Step 5: Run focused and existing response regression tests**

```powershell
pnpm --filter @specord/core exec vitest run test/anonymous-response-inference.test.ts test/response-review-regressions.test.ts test/config-overrides.test.ts test/pipeline.acceptance.test.ts
```

Expected: all tests pass and the canonical dynamic file export remains
unresolved.

- [ ] **Step 6: Commit response boundaries**

```powershell
git add packages/core/src/extractors/response-extractor.ts packages/core/test/anonymous-response-inference.test.ts
git commit -m "test(core): preserve conservative response boundaries"
```

---

### Task 5: Update the normative contract and user documentation

**Files:**
- Modify: `spec/specord-v1-extractor-spec.md`
- Modify: `docs/configuration.md`

**Interfaces:**
- Documents: exact config path, default-off behavior, accepted safe forms, rejected forms, and override precedence.

- [ ] **Step 1: Update the V1 config contract**

Add the `inference.responses.anonymousObjects` shape to the normative config
type. Change the conservative anonymous-object rule to say it remains unresolved
unless safe mode is selected and the complete shape passes the Phase 9 rules.
Keep the canonical fixture's default unresolved requirement unchanged.

- [ ] **Step 2: Add a configuration guide section**

Add an `Anonymous Response Inference` section with this example:

```ts
export default {
  inference: {
    responses: {
      anonymousObjects: "safe",
    },
  },
};
```

Explain that safe mode is opt-in, static-only, whole-shape, and does not cover
manual responses, runtime transforms, records, unknown members, streams, or
framework response classes.

- [ ] **Step 3: Run documentation and contract checks**

```powershell
rg -n "anonymousObjects|Anonymous object" spec/specord-v1-extractor-spec.md docs/configuration.md packages/types/src/config.ts
git diff --check
```

Expected: the same path and values appear consistently and diff check is clean.

- [ ] **Step 4: Commit documentation**

```powershell
git add spec/specord-v1-extractor-spec.md docs/configuration.md
git commit -m "docs: document safe anonymous response inference"
```

---

### Task 6: Measure acceptance and write the cumulative Phase 9 report

**Files:**
- Create: `reports/phase-9.md`

**Interfaces:**
- Consumes: default and safe-mode inspection models from the production-server checkout.
- Produces: exact operations, schemas, diagnostics, unresolved response counts, acceptance matrix, architecture capability, metrics, decisions, roadmap, and risks.

- [ ] **Step 1: Build the changed packages**

```powershell
pnpm --filter @specord/types build
pnpm --filter @specord/core build
pnpm --filter @specord/openapi build
pnpm --filter @specord/cli build
```

- [ ] **Step 2: Capture default benchmark parity**

Run the existing repository-local private benchmark with its target root set to
the private production-server checkout.

Expected: 107 paths, 136 operations, and route parity PASS.

- [ ] **Step 3: Capture safe-mode metrics without modifying the private checkout**

Run an inline Node ESM script from the worktree that imports
`loadConfig`, `resolveConfig`, and `inspect` from `packages/core/dist/index.js`,
loads the target config, merges
`inference.responses.anonymousObjects = "safe"`, and prints:

- path, operation, schema, and diagnostic counts;
- inferred, unresolved, and overridden response counts;
- unresolved response counts grouped by reason and controller; and
- unmatched path-parameter diagnostics.

The target is a private production-server checkout outside this worktree. Do
not edit its untracked `specord.config.ts`.

- [ ] **Step 4: Validate safe-mode OpenAPI**

In the same script, import `emitOpenApiDocument` and
`validateOpenApiDocument` from `packages/openapi/dist/index.js`. Emit with the
loaded config and require `valid === true`; print validator errors and exit 1 if
validation fails.

- [ ] **Step 5: Capture canonical default evidence**

```powershell
pnpm inspect -- examples/nestjs-api > $null
pnpm generate -- examples/nestjs-api --pretty > $null
pnpm --filter @specord/core exec vitest run test/pipeline.snapshot.test.ts test/pipeline.acceptance.test.ts
git diff --exit-code -- packages/core/test/__snapshots__/pipeline.snapshot.test.ts.snap reports/snapshot-registry.json reports/snapshot-changelog.md reports/snapshot-log.md
```

Expected: commands exit 0 and snapshot artifacts have no diff.

- [ ] **Step 6: Write `reports/phase-9.md`**

Include all nine repository-required sections:

1. status summary;
2. what was built;
3. acceptance matrix;
4. extraction output summary;
5. architecture capabilities and limits;
6. commits, lines, files, tests, and dependency metrics;
7. decision log;
8. roadmap; and
9. risk assessment with mitigations.

Use exact measured values and neutral production-server wording.

- [ ] **Step 7: Commit the report**

```powershell
git add reports/phase-9.md
git commit -m "docs: record phase 9 acceptance"
```

---

### Task 7: Full verification, review, and pull request

**Files:**
- Review every file changed from `origin/main`.

**Interfaces:**
- Produces: pushed feature branch and PR to `main` linked to RFC #3 and issue #1.

- [ ] **Step 1: Run fresh uncached verification**

```powershell
pnpm exec turbo run build --force
pnpm exec turbo run test --force
pnpm lint
```

Record exact tasks, test files, tests, failures, and any packages with no lint
task. A missing lint task is reported accurately rather than treated as a test
failure.

- [ ] **Step 2: Review repository state and diff quality**

```powershell
git status --short --branch
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Confirm no private target name, temporary file, generated config, snapshot
churn, unrelated refactor, or dependency change entered the branch.

- [ ] **Step 3: Run a read-only correctness review**

Review the implementation against every design requirement, with special
attention to manual response paths, nested incomplete schemas, config default,
diagnostic removal, deterministic output, and benchmark measurement.

- [ ] **Step 4: Push the feature branch**

```powershell
git push -u origin codex/safe-anonymous-response-inference
```

- [ ] **Step 5: Create the pull request**

Create a PR to `main` titled:

```text
feat(core): add safe anonymous response inference
```

The body includes motivation, exact config and default, safe/rejected behavior,
default and safe-mode benchmark counts, canonical snapshot result, workspace
verification counts, `Closes #3`, and `Refs #1`. Do not merge the PR.

- [ ] **Step 6: Audit hosted checks and review state**

Wait for GitHub checks, inspect failed logs if any, and repair on the same
branch. Inspect thread-aware review state. Delivery is complete only when the
PR exists, checks are green, no required review thread remains unresolved, and
the branch matches local verified state.
