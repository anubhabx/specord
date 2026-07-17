// ============================================================================
// Specord V1 Configuration Types
// Shape for specord.config.ts — the precision layer.
// See: spec/specord-v1-extractor-spec.md §Minimum v1 config contract
// ============================================================================

/** OpenAPI Reference Object fragment. */
export type OpenApiReferenceObject = {
  $ref: string;
  summary?: string;
  description?: string;
};

/** OpenAPI 3.1 Schema Object or Reference Object fragment. */
export type OpenApiSchemaObject =
  | OpenApiReferenceObject
  | (Record<string, unknown> & {
      type?: string | string[];
      title?: string;
      description?: string;
      format?: string;
      default?: unknown;
      enum?: unknown[];
      required?: string[];
      properties?: Record<string, OpenApiSchemaObject>;
      items?: OpenApiSchemaObject;
      allOf?: OpenApiSchemaObject[];
      oneOf?: OpenApiSchemaObject[];
      anyOf?: OpenApiSchemaObject[];
      not?: OpenApiSchemaObject;
      additionalProperties?: boolean | OpenApiSchemaObject;
    });

/** OpenAPI Media Type Object fragment. */
export type OpenApiMediaTypeObject = Record<string, unknown> & {
  schema?: OpenApiSchemaObject;
  example?: unknown;
  examples?: Record<string, unknown>;
  encoding?: Record<string, unknown>;
};

/** OpenAPI Response Object or Reference Object fragment. */
export type OpenApiResponseObject =
  | OpenApiReferenceObject
  | (Record<string, unknown> & {
      description: string;
      headers?: Record<string, unknown>;
      content?: Record<string, OpenApiMediaTypeObject>;
      links?: Record<string, unknown>;
    });

/** OpenAPI Responses Object fragment, keyed by status code or `default`. */
export type OpenApiResponsesObject = Record<string, OpenApiResponseObject>;

/** OpenAPI Security Scheme Object fragment. */
export type OpenApiSecuritySchemeObject = Record<string, unknown> & {
  type: "apiKey" | "http" | "mutualTLS" | "oauth2" | "openIdConnect";
  description?: string;
  name?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
};

/** OpenAPI Security Requirement Object fragment. */
export type OpenApiSecurityRequirementObject = Record<string, string[]>;

/** OpenAPI-shaped operation override fields supported in V1 config. */
export type OperationOverrideConfig = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: OpenApiSecurityRequirementObject[];
  responses?: OpenApiResponsesObject;
  exclude?: boolean;
};

/**
 * V1 configuration shape for `specord.config.ts`.
 * Config is optional; CLI flags take precedence.
 */
export type SpecordConfigV1 = {
  document?: {
    title?: string;
    version?: string;
    servers?: Array<{ url: string; description?: string }>;
    tags?: Array<{ name: string; description?: string }>;
  };

  source?: {
    project?: string;
    root?: string;
    include?: string[];
    exclude?: string[];
  };

  routing?: {
    globalPrefix?: string;
    versioning?: {
      /** Use `strategy`, not `type`. Config loader rejects `type` with a migration error. */
      strategy: "uri" | "header" | "media-type";
      value?: string;
    };
  };

  inference?: {
    responses?: {
      anonymousObjects?: "off" | "safe";
    };
  };

  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;

  operations?: Record<string, OperationOverrideConfig>;

  schemas?: Record<string, OpenApiSchemaObject>;

  ci?: {
    failOnInvalid?: boolean;
    failOnUnresolved?: boolean;
    failOnWarning?: boolean;
  };
};
