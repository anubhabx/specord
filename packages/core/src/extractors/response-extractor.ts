// ============================================================================
// Response extraction — return type inference and @HttpCode handling
// ============================================================================

import ts from "typescript";
import path from "node:path";
import type {
  Diagnostic,
  OpenApiSchemaObject,
  PropertyModel,
  ResponseModel,
  SchemaModel,
  SchemaRef,
  SourceLocation,
} from "@specord/types";
import { cloneOpenApiSchema } from "../internal/clone.js";
import {
  extractDecoratorStringArg,
  findDecorator,
} from "./controller-discovery.js";
import type { DiscoveredRoute } from "./route-extractor.js";
import {
  extractSwaggerResponses,
  httpStatusValueFromExpression,
  literalValue,
} from "./swagger-compat.js";

/** Default status codes per HTTP method (NestJS convention). */
const DEFAULT_STATUS: Record<string, number> = {
  post: 201,
  get: 200,
  put: 200,
  patch: 200,
  delete: 200,
  options: 200,
  head: 200,
};

const RESPONSE_TRANSFORM_DECORATORS = [
  "UseInterceptors",
  "SerializeOptions",
  "UseFilters",
  "Redirect",
  "Render",
] as const;
const NEST_COMMON_MODULE = "@nestjs/common";

export function routeAllowsSafeAnonymousInference(
  route: DiscoveredRoute,
  checker: ts.TypeChecker,
): boolean {
  if (
    route.node.parameters.some((parameter) =>
      hasAnyResolvedDecorator(parameter, ["Res", "Response"], checker),
    )
  ) {
    return false;
  }

  if (hasAnyResolvedDecorator(route.node, RESPONSE_TRANSFORM_DECORATORS, checker)) {
    return false;
  }

  const controller = route.node.parent;
  return !(
    ts.isClassDeclaration(controller) &&
    hasAnyResolvedDecorator(controller, RESPONSE_TRANSFORM_DECORATORS, checker)
  );
}

function hasAnyResolvedDecorator(
  node: ts.HasDecorators,
  names: readonly string[],
  checker: ts.TypeChecker,
): boolean {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
  return decorators?.some((decorator) =>
    isResolvedDecoratorNamed(decorator, names, checker),
  ) ?? false;
}

function isResolvedDecoratorNamed(
  decorator: ts.Decorator,
  names: readonly string[],
  checker: ts.TypeChecker,
): boolean {
  const target = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;
  if (ts.isPropertyAccessExpression(target)) {
    return isNamespaceDecoratorReference(target, names, checker);
  }

  const resolved = resolveDecoratorSymbol(
    checker.getSymbolAtLocation(target),
    checker,
  );
  const terminalName = resolved.symbol?.getName();
  const decoratorName = terminalName && terminalName !== "unknown"
    ? terminalName
    : resolved.nestCommonImportedName;
  return (
    resolved.followedAlias &&
    resolved.hasNestCommonProvenance &&
    decoratorName !== undefined &&
    names.includes(decoratorName)
  );
}

function isNamespaceDecoratorReference(
  target: ts.PropertyAccessExpression,
  names: readonly string[],
  checker: ts.TypeChecker,
): boolean {
  if (!ts.isIdentifier(target.expression)) return false;

  const qualifierSymbol = checker.getSymbolAtLocation(target.expression);
  if (qualifierSymbol?.declarations?.some(ts.isNamespaceImport) !== true) {
    return false;
  }

  const decoratorSymbol = resolveDecoratorSymbol(
    checker.getSymbolAtLocation(target.name),
    checker,
  );
  const qualifierHasNestCommonProvenance =
    symbolHasNestCommonProvenance(qualifierSymbol);
  const terminalName = decoratorSymbol.symbol?.getName();
  const decoratorName = terminalName && terminalName !== "unknown"
    ? terminalName
    : decoratorSymbol.nestCommonImportedName ??
      (qualifierHasNestCommonProvenance ? target.name.text : undefined);
  return (
    decoratorName !== undefined &&
    names.includes(decoratorName) &&
    (qualifierHasNestCommonProvenance ||
      decoratorSymbol.hasNestCommonProvenance)
  );
}

function resolveDecoratorSymbol(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
): {
  symbol?: ts.Symbol;
  followedAlias: boolean;
  hasNestCommonProvenance: boolean;
  nestCommonImportedName?: string;
} {
  const seen = new Set<ts.Symbol>();
  let current = symbol;
  let followedAlias = false;
  let hasNestCommonProvenance = false;
  let nestCommonImportedName: string | undefined;

  while (current) {
    hasNestCommonProvenance ||= symbolHasNestCommonProvenance(current);
    nestCommonImportedName ??= nestCommonImportedNameForSymbol(current, checker);
    if (!(current.flags & ts.SymbolFlags.Alias)) break;
    if (seen.has(current)) break;
    seen.add(current);
    followedAlias = true;
    current = checker.getAliasedSymbol(current);
  }

  const terminalName = current?.getName();
  if (
    nestCommonImportedName !== undefined &&
    (terminalName === undefined || terminalName === "unknown")
  ) {
    hasNestCommonProvenance = true;
  }

  return {
    symbol: current,
    followedAlias,
    hasNestCommonProvenance,
    nestCommonImportedName,
  };
}

function symbolHasNestCommonProvenance(symbol: ts.Symbol): boolean {
  return symbol.declarations?.some(declarationHasNestCommonProvenance) === true;
}

function nestCommonImportedNameForSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  seenSymbols = new Set<ts.Symbol>(),
  seenModuleExports = new Map<ts.Symbol, Set<string>>(),
): string | undefined {
  if (seenSymbols.has(symbol)) return undefined;
  seenSymbols.add(symbol);

  for (const declaration of symbol.declarations ?? []) {
    if (!declarationHasNestCommonProvenance(declaration)) continue;
    if (ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration)) {
      return (declaration.propertyName ?? declaration.name).text;
    }
  }

  for (const declaration of symbol.declarations ?? []) {
    if (ts.isImportSpecifier(declaration)) {
      const importDeclaration = enclosingImportDeclaration(declaration);
      if (!importDeclaration || !ts.isStringLiteral(importDeclaration.moduleSpecifier)) {
        continue;
      }
      const moduleSymbol = checker.getSymbolAtLocation(
        importDeclaration.moduleSpecifier,
      );
      if (!moduleSymbol) continue;
      const importedName = (declaration.propertyName ?? declaration.name).text;
      const resolvedName = nestCommonExportedNameFromModule(
        moduleSymbol,
        importedName,
        checker,
        seenSymbols,
        seenModuleExports,
      );
      if (resolvedName) return resolvedName;
    }

    if (ts.isExportSpecifier(declaration)) {
      const exportDeclaration = enclosingExportDeclaration(declaration);
      const sourceName = (declaration.propertyName ?? declaration.name).text;
      if (
        exportDeclaration?.moduleSpecifier &&
        ts.isStringLiteral(exportDeclaration.moduleSpecifier)
      ) {
        const moduleSymbol = checker.getSymbolAtLocation(
          exportDeclaration.moduleSpecifier,
        );
        if (!moduleSymbol) continue;
        const resolvedName = nestCommonExportedNameFromModule(
          moduleSymbol,
          sourceName,
          checker,
          seenSymbols,
          seenModuleExports,
        );
        if (resolvedName) return resolvedName;
        continue;
      }

      const localSymbol = checker.getSymbolAtLocation(
        declaration.propertyName ?? declaration.name,
      );
      if (!localSymbol) continue;
      const resolvedName = nestCommonImportedNameForSymbol(
        localSymbol,
        checker,
        seenSymbols,
        seenModuleExports,
      );
      if (resolvedName) return resolvedName;
    }
  }
  return undefined;
}

function nestCommonExportedNameFromModule(
  moduleSymbol: ts.Symbol,
  exportedName: string,
  checker: ts.TypeChecker,
  seenSymbols: Set<ts.Symbol>,
  seenModuleExports: Map<ts.Symbol, Set<string>>,
): string | undefined {
  const seenNames = seenModuleExports.get(moduleSymbol) ?? new Set<string>();
  if (seenNames.has(exportedName)) return undefined;
  seenNames.add(exportedName);
  seenModuleExports.set(moduleSymbol, seenNames);

  for (const declaration of moduleSymbol.declarations ?? []) {
    if (!ts.isSourceFile(declaration)) continue;
    for (const statement of declaration.statements) {
      if (!ts.isExportDeclaration(statement)) continue;

      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          if (specifier.name.text !== exportedName) continue;
          const sourceName = (specifier.propertyName ?? specifier.name).text;
          if (
            statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier)
          ) {
            if (isNestCommonModuleSpecifier(statement.moduleSpecifier.text)) {
              return sourceName;
            }
            const nextModule = checker.getSymbolAtLocation(
              statement.moduleSpecifier,
            );
            if (!nextModule) continue;
            const resolvedName = nestCommonExportedNameFromModule(
              nextModule,
              sourceName,
              checker,
              seenSymbols,
              seenModuleExports,
            );
            if (resolvedName) return resolvedName;
            continue;
          }

          const localSymbol = checker.getSymbolAtLocation(
            specifier.propertyName ?? specifier.name,
          );
          if (!localSymbol) continue;
          const resolvedName = nestCommonImportedNameForSymbol(
            localSymbol,
            checker,
            seenSymbols,
            seenModuleExports,
          );
          if (resolvedName) return resolvedName;
        }
        continue;
      }

      if (
        !statement.exportClause &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        if (isNestCommonModuleSpecifier(statement.moduleSpecifier.text)) {
          return exportedName;
        }
        const nextModule = checker.getSymbolAtLocation(statement.moduleSpecifier);
        if (!nextModule) continue;
        const resolvedName = nestCommonExportedNameFromModule(
          nextModule,
          exportedName,
          checker,
          seenSymbols,
          seenModuleExports,
        );
        if (resolvedName) return resolvedName;
      }
    }
  }

  return undefined;
}

function enclosingImportDeclaration(
  node: ts.Node,
): ts.ImportDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function enclosingExportDeclaration(
  node: ts.Node,
): ts.ExportDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isExportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function declarationHasNestCommonProvenance(declaration: ts.Declaration): boolean {
  let current: ts.Node | undefined = declaration;
  while (current) {
    if (
      (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) &&
      current.moduleSpecifier &&
      ts.isStringLiteral(current.moduleSpecifier) &&
      isNestCommonModuleSpecifier(current.moduleSpecifier.text)
    ) {
      return true;
    }
    if (
      ts.isModuleDeclaration(current) &&
      ts.isStringLiteral(current.name) &&
      isNestCommonModuleSpecifier(current.name.text)
    ) {
      return true;
    }
    current = current.parent;
  }

  const sourcePath = declaration.getSourceFile().fileName.replaceAll("\\", "/");
  return sourcePath.includes("/node_modules/@nestjs/common/");
}

function isNestCommonModuleSpecifier(value: string): boolean {
  return value === NEST_COMMON_MODULE || value.startsWith(`${NEST_COMMON_MODULE}/`);
}

/** Result of response extraction for a single route. */
export interface ResponseExtractionResult {
  responses: ResponseModel[];
  diagnostics: Diagnostic[];
  schemas: Record<string, SchemaModel>;
}

export interface ResponseExtractionOptions {
  inferSafeAnonymousObjects?: boolean;
}

