// ============================================================================
// Specord V1 Diagnostic Types
// Canonical diagnostic codes and structure for extraction diagnostics.
// See: spec/specord-v1-extractor-spec.md §Diagnostic catalog
// ============================================================================

import type { SourceLocation } from "./inspection-model.js";

/**
 * Canonical diagnostic codes for V1.
 * New codes must be added to the spec before shipping.
 */
export type DiagnosticCode =
  | "EXTRACTOR_UNRESOLVED_RESPONSE"
  | "EXTRACTOR_UNRESOLVED_PATH_PARAM"
  | "EXTRACTOR_UNRESOLVED_SECURITY"
  | "EXTRACTOR_UNSUPPORTED_MAPPED_TYPE"
  | "EXTRACTOR_UNSUPPORTED_DECORATOR"
  | "EXTRACTOR_TYPE_FALLBACK_ANY"
  | "EXTRACTOR_ROUTE_CONFLICT"
  | "EXTRACTOR_INVALID_PATH_TEMPLATE"
  | "EXTRACTOR_UNSUPPORTED_VERSIONING";

/**
 * Diagnostic severity levels.
 */
export type DiagnosticSeverity = "info" | "warning" | "error";

/**
 * A single diagnostic emitted during extraction.
 * Diagnostics are addressable and actionable: each includes enough context
 * for the user to understand what went wrong and how to fix it via config.
 */
export type Diagnostic = {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  source?: SourceLocation;
  subject?: string;
  suggestedOverridePath?: string;
  origin?: "typescript" | "nestjs" | "swagger" | "config" | "openapi";
};
