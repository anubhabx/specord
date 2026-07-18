# Specord V1 Extractor Spec

Date: 2026-04-27
Status: Active normative spec for `specord inspect` spike

Phase 2 extension: OpenAPI generation is now specified in `spec/Phase-2-real-world-nestjs-openapi-spec.md`. This document remains the base inspection model contract.

## Purpose

V1 focuses on one trustworthy path: extract a deterministic internal model from a conventional NestJS REST codebase, then use that model for later OpenAPI generation. V1 does not require Swagger decorators or the Nest Swagger CLI plugin.

The first delivery target is the extractor, not the renderer.

## Scope and Non-goals

### In scope for this spec

- Source-first extraction from TypeScript using `Program` and `TypeChecker`.
- Stable JSON output from `specord inspect`.
- Route, parameter, request DTO, and baseline response metadata extraction.
- Deterministic diagnostics for unresolved or risky inference.
- Fixture-first behavior for `examples/nestjs-api`.

### Out of scope for this spec

- UI renderer work.
- OpenAPI 3.1 emission details (translation is a later step).
- OpenAPI 3.2-only features.
- Full plugin/adaptor architecture for non-Nest sources.

## Canonical command for this spike

```txt
specord inspect examples/nestjs-api
```

The command MUST emit a single JSON document conforming to the contract below.

## Normative extractor contract

### Data model

```ts
type InspectionModel = {
  source: {
    project: string; // CLI-resolved path
    root: string; // CLI-resolved path
    inspectedAt: string; // ISO-8601 UTC timestamp
    version: "v1";
  };
  operations: OperationModel[];
  schemas: Record<string, SchemaModel>;
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  diagnostics: Diagnostic[];
};

type OperationModel = {
  id: string; // ControllerName.methodName
  operationId?: string; // OpenAPI operationId, defaults to id when absent
  controller: string;
  handler: string;
  method: "get" | "post" | "put" | "patch" | "delete" | "options" | "head";
  path: string; // OpenAPI template form, e.g. /users/{id}
  source?: SourceLocation;
  summary?: string;
  description?: string;
  tags?: string[];
  params: ParameterModel[];
  requestBody?: BodyModel;
  responses: ResponseModel[];
  security: InferenceState;
  diagnostics: Diagnostic[];
  openapi?: {
    summary?: string;
    description?: string;
    tags?: string[];
    security?: OpenApiSecurityRequirementObject[];
    responses?: OpenApiResponsesObject;
  };
};

type ParameterModel = {
  name: string;
  in: "path" | "query" | "header";
  type: SchemaRef;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  constraints?: Record<string, unknown>;
  source?: SourceLocation;
  inference: InferenceState;
};

type SchemaRef =
  | { kind: "ref"; name: string }
  | { kind: "primitive"; type: "string" | "number" | "integer" | "boolean" | "null" | "object" }
  | { kind: "array"; items: SchemaRef }
  | { kind: "inline"; schema: OpenApiSchemaObject }
  | { kind: "unknown" };

type InferenceState =
  | { status: "inferred" }
  | { status: "inferred-with-warning"; reason: string }
  | { status: "overridden" }
  | { status: "unresolved"; reason: string };

type Diagnostic = {
  severity: "info" | "warning" | "error";
  code: DiagnosticCode;
  message: string;
  source?: SourceLocation;
  subject?: string;
  suggestedOverridePath?: string;
  origin?: "typescript" | "nestjs" | "swagger" | "config" | "openapi";
};

type DiagnosticCode =
  | "EXTRACTOR_UNRESOLVED_RESPONSE"
  | "EXTRACTOR_UNRESOLVED_SECURITY"
  | "EXTRACTOR_UNSUPPORTED_MAPPED_TYPE"
  | "EXTRACTOR_UNSUPPORTED_DECORATOR"
  | "EXTRACTOR_TYPE_FALLBACK_ANY"
  | "EXTRACTOR_ROUTE_CONFLICT"
  | "EXTRACTOR_INVALID_PATH_TEMPLATE"
  | "EXTRACTOR_UNRESOLVED_PATH_PARAM"
  | "EXTRACTOR_UNSUPPORTED_VERSIONING";
```

### Determinism rules (MUST)

1. `operations` MUST be sorted by `path`, then `method`, then `id` (ascending lexical order).
2. `schemas` keys MUST be sorted lexically during emission.
3. `securitySchemes` keys MUST be sorted lexically during emission when present.
4. `diagnostics` MUST be sorted by `severity`, then `code`, then source location.
5. Component/schema naming MUST be stable:
   - exported class DTO name as primary key,
   - collision fallback format: `{ClassName}_{FileStem}_{Hash4}`.
