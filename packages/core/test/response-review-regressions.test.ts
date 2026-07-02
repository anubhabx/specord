// ============================================================================
// Response review regression tests
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspect, resolveConfig } from "../src/index.ts";
import {
  cleanupTempProjects,
  createTempProject,
} from "./helpers/temp-project.ts";

const tempRoots: string[] = [];

afterEach(() => {
  cleanupTempProjects(tempRoots);
});

describe("response extraction review regressions", () => {
  it("keeps inferred success responses when Swagger only documents errors", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-response-review-",
    });
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "widget.dto.ts"),
      [
        "export class WidgetResponseDto {",
        "  id: string;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(srcRoot, "widgets.controller.ts"),
      [
        "import { WidgetResponseDto } from './widget.dto';",
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "declare function ApiNotFoundResponse(options?: unknown): MethodDecorator;",
        "@Controller('widgets')",
        "class WidgetsController {",
        "  @Get(':id')",
        "  @ApiNotFoundResponse({ description: 'Widget not found.' })",
        "  get(): Promise<WidgetResponseDto> {",
        "    throw new Error('not implemented');",
        "  }",
        "}",
      ].join("\n"),
    );

    const model = inspect(
      resolveConfig({
        project: path.join(projectRoot, "tsconfig.json"),
        root: srcRoot,
      }),
    );

    const operation = model.operations.find(
      (item) => item.id === "WidgetsController.get",
    );

    expect(operation?.responses).toEqual([
      expect.objectContaining({
        status: 200,
        schema: { kind: "ref", name: "WidgetResponseDto" },
        inference: { status: "inferred" },
      }),
      expect.objectContaining({
        status: 404,
        description: "Widget not found.",
        inference: { status: "overridden" },
      }),
    ]);
  });

  it("harvests enum-valued ApiResponse statuses and raw response schemas", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-response-review-",
    });
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "widgets.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "declare function ApiResponse(options?: unknown): MethodDecorator;",
        "declare const HttpStatus: { OK: 200 };",
        "@Controller('widgets')",
        "class WidgetsController {",
        "  @Get()",
        "  @ApiResponse({",
        "    status: HttpStatus.OK,",
        "    schema: {",
        "      type: 'object',",
        "      properties: { ok: { type: 'boolean' } },",
        "      required: ['ok'],",
        "    },",
        "  })",
        "  list(): unknown {",
        "    return {};",
        "  }",
        "}",
      ].join("\n"),
    );

    const model = inspect(
      resolveConfig({
        project: path.join(projectRoot, "tsconfig.json"),
        root: srcRoot,
      }),
    );

    const operation = model.operations.find(
      (item) => item.id === "WidgetsController.list",
    );
    const response = operation?.responses[0];

    expect(response).toMatchObject({
      status: 200,
      schema: {
        kind: "inline",
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      },
      inference: { status: "overridden" },
    });
    expect(response?.openapi).not.toHaveProperty("schema");
  });

  it("does not infer a default response when Swagger already documents success", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-response-review-",
    });
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "widgets.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Post(path?: string): MethodDecorator;",
        "declare function ApiAcceptedResponse(options?: unknown): MethodDecorator;",
        "@Controller('widgets')",
        "class WidgetsController {",
        "  @Post('refresh')",
        "  @ApiAcceptedResponse({ description: 'Refresh accepted.' })",
        "  refresh(): Promise<void> {",
        "    throw new Error('not implemented');",
        "  }",
        "}",
      ].join("\n"),
    );

    const model = inspect(
      resolveConfig({
        project: path.join(projectRoot, "tsconfig.json"),
        root: srcRoot,
      }),
    );

    const operation = model.operations.find(
      (item) => item.id === "WidgetsController.refresh",
    );

    expect(operation?.responses).toEqual([
      expect.objectContaining({
        status: 202,
        description: "Refresh accepted.",
        inference: { status: "overridden" },
      }),
    ]);
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
  });

  it("diagnoses unresolved array item response types", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-response-review-",
    });
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "widgets.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "@Controller('widgets')",
        "class WidgetsController {",
        "  @Get()",
        "  list(): Promise<NotDiscoveredWidget[]> {",
        "    throw new Error('not implemented');",
        "  }",
        "}",
      ].join("\n"),
    );

    const model = inspect(
      resolveConfig({
        project: path.join(projectRoot, "tsconfig.json"),
        root: srcRoot,
      }),
    );

    const operation = model.operations.find(
      (item) => item.id === "WidgetsController.list",
    );

    expect(operation?.responses[0]).toMatchObject({
      status: 200,
      schema: { kind: "array", items: { kind: "unknown" } },
      inference: { status: "unresolved" },
    });
    expect(operation?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXTRACTOR_UNRESOLVED_RESPONSE",
          subject: "WidgetsController.list",
        }),
      ]),
    );
  });
});