/**
 * Extract response metadata from a route handler.
 * - Infers status code from method default or @HttpCode()
 * - Infers response schema from return type when it's a reducible exported shape
 * - Emits EXTRACTOR_UNRESOLVED_RESPONSE for non-reducible shapes
 */
export function extractResponse(
  route: DiscoveredRoute,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  options: ResponseExtractionOptions = {},
): ResponseExtractionResult {
  const diagnostics: Diagnostic[] = [];
  const swaggerResponses = extractSwaggerResponses(route.node, checker);
  const statusCode = defaultStatusCodeForRoute(route, checker);
  const responses: ResponseModel[] = swaggerResponses.map((response) => ({
    status: response.status,
    description: response.description,
    schema: response.schema,
    inference: { status: "overridden" },
    openapi: response.openapi,
  }));

  if (responses.some((response) => response.status >= 200 && response.status < 300)) {
    return {
      responses: responses.sort((left, right) => left.status - right.status),
      diagnostics,
      schemas: {},
    };
  }

  // Infer return type
  const returnType = inferReturnType(route, checker, root, discoveredSchemas, options);

  if (returnType.unresolved) {
    diagnostics.push({
      severity: "warning",
      code: "EXTRACTOR_UNRESOLVED_RESPONSE",
      message: returnType.reason ?? `Response schema for ${route.id} cannot be safely inferred`,
      source: route.location,
      subject: route.id,
      suggestedOverridePath: `operations.${route.id}.responses`,
    });
  }

  responses.push({
    status: statusCode,
    description: returnType.unresolved
      ? "Response schema could not be inferred — provide an override in specord.config.ts"
      : undefined,
    schema: returnType.schema,
    inference: returnType.unresolved
      ? { status: "unresolved", reason: returnType.reason ?? "Return type not reducible" }
      : { status: "inferred" },
  });

  return {
    responses: responses.sort((left, right) => left.status - right.status),
    diagnostics,
    schemas: returnType.schemas,
  };
}

interface InferredReturnType {
  schema?: SchemaRef;
  schemas: Record<string, SchemaModel>;
  unresolved: boolean;
  reason?: string;
}

type TypeSchema = {
  type: SchemaRef;
  enum?: unknown[];
  nullable?: boolean;
  format?: string;
};

type SchemaFromTypeOptions = {
  nameHint?: string;
  allowAnonymousObject: boolean;
  preserveArrayItemMetadata?: boolean;
};

/**
 * Analyze the handler method's return type to infer a response schema.
 */
function inferReturnType(
  route: DiscoveredRoute,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  options: ResponseExtractionOptions,
): InferredReturnType {
  const resolved = resolveReturnPayloadType(
    route,
    checker,
    options.inferSafeAnonymousObjects === true,
  );
  if (!resolved) {
    return {
      schemas: {},
      unresolved: true,
      reason: "No callable signature found",
    };
  }

  if (resolved.nonCanonicalContainer) {
    return {
      schemas: {},
      unresolved: true,
      reason:
        `Return type uses a non-canonical ${resolved.nonCanonicalContainer} ` +
        "response container",
    };
  }

  const generatedSchemas: Record<string, SchemaModel> = {};
  const anonymousRoot = anonymousObjectRootBranch(resolved.type);
  const anonymousArrayRoot = isArrayContainingAnonymousObject(
    resolved.type,
    checker,
  );
  const hasUndefinedRootBranch =
    resolved.type.isUnion() &&
    resolved.type.types.some((part) => part.flags & ts.TypeFlags.Undefined);
  const unsupportedAnonymousRootUnion =
    options.inferSafeAnonymousObjects === true &&
    isUnsupportedAnonymousRootUnion(resolved.type);
  const safeAnonymousBoundaryCandidate =
    options.inferSafeAnonymousObjects === true &&
    (anonymousRoot !== undefined ||
      unsupportedAnonymousRootUnion ||
      anonymousArrayRoot);
  const safeAnonymousRouteAllowed =
    safeAnonymousBoundaryCandidate &&
    routeAllowsSafeAnonymousInference(route, checker);
  if (safeAnonymousBoundaryCandidate && !safeAnonymousRouteAllowed) {
    return {
      schemas: {},
      unresolved: true,
      reason: "Anonymous response crosses a manual or transformed response boundary",
    };
  }
  if (unsupportedAnonymousRootUnion) {
    return {
      schemas: {},
      unresolved: true,
      reason: "Anonymous response shape is not closed enough for safe inference",
    };
  }

  const safeAnonymousCandidate =
    options.inferSafeAnonymousObjects === true &&
    (anonymousRoot !== undefined || anonymousArrayRoot);
  const safeAnonymousShape =
    safeAnonymousCandidate &&
    !hasUndefinedRootBranch &&
    (anonymousRoot === undefined ||
      isSafeAnonymousRootType(anonymousRoot, checker)) &&
    isSafeAnonymousTypeBranch(
      resolved.type,
      checker,
      root,
      discoveredSchemas,
      new Set(),
    );
  if (safeAnonymousCandidate && !safeAnonymousShape) {
    return {
      schemas: {},
      unresolved: true,
      reason: "Anonymous response shape is not closed enough for safe inference",
    };
  }
  const schema = schemaFromType(
    resolved.type,
    checker,
    root,
    discoveredSchemas,
    generatedSchemas,
    new Set(),
    {
      nameHint: resolved.nameHint,
      allowAnonymousObject: safeAnonymousShape,
      preserveArrayItemMetadata: safeAnonymousShape,
    },
  );
  const schemaRef = typeSchemaToSchemaRef(schema, safeAnonymousShape);

  // Check if the return type is reducible
  if (schemaRef.kind === "unknown") {
    // Check if it's an anonymous object literal return
    const typeString = checker.typeToString(resolved.type);
    return {
      schemas: safeAnonymousCandidate ? {} : generatedSchemas,
      unresolved: true,
      reason: safeAnonymousCandidate
        ? "Anonymous response shape is not closed enough for safe inference"
        : `Return type "${typeString}" is not a reducible exported shape`,
    };
  }

  if (
    safeAnonymousShape &&
    !isCompleteResponseSchemaRef(schemaRef, discoveredSchemas, generatedSchemas)
  ) {
    return {
      schemas: {},
      unresolved: true,
      reason: "Anonymous response shape is not closed enough for safe inference",
    };
  }

  if (schemaRef.kind === "ref") {
    // Check if the referenced type is in our discovered schemas
    // or is a known primitive wrapper
    if (!discoveredSchemas[schemaRef.name] && !generatedSchemas[schemaRef.name]) {
      // It's a library type or external type we don't control
      return {
        schema: schemaRef,
        schemas: generatedSchemas,
        unresolved: true,
        reason: `Return type "${schemaRef.name}" is not a discovered schema under --root`,
      };
    }
  }

  if (schemaRef.kind === "array" && schemaRefContainsUnknown(schemaRef.items)) {
    const typeString = checker.typeToString(resolved.type);
    return {
      schema: schemaRef,
      schemas: generatedSchemas,
      unresolved: true,
      reason: `Return type "${typeString}" includes an array item type that is not a reducible exported shape`,
    };
  }

  return { schema: schemaRef, schemas: generatedSchemas, unresolved: false };
}