6. `path` MUST normalize to:
   - leading `/`,
   - no trailing slash (except `/`),
   - Nest `:id` tokens converted to `{id}`.
7. No extraction behavior may depend on runtime evaluation of function bodies.

## V1 extraction rules

### Automatic extraction (MUST)

- Controller prefixes from `@Controller(...)`.
- Method decorators: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`.
- Joined route paths after normalization rules.
- Parameter metadata from `@Param`, `@Query`, `@Body`, `@Headers`.
- Primitive parameter types from type annotations.
- Pipe-derived type refinement only for an allowlist:
  - `ParseIntPipe` -> integer.
- Request schemas from exported class DTO symbols.
- `@Query() Dto` query DTOs expanded into individual query parameters from the DTO properties.
- Query parameter expansion preserves DTO property order, optional/required state, defaults, enum values, formats, and validator-derived constraints.
- `@Param() Dto` path DTOs expanded into individual required path parameters from DTO properties.
- Every valid `{token}` in a path SHOULD have a matching emitted OpenAPI path parameter; unmatched tokens MUST emit `EXTRACTOR_UNRESOLVED_PATH_PARAM`.
- `PartialType(BaseDto)` schemas from the base DTO with all copied fields optional.
- Exported `z.object(...)` schemas paired with exported `z.infer<typeof schema>` type aliases as named schema components.
- Zod schema support includes object, string, number, boolean, enum/literal, array, optional, default, nullable, simple literal unions, `strict`, `passthrough`, `partial`, and `extend`.
- DTO fields including:
  - optional markers,
  - defaults (as default values, not required flags),
  - enum members,
  - arrays,
  - nested exported DTO references.
- Validator hints from `class-validator` allowlist:
  - `IsString`, `IsEmail`, `IsNumber`, `IsInt`, `Min`, `MinLength`, `MaxLength`, `IsEnum`, `IsOptional`, `IsPositive`, `Matches`.
- Default response status:
  - `POST` -> `201`,
  - all other HTTP methods -> `200`,
  - overridden by `@HttpCode(...)` when present.
- Response schemas from exported interfaces and object type aliases reachable through controller return types, including return types imported from TypeScript program files outside `--root`.
- Configured security schemes MAY be applied automatically to guarded or app-auth-decorated routes. A configured HTTP bearer scheme is preferred as the default protected-route requirement when no Swagger security decorator is present.
- Supported app-level auth decorators include `@Public`, `@SkipThrottle`, `@Throttle`, `@RequireCapability`, and `@RequireAdmin`. Public routes are intentionally unauthenticated unless they also carry an explicit auth decorator.

### Conservative extraction (MUST resolve as unresolved/warning, not guessed)

- Unmapped guard-derived auth semantics when no Swagger or configured security mapping exists.
- Return type shape when originating service/data source is `any`.
- Anonymous object literal response shapes, except for the narrow safe-mode rule below.
- Interceptor, serializer, exception-filter transformed output.
- `@Res()` / `@Response()` manual response handling.
- Complex generics, conditional types, and polymorphic unions.
- Unknown/custom decorators without config mapping.

When uncertain, extractor MUST emit incomplete-but-valid model data and at least one diagnostic.

### Safe anonymous response inference (MUST remain opt-in)

`inference.responses.anonymousObjects` defaults to `"off"`. An omitted `inference` section, omitted `responses` section, omitted `anonymousObjects`, or explicit `"off"` MUST leave anonymous object literal response shapes unresolved with the existing warning and deterministic output. The canonical fixture's default anonymous response remains unresolved, and default snapshots MUST remain unchanged.

When `anonymousObjects` is `"safe"`, an anonymous response MAY be inferred only when its root eligibility, route eligibility, and complete whole-shape reduction all pass. Canonical `Promise<T>` and installed `rxjs` `Observable<T>` response containers MUST be identified from compiler-resolved type identity rather than source spelling, including import aliases, namespace-qualified references, and instantiated type aliases; project-local lookalikes MUST remain unresolved. The root MUST be an anonymous, non-aliased object with at least one non-method property; it MUST have no index, call, or construct signatures. A union containing `null` and exactly one non-nullish anonymous branch MAY apply these root checks to that branch and MUST preserve `null` in the emitted schema; a root containing `undefined` or `void` does not gain this eligibility. A root union containing a direct anonymous object branch or an anonymous object beneath an array branch plus any other active branch MUST remain unresolved in safe mode and MUST still obey the route-boundary gate, even when default/off legacy inference can emit that union as `oneOf`. The route MUST have no `@Res()` / `@Response()` parameter and no visible response-boundary marker (`@UseInterceptors`, `@SerializeOptions`, `@UseFilters`, `@Redirect`, or `@Render`) on the handler or controller. The same route and complete whole-shape gates MUST apply before retaining an existing array response whose item graph contains an anonymous object, so array wrappers cannot bypass a manual or transformed boundary or retain an incomplete anonymous item.

The complete shape MAY contain primitives, same-primitive literals or literal enums, `Date`, arrays, nested closed objects, valid discovered or response-generated schema references whose selected interface or object-type-alias declaration is non-generic, monomorphically named aliases to specialized generic objects, and nullable forms of those supported shapes. `undefined` MAY be discarded only at an object-property boundary that the emitted schema preserves as optional; an `undefined` branch in an array item or other value position MUST make the safe response unresolved. A reference whose selected schema declaration itself has generic type parameters MUST remain unresolved rather than sharing one bare component name across instantiations. The shape MUST also be rejected as unresolved when any branch contains a record or index signature; `any`, `unknown`, or `never`; an empty shape; a call, construct, or method member; a class, framework response, stream, or manual response; a visible transform; a complex union or conditional type; or a dangling reference. The extractor MUST NOT emit a partial schema. Component schemas generated while attempting a rejected anonymous response MUST be discarded.

Explicit Swagger 2xx responses MUST continue to take precedence over source inference. Operation response overrides remain authoritative; when an override resolves a response uncertainty, it removes only that operation's directly resolved response diagnostic. Accepted safe-mode responses use inferred state; rejected candidates retain the existing unresolved diagnostic and deterministic ordering.

## Diagnostic catalog (v1 minimum)

| Code | Severity | Trigger | Suggested override path |
| --- | --- | --- | --- |
| `EXTRACTOR_UNRESOLVED_RESPONSE` | warning | Response schema cannot be safely inferred | `operations.<id>.responses` |
| `EXTRACTOR_UNRESOLVED_SECURITY` | warning | Guard/auth semantics observed but not mapped | `securitySchemes` or `operations.<id>.security` |
| `EXTRACTOR_UNSUPPORTED_MAPPED_TYPE` | warning | Mapped utility cannot be fully resolved | `schemas.<name>` |
| `EXTRACTOR_UNSUPPORTED_DECORATOR` | info | Decorator seen but not in supported allowlist | `operations.<id>` |
| `EXTRACTOR_TYPE_FALLBACK_ANY` | warning | Symbol resolves to `any` | `schemas.<name>` or `operations.<id>` |
| `EXTRACTOR_ROUTE_CONFLICT` | error | Duplicate `method + path` extracted | `routing` |
| `EXTRACTOR_INVALID_PATH_TEMPLATE` | error | Invalid `path` parameter template | `routing` |
| `EXTRACTOR_UNRESOLVED_PATH_PARAM` | warning | Path template token has no matching emitted path parameter | `operations.<id>.params` |
| `EXTRACTOR_UNSUPPORTED_VERSIONING` | warning | Configured versioning strategy cannot be safely expressed as a V1 path | `routing.versioning` |

## Fixture-specific acceptance matrix (`examples/nestjs-api`)

The first spike is accepted only when all checks below pass.

| Area | Required result |
| --- | --- |
| Controller discovery | All controllers under `examples/nestjs-api/src` are present in `operations[*].controller`. |
| Route extraction | Every controller handler with supported HTTP decorators appears with normalized `path` and `method`. |
| DTO extraction | `CreateUserDto`, `CreateProductDto`, and `PaginationDto` are present with stable schema names. |
| Query DTO expansion | `ProductsController.findAll` emits `page`, `limit`, `search`, and `category` query parameters from `PaginationDto`. |
| Mapped types | `UpdateUserDto` and `UpdateProductDto` infer `PartialType(...)` fields from their base DTOs with no required fields. |
| Security inference | Guard-backed operations emit `EXTRACTOR_UNRESOLVED_SECURITY` unless explicitly overridden. |
| Response inference | Ambiguous return shapes emit `EXTRACTOR_UNRESOLVED_RESPONSE`. |
| Snapshot stability | Two consecutive runs on unchanged source produce byte-identical JSON snapshot output (excluding `inspectedAt`, which may be normalized in test harness). |

## Known hurdles in fixture

- `ProductsController.findAll()` anonymous paginated object response -> unresolved response required.
- `UsersService` returning `Promise<any>` while mutating response shape -> unresolved response required.
- Guard usage such as `JwtAuthGuard` -> unresolved security required until config override is present.
- `@Param("id", ParseIntPipe) id: number` -> integer path parameter allowed.
- `@Param("id") id: string` then `+id` in method body -> body coercion ignored, remain string.
- `@Query() paginationDto: PaginationDto` -> expand DTO fields into query parameters while retaining `PaginationDto` in `schemas`.
- `PartialType(...)` usage -> infer optional copies of the base DTO fields.
- Other mapped utilities that cannot be resolved -> emit unsupported mapped type diagnostic.

## Minimum v1 config contract

`specord.config.ts` is the precision layer and MUST be optional. CLI flags MUST work without config.

```ts
type SpecordConfigV1 = {
  document?: {
    title?: string;
    version?: string;
    servers?: Array<{ url: string; description?: string }>;
    tags?: Array<{ name: string; description?: string }>;
  };
  source?: {
    project?: string;
    root?: string;
    include?: string[];
    exclude?: string[];
  };
  routing?: {
    globalPrefix?: string;
    versioning?: { strategy: "uri" | "header" | "media-type"; value?: string };
  };
  inference?: {
    responses?: {
      anonymousObjects?: "off" | "safe";
    };
  };
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  operations?: Record<
    string,
    {
      summary?: string;
      description?: string;
      tags?: string[];
      security?: OpenApiSecurityRequirementObject[];
      responses?: OpenApiResponsesObject;
      exclude?: boolean;
    }
  >;
  schemas?: Record<string, OpenApiSchemaObject>;
  ci?: {
    failOnInvalid?: boolean;
    failOnUnresolved?: boolean;
    failOnWarning?: boolean;
  };
};
```

Phase 1B tightens the broad override fragments above to OpenAPI-shaped carrier types:

```ts
type OpenApiSecuritySchemeObject = Record<string, unknown> & {
  type: "apiKey" | "http" | "mutualTLS" | "oauth2" | "openIdConnect";
  description?: string;
  name?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
};

