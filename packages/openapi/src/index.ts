// ============================================================================
// @specord/openapi — OpenAPI 3.1 emission and validation
// ============================================================================

import { Validator } from "@seriousme/openapi-schema-validator";
import type {
  BodyModel,
  InspectionModel,
  OpenApiSchemaObject,
  ParameterModel,
  PropertyModel,
  ResponseModel,
  SchemaModel,
  SchemaRef,
  SpecordConfigV1,
} from "@specord/types";
import { cloneOpenApiSchema } from "./internal/clone.js";

export type OpenApiDocument = Record<string, unknown> & {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

export type ValidationResult = {
  valid: boolean;
  errors: unknown;
};

export function emitOpenApiDocument(
  model: InspectionModel,
  config: SpecordConfigV1 = {},
): OpenApiDocument {
  const schemaNames = new Set(Object.keys(model.schemas));
  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: config.document?.title ?? "Specord API",
      version: config.document?.version ?? "0.1.0",
    },
    paths: {},
  };

  if (config.document?.servers?.length) {
    document.servers = config.document.servers;
  }

  if (config.document?.tags?.length) {
    document.tags = config.document.tags;
  }

  for (const operation of [...model.operations].sort(compareOperations)) {
    const pathItem = (document.paths[operation.path] ??= {});
    pathItem[operation.method] = {
      ...(operation.tags?.length ? { tags: operation.tags } : {}),
      ...(operation.summary ? { summary: operation.summary } : {}),
      ...(operation.description ? { description: operation.description } : {}),
      operationId: operation.operationId ?? operation.id,
      ...(operation.params.length
        ? { parameters: operation.params.map((parameter) => parameterToOpenApi(parameter, schemaNames)) }
        : {}),
      ...(operation.requestBody
        ? { requestBody: requestBodyToOpenApi(operation.requestBody, schemaNames) }
        : {}),
      responses: responsesToOpenApi(operation.responses, schemaNames),
      ...(operation.openapi?.security ? { security: operation.openapi.security } : {}),
    };
  }

  const schemas = schemasToOpenApi(model.schemas, schemaNames);
  const securitySchemes = model.securitySchemes;

  if (Object.keys(schemas).length > 0 || securitySchemes) {
    document.components = {
      ...(Object.keys(schemas).length > 0 ? { schemas } : {}),
      ...(securitySchemes ? { securitySchemes: sortObject(securitySchemes) } : {}),
    };
  }

  return document;
}

export async function validateOpenApiDocument(
  document: OpenApiDocument,
): Promise<ValidationResult> {
  const validator = new Validator({ strict: false });
  const result = await validator.validate(document);
  return {
    valid: result.valid,
    errors: result.errors,
  };
}

function compareOperations(
  left: InspectionModel["operations"][number],
  right: InspectionModel["operations"][number],
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.method.localeCompare(right.method) ||
    left.id.localeCompare(right.id)
  );
}

function parameterToOpenApi(
  parameter: ParameterModel,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.in === "path" ? true : parameter.required,
    ...(parameter.description ? { description: parameter.description } : {}),
    schema: schemaRefToOpenApi(
      parameter.type,
      {
        default: parameter.default,
        enum: parameter.enum,
        format: parameter.format,
        constraints: parameter.constraints,
      },
      schemaNames,
    ),
  };
}

function requestBodyToOpenApi(
  body: BodyModel,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    required: body.required,
    content: {
      "application/json": {
        schema: schemaRefToOpenApi(body.schema, {}, schemaNames),
      },
    },
  };
}

function responsesToOpenApi(
  responses: ResponseModel[],
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const response of [...responses].sort((a, b) => a.status - b.status)) {
    result[String(response.status)] = responseToOpenApi(response, schemaNames);
  }

  if (Object.keys(result).length === 0) {
    result.default = { description: "Response." };
  }

  return result;
}

