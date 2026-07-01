// ============================================================================
// Schema extraction — DTO classes, properties, validators, mapped types
// ============================================================================

import ts from "typescript";
import type {
  SchemaModel,
  PropertyModel,
  SchemaRef,
  Diagnostic,
  OpenApiSchemaObject,
} from "@specord/types";
import {
  arrayLiteralStrings,
  extractOpenApiMetadataFactory,
  extractSwaggerProperty,
  schemaRefFromExpression,
  type SwaggerPropertyMetadata,
} from "./swagger-compat.js";

/** class-validator decorators we map to schema constraints (V1 allowlist). */
const VALIDATOR_MAP: Record<string, (args: ts.NodeArray<ts.Expression>) => Record<string, unknown>> = {
  IsString: () => ({ type: "string" }),
  IsEmail: () => ({ format: "email" }),
  IsNumber: () => ({ type: "number" }),
  IsInt: () => ({ type: "integer" }),
  Min: (args) => ({ minimum: extractNumericArg(args) }),
  MinLength: (args) => ({ minLength: extractNumericArg(args) }),
  MaxLength: (args) => ({ maxLength: extractNumericArg(args) }),
  IsEnum: () => ({}), // Enum is handled through the type itself
  IsOptional: () => ({ optional: true }),
  IsPositive: () => ({ exclusiveMinimum: 0 }),
  Matches: (args) => {
    if (args.length > 0 && ts.isRegularExpressionLiteral(args[0])) {
      return { pattern: args[0].text.slice(1, args[0].text.lastIndexOf("/")) };
    }
    return {};
  },
};

/** Result of schema extraction across all DTO files. */
export interface SchemaExtractionResult {
  schemas: Record<string, SchemaModel>;
  diagnostics: Diagnostic[];
}

type ExportedClassInfo = {
  node: ts.ClassDeclaration;
  sourceFile: ts.SourceFile;
  className: string;
  file: string;
  line: number;
};

type ZodSchemaInfo = {
  name: string;
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
  file: string;
  line: number;
  exported: boolean;
};

type ZodInferAliasInfo = {
  aliasName: string;
  schemaName: string;
  sourceFile: ts.SourceFile;
  file: string;
  line: number;
};

type ZodParsedSchema = {
  type: SchemaRef;
  optional: boolean;
  nullable: boolean;
  default?: unknown;
  enum?: unknown[];
  constraints?: Record<string, unknown>;
  object?: ZodObjectSchema;
};

type ZodObjectSchema = {
  properties: Record<string, PropertyModel>;
  required: string[];
  additionalProperties?: boolean;
};

/**
 * Extract schemas from all discovered DTO/entity source files.
 */
export function extractSchemas(
  dtoFiles: ts.SourceFile[],
  checker: ts.TypeChecker,
  root: string,
): SchemaExtractionResult {
  const schemas: Record<string, SchemaModel> = {};
  const diagnostics: Diagnostic[] = [];
  const normalizedRoot = root.replace(/\\/g, "/");
  const exportedClasses: ExportedClassInfo[] = [];
  const classIndex = new Map<string, ExportedClassInfo>();
  const enumIndex = new Map<string, unknown[]>();
  const zodSchemaIndex = new Map<string, ZodSchemaInfo>();
  const zodInferAliases: ZodInferAliasInfo[] = [];

  for (const sourceFile of dtoFiles) {
    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isClassDeclaration(node) || !node.name) return;

      // Only extract exported classes
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) return;

      const className = node.name.text;
      const filePath = sourceFile.fileName.replace(/\\/g, "/");
      const relativePath = filePath.startsWith(normalizedRoot + "/")
        ? filePath.slice(normalizedRoot.length + 1)
        : filePath;

      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const classInfo = {
        node,
        sourceFile,
        className,
        file: relativePath,
        line: line + 1,
      };

      exportedClasses.push(classInfo);
      classIndex.set(className, classInfo);
    });

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isVariableStatement(node)) {
        const isExported = node.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword,
        ) ?? false;

        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            continue;
          }

          const expression = unwrapExpression(declaration.initializer);
          if (!isZodSchemaExpression(expression)) continue;

          const file = relativeFilePath(sourceFile, normalizedRoot);
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            declaration.name.getStart(),
          );
          zodSchemaIndex.set(declaration.name.text, {
            name: declaration.name.text,
            expression,
            sourceFile,
            file,
            line: line + 1,
            exported: isExported,
          });
        }
      }

      if (ts.isTypeAliasDeclaration(node)) {
        const isExported = node.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword,
        ) ?? false;
        if (!isExported) return;

        const schemaName = zodInferSchemaName(node.type);
        if (!schemaName) return;

        const file = relativeFilePath(sourceFile, normalizedRoot);
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.name.getStart(),
        );
        zodInferAliases.push({
          aliasName: node.name.text,
          schemaName,
          sourceFile,
          file,
          line: line + 1,
        });
      }
    });

    // Also extract exported enums
    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isEnumDeclaration(node) || !node.name) return;

      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) return;

      enumIndex.set(node.name.text, enumValuesFromDeclaration(node));
    });
  }

  for (const classInfo of exportedClasses) {
    if (schemas[classInfo.className]) continue;

    const result = extractClassSchema(
      classInfo,
      checker,
      normalizedRoot,
      classIndex,
      enumIndex,
      schemas,
      new Set(),
    );

    schemas[classInfo.className] = result.schema;
    diagnostics.push(...result.diagnostics);
  }

  const aliasedZodSchemas = new Set<string>();
  for (const alias of zodInferAliases) {
    if (schemas[alias.aliasName]) continue;
    const schemaInfo = zodSchemaIndex.get(alias.schemaName);
    if (!schemaInfo) continue;

    const schema = schemaModelFromZodExpression(
      alias.aliasName,
      schemaInfo.expression,
      alias.file,
      alias.line,
      zodSchemaIndex,
      new Set(),
    );
    if (!schema) continue;

    schemas[alias.aliasName] = schema;
    aliasedZodSchemas.add(alias.schemaName);
  }

  for (const schemaInfo of zodSchemaIndex.values()) {
    if (!schemaInfo.exported || aliasedZodSchemas.has(schemaInfo.name)) continue;

    const schemaName = zodConstNameToSchemaName(schemaInfo.name);
    if (!schemaName || schemas[schemaName]) continue;

    const schema = schemaModelFromZodExpression(
      schemaName,
      schemaInfo.expression,
      schemaInfo.file,
      schemaInfo.line,
      zodSchemaIndex,
      new Set(),
    );
    if (schema) {
      schemas[schemaName] = schema;
    }
  }

  return { schemas, diagnostics };
}

