import { cloneJsonValue, type OpenApiSchemaObject } from "@specord/types";

export function cloneOpenApiSchema(
  schema: OpenApiSchemaObject,
): OpenApiSchemaObject {
  return cloneJsonValue(schema);
}
