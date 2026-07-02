// ============================================================================
// NestJS Swagger compatibility helpers
// Static AST harvesting only; Specord does not import or execute @nestjs/swagger.
// ============================================================================

import ts from "typescript";
import type {
  OpenApiSchemaObject,
  OpenApiResponseObject,
  OpenApiResponsesObject,
  OpenApiSecurityRequirementObject,
  OpenApiSecuritySchemeObject,
  ParameterModel,
  PropertyModel,
  SchemaRef,
} from "@specord/types";
import { cloneJsonValue, cloneSchemaRef } from "../internal/clone.js";

const API_RESPONSE_STATUS: Record<string, number> = {
  ApiOkResponse: 200,
  ApiCreatedResponse: 201,
  ApiAcceptedResponse: 202,
  ApiNoContentResponse: 204,
  ApiBadRequestResponse: 400,
  ApiUnauthorizedResponse: 401,
  ApiForbiddenResponse: 403,
  ApiNotFoundResponse: 404,
  ApiConflictResponse: 409,
  ApiUnprocessableEntityResponse: 422,
  ApiInternalServerErrorResponse: 500,
};

const NEST_HTTP_STATUS: Record<string, number> = {
  CONTINUE: 100,
  SWITCHING_PROTOCOLS: 101,
  PROCESSING: 102,
  EARLYHINTS: 103,
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NON_AUTHORITATIVE_INFORMATION: 203,
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  PARTIAL_CONTENT: 206,
  AMBIGUOUS: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  REQUESTED_RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  I_AM_A_TEAPOT: 418,
  MISDIRECTED: 421,
  UNPROCESSABLE_ENTITY: 422,
  FAILED_DEPENDENCY: 424,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
};

export type SwaggerOperationMetadata = {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
};

export type SwaggerResponseMetadata = {
  status: number;
  description?: string;
  schema?: SchemaRef;
  openapi: OpenApiResponseObject;
};

export type SwaggerPropertyMetadata = Partial<
  Pick<
    PropertyModel,
    | "description"
    | "default"
    | "example"
    | "examples"
    | "enum"
    | "format"
    | "deprecated"
    | "readOnly"
    | "writeOnly"
    | "nullable"
    | "constraints"
  >
> & {
  type?: SchemaRef;
  required?: boolean;
};

export type SwaggerSecurityMetadata = {
  requirements: OpenApiSecurityRequirementObject[];
  schemes: Record<string, OpenApiSecuritySchemeObject>;
};

export function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  return undefined;
}

export function getDecoratorsByName(
  node: ts.HasDecorators,
  names: ReadonlySet<string>,
): ts.Decorator[] {
  const decorators = ts.canHaveDecorators(node)
    ? ts.getDecorators(node)
    : undefined;

  if (!decorators) return [];

  return decorators.filter((decorator) => {
    const name = getDecoratorName(decorator);
    return name !== undefined && names.has(name);
  });
}

export function extractSwaggerTags(node: ts.HasDecorators): string[] {
  const tags: string[] = [];

  for (const decorator of getDecoratorsByName(node, new Set(["ApiTags"]))) {
    const args = getDecoratorArgs(decorator);
    for (const arg of args) {
      if (ts.isStringLiteral(arg)) {
        tags.push(arg.text);
      }
    }
  }

  return tags;
}

export function extractSwaggerOperation(
  node: ts.HasDecorators,
): SwaggerOperationMetadata {
  const decorator = getDecoratorsByName(node, new Set(["ApiOperation"]))[0];
  const options = decorator ? getFirstObjectArg(decorator) : undefined;

  if (!options) return {};

  return {
    operationId: readStringOption(options, "operationId"),
    summary: readStringOption(options, "summary"),
    description: readStringOption(options, "description"),
    deprecated: readBooleanOption(options, "deprecated"),
  };
}

export function extractSwaggerSecurity(
  node: ts.HasDecorators,
): OpenApiSecurityRequirementObject[] {
  return extractSwaggerSecurityMetadata(node).requirements;
}

