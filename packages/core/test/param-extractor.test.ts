// ============================================================================
// Parameter extraction tests
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

describe("path DTO parameter extraction", () => {
  it("expands Semblia-style whole-object Param DTOs into path parameters", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-param-",
    });
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

  it("emits unresolved path diagnostics when whole-object Param DTOs cannot be resolved", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-param-",
    });
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "projects.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "declare function Param(...args: unknown[]): ParameterDecorator;",
        "@Controller('projects')",
        "class ProjectsController {",
        "  @Get(':slug')",
        "  get(@Param() params: MissingProjectParamsDto) {",
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

    expect(operation?.params).toEqual([]);
    expect(operation?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXTRACTOR_UNRESOLVED_PATH_PARAM",
          subject: "ProjectsController.get",
        }),
      ]),
    );
  });

  it("uses pipes for named query params and ignores property-scoped body params", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-param-",
    });
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "projects.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Patch(path?: string): MethodDecorator;",
        "declare function Query(...args: unknown[]): ParameterDecorator;",
        "declare function Body(...args: unknown[]): ParameterDecorator;",
        "declare class ParseIntPipe {}",
        "@Controller('projects')",
        "class ProjectsController {",
        "  @Patch(':id')",
        "  update(@Query('page', ParseIntPipe) page: number, @Body('name') name: string) {",
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
      (item) => item.id === "ProjectsController.update",
    );

    expect(operation?.params).toEqual([
      expect.objectContaining({
        name: "page",
        in: "query",
        type: { kind: "primitive", type: "integer" },
      }),
    ]);
    expect(operation?.requestBody).toBeUndefined();
  });

  it("resolves generic Array<T> body types as arrays", () => {
    const projectRoot = createTempProject(tempRoots, {
      prefix: "specord-param-",
    });
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "project.dto.ts"),
      [
        "export class ProjectDto {",
        "  id: string;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(srcRoot, "projects.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Post(path?: string): MethodDecorator;",
        "declare function Body(...args: unknown[]): ParameterDecorator;",
        "@Controller('projects')",
        "class ProjectsController {",
        "  @Post('bulk')",
        "  create(@Body() body: Array<ProjectDto>) {",
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
      (item) => item.id === "ProjectsController.create",
    );

    expect(operation?.requestBody?.schema).toEqual({
      kind: "array",
      items: { kind: "ref", name: "ProjectDto" },
    });
  });
});
