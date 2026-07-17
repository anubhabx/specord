import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpecordConfigV1 } from "@specord/types";
import { inspect, resolveConfig } from "../src/index.ts";
import {
  cleanupTempProjects,
  createTempProject,
} from "./helpers/temp-project.ts";

const tempRoots: string[] = [];

afterEach(() => {
  cleanupTempProjects(tempRoots);
});

function inspectAnonymousResponse(
  anonymousObjects?: "off" | "safe",
  overrides?: Pick<SpecordConfigV1, "operations">,
  includeNestedObjectAlias = false,
) {
  const projectRoot = createTempProject(tempRoots, {
    prefix: "specord-anonymous-response-",
  });
  const srcRoot = path.join(projectRoot, "src");

  fs.writeFileSync(
    path.join(srcRoot, "payload.dto.ts"),
    [
      "export class PayloadDto {",
      "  id!: string;",
      "}",
      ...(includeNestedObjectAlias
        ? [
            "export type NestedObjectAlias = {",
            "  code: string;",
            "};",
          ]
        : []),
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(srcRoot, "response-decorators.ts"),
    [
      "export declare function Res(): ParameterDecorator;",
      "export declare function Response(): ParameterDecorator;",
      "export declare function UseInterceptors(...interceptors: unknown[]): MethodDecorator & ClassDecorator;",
      "export declare function UseFilters(...filters: unknown[]): MethodDecorator & ClassDecorator;",
      "export declare function SerializeOptions(options: unknown): MethodDecorator & ClassDecorator;",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(srcRoot, "anonymous.controller.ts"),
    [
      "declare function Controller(path?: string): ClassDecorator;",
      "declare function Get(path?: string): MethodDecorator;",
      "declare function Res(): ParameterDecorator;",
      "declare function Response(): ParameterDecorator;",
      "declare function UseInterceptors(...interceptors: unknown[]): MethodDecorator & ClassDecorator;",
      "declare function UseFilters(...filters: unknown[]): MethodDecorator & ClassDecorator;",
      "declare function SerializeOptions(options: unknown): MethodDecorator & ClassDecorator;",
      "declare function ApiOkResponse(options?: unknown): MethodDecorator;",
      "declare const ResponseInterceptor: unknown;",
      "declare const ResponseFilter: unknown;",
      "declare class Buffer { readonly length: number; }",
      includeNestedObjectAlias
        ? "import { PayloadDto, type NestedObjectAlias } from './payload.dto';"
        : "import { PayloadDto } from './payload.dto';",
      "import { Res as ManualResponse, UseInterceptors as TransformResponse } from './response-decorators';",
      "import * as ResponseDecorators from './response-decorators';",
      "@Controller('anonymous')",
      "class AnonymousController {",
      "  @Get()",
      "  get(): Promise<{",
      "    id: string;",
      "    active: boolean;",
      "    mode: 'draft' | 'live';",
      "    updatedAt: Date;",
      "    tags?: string[];",
      "    metrics: { count: number | null };",
      "  }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('indexed')",
      "  indexed(): Promise<{ [key: string]: string; known: string }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('callable')",
      "  callable(): Promise<{ (): string; id: string }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('method')",
      "  withMethod(): Promise<{ id: string; run(): string }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('record')",
      "  openRecord(): Promise<Record<string, unknown>> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('nested-record')",
      "  nestedRecord(): Promise<{ data: Record<string, unknown> }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('nested-unknown')",
      "  nestedUnknown(): Promise<{ data: unknown }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('nested-empty')",
      "  nestedEmpty(): Promise<{ data: {} }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('nested-complex-union')",
      "  nestedComplexUnion(): Promise<{ data: { a: string } | { b: number } }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('nested-library')",
      "  nestedLibrary(): Promise<{ data: Buffer }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('nested-discovered-class')",
      "  nestedDiscoveredClass(): Promise<{ data: PayloadDto }> {",
      "    throw new Error('not implemented');",
      "  }",
      ...(includeNestedObjectAlias
        ? [
            "  @Get('nested-object-alias')",
            "  nestedObjectAlias(): Promise<{ data: NestedObjectAlias }> {",
            "    throw new Error('not implemented');",
            "  }",
          ]
        : []),
      "  @Get('manual')",
      "  manual(@Res() response: unknown): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('manual-alias')",
      "  manualAlias(@Response() response: unknown): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('transformed')",
      "  @UseInterceptors(ResponseInterceptor)",
      "  transformed(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('filtered')",
      "  @UseFilters(ResponseFilter)",
      "  filtered(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('serialized')",
      "  @SerializeOptions({})",
      "  serialized(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('aliased-transform')",
      "  @TransformResponse(ResponseInterceptor)",
      "  aliasedTransform(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('namespace-filter')",
      "  @ResponseDecorators.UseFilters(ResponseFilter)",
      "  namespaceFilter(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('aliased-manual')",
      "  aliasedManual(@ManualResponse() response: unknown): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('namespace-manual')",
      "  namespaceManual(@ResponseDecorators.Response() response: unknown): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('swagger')",
      "  @ApiOkResponse({ schema: { type: 'string' } })",
      "  swagger(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "}",
      "@Controller('intercepted-controller')",
      "@UseInterceptors(ResponseInterceptor)",
      "class InterceptedController {",
      "  @Get()",
      "  get(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "}",
      "@Controller('filtered-controller')",
      "@UseFilters(ResponseFilter)",
      "class FilteredController {",
      "  @Get()",
      "  get(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "}",
      "@Controller('serialized-controller')",
      "@SerializeOptions({})",
      "class SerializedController {",
      "  @Get()",
      "  get(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "}",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(srcRoot, "unrelated-decorator.controller.ts"),
    [
      "declare function Controller(path?: string): ClassDecorator;",
      "declare function Get(path?: string): MethodDecorator;",
      "const UseFilters = (): MethodDecorator => () => undefined;",
      "const localDecorators = {",
      "  UseInterceptors: (): MethodDecorator => () => undefined,",
      "};",
      "@Controller('unrelated-decorators')",
      "class UnrelatedDecoratorController {",
      "  @Get('variable')",
      "  @UseFilters()",
      "  variable(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "  @Get('property')",
      "  @localDecorators.UseInterceptors()",
      "  property(): Promise<{ ok: boolean }> {",
      "    throw new Error('not implemented');",
      "  }",
      "}",
    ].join("\n"),
  );

  return inspect(
    resolveConfig(
      { project: path.join(projectRoot, "tsconfig.json"), root: srcRoot },
      anonymousObjects || overrides
        ? {
            ...(anonymousObjects
              ? { inference: { responses: { anonymousObjects } } }
              : {}),
            ...overrides,
          }
        : undefined,
    ),
  );
}

