// ============================================================================
// Config override tests — Phase 1B OpenAPI-shaped fragments
// ============================================================================

import { describe, expect, it } from "vitest";
import type { DiagnosticCode, OperationModel } from "@specord/types";
import { inspectNestFixtureWithConfig } from "./helpers/inspect-fixture.js";

function getOperation(model: { operations: OperationModel[] }, id: string): OperationModel {
  const operation = model.operations.find((op) => op.id === id);
  expect(operation, `expected operation ${id}`).toBeDefined();
  return operation!;
}

function countOperationDiagnostics(
  model: { operations: OperationModel[] },
  code: DiagnosticCode,
): number {
  return model.operations.flatMap((op) =>
    op.diagnostics.filter((diag) => diag.code === code),
  ).length;
}

describe("config override application", () => {
  it("applies OpenAPI-shaped response overrides and resolves response diagnostics", () => {
    const model = inspectNestFixtureWithConfig({
      operations: {
        "ProjectsController.exportCsv": {
          responses: {
            "200": {
              description: "CSV export returned.",
              content: {
                "text/csv": {
                  schema: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
          },
        },
      },
    });

    const operation = getOperation(model, "ProjectsController.exportCsv");

    expect(operation.responses).toEqual([
      expect.objectContaining({
        status: 200,
        description: "CSV export returned.",
        inference: { status: "overridden" },
        openapi: expect.objectContaining({
          description: "CSV export returned.",
        }),
      }),
    ]);
    expect(
      operation.diagnostics.some(
        (diag) => diag.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
    expect(
      countOperationDiagnostics(model, "EXTRACTOR_UNRESOLVED_RESPONSE"),
    ).toBe(0);
  });

  it("accepts OpenAPI default response overrides", () => {
    const model = inspectNestFixtureWithConfig({
      operations: {
        "ProjectsController.exportCsv": {
          responses: {
            default: {
              description: "Error response.",
            },
          },
        },
      },
    });

    const operation = getOperation(model, "ProjectsController.exportCsv");

    expect(operation.responses).toEqual([]);
    expect(operation.openapi?.responses).toEqual({
      default: {
        description: "Error response.",
      },
    });
    expect(
      operation.diagnostics.some(
        (diag) => diag.code === "EXTRACTOR_UNRESOLVED_RESPONSE",
      ),
    ).toBe(false);
  });

  it("applies security scheme and operation security overrides", () => {
    const model = inspectNestFixtureWithConfig({
      securitySchemes: {
        stripeSignature: {
          type: "apiKey",
          in: "header",
          name: "Stripe-Signature",
        },
      },
      operations: {
        "WebhooksController.stripe": {
          security: [{ stripeSignature: [] }],
        },
      },
    });

    const operation = getOperation(model, "WebhooksController.stripe");

    expect(model.securitySchemes).toMatchObject({
      stripeSignature: {
        type: "apiKey",
        in: "header",
        name: "Stripe-Signature",
      },
    });
    expect(operation.security).toEqual({ status: "overridden" });
    expect(operation.openapi?.security).toEqual([{ stripeSignature: [] }]);
    expect(
      operation.diagnostics.some(
        (diag) => diag.code === "EXTRACTOR_UNRESOLVED_SECURITY",
      ),
    ).toBe(false);
    expect(
      countOperationDiagnostics(model, "EXTRACTOR_UNRESOLVED_SECURITY"),
    ).toBe(0);
  });

  it("applies operation metadata overrides", () => {
    const model = inspectNestFixtureWithConfig({
      operations: {
        "AccountsController.list": {
          summary: "List tenant accounts",
          description: "Return the accounts visible to the caller.",
          tags: ["Tenancy"],
        },
      },
    });

    const operation = getOperation(model, "AccountsController.list");

    expect(operation.summary).toBe("List tenant accounts");
    expect(operation.description).toBe("Return the accounts visible to the caller.");
    expect(operation.tags).toEqual(["Tenancy"]);
    expect(operation.openapi).toMatchObject({
      summary: "List tenant accounts",
      description: "Return the accounts visible to the caller.",
      tags: ["Tenancy"],
    });
  });

  it("excludes operations and drops operation-scoped diagnostics", () => {
    const model = inspectNestFixtureWithConfig({
      operations: {
        "HealthController.health": {
          exclude: true,
        },
      },
    });

    expect(
      model.operations.some((op) => op.id === "HealthController.health"),
    ).toBe(false);
    expect(model.operations).toHaveLength(26);
    expect(
      model.diagnostics.some((diag) => diag.subject === "HealthController.health"),
    ).toBe(false);
  });

  it("applies schema overrides", () => {
    const model = inspectNestFixtureWithConfig({
      schemas: {
        UpdateProjectDto: {
          type: "object",
          properties: {
            name: { type: "string" },
            status: {
              type: "string",
              enum: ["planning", "active", "paused", "archived"],
            },
          },
        },
      },
    });

    expect(model.schemas.UpdateProjectDto).toMatchObject({
      name: "UpdateProjectDto",
      inference: { status: "overridden" },
      openapi: {
        type: "object",
        properties: {
          name: { type: "string" },
          status: {
            type: "string",
            enum: ["planning", "active", "paused", "archived"],
          },
        },
      },
    });
  });

  it("throws clear errors for invalid override keys", () => {
    expect(() =>
      inspectNestFixtureWithConfig({
        operations: {
          "MissingController.nope": {
            summary: "Nope",
          },
        },
      }),
    ).toThrow(/Unknown operation override "MissingController\.nope"/);

    expect(() =>
      inspectNestFixtureWithConfig({
        schemas: {
          MissingDto: {
            type: "object",
          },
        },
      }),
    ).toThrow(/Unknown schema override "MissingDto"/);

    expect(() =>
      inspectNestFixtureWithConfig({
        operations: {
          "AuthController.login": {
            responses: {
              ok: {
                description: "Nope",
              },
            },
          },
        },
      }),
    ).toThrow(/Invalid response override status "ok"/);

    expect(() =>
      inspectNestFixtureWithConfig({
        operations: {
          "AuthController.login": {
            responses: {
              "99": {
                description: "Too low.",
              },
            },
          },
        },
      }),
    ).toThrow(/Invalid response override status "99"/);
  });
});