function relativeFilePath(
  sourceFile: ts.SourceFile,
  normalizedRoot: string,
): string {
  const filePath = sourceFile.fileName.replace(/\\/g, "/");
  return filePath.startsWith(normalizedRoot + "/")
    ? filePath.slice(normalizedRoot.length + 1)
    : filePath;
}

function isZodSchemaExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return true;

  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return false;
  }

  const path = propertyAccessPath(expression.expression);
  if (path?.[0] === "z") return true;

  return isZodSchemaExpression(expression.expression.expression);
}

function zodInferSchemaName(typeNode: ts.TypeNode): string | undefined {
  if (!ts.isTypeReferenceNode(typeNode)) return undefined;

  const typeName = typeNode.typeName.getText();
  if (typeName !== "z.infer" || typeNode.typeArguments?.length !== 1) {
    return undefined;
  }

  const inferred = typeNode.typeArguments[0];
  if (
    !ts.isTypeQueryNode(inferred) ||
    !ts.isIdentifier(inferred.exprName)
  ) {
    return undefined;
  }

  return inferred.exprName.text;
}

function zodConstNameToSchemaName(name: string): string | undefined {
  if (!name.endsWith("Schema")) return undefined;

  const withoutSuffix = name.slice(0, -"Schema".length);
  return withoutSuffix
    .split(/[-_\s]+/)
    .flatMap((part) => part.split(/(?=[A-Z])/))
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function schemaModelFromZodExpression(
  name: string,
  expression: ts.Expression,
  file: string,
  line: number,
  zodSchemaIndex: Map<string, ZodSchemaInfo>,
  resolving: Set<string>,
): SchemaModel | undefined {
  const parsed = parseZodExpression(expression, zodSchemaIndex, resolving);
  if (!parsed?.object) return undefined;

  return {
    name,
    properties: parsed.object.properties,
    required: parsed.object.required,
    source: { file, line },
    inference: { status: "inferred" },
    openapi: parsed.object.additionalProperties === undefined
      ? undefined
      : { additionalProperties: parsed.object.additionalProperties },
  };
}

function parseZodExpression(
  expression: ts.Expression,
  zodSchemaIndex: Map<string, ZodSchemaInfo>,
  resolving: Set<string>,
): ZodParsedSchema | undefined {
  const unwrapped = unwrapExpression(expression);

  if (ts.isIdentifier(unwrapped)) {
    const schemaInfo = zodSchemaIndex.get(unwrapped.text);
    if (!schemaInfo || resolving.has(schemaInfo.name)) return undefined;

    resolving.add(schemaInfo.name);
    const parsed = parseZodExpression(
      schemaInfo.expression,
      zodSchemaIndex,
      resolving,
    );
    resolving.delete(schemaInfo.name);
    return parsed ? cloneZodParsedSchema(parsed) : undefined;
  }

  if (!ts.isCallExpression(unwrapped) || !ts.isPropertyAccessExpression(unwrapped.expression)) {
    return undefined;
  }

  const path = propertyAccessPath(unwrapped.expression);
  if (path?.[0] === "z") {
    return parseZodFactoryCall(unwrapped, path, zodSchemaIndex, resolving);
  }

  const methodName = unwrapped.expression.name.text;
  const receiver = unwrapped.expression.expression;
  const base = parseZodExpression(receiver, zodSchemaIndex, resolving);
  if (!base) return undefined;

  return applyZodModifier(
    base,
    methodName,
    unwrapped.arguments,
    zodSchemaIndex,
    resolving,
  );
}

function parseZodFactoryCall(
  call: ts.CallExpression,
  path: string[],
  zodSchemaIndex: Map<string, ZodSchemaInfo>,
  resolving: Set<string>,
): ZodParsedSchema | undefined {
  const factory = path.join(".");

  if (factory === "z.string" || factory === "z.coerce.string") {
    return zodParsed({ kind: "primitive", type: "string" });
  }

  if (factory === "z.number" || factory === "z.coerce.number") {
    return zodParsed({ kind: "primitive", type: "number" });
  }

  if (factory === "z.boolean" || factory === "z.coerce.boolean") {
    return zodParsed({ kind: "primitive", type: "boolean" });
  }

  if (factory === "z.object") {
    const shape = call.arguments[0];
    if (!shape || !ts.isObjectLiteralExpression(shape)) return undefined;

    const object = parseZodObjectLiteral(shape, zodSchemaIndex, resolving);
    return zodParsed(inlineObjectSchemaRef(object), { object });
  }

  if (factory === "z.enum") {
    const values = call.arguments[0] && ts.isArrayLiteralExpression(call.arguments[0])
      ? call.arguments[0].elements
          .map((element) => literalValue(element))
          .filter((value): value is string => typeof value === "string")
      : [];
    return zodParsed({ kind: "primitive", type: "string" }, { enum: values });
  }

  if (factory === "z.literal") {
    const value = call.arguments[0] ? literalValue(call.arguments[0]) : undefined;
    const primitive = primitiveTypeForLiteral(value);
    return zodParsed(
      primitive ? { kind: "primitive", type: primitive } : { kind: "unknown" },
      value === undefined ? {} : { enum: [value] },
    );
  }

  if (factory === "z.array") {
    const item = call.arguments[0]
      ? parseZodExpression(call.arguments[0], zodSchemaIndex, resolving)
      : undefined;
    return zodParsed({
      kind: "array",
      items: item ? schemaRefWithMetadata(item) : { kind: "unknown" },
    });
  }

  if (factory === "z.union") {
    const optionsArg = call.arguments[0];
    if (!optionsArg || !ts.isArrayLiteralExpression(optionsArg)) {
      return zodParsed({ kind: "unknown" });
    }

    const options = optionsArg.elements
      .map((element) => parseZodExpression(element, zodSchemaIndex, resolving))
      .filter((option): option is ZodParsedSchema => option !== undefined);

    const literalEnum = literalEnumFromUnion(options);
    if (literalEnum) {
      return zodParsed(
        { kind: "primitive", type: literalEnum.type },
        { enum: literalEnum.values },
      );
    }

    return zodParsed({
      kind: "inline",
      schema: { oneOf: options.map((option) => zodParsedToOpenApi(option)) },
    });
  }

  if (factory === "z.unknown" || factory === "z.any") {
    return zodParsed({ kind: "unknown" });
  }

  return undefined;
}

function parseZodObjectLiteral(
  shape: ts.ObjectLiteralExpression,
  zodSchemaIndex: Map<string, ZodSchemaInfo>,
  resolving: Set<string>,
): ZodObjectSchema {
  const properties: Record<string, PropertyModel> = {};
  const required: string[] = [];

  for (const property of shape.properties) {
    if (!ts.isPropertyAssignment(property)) continue;

    const name = objectPropertyName(property.name);
    if (!name) continue;

    const parsed = parseZodExpression(
      property.initializer,
      zodSchemaIndex,
      resolving,
    );
    if (!parsed) continue;

    if (!parsed.optional) {
      required.push(name);
    }

    properties[name] = {
      type: parsed.type,
      default: parsed.default,
      enum: parsed.enum,
      nullable: parsed.nullable || undefined,
      constraints: parsed.constraints,
      inference: { status: "inferred" },
    };
  }

  return { properties, required };
}

function applyZodModifier(
  base: ZodParsedSchema,
  methodName: string,
  args: ts.NodeArray<ts.Expression>,
  zodSchemaIndex: Map<string, ZodSchemaInfo>,
  resolving: Set<string>,
): ZodParsedSchema | undefined {
  const next = cloneZodParsedSchema(base);

  switch (methodName) {
    case "optional":
      next.optional = true;
      return next;
    case "nullable":
      next.nullable = true;
      return next;
    case "default":
      next.optional = true;
      next.default = args[0] ? literalValue(args[0]) : undefined;
      return next;
    case "int":
      if (next.type.kind === "primitive" && next.type.type === "number") {
        next.type = { kind: "primitive", type: "integer" };
      }
      return next;
    case "email":
    case "url":
    case "uuid":
      next.constraints = { ...(next.constraints ?? {}), format: methodName };
      return next;
    case "min":
      return applyNumericOrLengthConstraint(next, "min", args);
    case "max":
      return applyNumericOrLengthConstraint(next, "max", args);
    case "length":
      return applyLengthConstraint(next, args);
    case "strict":
      if (next.object) {
        next.object.additionalProperties = false;
        next.type = inlineObjectSchemaRef(next.object);
      }
      return next;
    case "passthrough":
      if (next.object) {
        next.object.additionalProperties = true;
        next.type = inlineObjectSchemaRef(next.object);
      }
      return next;
    case "partial":
      if (next.object) {
        next.object.required = [];
        next.type = inlineObjectSchemaRef(next.object);
      }
      return next;
    case "extend":
      if (next.object && args[0] && ts.isObjectLiteralExpression(args[0])) {
        const extension = parseZodObjectLiteral(args[0], zodSchemaIndex, resolving);
        next.object.properties = {
          ...next.object.properties,
          ...extension.properties,
        };
        next.object.required = [
          ...new Set([...next.object.required, ...extension.required]),
        ];
        next.type = inlineObjectSchemaRef(next.object);
      }
      return next;
    case "trim":
    case "toLowerCase":
    case "toUpperCase":
    case "transform":
    case "refine":
    case "superRefine":
      return next;
    default:
      return next;
  }
}

function applyNumericOrLengthConstraint(
  schema: ZodParsedSchema,
  direction: "min" | "max",
  args: ts.NodeArray<ts.Expression>,
): ZodParsedSchema {
  const value = args[0] ? literalValue(args[0]) : undefined;
  if (typeof value !== "number") return schema;

  const key = schema.type.kind === "primitive" &&
    (schema.type.type === "number" || schema.type.type === "integer")
    ? direction === "min" ? "minimum" : "maximum"
    : schema.type.kind === "array"
      ? direction === "min" ? "minItems" : "maxItems"
      : direction === "min" ? "minLength" : "maxLength";

  schema.constraints = { ...(schema.constraints ?? {}), [key]: value };
  return schema;
}

function applyLengthConstraint(
  schema: ZodParsedSchema,
  args: ts.NodeArray<ts.Expression>,
): ZodParsedSchema {
  const value = args[0] ? literalValue(args[0]) : undefined;
  if (typeof value !== "number") return schema;

  const minKey = schema.type.kind === "array" ? "minItems" : "minLength";
  const maxKey = schema.type.kind === "array" ? "maxItems" : "maxLength";
  schema.constraints = {
    ...(schema.constraints ?? {}),
    [minKey]: value,
    [maxKey]: value,
  };
  return schema;
}

function zodParsed(
  type: SchemaRef,
  options: Partial<Omit<ZodParsedSchema, "type">> = {},
): ZodParsedSchema {
  return {
    type,
    optional: options.optional ?? false,
    nullable: options.nullable ?? false,
    default: options.default,
    enum: options.enum,
    constraints: options.constraints,
    object: options.object,
  };
}

function inlineObjectSchemaRef(object: ZodObjectSchema): SchemaRef {
  return { kind: "inline", schema: zodObjectToOpenApi(object) };
}

function zodObjectToOpenApi(object: ZodObjectSchema): OpenApiSchemaObject {
  return {
    type: "object",
    ...(object.required.length > 0 ? { required: [...object.required] } : {}),
    properties: Object.fromEntries(
      Object.entries(object.properties).map(([name, property]) => [
        name,
        propertyToInlineOpenApi(property),
      ]),
    ),
    ...(object.additionalProperties === undefined
      ? {}
      : { additionalProperties: object.additionalProperties }),
  };
}

function propertyToInlineOpenApi(property: PropertyModel): OpenApiSchemaObject {
  return zodParsedToOpenApi({
    type: property.type,
    optional: false,
    nullable: property.nullable ?? false,
    default: property.default,
    enum: property.enum,
    constraints: property.constraints,
  });
}

function zodParsedToOpenApi(schema: ZodParsedSchema): OpenApiSchemaObject {
  const base = schemaRefToInlineOpenApi(schema.type);
  const next: Record<string, unknown> = { ...base };

  if (schema.default !== undefined) next.default = schema.default;
  if (schema.enum !== undefined) next.enum = schema.enum;
  if (schema.nullable && typeof next.type === "string") {
    next.type = [next.type, "null"];
  }

  if (schema.constraints) {
    for (const [key, value] of Object.entries(schema.constraints)) {
      if (value !== undefined) {
        next[key] = value;
      }
    }
  }

  return next as OpenApiSchemaObject;
}

function schemaRefWithMetadata(schema: ZodParsedSchema): SchemaRef {
  if (
    schema.default === undefined &&
    schema.enum === undefined &&
    !schema.nullable &&
    !schema.constraints
  ) {
    return cloneSchemaRef(schema.type);
  }

  return { kind: "inline", schema: zodParsedToOpenApi(schema) };
}

function schemaRefToInlineOpenApi(ref: SchemaRef): OpenApiSchemaObject {
  switch (ref.kind) {
    case "primitive":
      return { type: ref.type };
    case "array":
      return { type: "array", items: schemaRefToInlineOpenApi(ref.items) };
    case "inline":
      return cloneUnknown(ref.schema) as OpenApiSchemaObject;
    case "ref":
      return { $ref: `#/components/schemas/${ref.name}` };
    case "unknown":
      return {};
  }
}

function literalEnumFromUnion(
  options: ZodParsedSchema[],
): { type: "string" | "number" | "boolean"; values: unknown[] } | undefined {
  if (options.length === 0) return undefined;

  const values: unknown[] = [];
  let type: "string" | "number" | "boolean" | undefined;

  for (const option of options) {
    if (
      option.enum?.length !== 1 ||
      option.type.kind !== "primitive" ||
      !["string", "number", "boolean"].includes(option.type.type)
    ) {
      return undefined;
    }

    const optionType = option.type.type as "string" | "number" | "boolean";
    if (type && type !== optionType) return undefined;

    type = optionType;
    values.push(option.enum[0]);
  }

  return type ? { type, values } : undefined;
}

function propertyAccessPath(
  access: ts.PropertyAccessExpression,
): string[] | undefined {
  const parts = [access.name.text];
  let current: ts.Expression = access.expression;

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }

  if (!ts.isIdentifier(current)) return undefined;
  parts.unshift(current.text);
  return parts;
}

function objectPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function literalValue(expression: ts.Expression): unknown {
  const unwrapped = unwrapExpression(expression);

  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }

  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }

  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.map((element) => literalValue(element));
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    return Object.fromEntries(
      unwrapped.properties
        .filter(ts.isPropertyAssignment)
        .map((property) => [
          objectPropertyName(property.name) ?? property.name.getText(),
          literalValue(property.initializer),
        ]),
    );
  }

  return undefined;
}

function primitiveTypeForLiteral(
  value: unknown,
): "string" | "number" | "boolean" | "null" | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null) return "null";
  return undefined;
}

function cloneZodParsedSchema(schema: ZodParsedSchema): ZodParsedSchema {
  return {
    type: cloneSchemaRef(schema.type),
    optional: schema.optional,
    nullable: schema.nullable,
    default: cloneUnknown(schema.default),
    enum: schema.enum ? [...schema.enum] : undefined,
    constraints: schema.constraints ? { ...schema.constraints } : undefined,
    object: schema.object ? cloneZodObjectSchema(schema.object) : undefined,
  };
}

function cloneZodObjectSchema(object: ZodObjectSchema): ZodObjectSchema {
  return {
    properties: cloneProperties(object.properties),
    required: [...object.required],
    additionalProperties: object.additionalProperties,
  };
}

