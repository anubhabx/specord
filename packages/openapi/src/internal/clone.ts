import type { OpenApiSchemaObject } from "@specord/types";

export function cloneOpenApiSchema(
  schema: OpenApiSchemaObject,
): OpenApiSchemaObject {
  return cloneJsonValue(schema);
}

function cloneJsonValue<T>(value: T): T {
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