export function extractSwaggerSecurityMetadata(
  node: ts.HasDecorators,
): SwaggerSecurityMetadata {
  const requirements: OpenApiSecurityRequirementObject[] = [];
  const schemes: Record<string, OpenApiSecuritySchemeObject> = {};

  for (const decorator of getDecoratorsByName(
    node,
    new Set(["ApiBearerAuth", "ApiSecurity"]),
  )) {
    const name = getDecoratorName(decorator);
    const args = getDecoratorArgs(decorator);
    const firstString = args.find(ts.isStringLiteral)?.text;

    if (name === "ApiBearerAuth") {
      const schemeName = firstString ?? "bearerAuth";
      requirements.push({ [schemeName]: [] });
      schemes[schemeName] = {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      };
    } else if (name === "ApiSecurity" && firstString) {
      requirements.push({ [firstString]: [] });
    }
  }

  return { requirements, schemes };
}

export function extractSwaggerResponses(
  node: ts.HasDecorators,
  checker?: ts.TypeChecker,
): SwaggerResponseMetadata[] {
  const names = new Set(["ApiResponse", ...Object.keys(API_RESPONSE_STATUS)]);
  const responses: SwaggerResponseMetadata[] = [];

  for (const decorator of getDecoratorsByName(node, names)) {
    const decoratorName = getDecoratorName(decorator);
    if (!decoratorName) continue;

    const options = getFirstObjectArg(decorator);
    const status =
      decoratorName === "ApiResponse"
        ? readNumberOption(options, "status", checker)
        : API_RESPONSE_STATUS[decoratorName];

    if (!status) continue;

    const description =
      readStringOption(options, "description") ??
      defaultDescriptionForStatus(status);
    const schema = readSchemaFromResponseOptions(options);
    const openapi = responseObjectFromOptions(options, description, schema);

    responses.push({
      status,
      description,
      schema,
      openapi,
    });
  }

  return responses.sort((left, right) => left.status - right.status);
}

export function extractSwaggerProperty(
  member: ts.PropertyDeclaration,
  checker?: ts.TypeChecker,
): SwaggerPropertyMetadata {
  const decorators = getDecoratorsByName(
    member,
    new Set(["ApiProperty", "ApiPropertyOptional", "ApiResponseProperty"]),
  );
  if (decorators.length === 0) return {};

  const metadata: SwaggerPropertyMetadata = {};

  for (const decorator of decorators) {
    const decoratorName = getDecoratorName(decorator);
    const options = getFirstObjectArg(decorator);

    if (decoratorName === "ApiPropertyOptional") {
      metadata.required = false;
    }
    if (decoratorName === "ApiResponseProperty") {
      metadata.readOnly = true;
    }

    Object.assign(metadata, propertyMetadataFromOptions(options, checker));
  }

  return metadata;
}

export function extractOpenApiMetadataFactory(
  classNode: ts.ClassDeclaration,
  checker?: ts.TypeChecker,
): Record<string, SwaggerPropertyMetadata> {
  const result: Record<string, SwaggerPropertyMetadata> = {};

  for (const member of classNode.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (!member.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)) {
      continue;
    }
    if (member.name.getText() !== "_OPENAPI_METADATA_FACTORY") continue;

    const returnStatement = member.body?.statements.find(ts.isReturnStatement);
    if (!returnStatement?.expression || !ts.isObjectLiteralExpression(returnStatement.expression)) {
      continue;
    }

    for (const property of returnStatement.expression.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const propertyName = getPropertyName(property.name);
      if (!propertyName || !ts.isObjectLiteralExpression(property.initializer)) {
        continue;
      }

      result[propertyName] = propertyMetadataFromOptions(property.initializer, checker);
    }
  }

  return result;
}

export function propertyMetadataFromOptions(
  options: ts.ObjectLiteralExpression | undefined,
  checker?: ts.TypeChecker,
): SwaggerPropertyMetadata {
  if (!options) return {};

  const metadata: SwaggerPropertyMetadata = {};
  const constraints: Record<string, unknown> = {};

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = getPropertyName(property.name);
    if (!name) continue;

    const value = literalValue(property.initializer, checker);

    switch (name) {
      case "type": {
        const ref = schemaRefFromExpression(property.initializer);
        if (ref) metadata.type = ref;
        break;
      }
      case "required":
        if (typeof value === "boolean") metadata.required = value;
        break;
      case "description":
        if (typeof value === "string") metadata.description = value;
        break;
      case "default":
        metadata.default = value;
        break;
      case "example":
        metadata.example = value;
        break;
      case "examples":
        if (Array.isArray(value)) metadata.examples = value;
        break;
      case "enum":
        if (Array.isArray(value)) metadata.enum = value;
        break;
      case "format":
        if (typeof value === "string") metadata.format = value;
        break;
      case "deprecated":
        if (typeof value === "boolean") metadata.deprecated = value;
        break;
      case "readOnly":
        if (typeof value === "boolean") metadata.readOnly = value;
        break;
      case "writeOnly":
        if (typeof value === "boolean") metadata.writeOnly = value;
        break;
      case "nullable":
        if (typeof value === "boolean") metadata.nullable = value;
        break;
      case "minimum":
      case "maximum":
      case "exclusiveMinimum":
      case "exclusiveMaximum":
      case "minLength":
      case "maxLength":
      case "pattern":
      case "minItems":
      case "maxItems":
        if (value !== undefined) constraints[name] = value;
        break;
    }
  }

  if (Object.keys(constraints).length > 0) {
    metadata.constraints = constraints;
  }

  return metadata;
}