function isAnonymousObjectType(type: ts.Type): boolean {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    !!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) &&
    type.aliasSymbol === undefined
  );
}

function anonymousObjectRootBranch(type: ts.Type): ts.Type | undefined {
  if (isAnonymousObjectType(type)) return type;
  if (!type.isUnion()) return undefined;
  if (
    !type.types.some((part) => part.flags & ts.TypeFlags.Null) ||
    type.types.some((part) => part.flags & ts.TypeFlags.Undefined)
  ) {
    return undefined;
  }

  const activeTypes = type.types.filter(
    (part) => !(part.flags & ts.TypeFlags.Null),
  );
  return activeTypes.length === 1 && isAnonymousObjectType(activeTypes[0])
    ? activeTypes[0]
    : undefined;
}

function isUnsupportedAnonymousRootUnion(type: ts.Type): boolean {
  return (
    type.isUnion() &&
    type.types.some(isAnonymousObjectType) &&
    anonymousObjectRootBranch(type) === undefined
  );
}

function isArrayContainingAnonymousObject(
  type: ts.Type,
  checker: ts.TypeChecker,
  insideArray = false,
  seen = new Set<ts.Type>(),
): boolean {
  if (seen.has(type)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(type);

  if (insideArray && isAnonymousObjectType(type)) return true;
  if (type.isUnion()) {
    const branches = insideArray
      ? type.types
      : type.types.filter(
          (part) =>
            !(part.flags & ts.TypeFlags.Null) &&
            !(part.flags & ts.TypeFlags.Undefined),
        );
    if (!insideArray && branches.length !== 1) return false;
    return branches.some((part) =>
      isArrayContainingAnonymousObject(part, checker, insideArray, nextSeen),
    );
  }
  if (!checker.isArrayType(type)) return false;

  const [itemType] = getTypeArguments(type, checker);
  return (
    itemType !== undefined &&
    isArrayContainingAnonymousObject(itemType, checker, true, nextSeen)
  );
}

function isSafeAnonymousRootType(
  type: ts.Type,
  checker: ts.TypeChecker,
): boolean {
  if (
    !(type.flags & ts.TypeFlags.Object) ||
    !((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) ||
    type.aliasSymbol !== undefined ||
    type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Conditional)
  ) {
    return false;
  }

  const properties = checker.getPropertiesOfType(type);
  return (
    checker.getIndexInfosOfType(type).length === 0 &&
    checker.getSignaturesOfType(type, ts.SignatureKind.Call).length === 0 &&
    checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length === 0 &&
    properties.length > 0 &&
    properties.every((symbol) => !isMethodLikeSymbol(symbol))
  );
}

function isSafeAnonymousTypeBranch(
  type: ts.Type,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  visiting: Set<ts.Type>,
): boolean {
  if (
    type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Conditional)
  ) {
    return false;
  }

  if (
    type.flags &
    (ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean | ts.TypeFlags.Null)
  ) {
    return true;
  }

  if (literalValueFromType(type, checker) !== undefined) return true;

  if (type.isUnion()) {
    const activeTypes = type.types.filter(
      (part) =>
        !(part.flags & ts.TypeFlags.Null) &&
        !(part.flags & ts.TypeFlags.Undefined),
    );
    return (
      activeTypes.length > 0 &&
      (literalEnumFromTypes(activeTypes, checker) !== undefined ||
        (activeTypes.length === 1 &&
          isSafeAnonymousTypeBranch(
            activeTypes[0],
            checker,
            root,
            discoveredSchemas,
            visiting,
          )))
    );
  }

  if (checker.isArrayType(type)) {
    const [itemType] = getTypeArguments(type, checker);
    return (
      itemType !== undefined &&
      isSafeAnonymousTypeBranch(itemType, checker, root, discoveredSchemas, visiting)
    );
  }

  if (schemaNameForType(type) === "Date") {
    return isTypeScriptLibType(type, "Date");
  }

  if (!(type.flags & ts.TypeFlags.Object) || visiting.has(type)) return false;

  const symbol = schemaSymbolForType(type);
  if (
    symbol?.declarations?.some((declaration) => ts.isClassDeclaration(declaration)) ||
    checker.getIndexInfosOfType(type).length > 0 ||
    checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
    checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
  ) {
    return false;
  }
  const properties = checker.getPropertiesOfType(type);
  if (properties.length === 0 || properties.some(isMethodLikeSymbol)) return false;

  visiting.add(type);
  const complete = properties.every((property) => {
    const location = firstDeclaration(property) ?? type.symbol?.valueDeclaration;
    return (
      location !== undefined &&
      isSafeAnonymousTypeBranch(
        checker.getTypeOfSymbolAtLocation(property, location),
        checker,
        root,
        discoveredSchemas,
        visiting,
      )
    );
  });
  visiting.delete(type);
  return complete;
}

