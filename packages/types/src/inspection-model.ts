// ============================================================================
// Specord V1 Inspection Model
// Normative types for the internal extraction model emitted by `specord inspect`.
// See: spec/specord-v1-extractor-spec.md
// ============================================================================

import type { Diagnostic } from "./diagnostics.js";
import type {
  OpenApiResponseObject,
  OpenApiResponsesObject,
  OpenApiSchemaObject,
  OpenApiSecurityRequirementObject,
  OpenApiSecuritySchemeObject,
} from "./config.js";

/**
 * Source location within the inspected project.
 * `file` is always relative to `--root`.
 * `line` is 1-based. `column` is optional.
 */
export type SourceLocation = {
  file: string;
  line: number;
  column?: number;
};

/**
 * Confidence status for any inferred unit.
 * Every operation, parameter, response, and schema field carries one of these.
 */
export type InferenceState =
  | { status: "inferred" }
  | { status: "inferred-with-warning"; reason: string }
  | { status: "overridden" }
  | { status: "unresolved"; reason: string };

/**
 * Type reference within the internal model.
 * Uses a discriminated union to represent schema shapes without full OpenAPI complexity.
 */
export type SchemaRef =
  | { kind: "ref"; name: string }
  | { kind: "primitive"; type: PrimitiveType }
  | { kind: "array"; items: SchemaRef }
  | { kind: "inline"; schema: OpenApiSchemaObject }
  | { kind: "unknown" };

/** Primitive types supported in the internal model. */
export type PrimitiveType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null"
  | "object";

/**
 * Single property within a SchemaModel.
 */
export type PropertyModel = {
  type: SchemaRef;
  description?: string;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  enum?: unknown[];
  format?: string;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  nullable?: boolean;
  constraints?: Record<string, unknown>;
  inference: InferenceState;
};

/**
 * Schema extracted from an exported DTO/entity class.
 * `name` corresponds to the key in `InspectionModel.schemas[name]`.
 */
export type SchemaModel = {
  name: string;
  properties: Record<string, PropertyModel>;
  required: string[];
  source?: SourceLocation;
  inference: InferenceState;
  openapi?: OpenApiSchemaObject;
};

/**
 * Parameter extracted from `@Param`, `@Query`, or `@Headers`.
 */
export type ParameterModel = {
  name: string;
  in: "path" | "query" | "header";
  type: SchemaRef;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  constraints?: Record<string, unknown>;
  source?: SourceLocation;
  inference: InferenceState;
};

/**
 * Request body extracted from `@Body()`.
 */
export type BodyModel = {
  schema: SchemaRef;
  required: boolean;
  source?: SourceLocation;
  inference: InferenceState;
};

/**
 * Response entry for an operation.
 */
export type ResponseModel = {
  status: number;
  description?: string;
  schema?: SchemaRef;
  contentType?: string;
  inference: InferenceState;
  openapi?: OpenApiResponseObject;
};

/**
 * Single API operation extracted from a controller handler.
 * `id` uses the format `ControllerName.methodName`.
 */
export type OperationModel = {
  id: string;
  operationId?: string;
  controller: string;
  handler: string;
  method: "get" | "post" | "put" | "patch" | "delete" | "options" | "head";
  path: string;
  source?: SourceLocation;
  summary?: string;
  description?: string;
  tags?: string[];
  params: ParameterModel[];
  requestBody?: BodyModel;
  responses: ResponseModel[];
  security: InferenceState;
  diagnostics: Diagnostic[];
  openapi?: {
    summary?: string;
    description?: string;
    tags?: string[];
    security?: OpenApiSecurityRequirementObject[];
    responses?: OpenApiResponsesObject;
  };
};

/**
 * Top-level output of `specord inspect`.
 */
export type InspectionModel = {
  source: {
    project: string;
    root: string;
    inspectedAt: string;
    version: "v1";
  };
  operations: OperationModel[];
  schemas: Record<string, SchemaModel>;
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  diagnostics: Diagnostic[];
};

// Re-export diagnostic types from the diagnostics module
export type { Diagnostic, DiagnosticCode } from "./diagnostics.js";
