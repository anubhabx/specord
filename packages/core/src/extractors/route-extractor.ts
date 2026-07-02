// ============================================================================
// Route extraction — HTTP method decorators, path normalization, path joining
// ============================================================================

import ts from "typescript";
import type {
  OpenApiSecurityRequirementObject,
  OpenApiSecuritySchemeObject,
  SourceLocation,
} from "@specord/types";
import type { DiscoveredController } from "./controller-discovery.js";
import {
  AUTH_DECORATOR_NAMES,
  extractDecoratorStringArg,
  findDecorator,
  hasAnyDecorator,
  hasDecorator,
} from "./controller-discovery.js";
import {
  extractSwaggerOperation,
  extractSwaggerSecurityMetadata,
  extractSwaggerTags,
} from "./swagger-compat.js";

/** HTTP methods supported for V1 extraction. */
const HTTP_METHOD_DECORATORS = [
  "Get", "Post", "Put", "Patch", "Delete", "Options", "Head",
] as const;

type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";

/** Discovered route handler within a controller. */
export interface DiscoveredRoute {
  /** Operation ID: ControllerName.methodName */
  id: string;
  controller: string;
  handler: string;
  method: HttpMethod;
  /** Normalized OpenAPI path, e.g. /users/{id} */
  path: string;
  /** The method declaration AST node. */
  node: ts.MethodDeclaration;
  sourceFile: ts.SourceFile;
  location: SourceLocation;
  /** Whether this handler has a method-level @UseGuards. */
  hasMethodLevelGuard: boolean;
  /** Whether the controller has a class-level @UseGuards. */
  hasClassLevelGuard: boolean;
  /** Whether this handler or its controller is explicitly public. */
  isPublic: boolean;
  /** Whether this handler has an app-specific auth decorator. */
  hasMethodLevelAuthDecorator: boolean;
  /** Whether the controller has an app-specific auth decorator. */
  hasClassLevelAuthDecorator: boolean;
  /** Names of unsupported decorators on this handler. */
  unsupportedDecorators: string[];
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  security: OpenApiSecurityRequirementObject[];
  securitySchemes: Record<string, OpenApiSecuritySchemeObject>;
}

/** Known NestJS/common decorators that we handle or explicitly ignore. */
const KNOWN_DECORATORS = new Set([
  ...HTTP_METHOD_DECORATORS,
  "Controller", "UseGuards", "HttpCode",
  "Param", "Query", "Body", "Headers", "Request", "Req", "Res", "Response",
  "Injectable", "Inject",
  "Public", "SkipThrottle", "Throttle", ...AUTH_DECORATOR_NAMES,
  "ApiTags", "ApiOperation", "ApiResponse", "ApiOkResponse",
  "ApiCreatedResponse", "ApiAcceptedResponse", "ApiNoContentResponse",
  "ApiBadRequestResponse", "ApiUnauthorizedResponse", "ApiForbiddenResponse",
  "ApiNotFoundResponse", "ApiConflictResponse", "ApiUnprocessableEntityResponse",
  "ApiInternalServerErrorResponse", "ApiBearerAuth", "ApiSecurity",
]);

/**
 * Extract all route handlers from a discovered controller.
 */
export function extractRoutes(
  controller: DiscoveredController,
  globalPrefix: string,
  versionPrefix: string,
  root: string,
): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  const normalizedRoot = root.replace(/\\/g, "/");

  ts.forEachChild(controller.node, (node) => {
    if (!ts.isMethodDeclaration(node) || !node.name) return;

    const methodName = node.name.getText(controller.sourceFile);

    for (const decoratorName of HTTP_METHOD_DECORATORS) {
      const httpDecorator = findDecorator(node, decoratorName);
      if (!httpDecorator) continue;

      const methodPath = extractDecoratorStringArg(httpDecorator) ?? "";
      const fullPath = normalizePath(
        globalPrefix,
        versionPrefix,
        controller.prefix,
        methodPath,
      );

      const filePath = controller.sourceFile.fileName.replace(/\\/g, "/");
      const relativePath = filePath.startsWith(normalizedRoot + "/")
        ? filePath.slice(normalizedRoot.length + 1)
        : filePath;

      const { line } = controller.sourceFile.getLineAndCharacterOfPosition(
        node.getStart(),
      );

      // Detect unsupported decorators
      const unsupported = detectUnsupportedDecorators(node);
      const operation = extractSwaggerOperation(node);
      const methodTags = extractSwaggerTags(node);
      const methodSecurity = extractSwaggerSecurityMetadata(node);
      const hasMethodLevelAuthDecorator = hasAnyDecorator(node, AUTH_DECORATOR_NAMES);
      const isPublic = controller.isPublic || hasDecorator(node, "Public");
      const routeSecurity = isPublic && !hasMethodLevelAuthDecorator
        ? methodSecurity.requirements
        : [...controller.security, ...methodSecurity.requirements];

      routes.push({
        id: `${controller.name}.${methodName}`,
        controller: controller.name,
        handler: methodName,
        method: decoratorName.toLowerCase() as HttpMethod,
        path: fullPath,
        node,
        sourceFile: controller.sourceFile,
        location: { file: relativePath, line: line + 1 },
        hasMethodLevelGuard: hasDecorator(node, "UseGuards"),
        hasClassLevelGuard: controller.hasClassLevelGuard,
        isPublic,
        hasMethodLevelAuthDecorator,
        hasClassLevelAuthDecorator: controller.hasClassLevelAuthDecorator,
        unsupportedDecorators: unsupported,
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        tags: [...controller.tags, ...methodTags],
        security: routeSecurity,
        securitySchemes: {
          ...controller.securitySchemes,
          ...methodSecurity.schemes,
        },
      });

      break; // One HTTP method per handler
    }
  });

  return routes;
}

/**
 * Normalize and join path segments into an OpenAPI template path.
 * Rules:
 *   - Leading /
 *   - No trailing slash (except /)
 *   - Nest :id tokens converted to {id}
 */
export function normalizePath(...segments: string[]): string {
  // Join segments, filter empty
  const joined = segments
    .map((s) => s.replace(/^\/|\/$/g, ""))
    .filter((s) => s.length > 0)
    .join("/");

  if (joined.length === 0) return "/";

  // Convert Nest :param syntax to OpenAPI {param} syntax
  const converted = joined.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");

  return "/" + converted;
}

/**
 * Detect decorators on a method that are not in the known set.
 */
function detectUnsupportedDecorators(node: ts.MethodDeclaration): string[] {
  const decorators = ts.canHaveDecorators(node)
    ? ts.getDecorators(node)
    : undefined;

  if (!decorators) return [];

  const unsupported: string[] = [];

  for (const d of decorators) {
    const name = getDecoratorName(d);
    if (name && !KNOWN_DECORATORS.has(name)) {
      unsupported.push(name);
    }
  }

  return unsupported;
}

function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  return undefined;
}