function isCompleteResponseSchemaRef(
  ref: SchemaRef,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  visitingSchemas = new Set<string>(),
): boolean {
  switch (ref.kind) {
    case "unknown":
      return false;
    case "primitive":
      return true;
    case "array":
      return isCompleteResponseSchemaRef(
        ref.items,
        discoveredSchemas,
        generatedSchemas,
        visitingSchemas,
      );
    case "ref": {
      if (visitingSchemas.has(ref.name)) return false;
      const schema = discoveredSchemas[ref.name] ?? generatedSchemas[ref.name];
      if (!schema) return false;

      visitingSchemas.add(ref.name);
      const complete = isCompleteResponseSchemaModel(
        schema,
        discoveredSchemas,
        generatedSchemas,
        visitingSchemas,
      );
      visitingSchemas.delete(ref.name);
      return complete;
    }
    case "inline":
      return isCompleteOpenApiSchema(
        ref.schema,
        discoveredSchemas,
        generatedSchemas,
        visitingSchemas,
      );
  }
}

function isCompleteResponseSchemaModel(
  schema: SchemaModel,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  visitingSchemas: Set<string>,
): boolean {
  if (
    Object.keys(schema.properties).length === 0 ||
    (schema.inference.status !== "inferred" && schema.inference.status !== "overridden") ||
    !hasClosedAdditionalProperties(schema.openapi)
  ) {
    return false;
  }

  return Object.values(schema.properties).every((property) =>
    isCompleteResponseSchemaRef(
      property.type,
      discoveredSchemas,
      generatedSchemas,
      visitingSchemas,
    ),
  );
}

