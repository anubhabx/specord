// ============================================================================
// Extraction pipeline — orchestrates all extraction steps into InspectionModel
// ============================================================================

import type {
  InspectionModel,
  OperationModel,
  Diagnostic,
  OpenApiSecurityRequirementObject,
  OpenApiSecuritySchemeObject,
  SpecordConfigV1,
} from "@specord/types";
import { createProgram } from "./program/create-program.js";
import { discoverSources } from "./program/source-discovery.js";
import { discoverControllers } from "./extractors/controller-discovery.js";
import { extractRoutes } from "./extractors/route-extractor.js";
import { extractParams } from "./extractors/param-extractor.js";
import { extractSchemas } from "./extractors/schema-extractor.js";
import { extractResponse } from "./extractors/response-extractor.js";
import {
  unresolvedSecurityDiagnostic,
  unsupportedDecoratorDiagnostic,
} from "./diagnostics/diagnostic-builder.js";
import type { ResolvedConfig } from "./config/loader.js";
import {
  DEFAULT_CONTROLLER_SUFFIXES,
  DEFAULT_DTO_SUFFIXES,
} from "./config/defaults.js";
import { applyConfigOverrides } from "./config/apply-overrides.js";

/**
 * Run the full extraction pipeline and produce an InspectionModel.
 */
export function inspect(config: ResolvedConfig): InspectionModel {
  const { project, root, config: userConfig } = config;

  // Step 1: Create TypeScript program
  const { program, checker } = createProgram(project);

  // Step 2: Discover source files
  const sources = discoverSources(
    program,
    root,
    DEFAULT_CONTROLLER_SUFFIXES,
    DEFAULT_DTO_SUFFIXES,
    {
      include: userConfig.source?.include,
      exclude: userConfig.source?.exclude,
    },
  );

  // Step 3: Extract schemas from DTO/entity files
  const { schemas, diagnostics: schemaDiagnostics } = extractSchemas(
    sources.dtoFiles,
    checker,
    root,
  );

  // Step 4: Discover controllers
  const controllers = discoverControllers(sources.controllerFiles, root);

  // Step 5: Extract routes and build operations
  const globalPrefix = userConfig.routing?.globalPrefix ?? "";
  const versionPrefix = getUriVersionPrefix(userConfig.routing?.versioning);
  const operations: OperationModel[] = [];
  const globalDiagnostics: Diagnostic[] = [...schemaDiagnostics];
  if (
    userConfig.routing?.versioning &&
    userConfig.routing.versioning.strategy !== "uri"
  ) {
    globalDiagnostics.push({
      severity: "warning",
      code: "EXTRACTOR_UNSUPPORTED_VERSIONING",
      message: `Routing versioning strategy "${userConfig.routing.versioning.strategy}" is not expressible as a V1 path prefix`,
      subject: "routing.versioning",
      suggestedOverridePath: "routing.versioning",
      origin: "nestjs",
    });
  }

  // Track paths for route conflict detection
  const routeMap = new Map<string, string>();
  const inferredSecuritySchemes: Record<string, OpenApiSecuritySchemeObject> = {};
  const configuredSecuritySchemeNames = new Set(
    Object.keys(userConfig.securitySchemes ?? {}),
  );
  const routesByController = controllers.map((controller) =>
    extractRoutes(controller, globalPrefix, versionPrefix, root),
  );

  for (const routes of routesByController) {
    for (const route of routes) {
      Object.assign(inferredSecuritySchemes, route.securitySchemes);
    }
  }

  for (const routes of routesByController) {
    for (const route of routes) {
      const operationDiagnostics: Diagnostic[] = [];

      // Check for route conflicts
      const routeKey = `${route.method}:${route.path}`;
      const existing = routeMap.get(routeKey);
      if (existing) {
        globalDiagnostics.push({
          severity: "error",
          code: "EXTRACTOR_ROUTE_CONFLICT",
          message: `Duplicate route ${route.method.toUpperCase()} ${route.path}: ${existing} and ${route.id}`,
          source: route.location,
          subject: route.id,
          suggestedOverridePath: "routing",
        });
      } else {
        routeMap.set(routeKey, route.id);
      }

      // Validate path template params
      const pathParams = extractPathParams(route.path);
      for (const paramName of pathParams) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName)) {
          globalDiagnostics.push({
            severity: "error",
            code: "EXTRACTOR_INVALID_PATH_TEMPLATE",
            message: `Invalid path parameter name "${paramName}" in ${route.path}`,
            source: route.location,
            subject: route.id,
            suggestedOverridePath: "routing",
          });
        }
      }

      // Extract parameters
      const { params, requestBody } = extractParams(route, checker, root, schemas);
      const emittedPathParams = new Set(
        params
          .filter((param) => param.in === "path")
          .map((param) => param.name),
      );
      for (const paramName of pathParams) {
        if (emittedPathParams.has(paramName)) continue;

        operationDiagnostics.push({
          severity: "warning",
          code: "EXTRACTOR_UNRESOLVED_PATH_PARAM",
          message: `Path template parameter "{${paramName}}" in ${route.path} has no matching emitted path parameter`,
          source: route.location,
          subject: route.id,
          suggestedOverridePath: `operations.${route.id}.params`,
        });
      }

      // Extract response
      const {
        responses,
        diagnostics: responseDiagnostics,
        schemas: responseSchemas,
      } = extractResponse(
        route,
        checker,
        root,
        schemas,
      );
      for (const [schemaName, responseSchema] of Object.entries(responseSchemas)) {
        if (!schemas[schemaName]) {
          schemas[schemaName] = responseSchema;
        }
      }
      operationDiagnostics.push(...responseDiagnostics);

      let routeSecurity = mergeSecurityRequirements(route.security);
      const hasGuard = route.hasMethodLevelGuard || route.hasClassLevelGuard;
      const hasExplicitAuthDecorator = route.isPublic
        ? route.hasMethodLevelAuthDecorator
        : route.hasMethodLevelAuthDecorator || route.hasClassLevelAuthDecorator;
      const hasAuth = hasExplicitAuthDecorator || (hasGuard && !route.isPublic);
      if (routeSecurity.length === 0 && hasAuth) {
        routeSecurity = defaultConfiguredSecurityRequirement(
          userConfig.securitySchemes,
        );
      }

      // Security diagnostics
      if (hasAuth && routeSecurity.length === 0) {
        operationDiagnostics.push(
          unresolvedSecurityDiagnostic(route.id, route.location),
        );
      }
      for (const schemeName of missingSecuritySchemes(
        routeSecurity,
        inferredSecuritySchemes,
        configuredSecuritySchemeNames,
      )) {
        operationDiagnostics.push({
          severity: "warning",
          code: "EXTRACTOR_UNRESOLVED_SECURITY",
          message: `Security requirement "${schemeName}" was harvested but no security scheme was configured or inferable`,
          source: route.location,
          subject: route.id,
          suggestedOverridePath: `securitySchemes.${schemeName}`,
          origin: "swagger",
        });
      }

      // Unsupported decorator diagnostics
      for (const decoratorName of route.unsupportedDecorators) {
        operationDiagnostics.push(
          unsupportedDecoratorDiagnostic(route.id, decoratorName, route.location),
        );
      }

      operations.push({
        id: route.id,
        operationId: route.operationId ?? route.id,
        controller: route.controller,
        handler: route.handler,
        method: route.method,
        path: route.path,
        source: route.location,
        summary: route.summary,
        description: route.description,
        tags: route.tags.length > 0 ? route.tags : undefined,
        params,
        requestBody,
        responses,
        security: routeSecurity.length > 0
          ? { status: "overridden" }
          : hasAuth
            ? { status: "unresolved", reason: "Guard/auth semantics require config override" }
            : { status: "inferred" },
        diagnostics: operationDiagnostics,
        openapi: routeSecurity.length > 0
          ? { security: routeSecurity }
          : undefined,
      });
    }
  }

  const model: InspectionModel = {
    source: {
      project,
      root,
      inspectedAt: new Date().toISOString(),
      version: "v1",
    },
    operations,
    schemas,
    securitySchemes: Object.keys(inferredSecuritySchemes).length > 0
      ? inferredSecuritySchemes
      : undefined,
    diagnostics: globalDiagnostics,
  };

  return applyConfigOverrides(model, userConfig);
}

