# Getting Started

This guide covers the first successful V1 run for Specord.

V1 is NestJS REST only. It can harvest common NestJS Swagger source patterns, but Specord itself does not depend on `@nestjs/swagger`.

## Prerequisites

- Node.js `>=18`
- pnpm `10.33.4`
- Repository dependencies installed with `pnpm install`

## Inspect First

Use `inspect` when you want to see the internal model and diagnostics:

```bash
pnpm.cmd inspect -- examples/nestjs-api
```

Expected result:

- A JSON `InspectionModel`
- Stable ordering of operations, schemas, and diagnostics
- Warnings for unresolved inference cases

## Generate OpenAPI

Use `generate` when you want OpenAPI 3.1 JSON:

```bash
pnpm.cmd generate -- examples/nestjs-api --pretty
```

Write to a file:

```bash
pnpm.cmd generate -- examples/nestjs-api --output openapi.json --pretty
```

Generation validates the OpenAPI document before writing. Unresolved extraction warnings are allowed by default and printed to stderr.

## Serve Or Inject Docs

For an existing Nest app bootstrap, inject docs routes:

```ts
import { setupSpecordDocs } from "@specord/nestjs";

setupSpecordDocs(app);
```

This mounts the UI at `/api` and JSON at `/api/openapi.json` by default.

For a standalone local docs server:

```bash
pnpm.cmd serve -- examples/nestjs-api --pretty
```

Open `http://127.0.0.1:4777/api`.

The UI can send browser-local Try it requests for the selected operation. Injected docs can use same-origin paths; standalone `specord serve` needs `--app-url` or an OpenAPI `servers[0].url` target because it does not proxy API traffic. Specord does not persist credentials or proxy around CORS.

## Add Precision With Config

Create `specord.config.ts` when the source code cannot express enough detail:

```ts
export default {
  source: {
    project: "examples/nestjs-api/tsconfig.json",
    root: "examples/nestjs-api/src",
  },
  document: {
    title: "Specord Benchmark API",
    version: "1.0.0",
  },
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    },
    stripeSignature: {
      type: "apiKey",
      in: "header",
      name: "Stripe-Signature",
    },
  },
  ci: {
    failOnUnresolved: true,
  },
};
```

Then run:

```bash
pnpm.cmd generate
```

When you run from a Nest project directory, Specord defaults to `tsconfig.json` and `src/`. From a monorepo root, pass the project directory once:

```bash
specord generate apps/api --pretty
```

Use explicit flags only for custom layouts:

```bash
specord generate --project apps/api/tsconfig.build.json --root apps/api/source
```

## Validate Against The Contract

Use these documents as the product boundary:

- `spec/specord-v1-extractor-spec.md`
- `spec/Phase-2-real-world-nestjs-openapi-spec.md`
- `docs/specord-inspect.md`
- `docs/specord-generate.md`
- `docs/specord-nestjs.md`
- `docs/specord-serve.md`
- `docs/configuration.md`