export function isCompleteOpenApiSchema(
  schema: OpenApiSchemaObject,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  visitingSchemas: Set<string>,
): boolean {
  const value = schema as Record<string, unknown>;
  if (!hasClosedAdditionalProperties(schema)) return false;
  const ref = value.$ref;
  if (typeof ref === "string") {
    const name = ref.match(/^#\/components\/schemas\/(.+)$/)?.[1];
    return (
      name !== undefined &&
      isCompleteResponseSchemaRef(
        { kind: "ref", name },
        discoveredSchemas,
        generatedSchemas,
        visitingSchemas,
      )
    );
  }

  if (Array.isArray(value.anyOf)) return false;
  if (Array.isArray(value.oneOf)) {
    if (value.oneOf.length !== 2) return false;
    const [first, second] = value.oneOf;
    const firstIsNull = isNullOpenApiSchema(first);
    const secondIsNull = isNullOpenApiSchema(second);
    return (
      firstIsNull !== secondIsNull &&
      isCompleteOpenApiSchema(
        (firstIsNull ? second : first) as OpenApiSchemaObject,
        discoveredSchemas,
        generatedSchemas,
        visitingSchemas,
      )
    );
  }

  if (value.type === "array") {
    return (
      value.items !== undefined &&
      isCompleteOpenApiSchema(
        value.items as OpenApiSchemaObject,
        discoveredSchemas,
        generatedSchemas,
        visitingSchemas,
      )
    );
  }

  if (value.type === "object") {
    const properties = value.properties;
    return (
      properties !== undefined &&
      Object.keys(properties as Record<string, unknown>).length > 0 &&
      Object.values(properties as Record<string, OpenApiSchemaObject>).every((property) =>
        isCompleteOpenApiSchema(
          property,
          discoveredSchemas,
          generatedSchemas,
          visitingSchemas,
        ),
      )
    );
  }

  if (typeof value.type === "string") return value.type !== "object";
  if (Array.isArray(value.type)) {
    const nonNullTypes = value.type.filter((entry) => entry !== "null");
    if (nonNullTypes.length !== 1 || !value.type.includes("null")) return false;
    return isCompleteOpenApiSchema(
      { ...schema, type: nonNullTypes[0] } as OpenApiSchemaObject,
      discoveredSchemas,
      generatedSchemas,
      visitingSchemas,
    );
  }

  return false;
}

function hasClosedAdditionalProperties(
  schema: OpenApiSchemaObject | undefined,
): boolean {
  if (!schema) return true;
  const additionalProperties = (schema as Record<string, unknown>).additionalProperties;
  return additionalProperties === undefined || additionalProperties === false;
}

function isNullOpenApiSchema(schema: unknown): boolean {
  return (
    typeof schema === "object" &&
    schema !== null &&
    (schema as Record<string, unknown>).type === "null"
  );
}

function defaultStatusCodeForRoute(
  route: DiscoveredRoute,
  checker: ts.TypeChecker,
): number {
  let statusCode = DEFAULT_STATUS[route.method] ?? 200;

  const httpCodeDecorator = findDecorator(route.node, "HttpCode");
  if (httpCodeDecorator) {
    const codeArg = extractHttpCodeArg(httpCodeDecorator, checker);
    if (codeArg !== undefined) {
      statusCode = codeArg;
    }
  }

  return statusCode;
}

function schemaRefContainsUnknown(ref: SchemaRef): boolean {
  switch (ref.kind) {
    case "unknown":
      return true;
    case "array":
      return schemaRefContainsUnknown(ref.items);
    case "inline":
    case "ref":
    case "primitive":
      return false;
  }
}

function resolveReturnPayloadType(
  route: DiscoveredRoute,
  checker: ts.TypeChecker,
  requireCanonicalContainers: boolean,
): {
  type: ts.Type;
  nameHint?: string;
  nonCanonicalContainer?: "Promise" | "Observable";
} | undefined {
  if (route.node.type) {
    if (requireCanonicalContainers) {
      return unwrapResponseContainerType(
        checker.getTypeFromTypeNode(route.node.type),
        checker,
        true,
      );
    }

    const unwrappedTypeNode = unwrapLegacyResponseContainerTypeNode(route.node.type);
    return {
      type: checker.getTypeFromTypeNode(unwrappedTypeNode),
      nameHint: schemaNameFromTypeNode(unwrappedTypeNode),
    };
  }

  const signature = checker.getSignatureFromDeclaration(route.node);
  if (!signature) return undefined;

  const returnType = checker.getReturnTypeOfSignature(signature);
  return unwrapResponseContainerType(
    returnType,
    checker,
    requireCanonicalContainers,
  );
}

function unwrapLegacyResponseContainerTypeNode(
  typeNode: ts.TypeNode,
): ts.TypeNode {
  if (!ts.isTypeReferenceNode(typeNode) || typeNode.typeArguments?.length !== 1) {
    return typeNode;
  }

  const name = typeNode.typeName.getText();
  if (name !== "Promise" && name !== "Observable") {
    return typeNode;
  }

  return unwrapLegacyResponseContainerTypeNode(
    typeNode.typeArguments[0],
  );
}

function unwrapResponseContainerType(
  type: ts.Type,
  checker: ts.TypeChecker,
  requireCanonicalContainers: boolean,
  seen = new Set<ts.Type>(),
): {
  type: ts.Type;
  nonCanonicalContainer?: "Promise" | "Observable";
} {
  if (seen.has(type)) return { type };
  const nextSeen = new Set(seen);
  nextSeen.add(type);

  const symbolName = type.getSymbol()?.getName();
  const typeArguments = getTypeArguments(type, checker);
  if (
    (symbolName === "Promise" || symbolName === "Observable") &&
    typeArguments.length === 1
  ) {
    if (
      requireCanonicalContainers &&
      !isCanonicalResponseContainerType(type, symbolName)
    ) {
      return { type, nonCanonicalContainer: symbolName };
    }
    return unwrapResponseContainerType(
      typeArguments[0],
      checker,
      requireCanonicalContainers,
      nextSeen,
    );
  }

  return { type };
}

function isCanonicalResponseContainerType(
  type: ts.Type,
  name: "Promise" | "Observable",
): boolean {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (name === "Promise") return isTypeScriptLibSymbol(symbol, name);

  return (
    symbol?.getName() === name &&
    symbol.declarations !== undefined &&
    symbol.declarations.length > 0 &&
    symbol.declarations.some((declaration) =>
      declarationComesFromInstalledPackage(declaration, "rxjs"),
    )
  );
}

function isTypeScriptLibType(type: ts.Type, name: string): boolean {
  return isTypeScriptLibSymbol(schemaSymbolForType(type), name);
}

function isTypeScriptLibSymbol(
  symbol: ts.Symbol | undefined,
  name: string,
): boolean {
  return (
    symbol?.getName() === name &&
    symbol.declarations?.some((declaration) => {
      const sourceFile = declaration.getSourceFile();
      return (
        sourceFile.hasNoDefaultLib &&
        /^lib(?:\..+)?\.d\.ts$/i.test(path.basename(sourceFile.fileName))
      );
    }) === true
  );
}

function declarationComesFromInstalledPackage(
  declaration: ts.Declaration,
  packageName: string,
): boolean {
  const sourcePath = declaration
    .getSourceFile()
    .fileName.replaceAll("\\", "/")
    .toLowerCase();
  return sourcePath.includes(
    `/node_modules/${packageName.toLowerCase()}/`,
  );
}

function schemaFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  resolving: Set<string>,
  options: SchemaFromTypeOptions,
): TypeSchema {
  const union = unionSchemaFromType(
    type,
    checker,
    root,
    discoveredSchemas,
    generatedSchemas,
    resolving,
    options,
  );
  if (union) return union;

  const literal = literalSchemaFromType(type, checker);
  if (literal) return literal;

  if (type.flags & ts.TypeFlags.String) {
    return { type: { kind: "primitive", type: "string" } };
  }
  if (type.flags & ts.TypeFlags.Number) {
    return { type: { kind: "primitive", type: "number" } };
  }
  if (type.flags & ts.TypeFlags.Boolean) {
    return { type: { kind: "primitive", type: "boolean" } };
  }
  if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
    return { type: { kind: "primitive", type: "null" } };
  }
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) {
    return { type: { kind: "unknown" } };
  }

  if (checker.isArrayType(type)) {
    const [itemType] = getTypeArguments(type, checker);
    const itemSchema = itemType
      ? schemaFromType(
          itemType,
          checker,
          root,
          discoveredSchemas,
          generatedSchemas,
          resolving,
          {
            allowAnonymousObject: true,
            preserveArrayItemMetadata: options.preserveArrayItemMetadata,
          },
        )
      : undefined;
    return {
      type: {
        kind: "array",
        items: itemSchema
          ? typeSchemaToSchemaRef(
              itemSchema,
              options.preserveArrayItemMetadata === true,
            )
          : { kind: "unknown" },
      },
    };
  }

  const schemaName = schemaNameForType(type) ?? options.nameHint;
  if (schemaName === "Date") {
    return { type: { kind: "primitive", type: "string" }, format: "date-time" };
  }
  if (schemaName && discoveredSchemas[schemaName]) {
    return { type: { kind: "ref", name: schemaName } };
  }
  if (schemaName && generatedSchemas[schemaName]) {
    return { type: { kind: "ref", name: schemaName } };
  }

  const schemaSymbol = schemaSymbolForType(type);
  const canGenerateNamedSchema =
    schemaName !== undefined &&
    schemaSymbol !== undefined &&
    isSchemaDeclarationSymbol(schemaSymbol);

  if (canGenerateNamedSchema) {
    if (resolving.has(schemaName)) {
      return { type: { kind: "ref", name: schemaName } };
    }

    resolving.add(schemaName);
    const schema = schemaModelFromObjectType(
      schemaName,
      type,
      checker,
      root,
      discoveredSchemas,
      generatedSchemas,
      resolving,
      schemaSymbol,
      options.preserveArrayItemMetadata === true,
    );
    resolving.delete(schemaName);

    if (schema) {
      generatedSchemas[schemaName] = schema;
      return { type: { kind: "ref", name: schemaName } };
    }
  }

  if (options.allowAnonymousObject) {
    const properties = propertiesFromType(
      type,
      checker,
      root,
      discoveredSchemas,
      generatedSchemas,
      resolving,
      options.preserveArrayItemMetadata === true,
    );
    if (properties) {
      return {
        type: {
          kind: "inline",
          schema: propertiesToOpenApiObject(
            properties.properties,
            properties.required,
          ),
        },
      };
    }
  }

  return { type: { kind: "unknown" } };
}

function unionSchemaFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  resolving: Set<string>,
  options: SchemaFromTypeOptions,
): TypeSchema | undefined {
  if (!type.isUnion()) return undefined;

  const nullable = type.types.some((part) => part.flags & ts.TypeFlags.Null);
  const activeTypes = type.types.filter(
    (part) =>
      !(part.flags & ts.TypeFlags.Null) &&
      !(part.flags & ts.TypeFlags.Undefined),
  );

  if (activeTypes.length === 0) {
    return { type: { kind: "primitive", type: "null" } };
  }

  const literalEnum = literalEnumFromTypes(activeTypes, checker);
  if (literalEnum) {
    return {
      type: { kind: "primitive", type: literalEnum.type },
      enum: literalEnum.values,
      nullable,
    };
  }

  if (activeTypes.length === 1) {
    const child = schemaFromType(
      activeTypes[0],
      checker,
      root,
      discoveredSchemas,
      generatedSchemas,
      resolving,
      options,
    );
    return { ...child, nullable: child.nullable || nullable };
  }

  const oneOfSchemas = activeTypes.map((part) =>
    typeSchemaToOpenApi(
      schemaFromType(
        part,
        checker,
        root,
        discoveredSchemas,
        generatedSchemas,
        resolving,
        {
          allowAnonymousObject: true,
          preserveArrayItemMetadata: options.preserveArrayItemMetadata,
        },
      ),
    ),
  );
  if (nullable) {
    oneOfSchemas.push({ type: "null" });
  }

  return { type: { kind: "inline", schema: { oneOf: oneOfSchemas } } };
}

function literalSchemaFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
): TypeSchema | undefined {
  const value = literalValueFromType(type, checker);
  if (value === undefined) return undefined;

  const primitive = primitiveTypeForLiteral(value);
  if (!primitive) return undefined;

  return {
    type: { kind: "primitive", type: primitive },
    enum: [value],
  };
}

function schemaModelFromObjectType(
  name: string,
  type: ts.Type,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  resolving: Set<string>,
  symbol: ts.Symbol,
  preserveArrayItemMetadata: boolean,
): SchemaModel | undefined {
  const extracted = propertiesFromType(
    type,
    checker,
    root,
    discoveredSchemas,
    generatedSchemas,
    resolving,
    preserveArrayItemMetadata,
  );
  if (!extracted) return undefined;

  return {
    name,
    properties: extracted.properties,
    required: extracted.required,
    source: sourceLocationForSymbol(symbol, root),
    inference: { status: "inferred" },
  };
}

function propertiesFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  resolving: Set<string>,
  preserveArrayItemMetadata: boolean,
): {
  properties: Record<string, PropertyModel>;
  required: string[];
} | undefined {
  const symbols = checker.getPropertiesOfType(type).filter((symbol) =>
    !isMethodLikeSymbol(symbol),
  );
  if (symbols.length === 0) return undefined;

  const properties: Record<string, PropertyModel> = {};
  const required: string[] = [];

  for (const symbol of symbols) {
    const declaration = firstDeclaration(symbol);
    const location = declaration ?? type.symbol?.valueDeclaration;
    if (!location) continue;

    const propertyName = symbol.getName();
    if (propertyName === "__type") continue;

    const propertyType = checker.getTypeOfSymbolAtLocation(symbol, location);
    const schema = schemaFromType(
      propertyType,
      checker,
      root,
      discoveredSchemas,
      generatedSchemas,
      resolving,
      {
        allowAnonymousObject: true,
        preserveArrayItemMetadata,
      },
    );

    properties[propertyName] = {
      type: schema.type,
      enum: schema.enum,
      format: schema.format,
      nullable: schema.nullable || undefined,
      inference: { status: "inferred" },
    };

    if (!isOptionalProperty(symbol, propertyType)) {
      required.push(propertyName);
    }
  }

  return { properties, required };
}

function typeSchemaToOpenApi(schema: TypeSchema): OpenApiSchemaObject {
  const next: Record<string, unknown> = schemaRefToOpenApi(schema.type);
  if (schema.enum !== undefined) next.enum = schema.enum;
  if (schema.format !== undefined) next.format = schema.format;
  return (schema.nullable ? applyNullableOpenApi(next) : next) as OpenApiSchemaObject;
}

