// ============================================================================
// Path parameter diagnostic tests
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

describe("path parameter diagnostics", () => {
  it("emits a diagnostic when a path token has no parameter", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specord-path-"));
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

    fs.writeFileSync(
      path.join(srcRoot, "projects.dto.ts"),
      [
        "export class ProjectSlugParamsDto {",
        "  slug: string;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(srcRoot, "projects.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "declare function Param(...args: unknown[]): ParameterDecorator;",
        "@Controller('projects')",
        "class ProjectsController {",
        "  @Get(':slug/members/:memberId')",
        "  get(@Param() params: ProjectSlugParamsDto) {",
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
      }),
    ]);
    expect(operation?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXTRACTOR_UNRESOLVED_PATH_PARAM",
          subject: "ProjectsController.get",
        }),
      ]),
    );
  });
});
