// ============================================================================
// Parameter extraction tests
// ============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspect, resolveConfig } from "../src/index.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("path DTO parameter extraction", () => {
  it("expands Semblia-style whole-object Param DTOs into path parameters", () => {
    const projectRoot = createTempProject();
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "projects.dto.ts"),
      [
        "export class ProjectMemberParamsDto {",
        "  slug: string;",
        "  userId: string;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(srcRoot, "projects.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "declare function Param(...args: unknown[]): ParameterDecorator;",
        "declare const ZodValidationPipe: new (...args: unknown[]) => unknown;",
        "declare const projectMemberParamsSchema: unknown;",
        "@Controller('projects')",
        "class ProjectsController {",
        "  @Get(':slug/members/:userId')",
        "  get(@Param(new ZodValidationPipe(projectMemberParamsSchema)) params: ProjectMemberParamsDto) {",
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
      (item) => item.id === "ProjectsController.get",
    );

    expect(operation?.params).toEqual([
      expect.objectContaining({
        name: "slug",
        in: "path",
        required: true,
        type: { kind: "primitive", type: "string" },
      }),
      expect.objectContaining({
        name: "userId",
        in: "path",
        required: true,
        type: { kind: "primitive", type: "string" },
      }),
    ]);
    expect(
      operation?.diagnostics.some(
        (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_PATH_PARAM",
      ),
    ).toBe(false);
  });
});

function createTempProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specord-param-"));
  tempRoots.push(projectRoot);
  const srcRoot = path.join(projectRoot, "src");
  fs.mkdirSync(srcRoot);

  fs.writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          experimentalDecorators: true,
          module: "Node16",
          moduleResolution: "Node16",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );

  return projectRoot;
}
