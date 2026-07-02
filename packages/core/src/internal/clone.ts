import type { OpenApiSchemaObject, SchemaRef } from "@specord/types";

export function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((child) => cloneJsonValue(child)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        cloneJsonValue(child),
      ]),
    ) as T;
  }

  return value;
}

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