function extractClassSchema(
  classInfo: ExportedClassInfo,
  checker: ts.TypeChecker,
  normalizedRoot: string,
  classIndex: Map<string, ExportedClassInfo>,
  enumIndex: Map<string, unknown[]>,
  schemas: Record<string, SchemaModel>,
  resolving: Set<string>,
): { schema: SchemaModel; diagnostics: Diagnostic[] } {
  const existing = schemas[classInfo.className];
  if (existing) {
    return { schema: existing, diagnostics: [] };
  }

  if (resolving.has(classInfo.className)) {
    return {
      schema: unsupportedMappedTypeSchema(
        classInfo.className,
        "PartialType",
        "?",
        classInfo.file,
        classInfo.line,
      ),
      diagnostics: [
        unsupportedMappedTypeDiagnostic(
          classInfo.className,
          "PartialType",
          "?",
          classInfo.file,
          classInfo.line,
        ),
      ],
    };
  }

  resolving.add(classInfo.className);

  const mappedTypeResult = checkMappedType(
    classInfo,
    checker,
    normalizedRoot,
    classIndex,
    enumIndex,
    schemas,
    resolving,
  );

  if (mappedTypeResult) {
    resolving.delete(classInfo.className);
    return mappedTypeResult;
  }

  const baseResult = extractBaseClassSchema(
    classInfo,
    checker,
    normalizedRoot,
    classIndex,
    enumIndex,
    schemas,
    resolving,
  );
  const { properties, required, propDiagnostics } = extractProperties(
    classInfo.node,
    checker,
    classInfo.sourceFile,
    normalizedRoot,
    enumIndex,
  );
  const mergedProperties = baseResult
    ? { ...cloneProperties(baseResult.schema.properties), ...properties }
    : properties;
  const mergedRequired = baseResult
    ? [...new Set([...baseResult.schema.required, ...required])]
    : required;

  resolving.delete(classInfo.className);

  return {
    schema: {
      name: classInfo.className,
      properties: mergedProperties,
      required: mergedRequired,
      source: { file: classInfo.file, line: classInfo.line },
      inference: { status: "inferred" },
    },
    diagnostics: [...(baseResult?.diagnostics ?? []), ...propDiagnostics],
  };
}