describe("anonymous response inference", () => {
  it("infers a closed anonymous response object in safe mode", () => {
    const model = inspectAnonymousResponse("safe");
    const operation = model.operations.find(
      (item) => item.id === "AnonymousController.get",
    );

    expect(operation?.responses[0]).toMatchObject({
      status: 200,
      inference: { status: "inferred" },
      schema: {
        kind: "inline",
        schema: {
          type: "object",
          required: ["id", "active", "mode", "updatedAt", "metrics"],
          properties: {
            id: { type: "string" },
            active: { type: "boolean" },
            mode: { type: "string", enum: ["draft", "live"] },
            updatedAt: { type: "string", format: "date-time" },
            tags: { type: "array", items: { type: "string" } },
            metrics: {
              type: "object",
              required: ["count"],
              properties: {
                count: { type: ["number", "null"] },
              },
            },
          },
        },
      },
    });
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
  });

  it("keeps anonymous responses unresolved by default and when explicitly off", () => {
    const defaultOperation = inspectAnonymousResponse().operations.find(
      (item) => item.id === "AnonymousController.get",
    );
    const explicitlyOffOperation = inspectAnonymousResponse("off").operations.find(
      (item) => item.id === "AnonymousController.get",
    );

    expect(defaultOperation?.responses[0]?.inference.status).toBe("unresolved");
    expect(
      defaultOperation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(true);
    expect(explicitlyOffOperation?.responses[0]?.inference.status).toBe("unresolved");
    expect(
      explicitlyOffOperation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(true);
  });

  it.each([
    "AnonymousController.indexed",
    "AnonymousController.callable",
    "AnonymousController.withMethod",
    "AnonymousController.openRecord",
  ])("keeps unsafe anonymous root %s unresolved in safe mode", (operationId) => {
    const model = inspectAnonymousResponse("safe");
    const operation = model.operations.find((item) => item.id === operationId);

    expect(operation?.responses[0]?.inference.status).toBe("unresolved");
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(true);
    expect(Object.keys(model.schemas)).toEqual(["PayloadDto"]);
  });

  it.each([
    "AnonymousController.nestedRecord",
    "AnonymousController.nestedUnknown",
    "AnonymousController.nestedEmpty",
    "AnonymousController.nestedComplexUnion",
    "AnonymousController.nestedLibrary",
  ])("rejects incomplete nested shape %s without generated schemas", (operationId) => {
    const model = inspectAnonymousResponse("safe");
    const operation = model.operations.find((item) => item.id === operationId);

    expect(operation?.responses[0]?.inference.status).toBe("unresolved");
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(true);
    expect(Object.keys(model.schemas)).toEqual(["PayloadDto"]);
  });

  it("rejects a discovered DTO class nested in a safe anonymous response", () => {
    const model = inspectAnonymousResponse("safe");
    const operation = model.operations.find(
      (item) => item.id === "AnonymousController.nestedDiscoveredClass",
    );

    expect(operation?.responses[0]?.inference.status).toBe("unresolved");
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(true);
  });

  it("infers a nested named object type alias in a safe anonymous response", () => {
    const model = inspectAnonymousResponse("safe", undefined, true);
    const operation = model.operations.find(
      (item) => item.id === "AnonymousController.nestedObjectAlias",
    );

    expect(operation?.responses[0]).toMatchObject({
      status: 200,
      inference: { status: "inferred" },
      schema: {
        kind: "inline",
        schema: {
          type: "object",
          properties: {
            data: { $ref: "#/components/schemas/NestedObjectAlias" },
          },
        },
      },
    });
    expect(model.schemas.NestedObjectAlias).toMatchObject({
      properties: {
        code: { type: { kind: "primitive", type: "string" } },
      },
    });
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
  });

  it.each([
    "AnonymousController.manual",
    "AnonymousController.manualAlias",
    "AnonymousController.transformed",
    "AnonymousController.filtered",
    "AnonymousController.serialized",
    "AnonymousController.aliasedTransform",
    "AnonymousController.namespaceFilter",
    "AnonymousController.aliasedManual",
    "AnonymousController.namespaceManual",
    "InterceptedController.get",
    "FilteredController.get",
    "SerializedController.get",
  ])("keeps response boundary %s unresolved in safe mode", (operationId) => {
    const model = inspectAnonymousResponse("safe");
    const operation = model.operations.find((item) => item.id === operationId);

    expect(operation?.responses[0]?.inference.status).toBe("unresolved");
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(true);
    expect(operation?.responses[0]?.inference.reason).toBe(
      "Anonymous response shape is not closed enough for safe inference",
    );
  });

  it.each([
    "UnrelatedDecoratorController.variable",
    "UnrelatedDecoratorController.property",
  ])("infers a closed response with unrelated decorator %s", (operationId) => {
    const model = inspectAnonymousResponse("safe");
    const operation = model.operations.find((item) => item.id === operationId);

    expect(operation?.responses[0]?.inference.status).toBe("inferred");
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
  });

  it("keeps an explicit Swagger success response authoritative in safe mode", () => {
    const model = inspectAnonymousResponse("safe");
    const operation = model.operations.find(
      (item) => item.id === "AnonymousController.swagger",
    );

    expect(operation?.responses).toEqual([
      expect.objectContaining({
        status: 200,
        schema: { kind: "inline", schema: { type: "string" } },
        inference: { status: "overridden" },
      }),
    ]);
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
  });

  it("keeps a config response override authoritative in safe mode", () => {
    const model = inspectAnonymousResponse("safe", {
      operations: {
        "AnonymousController.manual": {
          responses: {
            "200": {
              description: "Configured response.",
              content: {
                "application/json": { schema: { type: "boolean" } },
              },
            },
          },
        },
      },
    });
    const operation = model.operations.find(
      (item) => item.id === "AnonymousController.manual",
    );

    expect(operation?.responses).toEqual([
      expect.objectContaining({
        status: 200,
        description: "Configured response.",
        inference: { status: "overridden" },
        openapi: expect.objectContaining({ description: "Configured response." }),
      }),
    ]);
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
  });
});
