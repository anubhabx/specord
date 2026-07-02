// ============================================================================
// Parameter extraction — @Param, @Query, @Body, @Headers
// ============================================================================

import ts from "typescript";
import type {
  ParameterModel,
  BodyModel,
  SchemaRef,
  SchemaModel,
  SourceLocation,
} from "@specord/types";
import { cloneSchemaRef } from "../internal/clone.js";
import {
  findDecorator,
  extractDecoratorStringArg,
  extractDecoratorIdentifierArgs,
} from "./controller-discovery.js";
import type { DiscoveredRoute } from "./route-extractor.js";

/** Pipes that refine parameter types in the V1 allowlist. */
const PIPE_TYPE_MAP: Record<string, SchemaRef> = {
  ParseIntPipe: { kind: "primitive", type: "integer" },
  ParseFloatPipe: { kind: "primitive", type: "number" },
  ParseBoolPipe: { kind: "primitive", type: "boolean" },
};

/** Result of extracting parameters from a handler method. */
export interface ExtractedParams {
  params: ParameterModel[];
  requestBody?: BodyModel;
}

/**
 * Extract all parameter decorators from a route handler method.
 */
export function extractParams(
  route: DiscoveredRoute,
  checker: ts.TypeChecker,
  root: string,
  schemas: Record<string, SchemaModel> = {},
): ExtractedParams {
  const params: ParameterModel[] = [];
  let requestBody: BodyModel | undefined;
  const normalizedRoot = root.replace(/\\/g, "/");

  for (const param of route.node.parameters) {
    const location = getParamLocation(param, route.sourceFile, normalizedRoot);

    // Check for @Param()
    const paramDecorator = findDecorator(param, "Param");
    if (paramDecorator) {
      const name = extractDecoratorStringArg(paramDecorator);
      const pipeArgs = extractDecoratorIdentifierArgs(paramDecorator);
      const typeRef = resolveParamType(param, pipeArgs, checker);

      if (name) {
        params.push({
          name,
          in: "path",
          type: typeRef,
          required: true, // Path params are always required
          source: location,
          inference: { status: "inferred" },
        });
      } else {
        const expandedParams = expandDtoParams(
          typeRef,
          schemas,
          location,
          false,
          "path",
        );
        if (expandedParams) {
          params.push(...expandedParams);
        }
      }
      continue;
    }

    // Check for @Query()
    const queryDecorator = findDecorator(param, "Query");
    if (queryDecorator) {
      const specificName = extractDecoratorStringArg(queryDecorator);

      if (specificName) {
        // @Query("name") — single named query param
        const pipeArgs = extractDecoratorIdentifierArgs(queryDecorator);
        const typeRef = resolveParamType(param, pipeArgs, checker);
        params.push({
          name: specificName,
          in: "query",
          type: typeRef,
          required: !param.questionToken,
          source: location,
          inference: { status: "inferred" },
        });
      } else {
        // @Query() paginationDto: PaginationDto — entire DTO as query params
        const typeRef = resolveTypeRef(param, checker);
        const expandedParams = expandDtoParams(
          typeRef,
          schemas,
          location,
          !!param.questionToken,
          "query",
        );

        if (expandedParams) {
          params.push(...expandedParams);
        } else if (typeRef.kind === "ref") {
          params.push({
            name: typeRef.name,
            in: "query",
            type: typeRef,
            required: !param.questionToken,
            source: location,
            inference: { status: "inferred" },
          });
        }
      }
      continue;
    }

    // Check for @Body()
    const bodyDecorator = findDecorator(param, "Body");
    if (bodyDecorator) {
      if (extractDecoratorStringArg(bodyDecorator)) continue;

      const typeRef = resolveTypeRef(param, checker);
      requestBody = {
        schema: typeRef,
        required: !param.questionToken,
        source: location,
        inference: { status: "inferred" },
      };
      continue;
    }

    // Check for @Headers()
    const headersDecorator = findDecorator(param, "Headers");
    if (headersDecorator) {
      const name = extractDecoratorStringArg(headersDecorator);
      if (name) {
        params.push({
          name,
          in: "header",
          type: { kind: "primitive", type: "string" },
          required: !param.questionToken,
          source: location,
          inference: { status: "inferred" },
        });
      }
      continue;
    }
  }

  return { params, requestBody };
}

