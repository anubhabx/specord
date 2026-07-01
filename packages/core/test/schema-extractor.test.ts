// ============================================================================
// Schema extractor tests
// ============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { extractSchemas } from "../src/extractors/schema-extractor.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("extractSchemas mapped type fallbacks", () => {
  it("does not mark mapped types inferred when their base cannot be resolved", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "specord-schema-"));
    tempRoots.push(root);

    const sourcePath = path.join(root, "mapped.dto.ts");
    fs.writeFileSync(
      sourcePath,
      [
        "declare function PartialType<T>(base: T): T;",
        "declare function PickType<T>(base: T, keys: readonly string[]): T;",
        "export class CreateThingDto {",
        "  name: string;",
        "}",
        "export class PickedThingDto extends PickType(MissingThingDto, ['name'] as const) {}",
        "export class UpdatePickedThingDto extends PartialType(PickedThingDto) {}",
      ].join("\n"),
    );

    const program = ts.createProgram([sourcePath], {
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
    });

    const sourceFile = program.getSourceFile(sourcePath);
    expect(sourceFile).toBeDefined();

    const result = extractSchemas(
      [sourceFile!],
      program.getTypeChecker(),
      root,
    );

    expect(result.schemas.PickedThingDto.inference.status).toBe(
      "inferred-with-warning",
    );
    expect(result.schemas.UpdatePickedThingDto.inference.status).toBe(
      "inferred-with-warning",
    );
    expect(result.schemas.UpdatePickedThingDto.properties).toEqual({});

    expect(
      result.diagnostics
        .filter(
          (diagnostic) =>
            diagnostic.code === "EXTRACTOR_UNSUPPORTED_MAPPED_TYPE",
        )
        .map((diagnostic) => diagnostic.subject)
        .sort(),
    ).toEqual(["PickedThingDto", "UpdatePickedThingDto"]);
  });
});

describe("extractSchemas Zod DTO aliases", () => {
  it("maps exported z.infer aliases to schema components", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "specord-zod-schema-"));
    tempRoots.push(root);

    const sourcePath = path.join(root, "widgets.dto.ts");
    fs.writeFileSync(
      sourcePath,
      [
        "declare const z: any;",
        "export const widgetStatusSchema = z.enum(['draft', 'published']);",
        "const widgetSettingsSchema = z.object({",
        "  enabled: z.boolean().default(true),",
        "  label: z.string().nullable().optional(),",
        "}).passthrough();",
        "export const createWidgetBodySchema = z.object({",
        "  title: z.string().trim().min(2).max(120),",
        "  retries: z.coerce.number().int().min(1).max(10).default(1),",
        "  status: widgetStatusSchema.optional(),",
        "  tags: z.array(z.string().trim()).default([]),",
        "  mode: z.union([z.literal('embed'), z.literal('wall')]).optional(),",
        "  settings: widgetSettingsSchema.optional(),",
        "  notes: z.string().nullable(),",
        "}).strict();",
        "export type CreateWidgetBodyDto = z.infer<typeof createWidgetBodySchema>;",
      ].join("\n"),
    );

    const program = ts.createProgram([sourcePath], {
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
    });

    const sourceFile = program.getSourceFile(sourcePath);
    expect(sourceFile).toBeDefined();

    const result = extractSchemas(
      [sourceFile!],
      program.getTypeChecker(),
      root,
    );

    expect(Object.keys(result.schemas)).toEqual(["CreateWidgetBodyDto"]);
    expect(result.schemas.CreateWidgetBodyDto).toMatchObject({
      name: "CreateWidgetBodyDto",
      required: ["title", "notes"],
      properties: {
        title: {
          type: { kind: "primitive", type: "string" },
          constraints: { minLength: 2, maxLength: 120 },
        },
        retries: {
          type: { kind: "primitive", type: "integer" },
          default: 1,
          constraints: { minimum: 1, maximum: 10 },
        },
        status: {
          type: { kind: "primitive", type: "string" },
          enum: ["draft", "published"],
        },
        tags: {
          type: { kind: "array", items: { kind: "primitive", type: "string" } },
          default: [],
        },
        mode: {
          type: { kind: "primitive", type: "string" },
          enum: ["embed", "wall"],
        },
        settings: {
          type: {
            kind: "inline",
            schema: {
              type: "object",
              additionalProperties: true,
              properties: {
                enabled: { type: "boolean", default: true },
                label: { type: ["string", "null"] },
              },
            },
          },
        },
        notes: {
          type: { kind: "primitive", type: "string" },
          nullable: true,
        },
      },
      inference: { status: "inferred" },
    });
    expect(result.diagnostics).toEqual([]);
  });
});
