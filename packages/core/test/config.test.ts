// ============================================================================
// Config loader tests — resolveConfig precedence and validation
// ============================================================================

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveConfig } from "../src/index.ts";
import { validateConfig } from "../src/config/loader.ts";

describe("resolveConfig", () => {
  // 6.1 CLI Flags Required Without Config
  it("requires project and root when config does not provide them", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "specord-empty-"));

    expect(() => resolveConfig({}, undefined, { cwd })).toThrow(/Missing --project/);
  });

  it("requires root when only project is provided", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "specord-empty-"));

    expect(() =>
      resolveConfig({ project: "tsconfig.json" }, undefined, { cwd }),
    ).toThrow(/Missing --root/);
  });

  // 6.2 CLI Overrides Config
  it("gives CLI flags precedence over config values", () => {
    const resolved = resolveConfig(
      {
        project: "cli-tsconfig.json",
        root: "cli-src",
      },
      {
        source: {
          project: "config-tsconfig.json",
          root: "config-src",
        },
      },
    );

    expect(resolved.project).toContain("cli-tsconfig.json");
    expect(resolved.root).toContain("cli-src");
  });

  // 6.3 Config Values Work Without CLI
  it("uses config source values when CLI flags are absent", () => {
    const resolved = resolveConfig(
      {},
      {
        source: {
          project: "config-tsconfig.json",
          root: "config-src",
        },
      },
    );

    expect(resolved.project).toContain("config-tsconfig.json");
    expect(resolved.root).toContain("config-src");
  });

  it("uses a positional target directory before config source defaults", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "specord-target-"));
    const target = path.join(cwd, "apps", "api");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.writeFileSync(path.join(target, "tsconfig.json"), "{}", "utf8");

    const resolved = resolveConfig(
      {
        target: "apps/api",
      },
      {
        source: {
          project: "config-tsconfig.json",
          root: "config-src",
        },
      },
      { cwd },
    );

    expect(resolved.project).toBe(path.join(target, "tsconfig.json"));
    expect(resolved.root).toBe(path.join(target, "src"));
  });

  it("resolves project and root to absolute paths", () => {
    const resolved = resolveConfig(
      {
        project: "tsconfig.json",
        root: "src",
      },
      undefined,
    );

    // Cross-platform: works on both Windows (C:\...) and Unix (/...)
    expect(path.isAbsolute(resolved.project)).toBe(true);
    expect(path.isAbsolute(resolved.root)).toBe(true);
  });

  it("passes through the merged config object", () => {
    const userConfig = {
      source: {
        project: "tsconfig.json",
        root: "src",
      },
      routing: {
        globalPrefix: "api",
      },
    };

    const resolved = resolveConfig({}, userConfig);

    expect(resolved.config.routing?.globalPrefix).toBe("api");
  });
});

describe("loadConfig", () => {
  it("loads a TypeScript specord.config.ts file in the CLI runtime", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "specord-config-"));
    fs.writeFileSync(
      path.join(cwd, "specord.config.ts"),
      `export default {
        source: {
          project: "examples/nestjs-api/tsconfig.json",
          root: "examples/nestjs-api/src"
        },
        document: {
          title: "Configured API",
          version: "1.2.3"
        },
        ci: {
          failOnUnresolved: true
        }
      };
      `,
      "utf8",
    );

    const config = await loadConfig(cwd);

    expect(config?.document?.title).toBe("Configured API");
    expect(config?.ci?.failOnUnresolved).toBe(true);
    expect(
      fs.readdirSync(cwd).some((name) => name.startsWith(".specord.config.")),
    ).toBe(false);
  });
});

// 6.4 Deprecated Versioning Type Rejection
describe("config validation", () => {
  it("rejects deprecated routing.versioning.type", () => {
    const config = {
      source: { project: "tsconfig.json", root: "src" },
      routing: {
        versioning: { type: "uri" },
      },
    } as any;

    expect(() => validateConfig(config)).toThrow(/strategy/);
  });

  it("accepts routing.versioning.strategy", () => {
    const config = {
      source: { project: "tsconfig.json", root: "src" },
      routing: {
        versioning: { strategy: "uri" as const },
      },
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it.each(["off", "safe"] as const)(
    "accepts inference.responses.anonymousObjects=%s",
    (anonymousObjects) => {
      expect(() =>
        validateConfig({
          inference: { responses: { anonymousObjects } },
        }),
      ).not.toThrow();
    },
  );

  it("rejects unsupported anonymous response inference modes", () => {
    expect(() =>
      validateConfig({
        inference: {
          responses: { anonymousObjects: "aggressive" },
        },
      } as any),
    ).toThrow(/inference\.responses\.anonymousObjects.*off.*safe/);
  });

  it("rejects bigint anonymous response inference modes with a config error", () => {
    expect(() =>
      validateConfig({
        inference: {
          responses: { anonymousObjects: 1n },
        },
      } as any),
    ).toThrow(/inference\.responses\.anonymousObjects.*off.*safe/);
  });

  it("rejects cyclic anonymous response inference modes with a config error", () => {
    const anonymousObjects: { self?: unknown } = {};
    anonymousObjects.self = anonymousObjects;

    expect(() =>
      validateConfig({
        inference: {
          responses: { anonymousObjects },
        },
      } as any),
    ).toThrow(/inference\.responses\.anonymousObjects.*off.*safe/);
  });
});