function extractBaseClassSchema(
  classInfo: ExportedClassInfo,
  checker: ts.TypeChecker,
  normalizedRoot: string,
  classIndex: Map<string, ExportedClassInfo>,
  enumIndex: Map<string, unknown[]>,
  schemas: Record<string, SchemaModel>,
  resolving: Set<string>,
): { schema: SchemaModel; diagnostics: Diagnostic[] } | undefined {
  for (const clause of classInfo.node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;

    for (const type of clause.types) {
      if (ts.isIdentifier(type.expression)) {
        const baseClass = classIndex.get(type.expression.text);
        if (!baseClass) return undefined;

        const result = extractClassSchema(
          baseClass,
          checker,
          normalizedRoot,
          classIndex,
          enumIndex,
          schemas,
          resolving,
        );
        schemas[baseClass.className] = result.schema;
        return result;
      }
    }
  }

  return undefined;
}

/**
 * Check if a class extends a mapped type utility (PartialType, PickType, etc.).
 */
function checkMappedType(
  classInfo: ExportedClassInfo,
  checker: ts.TypeChecker,
  normalizedRoot: string,
  classIndex: Map<string, ExportedClassInfo>,
  enumIndex: Map<string, unknown[]>,
  schemas: Record<string, SchemaModel>,
  resolving: Set<string>,
): { schema: SchemaModel; diagnostics: Diagnostic[] } | null {
  const { node, className, file, line } = classInfo;

  if (!node.heritageClauses) return null;

  for (const clause of node.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;

    for (const type of clause.types) {
      const expr = type.expression;

      if (ts.isCallExpression(expr)) {
        const mapped = resolveMappedTypeExpression(
          expr,
          classInfo,
          checker,
          normalizedRoot,
          classIndex,
          enumIndex,
          schemas,
          resolving,
        );

        if (mapped) {
          return mapped;
        }
      }
    }
  }

  return null;
}