export function arrayLiteralStrings(expression: ts.Expression): string[] | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isArrayLiteralExpression(unwrapped)) return undefined;

  const values: string[] = [];
  for (const element of unwrapped.elements) {
    const value = unwrapExpression(element);
    if (!ts.isStringLiteral(value)) return undefined;
    values.push(value.text);
  }

  return values;
}

export function schemaRefFromExpression(
  expression: ts.Expression,
): SchemaRef | undefined {
  const unwrapped = unwrapExpression(expression);

  if (ts.isArrowFunction(unwrapped)) {
    return ts.isBlock(unwrapped.body)
      ? undefined
      : schemaRefFromExpression(unwrapped.body);
  }

  if (ts.isArrayLiteralExpression(unwrapped)) {
    const first = unwrapped.elements[0];
    if (!first || !ts.isExpression(first)) return undefined;
    const items = schemaRefFromExpression(first);
    return items ? { kind: "array", items } : undefined;
  }

  if (ts.isIdentifier(unwrapped)) {
    return namedSchemaRef(unwrapped.text);
  }

  return undefined;
}

export function literalValue(
  expression: ts.Expression,
  checker?: ts.TypeChecker,
): unknown {
  const unwrapped = unwrapExpression(expression);

  if (ts.isStringLiteral(unwrapped)) return unwrapped.text;
  if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.map((element) => literalValue(element, checker));
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    const object: Record<string, unknown> = {};
    for (const property of unwrapped.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = getPropertyName(property.name);
      if (!name) continue;
      object[name] = literalValue(property.initializer, checker);
    }
    return object;
  }

  if (ts.isIdentifier(unwrapped)) {
    const enumValues = enumValuesFromIdentifier(unwrapped, checker);
    return enumValues ?? unwrapped.text;
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    return enumValueFromPropertyAccess(unwrapped, checker) ?? unwrapped.getText();
  }

  return undefined;
}

export function getDecoratorArgs(decorator: ts.Decorator): ts.NodeArray<ts.Expression> {
  return ts.isCallExpression(decorator.expression)
    ? decorator.expression.arguments
    : ts.factory.createNodeArray<ts.Expression>();
}

function readSchemaFromResponseOptions(
  options: ts.ObjectLiteralExpression | undefined,
): SchemaRef | undefined {
  if (!options) return undefined;

  const typeExpr = readOptionExpression(options, "type");
  const schemaExpr = readOptionExpression(options, "schema");
  const isArray = readBooleanOption(options, "isArray") === true;

  if (schemaExpr && ts.isObjectLiteralExpression(unwrapExpression(schemaExpr))) {
    const schema = literalValue(schemaExpr);
    return isRecord(schema)
      ? { kind: "inline", schema: cloneJsonValue(schema) as OpenApiSchemaObject }
      : undefined;
  }

  const ref = typeExpr ? schemaRefFromExpression(typeExpr) : undefined;
  if (!ref) return undefined;

  return isArray ? { kind: "array", items: ref } : ref;
}

function responseObjectFromOptions(
  options: ts.ObjectLiteralExpression | undefined,
  description: string,
  schema: SchemaRef | undefined,
): OpenApiResponseObject {
  const raw = literalValue(options ?? ts.factory.createObjectLiteralExpression());
  const base = isRecord(raw) ? { ...raw } : {};
  delete base.status;
  delete base.type;
  delete base.isArray;
  delete base.schema;

  if (!schema) {
    return { description, ...base };
  }

  return {
    description,
    ...base,
  };
}

function readStringOption(
  options: ts.ObjectLiteralExpression | undefined,
  name: string,
): string | undefined {
  const value = readOptionValue(options, name);
  return typeof value === "string" ? value : undefined;
}

