// ============================================================================
// @specord/ui docs shell tests
// ============================================================================

import { describe, expect, it } from "vitest";
import { renderDocsUi } from "../src/index.js";

describe("renderDocsUi", () => {
  it("renders an escaped docs shell with title and source wired to the OpenAPI endpoint", () => {
    const html = renderDocsUi({
      title: "<Specord Premium Docs>",
      openApiUrl: "/api/openapi.json",
      appUrl: "http://localhost:3000",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("&lt;Specord Premium Docs&gt;");
    expect(html).not.toContain("<title><Specord Premium Docs>");
    expect(html).toContain("/api/openapi.json");
    expect(html).toContain("http://localhost:3000");
    expect(html).toContain("data-specord-docs-shell");
  });

  it("renders our brand new visual three-column structure", () => {
    const html = renderDocsUi({ openApiUrl: "/api/openapi.json" });

    expect(html).toContain("data-specord-sidebar");
    expect(html).toContain("data-specord-workspace");
    expect(html).toContain("data-specord-toolkit");
  });

  it("exposes controls for fuzzy search, sidebar nav lists, stats, and raw JSON document copying", () => {
    const html = renderDocsUi({ openApiUrl: "/api/openapi.json" });

    expect(html).toContain("data-specord-search-input");
    expect(html).toContain("data-specord-navigation");
    expect(html).toContain("data-specord-ops-count");
    expect(html).toContain("data-specord-copy-json");
  });

  it("ships standard developer toolkit tabs (Try It, Snippets, Raw Spec)", () => {
    const html = renderDocsUi({ openApiUrl: "/api/openapi.json" });

    expect(html).toContain('data-toolkit-tab="try"');
    expect(html).toContain('data-toolkit-tab="snippets"');
    expect(html).toContain('data-toolkit-tab="spec"');
    expect(html).toContain("data-specord-toolkit-content");
    expect(html).toContain("data-specord-toast-container");
    expect(html).toContain("data-specord-try-target");
    expect(html).toContain("resolveTryItBaseUrl");
  });

  it("can disable same-origin Try It fallback for standalone docs servers", () => {
    const html = renderDocsUi({
      openApiUrl: "/api/openapi.json",
      sameOriginTryIt: false,
    });

    expect(html).toContain('"sameOriginTryIt":false');
  });

  it("keeps injected client configuration HTML-safe", () => {
    const html = renderDocsUi({
      title: "Specord",
      openApiUrl: "/api/openapi.json?next=<script>",
    });

    expect(html).toContain("/api/openapi.json?next=\\u003cscript>");
    expect(html).not.toContain('"openApiUrl":"/api/openapi.json?next=<script>"');
  });
});