function responseToOpenApi(
  response: ResponseModel,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  if (response.openapi) {
    const openapi: Record<string, unknown> = { ...response.openapi };
    if (response.schema && !("content" in openapi)) {
      openapi.content = responseContent(response, schemaNames);
    }
    return openapi;
  }

  const base: Record<string, unknown> = {
    description: response.description ?? "Response.",
  };

  if (response.schema && response.status !== 204) {
    base.content = responseContent(response, schemaNames);
  }

  return base;
}

function responseContent(
  response: ResponseModel,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    [response.contentType ?? "application/json"]: {
      schema: schemaRefToOpenApi(
        response.schema ?? { kind: "unknown" },
        {},
        schemaNames,
      ),
    },
  };
}

function schemasToOpenApi(
  schemas: Record<string, SchemaModel>,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(sortObject(schemas))) {
    result[name] = schemaToOpenApi(schema, schemaNames);
  }

  return result;
}

function schemaToOpenApi(
  schema: SchemaModel,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  const generated: Record<string, unknown> = {
    type: "object",
    ...(schema.required.length ? { required: [...schema.required].sort() } : {}),
    properties: Object.fromEntries(
      Object.entries(sortObject(schema.properties)).map(([name, property]) => [
        name,
        propertyToOpenApi(property, schemaNames),
      ]),
    ),
  };

  if (schema.openapi) {
    return mergeOpenApiObject(generated, schema.openapi);
  }

  return generated;
}

function propertyToOpenApi(
  property: PropertyModel,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  return schemaRefToOpenApi(
    property.type,
    {
      description: property.description,
      default: property.default,
      example: property.example,
      examples: property.examples,
      enum: property.enum,
      format: property.format,
      deprecated: property.deprecated,
      readOnly: property.readOnly,
      writeOnly: property.writeOnly,
      nullable: property.nullable,
      constraints: property.constraints,
    },
    schemaNames,
  );
}

function schemaRefToOpenApi(
  ref: SchemaRef,
  metadata: {
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
  } = {},
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  const base = schemaRefBaseToOpenApi(ref, schemaNames);
  const next: Record<string, unknown> = { ...base };

  if (metadata.description !== undefined) next.description = metadata.description;
  if (metadata.default !== undefined) next.default = metadata.default;
  if (metadata.example !== undefined) next.example = metadata.example;
  if (metadata.examples !== undefined) next.examples = metadata.examples;
  if (metadata.enum !== undefined) next.enum = metadata.enum;
  if (metadata.format !== undefined) next.format = metadata.format;
  if (metadata.deprecated !== undefined) next.deprecated = metadata.deprecated;
  if (metadata.readOnly !== undefined) next.readOnly = metadata.readOnly;
  if (metadata.writeOnly !== undefined) next.writeOnly = metadata.writeOnly;
  if (metadata.nullable === true && typeof next.type === "string") {
    next.type = [next.type, "null"];
  }

  if (metadata.constraints) {
    for (const [key, value] of Object.entries(metadata.constraints)) {
      if (key === "type" || value === undefined) continue;
      next[key] = value;
    }
  }

  return next;
}

function schemaRefBaseToOpenApi(
  ref: SchemaRef,
  schemaNames: ReadonlySet<string>,
): Record<string, unknown> {
  switch (ref.kind) {
    case "primitive":
      return { type: ref.type === "null" ? "null" : ref.type };
    case "array":
      return { type: "array", items: schemaRefToOpenApi(ref.items, {}, schemaNames) };
    case "inline":
      return cloneOpenApiSchema(ref.schema);
    case "ref":
      if (!schemaNames.has(ref.name)) {
        return {};
      }
      return { $ref: `#/components/schemas/${ref.name}` };
    case "unknown":
      return {};
  }
}

function mergeOpenApiObject(
  generated: Record<string, unknown>,
  override: OpenApiSchemaObject,
): Record<string, unknown> {
  if ("$ref" in override) {
    return override;
  }

  return {
    ...generated,
    ...override,
    properties: {
      ...(isRecord(generated.properties) ? generated.properties : {}),
      ...(isRecord(override.properties) ? override.properties : {}),
    },
  };
}

function sortObject<T>(object: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
