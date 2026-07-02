// ============================================================================
// Response interface/type alias extraction tests
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

describe("response interface extraction", () => {
  it("creates component schemas for external interface and type-alias return types", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-response-",
      directories: ["src", "shared"],
      include: ["src/**/*.ts", "shared/**/*.ts"],
    });
    const srcRoot = path.join(projectRoot, "src");
    const sharedRoot = path.join(projectRoot, "shared");

    fs.writeFileSync(
      path.join(sharedRoot, "api-types.ts"),
      [
        "export interface WidgetSummary {",
        "  id: string;",
        "  enabled: boolean;",
        "}",
        "",
        "export type WidgetEnvelope = {",
        "  widget: WidgetSummary;",
        "  tags?: string[];",
        "  mode: 'draft' | 'live';",
        "  count: number | null;",
        "};",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(srcRoot, "widgets.controller.ts"),
      [
        "import type { WidgetEnvelope } from '../shared/api-types';",
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "@Controller('widgets')",
        "class WidgetsController {",
        "  @Get(':id')",
        "  get(): Promise<WidgetEnvelope> {",
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

    expect(operation?.responses[0]).toMatchObject({
      status: 200,
      schema: { kind: "ref", name: "WidgetEnvelope" },
      inference: { status: "inferred" },
    });
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
    expect(model.schemas.WidgetEnvelope).toMatchObject({
      name: "WidgetEnvelope",
      properties: {
        widget: expect.objectContaining({
          type: { kind: "ref", name: "WidgetSummary" },
        }),
        tags: expect.objectContaining({
          type: { kind: "array", items: { kind: "primitive", type: "string" } },
        }),
        mode: expect.objectContaining({
          type: { kind: "primitive", type: "string" },
          enum: ["draft", "live"],
        }),
        count: expect.objectContaining({
          type: { kind: "primitive", type: "number" },
          nullable: true,
        }),
      },
      required: ["widget", "mode", "count"],
      inference: { status: "inferred" },
    });
    expect(model.schemas.WidgetSummary).toMatchObject({
      name: "WidgetSummary",
      properties: {
        id: expect.objectContaining({
          type: { kind: "primitive", type: "string" },
        }),
        enabled: expect.objectContaining({
          type: { kind: "primitive", type: "boolean" },
        }),
      },
      required: ["id", "enabled"],
      inference: { status: "inferred" },
    });
  });
});