function expandDtoParams(
  typeRef: SchemaRef,
  schemas: Record<string, SchemaModel>,
  source: SourceLocation,
  isContainerOptional: boolean,
  parameterLocation: "path" | "query",
): ParameterModel[] | undefined {
  if (typeRef.kind !== "ref") return undefined;

  const schema = schemas[typeRef.name];
  if (!schema) return undefined;

  const required = new Set(schema.required);

  return Object.entries(schema.properties).map(([name, property]) => ({
    name,
    in: parameterLocation,
    type: cloneSchemaRef(property.type),
    required: parameterLocation === "path"
      ? true
      : !isContainerOptional && required.has(name),
    description: property.description,
    default: property.default,
    enum: property.enum ? [...property.enum] : undefined,
    format: property.format,
    constraints: property.constraints ? { ...property.constraints } : undefined,
    source,
    inference: { ...property.inference },
  }));
}

/**
 * Resolve a parameter's type, considering pipe type hints.
 */
function resolveParamType(
  param: ts.ParameterDeclaration,
  pipeArgs: string[],
  checker: ts.TypeChecker,
): SchemaRef {
  // Check for pipe type refinement first
  for (const pipeName of pipeArgs) {
    if (PIPE_TYPE_MAP[pipeName]) {
      return PIPE_TYPE_MAP[pipeName];
    }
  }

  // Fall back to type annotation
  return resolveTypeRef(param, checker);
}

/**
 * Resolve a parameter or return type to a SchemaRef.
 */
export function resolveTypeRef(
  node: ts.ParameterDeclaration | ts.Node,
  checker: ts.TypeChecker,
): SchemaRef {
  let typeNode: ts.TypeNode | undefined;

  if (ts.isParameter(node)) {
    typeNode = node.type;
  }

  if (!typeNode) {
    // Try to infer from checker
    const type = checker.getTypeAtLocation(node);
    return typeToSchemaRef(type, checker);
  }

  return typeNodeToSchemaRef(typeNode, checker);
}

/**
 * Map a TypeScript type node to a SchemaRef.
 */
function typeNodeToSchemaRef(
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
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
      return { kind: "primitive", type: "null" };
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { kind: "unknown" };
  }

  // Array types
  if (ts.isArrayTypeNode(typeNode)) {
    return {
      kind: "array",
      items: typeNodeToSchemaRef(typeNode.elementType, checker),
    };
  }

  // Type references (class names, generics)
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    const name = ts.isIdentifier(typeName) ? typeName.text : typeName.getText();

    // Unwrap Promise<T> and Observable<T>
    if ((name === "Promise" || name === "Observable") && typeNode.typeArguments?.length === 1) {
      return typeNodeToSchemaRef(typeNode.typeArguments[0], checker);
    }

    if (name === "Array" && typeNode.typeArguments?.length === 1) {
      return {
        kind: "array",
        items: typeNodeToSchemaRef(typeNode.typeArguments[0], checker),
      };
    }

    return { kind: "ref", name };
  }

  return { kind: "unknown" };
}

/**
 * Map a TypeScript Type (from checker) to a SchemaRef.
 */
export function typeToSchemaRef(
  type: ts.Type,
  checker: ts.TypeChecker,
): SchemaRef {
  const typeString = checker.typeToString(type);

  if (type.flags & ts.TypeFlags.String) return { kind: "primitive", type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { kind: "primitive", type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { kind: "primitive", type: "boolean" };
  if (type.flags & ts.TypeFlags.Void) return { kind: "primitive", type: "null" };
  if (type.flags & ts.TypeFlags.Any) return { kind: "unknown" };
  if (type.flags & ts.TypeFlags.Unknown) return { kind: "unknown" };

  // Check for array
  if (checker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return { kind: "array", items: typeToSchemaRef(typeArgs[0], checker) };
    }
    return { kind: "array", items: { kind: "unknown" } };
  }

  // Object types — try to get the symbol name
  const symbol = type.getSymbol();
  if (symbol) {
    const name = symbol.getName();

    // Unwrap Promise<T> / Observable<T>
    if ((name === "Promise" || name === "Observable") && (type as ts.TypeReference).typeArguments?.length === 1) {
      return typeToSchemaRef(
        (type as ts.TypeReference).typeArguments![0],
        checker,
      );
    }

    // Named class/interface
    if (name !== "__object" && name !== "__type") {
      return { kind: "ref", name };
    }
  }

  return { kind: "unknown" };
}

function getParamLocation(
  param: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
  normalizedRoot: string,
): SourceLocation {
  const filePath = sourceFile.fileName.replace(/\\/g, "/");
  const relativePath = filePath.startsWith(normalizedRoot + "/")
    ? filePath.slice(normalizedRoot.length + 1)
    : filePath;
  const { line } = sourceFile.getLineAndCharacterOfPosition(param.getStart());
  return { file: relativePath, line: line + 1 };
}