function typeSchemaToSchemaRef(
  schema: TypeSchema,
  preserveMetadata: boolean,
): SchemaRef {
  if (
    !preserveMetadata ||
    (schema.enum === undefined &&
      schema.format === undefined &&
      schema.nullable !== true)
  ) {
    return schema.type;
  }

  return { kind: "inline", schema: typeSchemaToOpenApi(schema) };
}

function propertiesToOpenApiObject(
  properties: Record<string, PropertyModel>,
  required: string[],
): OpenApiSchemaObject {
  return {
    type: "object",
    ...(required.length > 0 ? { required: [...required] } : {}),
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [
        name,
        propertyToOpenApi(property),
      ]),
    ),
  };
}

function propertyToOpenApi(property: PropertyModel): OpenApiSchemaObject {
  const next: Record<string, unknown> = schemaRefToOpenApi(property.type);
  if (property.enum !== undefined) next.enum = property.enum;
  if (property.format !== undefined) next.format = property.format;
  return (property.nullable ? applyNullableOpenApi(next) : next) as OpenApiSchemaObject;
}

function applyNullableOpenApi(schema: Record<string, unknown>): Record<string, unknown> {
  const next = { ...schema };
  if (Array.isArray(next.enum) && !next.enum.includes(null)) {
    next.enum = [...next.enum, null];
  }

  if (typeof next.type === "string") {
    next.type = [next.type, "null"];
    return next;
  }

  if (Array.isArray(next.type)) {
    next.type = next.type.includes("null")
      ? next.type
      : [...next.type, "null"];
    return next;
  }

  return { oneOf: [next, { type: "null" }] };
}

function schemaRefToOpenApi(ref: SchemaRef): OpenApiSchemaObject {
  switch (ref.kind) {
    case "primitive":
      return { type: ref.type };
    case "array":
      return { type: "array", items: schemaRefToOpenApi(ref.items) };
    case "inline":
      return cloneOpenApiSchema(ref.schema);
    case "ref":
      return { $ref: `#/components/schemas/${ref.name}` };
    case "unknown":
      return {};
  }
}

function schemaNameFromTypeNode(typeNode: ts.TypeNode): string | undefined {
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    return isInternalTypeName(name) ? undefined : name.split(".").at(-1);
  }

  return undefined;
}

function schemaNameForType(type: ts.Type): string | undefined {
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
  return name && !isInternalTypeName(name) ? name : undefined;
}

function schemaSymbolForType(type: ts.Type): ts.Symbol | undefined {
  return type.aliasSymbol ?? type.getSymbol();
}

function isSchemaDeclarationSymbol(symbol: ts.Symbol): boolean {
  return symbol.declarations?.some((declaration) =>
    ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration),
  ) ?? false;
}

function isInternalTypeName(name: string): boolean {
  return [
    "__object",
    "__type",
    "Array",
    "Promise",
    "Observable",
    "Record",
  ].includes(name);
}

function getTypeArguments(
  type: ts.Type,
  checker: ts.TypeChecker,
): readonly ts.Type[] {
  return checker.getTypeArguments(type as ts.TypeReference);
}

function literalEnumFromTypes(
  types: readonly ts.Type[],
  checker: ts.TypeChecker,
): { type: "string" | "number" | "boolean"; values: unknown[] } | undefined {
  const values: unknown[] = [];
  let primitive: "string" | "number" | "boolean" | undefined;

  for (const type of types) {
    const value = literalValueFromType(type, checker);
    const nextPrimitive = primitiveTypeForLiteral(value);
    if (!nextPrimitive) return undefined;
    if (primitive && primitive !== nextPrimitive) return undefined;
    primitive = nextPrimitive;
    values.push(value);
  }

  return primitive ? { type: primitive, values } : undefined;
}

function literalValueFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
): unknown {
  if (type.isStringLiteral()) return type.value;
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    return (type as ts.NumberLiteralType).value;
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    const text = checker.typeToString(type);
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return undefined;
}

function primitiveTypeForLiteral(
  value: unknown,
): "string" | "number" | "boolean" | undefined {
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return undefined;
  }
}

function isMethodLikeSymbol(symbol: ts.Symbol): boolean {
  return symbol.declarations?.some((declaration) =>
    ts.isMethodSignature(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isFunctionDeclaration(declaration),
  ) ?? false;
}

function isOptionalProperty(symbol: ts.Symbol, type: ts.Type): boolean {
  return (
    !!(symbol.flags & ts.SymbolFlags.Optional) ||
    (type.isUnion() &&
      type.types.some((part) => part.flags & ts.TypeFlags.Undefined))
  );
}

function sourceLocationForSymbol(
  symbol: ts.Symbol,
  root: string,
): SourceLocation | undefined {
  const declaration = firstDeclaration(symbol);
  if (!declaration) return undefined;

  const sourceFile = declaration.getSourceFile();
  const filePath = sourceFile.fileName.replace(/\\/g, "/");
  const relativeFile = path.relative(root, filePath).replace(/\\/g, "/");
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    declaration.getStart(),
  );

  return { file: relativeFile, line: line + 1 };
}

function firstDeclaration(symbol: ts.Symbol): ts.Declaration | undefined {
  return symbol.declarations?.[0] ?? symbol.valueDeclaration;
}

/**
 * Extract numeric argument from @HttpCode(number).
 */
function extractHttpCodeArg(
  decorator: ts.Decorator,
  checker: ts.TypeChecker,
): number | undefined {
  if (!ts.isCallExpression(decorator.expression)) return undefined;
  const args = decorator.expression.arguments;
  if (args.length === 0) return undefined;

  const firstArg = args[0];
  const value = literalValue(firstArg, checker);
  if (typeof value === "number") return value;
  return httpStatusValueFromExpression(firstArg);
}
