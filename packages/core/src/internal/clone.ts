import { cloneJsonValue, type OpenApiSchemaObject, type SchemaRef } from "@specord/types";

export { cloneJsonValue };

export function cloneOpenApiSchema(
  schema: OpenApiSchemaObject,
): OpenApiSchemaObject {
  return cloneJsonValue(schema);
}

export function cloneSchemaRef(type: SchemaRef): SchemaRef {
  switch (type.kind) {
    case "array":
      return { kind: "array", items: cloneSchemaRef(type.items) };
    case "inline":
      return { kind: "inline", schema: cloneOpenApiSchema(type.schema) };
    case "ref":
      return { kind: "ref", name: type.name };
    case "primitive":
      return { kind: "primitive", type: type.type };
    case "unknown":
      return { kind: "unknown" };
  }
}
