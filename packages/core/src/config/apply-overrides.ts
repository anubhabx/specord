// ============================================================================
// Config override application
// Applies OpenAPI-shaped config fragments to the internal inspection model.
// ============================================================================

import type {
  Diagnostic,
  InspectionModel,
  OpenApiResponseObject,
  OpenApiResponsesObject,
  OpenApiSecurityRequirementObject,
  OperationModel,
  OperationOverrideConfig,
  ResponseModel,
  SchemaModel,
  SpecordConfigV1,
} from "@specord/types";

/**
 * Apply config overrides to an extracted inspection model.
 */
export function applyConfigOverrides(
  model: InspectionModel,
  config: SpecordConfigV1,
): InspectionModel {
  if (!config.operations && !config.schemas && !config.securitySchemes) {
    return model;
  }

  validateOverrideKeys(model, config);

  const excludedOperationIds = new Set(
    Object.entries(config.operations ?? {})
      .filter(([, override]) => override.exclude === true)
      .map(([operationId]) => operationId),
  );

  const operations = model.operations
    .filter((operation) => !excludedOperationIds.has(operation.id))
    .map((operation) =>
      applyOperationOverride(operation, config.operations?.[operation.id]),
    );

  const schemas = applySchemaOverrides(model.schemas, config);

  const overriddenSchemaNames = new Set(Object.keys(config.schemas ?? {}));
  const diagnostics = model.diagnostics.filter((diagnostic) => {
    if (excludedOperationIds.has(diagnostic.subject ?? "")) {
      return false;
    }

    if (
      overriddenSchemaNames.has(diagnostic.subject ?? "") &&
      isSchemaDiagnostic(diagnostic)
    ) {
      return false;
    }

    return true;
  });

  return {
    ...model,
    operations,
    schemas,
    securitySchemes: mergeSecuritySchemes(
      model.securitySchemes,
      config.securitySchemes,
    ),
    diagnostics,
  };
}

function mergeSecuritySchemes(
  extracted: InspectionModel["securitySchemes"],
  configured: SpecordConfigV1["securitySchemes"],
): InspectionModel["securitySchemes"] {
  const merged = {
    ...(extracted ?? {}),
    ...(configured ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function applyOperationOverride(
  operation: OperationModel,
  override: OperationOverrideConfig | undefined,
): OperationModel {
  if (!override) {
    return operation;
  }

  const next: OperationModel = {
    ...operation,
    diagnostics: [...operation.diagnostics],
    openapi: operation.openapi ? { ...operation.openapi } : undefined,
  };

  if (override.summary !== undefined) {
    next.summary = override.summary;
    next.openapi = { ...next.openapi, summary: override.summary };
  }

  if (override.description !== undefined) {
    next.description = override.description;
    next.openapi = { ...next.openapi, description: override.description };
  }

  if (override.tags !== undefined) {
    next.tags = [...override.tags];
    next.openapi = { ...next.openapi, tags: [...override.tags] };
  }

  if (override.responses !== undefined) {
    next.responses = responsesFromOverride(override.responses);
    next.openapi = { ...next.openapi, responses: override.responses };
    next.diagnostics = removeDiagnostics(
      next.diagnostics,
      "EXTRACTOR_UNRESOLVED_RESPONSE",
    );
  }

  if (override.security !== undefined) {
    next.security = { status: "overridden" };
    next.openapi = {
      ...next.openapi,
      security: cloneSecurityRequirements(override.security),
    };
    next.diagnostics = removeDiagnostics(
      next.diagnostics,
      "EXTRACTOR_UNRESOLVED_SECURITY",
    );
  }

  return next;
}

function responsesFromOverride(
  responses: OpenApiResponsesObject,
): ResponseModel[] {
  return Object.entries(responses)
    .filter(([status]) => status !== "default")
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([status, response]) => ({
      status: Number(status),
      description: getResponseDescription(response),
      inference: { status: "overridden" },
      openapi: response,
    }));
}

function getResponseDescription(response: OpenApiResponseObject): string {
  if ("description" in response && typeof response.description === "string") {
    return response.description;
  }

  return "Response provided by specord.config.ts override";
}

function applySchemaOverrides(
  schemas: Record<string, SchemaModel>,
  config: SpecordConfigV1,
): Record<string, SchemaModel> {
  const overrides = config.schemas ?? {};
  const next: Record<string, SchemaModel> = { ...schemas };

  for (const [schemaName, override] of Object.entries(overrides)) {
    next[schemaName] = {
      ...next[schemaName],
      inference: { status: "overridden" },
      openapi: override,
    };
  }

  return next;
}

function validateOverrideKeys(
  model: InspectionModel,
  config: SpecordConfigV1,
): void {
  const operationIds = new Set(model.operations.map((operation) => operation.id));
  const schemaNames = new Set(Object.keys(model.schemas));

  for (const [operationId, override] of Object.entries(config.operations ?? {})) {
    if (!operationIds.has(operationId)) {
      throw new Error(`[specord] Unknown operation override "${operationId}".`);
    }

    validateOperationOverride(operationId, override);
  }

  for (const [schemaName, override] of Object.entries(config.schemas ?? {})) {
    if (!schemaNames.has(schemaName)) {
      throw new Error(`[specord] Unknown schema override "${schemaName}".`);
    }

    if (!isObject(override)) {
      throw new Error(
        `[specord] Schema override "${schemaName}" must be an object.`,
      );
    }
  }
}

function validateOperationOverride(
  operationId: string,
  override: OperationOverrideConfig,
): void {
  if (override.tags !== undefined && !isStringArray(override.tags)) {
    throw new Error(
      `[specord] Operation override "${operationId}".tags must be an array of strings.`,
    );
  }

  if (
    override.security !== undefined &&
    !isSecurityRequirements(override.security)
  ) {
    throw new Error(
      `[specord] Operation override "${operationId}".security must be an array of security requirement objects.`,
    );
  }

  if (override.responses !== undefined) {
    if (!isObject(override.responses)) {
      throw new Error(
        `[specord] Operation override "${operationId}".responses must be an object.`,
      );
    }

    for (const status of Object.keys(override.responses)) {
      if (!isValidResponseStatus(status)) {
        throw new Error(
          `[specord] Invalid response override status "${status}" for operation "${operationId}". Use an HTTP status code from 100 through 599.`,
        );
      }
    }
  }
}

function removeDiagnostics(
  diagnostics: Diagnostic[],
  code: Diagnostic["code"],
): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.code !== code);
}

function isSchemaDiagnostic(diagnostic: Diagnostic): boolean {
  return (
    diagnostic.code === "EXTRACTOR_UNSUPPORTED_MAPPED_TYPE" ||
    diagnostic.code === "EXTRACTOR_TYPE_FALLBACK_ANY"
  );
}

function cloneSecurityRequirements(
  security: OpenApiSecurityRequirementObject[],
): OpenApiSecurityRequirementObject[] {
  return security.map((requirement) => ({ ...requirement }));
}

function isValidResponseStatus(status: string): boolean {
  if (status === "default") {
    return true;
  }

  if (!/^[1-5][0-9][0-9]$/.test(status)) {
    return false;
  }

  const statusCode = Number(status);
  return statusCode >= 100 && statusCode <= 599;
}

function isSecurityRequirements(value: unknown): value is OpenApiSecurityRequirementObject[] {
  return (
    Array.isArray(value) &&
    value.every(
      (requirement) =>
        isObject(requirement) &&
        Object.values(requirement).every(isStringArray),
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
