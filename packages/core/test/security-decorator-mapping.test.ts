// ============================================================================
// Security decorator mapping tests
// ============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationModel } from "@specord/types";
import { inspect, resolveConfig } from "../src/index.ts";
import { cleanupTempProjects } from "./helpers/temp-project.ts";

const tempRoots: string[] = [];

afterEach(() => {
  cleanupTempProjects(tempRoots);
});

describe("security decorator mapping", () => {
  it("maps guarded routes to configured bearer auth and keeps public throttled routes public", () => {
    const projectRoot = createTempProject();
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "projects.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "declare function Post(path?: string): MethodDecorator;",
        "declare function UseGuards(...guards: unknown[]): ClassDecorator & MethodDecorator;",
        "declare function Public(): ClassDecorator & MethodDecorator;",
        "declare function SkipThrottle(): MethodDecorator;",
        "declare function Throttle(config: unknown): MethodDecorator;",
        "declare function RequireCapability(capability: unknown): MethodDecorator;",
        "declare class UserActorGuard {}",
        "declare class PublicSubmitThrottlerGuard {}",
        "declare class CapabilityGuard {}",
        "declare const Capability: { MANAGE_PROJECT: string };",
        "@Controller('projects')",
        "@UseGuards(UserActorGuard)",
        "class ProjectsController {",
        "  @Get()",
        "  list() {",
        "    return {};",
        "  }",
        "",
        "  @Public()",
        "  @SkipThrottle()",
        "  @Throttle({ default: { ttl: 60000, limit: 3 } })",
        "  @UseGuards(PublicSubmitThrottlerGuard)",
        "  @Post('public-submit')",
        "  submit() {",
        "    return {};",
        "  }",
        "",
        "  @UseGuards(CapabilityGuard)",
        "  @RequireCapability(Capability.MANAGE_PROJECT)",
        "  @Post(':slug/settings')",
        "  updateSettings() {",
        "    return {};",
        "  }",
        "}",
      ].join("\n"),
    );

    const model = inspect(
      resolveConfig(
        {
          project: path.join(projectRoot, "tsconfig.json"),
          root: srcRoot,
        },
        {
          securitySchemes: {
            sembliaBearer: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
            },
            internalApiKey: {
              type: "apiKey",
              in: "header",
              name: "X-Internal-Key",
            },
          },
        },
      ),
    );

    const list = getOperation(model.operations, "ProjectsController.list");
    const submit = getOperation(model.operations, "ProjectsController.submit");
    const updateSettings = getOperation(
      model.operations,
      "ProjectsController.updateSettings",
    );

    expect(list.security).toEqual({ status: "overridden" });
    expect(list.openapi?.security).toEqual([{ sembliaBearer: [] }]);
    expectSecurityDiagnostics(list).toEqual([]);

    expect(submit.security).toEqual({ status: "inferred" });
    expect(submit.openapi?.security).toBeUndefined();
    expectSecurityDiagnostics(submit).toEqual([]);
    expectUnsupportedDecorators(submit).toEqual([]);

    expect(updateSettings.security).toEqual({ status: "overridden" });
    expect(updateSettings.openapi?.security).toEqual([{ sembliaBearer: [] }]);
    expectSecurityDiagnostics(updateSettings).toEqual([]);
    expectUnsupportedDecorators(updateSettings).toEqual([]);
  });

  it("does not guess when guarded routes have multiple non-bearer schemes", () => {
    const projectRoot = createTempProject();
    const srcRoot = path.join(projectRoot, "src");

    fs.writeFileSync(
      path.join(srcRoot, "projects.controller.ts"),
      [
        "declare function Controller(path?: string): ClassDecorator;",
        "declare function Get(path?: string): MethodDecorator;",
        "declare function UseGuards(...guards: unknown[]): ClassDecorator & MethodDecorator;",
        "declare class UserActorGuard {}",
        "@Controller('projects')",
        "@UseGuards(UserActorGuard)",
        "class ProjectsController {",
        "  @Get()",
        "  list() {",
        "    return {};",
        "  }",
        "}",
      ].join("\n"),
    );

    const model = inspect(
      resolveConfig(
        {
          project: path.join(projectRoot, "tsconfig.json"),
          root: srcRoot,
        },
        {
          securitySchemes: {
            adminKey: {
              type: "apiKey",
              in: "header",
              name: "X-Admin-Key",
            },
            internalKey: {
              type: "apiKey",
              in: "header",
              name: "X-Internal-Key",
            },
          },
        },
      ),
    );

    const list = getOperation(model.operations, "ProjectsController.list");

    expect(list.security).toEqual({
      status: "unresolved",
      reason: "Guard/auth semantics require config override",
    });
    expect(list.openapi?.security).toBeUndefined();
    expectSecurityDiagnostics(list).toEqual([
      expect.objectContaining({
        code: "EXTRACTOR_UNRESOLVED_SECURITY",
        subject: "ProjectsController.list",
      }),
    ]);
  });
});

function getOperation(
  operations: OperationModel[],
  id: string,
): OperationModel {
  const operation = operations.find((item) => item.id === id);
  expect(operation, `expected operation ${id}`).toBeDefined();
  return operation!;
}

function expectSecurityDiagnostics(operation: OperationModel) {
  return expect(
    operation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "EXTRACTOR_UNRESOLVED_SECURITY",
    ),
  );
}

function expectUnsupportedDecorators(operation: OperationModel) {
  return expect(
    operation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "EXTRACTOR_UNSUPPORTED_DECORATOR",
    ),
  );
}

function createTempProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specord-security-"));
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