type OpenApiSecurityRequirementObject = Record<string, string[]>;
type OpenApiResponsesObject = Record<string, OpenApiResponseObject>;
type OpenApiResponseObject = OpenApiReferenceObject | {
  description: string;
  headers?: Record<string, unknown>;
  content?: Record<string, OpenApiMediaTypeObject>;
  links?: Record<string, unknown>;
  [key: string]: unknown;
};
type OpenApiSchemaObject = OpenApiReferenceObject | Record<string, unknown>;
type OpenApiReferenceObject = { $ref: string; summary?: string; description?: string };
```

### Precedence rules (MUST)

1. CLI flags override config file values.
2. Config file values override defaults.
3. Defaults apply only where neither CLI nor config provides values.

## Suggested development order

1. Implement `specord inspect` scaffold only.
2. Parse CLI flags and load config with precedence rules.
3. Build TypeScript program from provided project path.
4. Discover controllers and handlers.
5. Extract routes and params.
6. Extract request/query DTO schemas.
7. Attach deterministic diagnostics and source locations.
8. Snapshot fixture output and enforce deterministic ordering.
9. Add explicit return type response inference.
10. Add override application for responses/security.
11. Translate to OpenAPI 3.1 in separate phase.
12. Validate structural and semantic correctness.
13. Build renderer only after extractor and emitter trust is established.

## Phase 1B override application

Config overrides use OpenAPI 3.1-shaped fragments. This keeps the V1 config shape close to the future OpenAPI emitter while allowing `specord inspect` to remain the functional command.

Supported override fields:

- `securitySchemes`: OpenAPI Security Scheme Object fragments.
- `operations.<id>.responses`: OpenAPI Responses Object fragments keyed by status code or `default`.
- `operations.<id>.security`: OpenAPI Security Requirement Object array.
- `operations.<id>.summary`, `description`, `tags`, and `exclude`.
- `schemas.<name>`: OpenAPI Schema Object or Reference Object fragments.

Override application MUST preserve extracted source facts. It MAY add carrier fields for raw OpenAPI fragments so Phase 2 can emit them without losing detail.
When present, top-level `securitySchemes` MUST survive deterministic `specord inspect` serialization.

When an override resolves a known uncertainty, the affected inference state MUST become `overridden` and only the directly resolved diagnostic MUST be removed:

- response overrides remove `EXTRACTOR_UNRESOLVED_RESPONSE` on the same operation.
- security overrides remove `EXTRACTOR_UNRESOLVED_SECURITY` on the same operation.
- schema overrides remove matching schema diagnostics such as `EXTRACTOR_UNSUPPORTED_MAPPED_TYPE`.
- excluded operations are removed from `operations` and their operation-scoped diagnostics are removed.

Override keys MUST be validated conservatively. Unknown operation ids, unknown schema names, and malformed response status keys are configuration errors.

## Spike completion criteria

The first spike is complete when:

- All fixture acceptance matrix items pass.
- Required diagnostics are emitted for unresolved fixture cases.
- Snapshot tests are stable.
- No extractor output fields violate determinism or path normalization rules in this spec.