function resolveMappedTypeExpression(
  expr: ts.CallExpression,
  classInfo: ExportedClassInfo,
  checker: ts.TypeChecker,
  normalizedRoot: string,
  classIndex: Map<string, ExportedClassInfo>,
  enumIndex: Map<string, unknown[]>,
  schemas: Record<string, SchemaModel>,
  resolving: Set<string>,
): { schema: SchemaModel; diagnostics: Diagnostic[] } | null {
  if (!ts.isIdentifier(expr.expression)) return null;

  const utilName = expr.expression.text;
  if (!["PartialType", "PickType", "OmitType", "IntersectionType"].includes(utilName)) {
    return null;
  }

  const resolved = schemaFromMappedInput(
    expr,
    checker,
    normalizedRoot,
    classIndex,
    enumIndex,
    schemas,
    resolving,
  );

  if (!resolved) {
    const baseClassName = mappedTypeInputName(expr.arguments[0]);
    return {
      schema: unsupportedMappedTypeSchema(
        classInfo.className,
        utilName,
        baseClassName,
        classInfo.file,
        classInfo.line,
      ),
      diagnostics: [
        unsupportedMappedTypeDiagnostic(
          classInfo.className,
          utilName,
          baseClassName,
          classInfo.file,
          classInfo.line,
        ),
      ],
    };
  }

  return {
    schema: {
      name: classInfo.className,
      properties: cloneProperties(resolved.schema.properties),
      required: [...resolved.schema.required],
      source: { file: classInfo.file, line: classInfo.line },
      inference: { status: "inferred" },
    },
    diagnostics: resolved.diagnostics,
  };
}

function schemaFromMappedInput(
  expr: ts.Expression,
  checker: ts.TypeChecker,
  normalizedRoot: string,
  classIndex: Map<string, ExportedClassInfo>,
  enumIndex: Map<string, unknown[]>,
  schemas: Record<string, SchemaModel>,
  resolving: Set<string>,
): { schema: SchemaModel; diagnostics: Diagnostic[] } | undefined {
  const unwrapped = unwrapExpression(expr);

  if (ts.isIdentifier(unwrapped)) {
    const baseClass = classIndex.get(unwrapped.text);
    if (!baseClass) return undefined;

    const baseResult = extractClassSchema(
      baseClass,
      checker,
      normalizedRoot,
      classIndex,
      enumIndex,
      schemas,
      resolving,
    );
    schemas[baseClass.className] = baseResult.schema;
    return baseResult;
  }

  if (!ts.isCallExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression)) {
    return undefined;
  }

  const utilName = unwrapped.expression.text;
  const base = unwrapped.arguments[0]
    ? schemaFromMappedInput(
        unwrapped.arguments[0],
        checker,
        normalizedRoot,
        classIndex,
        enumIndex,
        schemas,
        resolving,
      )
    : undefined;

  if (utilName === "PartialType" && base) {
    if (base.schema.inference.status !== "inferred") {
      return undefined;
    }

    return {
      schema: {
        ...base.schema,
        properties: cloneProperties(base.schema.properties),
        required: [],
      },
      diagnostics: base.diagnostics,
    };
  }

  if ((utilName === "PickType" || utilName === "OmitType") && base) {
    if (base.schema.inference.status !== "inferred") {
      return undefined;
    }

    const keysArg = unwrapped.arguments[1];
    const keys = keysArg && ts.isExpression(keysArg)
      ? arrayLiteralStrings(keysArg)
      : undefined;
    if (!keys) return undefined;

    const selected = new Set(keys);
    const properties = Object.fromEntries(
      Object.entries(base.schema.properties).filter(([name]) =>
        utilName === "PickType" ? selected.has(name) : !selected.has(name),
      ).map(([name, property]) => [name, cloneProperty(property)]),
    );
    const required = base.schema.required.filter((name) =>
      utilName === "PickType" ? selected.has(name) : !selected.has(name),
    );

    return {
      schema: { ...base.schema, properties, required },
      diagnostics: base.diagnostics,
    };
  }

  if (utilName === "IntersectionType") {
    const left = unwrapped.arguments[0]
      ? schemaFromMappedInput(
          unwrapped.arguments[0],
          checker,
          normalizedRoot,
          classIndex,
          enumIndex,
          schemas,
          resolving,
        )
      : undefined;
    const right = unwrapped.arguments[1]
      ? schemaFromMappedInput(
          unwrapped.arguments[1],
          checker,
          normalizedRoot,
          classIndex,
          enumIndex,
          schemas,
          resolving,
        )
      : undefined;
    if (!left || !right) return undefined;
    if (
      left.schema.inference.status !== "inferred" ||
      right.schema.inference.status !== "inferred"
    ) {
      return undefined;
    }

    return {
      schema: {
        ...left.schema,
        properties: {
          ...cloneProperties(left.schema.properties),
          ...cloneProperties(right.schema.properties),
        },
        required: [...new Set([...left.schema.required, ...right.schema.required])],
      },
      diagnostics: [...left.diagnostics, ...right.diagnostics],
    };
  }

  return undefined;
}

