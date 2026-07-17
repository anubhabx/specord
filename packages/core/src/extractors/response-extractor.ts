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
import { findDecorator, extractDecoratorStringArg } from "./controller-discovery.js";
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
  const resolved = resolveReturnPayloadType(route, checker);
  if (!resolved) {
    return {
      schemas: {},
      unresolved: true,
      reason: "No callable signature found",
    };
  }

  const generatedSchemas: Record<string, SchemaModel> = {};
  const safeAnonymousCandidate =
    options.inferSafeAnonymousObjects === true &&
    isAnonymousObjectType(resolved.type);
  const safeAnonymousRoot =
    safeAnonymousCandidate &&
    isSafeAnonymousRootType(resolved.type, checker) &&
    isSafeAnonymousTypeBranch(
      resolved.type,
      checker,
      root,
      discoveredSchemas,
      new Set(),
    );
  const schema = schemaFromType(
    resolved.type,
    checker,
    root,
    discoveredSchemas,
    generatedSchemas,
    new Set(),
    {
      nameHint: resolved.nameHint,
      allowAnonymousObject: safeAnonymousRoot,
    },
  );
  const schemaRef = schema.type;

  // Check if the return type is reducible
  if (schemaRef.kind === "unknown") {
    // Check if it's an anonymous object literal return
    const typeString = checker.typeToString(resolved.type);
    return {
      schemas: generatedSchemas,
      unresolved: true,
      reason: safeAnonymousCandidate
        ? "Anonymous response shape is not closed enough for safe inference"
        : `Return type "${typeString}" is not a reducible exported shape`,
    };
  }

  if (
    safeAnonymousRoot &&
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

  if (schemaNameForType(type) === "Date") return true;

  if (!(type.flags & ts.TypeFlags.Object) || visiting.has(type)) return false;

  const symbol = schemaSymbolForType(type);
  const schemaName = schemaNameForType(type);
  if (schemaName && discoveredSchemas[schemaName]) return true;
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
): boolean {
  switch (ref.kind) {
    case "unknown":
      return false;
    case "primitive":
      return true;
    case "array":
      return isCompleteResponseSchemaRef(ref.items, discoveredSchemas, generatedSchemas);
    case "ref":
      return Boolean(discoveredSchemas[ref.name] || generatedSchemas[ref.name]);
    case "inline":
      return isCompleteOpenApiSchema(ref.schema, discoveredSchemas, generatedSchemas);
  }
}

function isCompleteOpenApiSchema(
  schema: OpenApiSchemaObject,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
): boolean {
  const value = schema as Record<string, unknown>;
  const ref = value.$ref;
  if (typeof ref === "string") {
    const name = ref.match(/^#\/components\/schemas\/(.+)$/)?.[1];
    return name !== undefined && Boolean(discoveredSchemas[name] || generatedSchemas[name]);
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
      )
    );
  }

  if (value.type === "object") {
    const properties = value.properties;
    return (
      properties !== undefined &&
      Object.keys(properties as Record<string, unknown>).length > 0 &&
      Object.values(properties as Record<string, OpenApiSchemaObject>).every((property) =>
        isCompleteOpenApiSchema(property, discoveredSchemas, generatedSchemas),
      )
    );
  }

  if (typeof value.type === "string") return value.type !== "object";
  if (Array.isArray(value.type)) {
    const nonNullTypes = value.type.filter((entry) => entry !== "null");
    return nonNullTypes.length === 1 && value.type.includes("null");
  }

  return false;
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
): { type: ts.Type; nameHint?: string } | undefined {
  if (route.node.type) {
    const payloadTypeNode = unwrapResponseContainerTypeNode(route.node.type);
    return {
      type: checker.getTypeFromTypeNode(payloadTypeNode),
      nameHint: schemaNameFromTypeNode(payloadTypeNode),
    };
  }

  const signature = checker.getSignatureFromDeclaration(route.node);
  if (!signature) return undefined;

  const returnType = checker.getReturnTypeOfSignature(signature);
  return { type: unwrapResponseContainerType(returnType, checker) };
}

function unwrapResponseContainerTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
  if (!ts.isTypeReferenceNode(typeNode) || typeNode.typeArguments?.length !== 1) {
    return typeNode;
  }

  const name = typeNode.typeName.getText();
  if (name !== "Promise" && name !== "Observable") {
    return typeNode;
  }

  return unwrapResponseContainerTypeNode(typeNode.typeArguments[0]);
}

function unwrapResponseContainerType(
  type: ts.Type,
  checker: ts.TypeChecker,
): ts.Type {
  const symbolName = type.getSymbol()?.getName();
  const typeArguments = getTypeArguments(type, checker);
  if (
    (symbolName === "Promise" || symbolName === "Observable") &&
    typeArguments.length === 1
  ) {
    return unwrapResponseContainerType(typeArguments[0], checker);
  }

  return type;
}

function schemaFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
  root: string,
  discoveredSchemas: Record<string, SchemaModel>,
  generatedSchemas: Record<string, SchemaModel>,
  resolving: Set<string>,
  options: {
    nameHint?: string;
    allowAnonymousObject: boolean;
  },
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
    return {
      type: {
        kind: "array",
        items: itemType
          ? schemaFromType(
              itemType,
              checker,
              root,
              discoveredSchemas,
              generatedSchemas,
              resolving,
              { allowAnonymousObject: true },
            ).type
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
  options: {
    nameHint?: string;
    allowAnonymousObject: boolean;
  },
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
        { allowAnonymousObject: true },
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
): SchemaModel | undefined {
  const extracted = propertiesFromType(
    type,
    checker,
    root,
    discoveredSchemas,
    generatedSchemas,
    resolving,
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
      { allowAnonymousObject: true },
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