/**
 * Extract path parameter names from an OpenAPI template path.
 */
function extractPathParams(path: string): string[] {
  const matches = path.matchAll(/\{([^}]+)\}/g);
  return [...matches].map((m) => m[1]);
}

function getUriVersionPrefix(
  versioning: NonNullable<SpecordConfigV1["routing"]>["versioning"] | undefined,
): string {
  if (!versioning || versioning.strategy !== "uri" || !versioning.value) {
    return "";
  }

  return versioning.value.startsWith("v")
    ? versioning.value
    : `v${versioning.value}`;
}

function mergeSecurityRequirements(
  security: OpenApiSecurityRequirementObject[],
): OpenApiSecurityRequirementObject[] {
  const merged: OpenApiSecurityRequirementObject[] = [];
  const seen = new Set<string>();

  for (const requirement of security ?? []) {
    const key = JSON.stringify(requirement);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(requirement);
  }

  return merged;
}

function defaultConfiguredSecurityRequirement(
  schemes: SpecordConfigV1["securitySchemes"] | undefined,
): OpenApiSecurityRequirementObject[] {
  const entries = Object.entries(schemes ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const bearerEntry = entries.find(
    ([, scheme]) =>
      scheme.type === "http" && scheme.scheme?.toLowerCase() === "bearer",
  );
  const selected = bearerEntry ?? (entries.length === 1 ? entries[0] : undefined);

  return selected ? [{ [selected[0]]: [] }] : [];
}

function missingSecuritySchemes(
  requirements: OpenApiSecurityRequirementObject[],
  inferred: Record<string, OpenApiSecuritySchemeObject>,
  configuredNames: Set<string>,
): string[] {
  const available = new Set([...Object.keys(inferred), ...configuredNames]);
  const missing = new Set<string>();

  for (const requirement of requirements) {
    for (const schemeName of Object.keys(requirement)) {
      if (!available.has(schemeName)) {
        missing.add(schemeName);
      }
    }
  }

  return [...missing].sort();
}