function mappedTypeInputName(expression: ts.Expression | undefined): string {
  if (!expression) return "?";
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text;
  return unwrapped.getText();
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

function unsupportedMappedTypeSchema(
  className: string,
  utilName: string,
  baseClassName: string,
  file: string,
  line: number,
): SchemaModel {
  return {
    name: className,
    properties: {},
    required: [],
    source: { file, line },
    inference: {
      status: "inferred-with-warning",
      reason: `Mapped type ${utilName}(${baseClassName}) cannot be fully resolved at extraction time`,
    },
  };
}

function unsupportedMappedTypeDiagnostic(
  className: string,
  utilName: string,
  baseClassName: string,
  file: string,
  line: number,
): Diagnostic {
  return {
    severity: "warning",
    code: "EXTRACTOR_UNSUPPORTED_MAPPED_TYPE",
    message: `${className} extends ${utilName}(${baseClassName}) — mapped type cannot be fully resolved`,
    source: { file, line },
    subject: className,
    suggestedOverridePath: `schemas.${className}`,
  };
}

function cloneProperties(
  properties: Record<string, PropertyModel>,
): Record<string, PropertyModel> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => [
      name,
      cloneProperty(property),
    ]),
  );
}

function cloneProperty(property: PropertyModel): PropertyModel {
  return {
    ...property,
    type: cloneSchemaRef(property.type),
    example: cloneUnknown(property.example),
    examples: property.examples ? [...property.examples] : undefined,
    enum: property.enum ? [...property.enum] : undefined,
    constraints: property.constraints ? { ...property.constraints } : undefined,
    inference: { ...property.inference },
  };
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === "object") return { ...(value as Record<string, unknown>) };
  return value;
}

function cloneSchemaRef(type: SchemaRef): SchemaRef {
  switch (type.kind) {
    case "array":
      return { kind: "array", items: cloneSchemaRef(type.items) };
    case "inline":
      return {
        kind: "inline",
        schema: cloneUnknown(type.schema) as typeof type.schema,
      };
    case "ref":
      return { kind: "ref", name: type.name };
    case "primitive":
      return { kind: "primitive", type: type.type };
    case "unknown":
      return { kind: "unknown" };
  }
}

/**
 * Extract properties from a class declaration.
 */