function readNumberOption(
  options: ts.ObjectLiteralExpression | undefined,
  name: string,
  checker?: ts.TypeChecker,
): number | undefined {
  const expression = readOptionExpression(options, name);
  if (!expression) return undefined;

  const value = literalValue(expression, checker);
  if (typeof value === "number") return value;

  return httpStatusValueFromExpression(expression);
}

function readBooleanOption(
  options: ts.ObjectLiteralExpression | undefined,
  name: string,
): boolean | undefined {
  const value = readOptionValue(options, name);
  return typeof value === "boolean" ? value : undefined;
}

function readOptionValue(
  options: ts.ObjectLiteralExpression | undefined,
  name: string,
): unknown {
  const expression = readOptionExpression(options, name);
  return expression ? literalValue(expression) : undefined;
}

function readOptionExpression(
  options: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  if (!options) return undefined;

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (getPropertyName(property.name) === name) {
      return property.initializer;
    }
  }

  return undefined;
}

function getFirstObjectArg(
  decorator: ts.Decorator,
): ts.ObjectLiteralExpression | undefined {
  const first = getDecoratorArgs(decorator)[0];
  const unwrapped = first && ts.isExpression(first) ? unwrapExpression(first) : undefined;
  return unwrapped && ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function httpStatusValueFromExpression(expression: ts.Expression): number | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(unwrapped)) return undefined;
  if (!ts.isIdentifier(unwrapped.expression) || unwrapped.expression.text !== "HttpStatus") {
    return undefined;
  }

  return NEST_HTTP_STATUS[unwrapped.name.text];
}

function namedSchemaRef(name: string): SchemaRef {
  switch (name) {
    case "String":
      return { kind: "primitive", type: "string" };
    case "Number":
      return { kind: "primitive", type: "number" };
    case "Boolean":
      return { kind: "primitive", type: "boolean" };
    case "Date":
      return { kind: "primitive", type: "string" };
    default:
      return { kind: "ref", name };
  }
}

function enumValuesFromIdentifier(
  identifier: ts.Identifier,
  checker: ts.TypeChecker | undefined,
): unknown[] | undefined {
  const symbol = resolveAlias(checker, checker?.getSymbolAtLocation(identifier));
  const declaration = symbol?.declarations?.find(ts.isEnumDeclaration);
  return declaration ? enumValues(declaration) : undefined;
}

function enumValueFromPropertyAccess(
  expression: ts.PropertyAccessExpression,
  checker: ts.TypeChecker | undefined,
): unknown {
  const left = expression.expression;
  if (!ts.isIdentifier(left)) return undefined;

  const symbol = resolveAlias(checker, checker?.getSymbolAtLocation(left));
  const declaration = symbol?.declarations?.find(ts.isEnumDeclaration);
  if (!declaration) return undefined;

  const member = declaration.members.find(
    (item) => item.name.getText() === expression.name.text,
  );
  if (!member) return undefined;

  return enumMemberValue(member);
}

function enumValues(declaration: ts.EnumDeclaration): unknown[] {
  return declaration.members.map(enumMemberValue);
}

function enumMemberValue(member: ts.EnumMember): unknown {
  if (member.initializer && ts.isStringLiteral(member.initializer)) {
    return member.initializer.text;
  }
  if (member.initializer && ts.isNumericLiteral(member.initializer)) {
    return Number(member.initializer.text);
  }
  return member.name.getText();
}

function resolveAlias(
  checker: ts.TypeChecker | undefined,
  symbol: ts.Symbol | undefined,
): ts.Symbol | undefined {
  if (!checker || !symbol || !(symbol.flags & ts.SymbolFlags.Alias)) {
    return symbol;
  }

  return checker.getAliasedSymbol(symbol);
}

function defaultDescriptionForStatus(status: number): string {
  return status >= 200 && status < 300 ? "Successful response." : "Response.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function queryParamsFromSchema(
  schemaProperties: Record<string, PropertyModel>,
  requiredNames: string[],
  sourceParams: Pick<ParameterModel, "source">,
): ParameterModel[] {
  const required = new Set(requiredNames);
  return Object.entries(schemaProperties).map(([name, property]) => ({
    name,
    in: "query" as const,
    type: cloneSchemaRef(property.type),
    required: required.has(name),
    description: property.description,
    default: property.default,
    enum: property.enum ? [...property.enum] : undefined,
    format: property.format,
    constraints: property.constraints ? { ...property.constraints } : undefined,
    source: sourceParams.source,
    inference: { ...property.inference },
  }));
}
