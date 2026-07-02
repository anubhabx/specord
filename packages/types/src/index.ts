// @specord/types — public API
export type {
  InspectionModel,
  OperationModel,
  ParameterModel,
  BodyModel,
  ResponseModel,
  SchemaModel,
  SchemaRef,
  PrimitiveType,
  PropertyModel,
  SourceLocation,
  InferenceState,
} from "./inspection-model.js";

export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from "./diagnostics.js";

export type {
  OpenApiMediaTypeObject,
  OpenApiReferenceObject,
  OpenApiResponseObject,
  OpenApiResponsesObject,
  OpenApiSchemaObject,
  OpenApiSecurityRequirementObject,
  OpenApiSecuritySchemeObject,
  OperationOverrideConfig,
  SpecordConfigV1,
} from "./config.js";

export type {
  ApiHistoryChangeType,
  ApiHistoryConfidence,
  ApiHistoryRecord,
} from "./history.js";

export { cloneJsonValue } from "./clone.js";