function extractProperties(
  classNode: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  normalizedRoot: string,
  enumIndex: Map<string, unknown[]>,
): {
  properties: Record<string, PropertyModel>;
  required: string[];
  propDiagnostics: Diagnostic[];
} {
  const properties: Record<string, PropertyModel> = {};
  const required: string[] = [];
  const propDiagnostics: Diagnostic[] = [];
  const factoryMetadata = extractOpenApiMetadataFactory(classNode, checker);

  for (const member of classNode.members) {
    if (!ts.isPropertyDeclaration(member) || !member.name) continue;

    const propName = member.name.getText(sourceFile);
    const isOptional = !!member.questionToken;

    // Resolve type
    let typeRef: SchemaRef;
    let format: string | undefined;
    let enumValues: unknown[] | undefined;
    const constraints: Record<string, unknown> = {};

    if (member.type) {
      typeRef = resolvePropertyType(member.type, checker);

      // Check for enum type
      if (ts.isTypeReferenceNode(member.type)) {
        const typeName = ts.isIdentifier(member.type.typeName)
          ? member.type.typeName.text
          : member.type.typeName.getText();
        if (enumIndex.has(typeName)) {
          enumValues = enumIndex.get(typeName);
          typeRef = enumValues?.every((value) => typeof value === "number")
            ? { kind: "primitive", type: "number" }
            : { kind: "primitive", type: "string" };
        }
        const memberType = checker.getTypeFromTypeNode(member.type);
        const symbol =
          checker.getSymbolAtLocation(member.type.typeName) ??
          memberType.symbol ??
          memberType.aliasSymbol;
        if (!enumValues && symbol) {
          const decl = symbol.declarations?.find(ts.isEnumDeclaration);
          if (decl && ts.isEnumDeclaration(decl)) {
            enumValues = enumValuesFromDeclaration(decl);
            typeRef = enumValues.every((value) => typeof value === "number")
              ? { kind: "primitive", type: "number" }
              : { kind: "primitive", type: "string" };
          }
        }
      }
    } else {
      typeRef = { kind: "unknown" };
    }

    // Extract default value
    let defaultValue: unknown;
    if (member.initializer) {
      if (ts.isNumericLiteral(member.initializer)) {
        defaultValue = Number(member.initializer.text);
      } else if (ts.isStringLiteral(member.initializer)) {
        defaultValue = member.initializer.text;
      } else if (
        member.initializer.kind === ts.SyntaxKind.TrueKeyword ||
        member.initializer.kind === ts.SyntaxKind.FalseKeyword
      ) {
        defaultValue = member.initializer.kind === ts.SyntaxKind.TrueKeyword;
      }
    }

    // Extract class-validator constraints
    const decorators = ts.canHaveDecorators(member)
      ? ts.getDecorators(member)
      : undefined;

    let markedOptional = isOptional;
    const swaggerProperty = extractSwaggerProperty(member, checker);

    if (decorators) {
      for (const decorator of decorators) {
        const decoratorName = getDecoratorCallName(decorator);
        if (!decoratorName) continue;

        const handler = VALIDATOR_MAP[decoratorName];
        if (handler) {
          const args = ts.isCallExpression(decorator.expression)
            ? decorator.expression.arguments
            : ts.factory.createNodeArray<ts.Expression>();
          const result = handler(args);

          if (result.optional) {
            markedOptional = true;
            delete result.optional;
          }

          Object.assign(constraints, result);
        }
      }
    }

    const mergedMetadata = mergePropertyMetadata(
      swaggerProperty,
      factoryMetadata[propName],
    );

    if (mergedMetadata.type) {
      typeRef = mergedMetadata.type;
    }
    if (mergedMetadata.required === false) {
      markedOptional = true;
    }
    if (mergedMetadata.required === true) {
      markedOptional = false;
    }
    if (mergedMetadata.constraints) {
      Object.assign(constraints, mergedMetadata.constraints);
    }

    if (!markedOptional) {
      required.push(propName);
    }

    properties[propName] = {
      type: typeRef,
      description: mergedMetadata.description,
      default: defaultValue,
      example: mergedMetadata.example,
      examples: mergedMetadata.examples,
      enum: mergedMetadata.enum ?? enumValues,
      format: mergedMetadata.format ?? format,
      deprecated: mergedMetadata.deprecated,
      readOnly: mergedMetadata.readOnly,
      writeOnly: mergedMetadata.writeOnly,
      nullable: mergedMetadata.nullable,
      constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
      inference: { status: "inferred" },
    };
  }

  for (const [propName, metadata] of Object.entries(factoryMetadata)) {
    if (properties[propName]) continue;

    const markedOptional = metadata.required === false;
    if (!markedOptional) {
      required.push(propName);
    }

    properties[propName] = {
      type: metadata.type ?? { kind: "unknown" },
      description: metadata.description,
      default: metadata.default,
      example: metadata.example,
      examples: metadata.examples,
      enum: metadata.enum,
      format: metadata.format,
      deprecated: metadata.deprecated,
      readOnly: metadata.readOnly,
      writeOnly: metadata.writeOnly,
      nullable: metadata.nullable,
      constraints: metadata.constraints,
      inference: { status: "inferred" },
    };
  }

  return { properties, required, propDiagnostics };
}

function mergePropertyMetadata(
  ...items: Array<SwaggerPropertyMetadata | undefined>
): SwaggerPropertyMetadata {
  const merged: SwaggerPropertyMetadata = {};
  const constraints: Record<string, unknown> = {};

  for (const item of items) {
    if (!item) continue;
    Object.assign(merged, item);
    if (item.constraints) {
      Object.assign(constraints, item.constraints);
    }
  }

  if (Object.keys(constraints).length > 0) {
    merged.constraints = constraints;
  }

  return merged;
}

/**
 * Resolve a property type node to a SchemaRef.
 */
function resolvePropertyType(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
): SchemaRef {
  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { kind: "primitive", type: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { kind: "primitive", type: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "primitive", type: "boolean" };
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { kind: "unknown" };
  }

  if (ts.isArrayTypeNode(typeNode)) {
    return {
      kind: "array",
      items: resolvePropertyType(typeNode.elementType, checker),
    };
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : typeNode.typeName.getText();

    // Date → string with format date-time
    if (name === "Date") {
      return { kind: "primitive", type: "string" };
    }

    return { kind: "ref", name };
  }

  return { kind: "unknown" };
}

function getDecoratorCallName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  return undefined;
}

function extractNumericArg(
  args: ts.NodeArray<ts.Expression>,
): number | undefined {
  if (args.length > 0 && ts.isNumericLiteral(args[0])) {
    return Number(args[0].text);
  }
  return undefined;
}

function enumValuesFromDeclaration(decl: ts.EnumDeclaration): unknown[] {
  return decl.members.map((member) => {
    if (member.initializer && ts.isStringLiteral(member.initializer)) {
      return member.initializer.text;
    }
    if (member.initializer && ts.isNumericLiteral(member.initializer)) {
      return Number(member.initializer.text);
    }
    return member.name.getText(decl.getSourceFile());
  });
}
