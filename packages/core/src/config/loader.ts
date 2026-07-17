// ============================================================================
// Config — loader
// Loads and validates specord.config.ts with precedence rules:
//   CLI flags > positional project directory > config file > current directory defaults
// ============================================================================

import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import type { SpecordConfigV1 } from "@specord/types";

/**
 * Attempt to load `specord.config.ts` from the given directory.
 * Returns undefined if no config file is found.
 * Throws on validation errors (e.g., deprecated `versioning.type` key).
 */
export async function loadConfig(
  cwd: string,
): Promise<SpecordConfigV1 | undefined> {
  const configPath = path.resolve(cwd, "specord.config.ts");

  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  const config = await importTypeScriptConfig(configPath);

  validateConfig(config);
  return config;
}

async function importTypeScriptConfig(
  configPath: string,
): Promise<SpecordConfigV1> {
  const source = fs.readFileSync(configPath, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: configPath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      esModuleInterop: true,
      isolatedModules: true,
      sourceMap: false,
      inlineSourceMap: false,
    },
  });

  const hash = crypto
    .createHash("sha256")
    .update(configPath)
    .update(source)
    .digest("hex")
    .slice(0, 12);
  const compiledPath = path.resolve(
    path.dirname(configPath),
    `.specord.config.${process.pid}.${hash}.mjs`,
  );

  fs.writeFileSync(compiledPath, compiled.outputText, "utf8");

  try {
    const configUrl = `${pathToFileURL(compiledPath).href}?t=${Date.now()}`;
    const module = await import(configUrl);
    return module.default ?? module;
  } finally {
    fs.rmSync(compiledPath, { force: true });
  }
}

/**
 * Validate a loaded config and throw on known issues.
 */
export function validateConfig(config: SpecordConfigV1): void {
  // Reject deprecated `versioning.type` key
  const routing = isObject(config.routing) ? config.routing : undefined;
  const versioningValue = routing?.versioning;
  if (isObject(versioningValue)) {
    const versioning = versioningValue;
    if ("type" in versioning && !("strategy" in versioning)) {
      throw new Error(
        `[specord] Config error in routing.versioning: ` +
        `"type" is deprecated. Use "strategy" instead.\n` +
        `  Change: versioning: { type: "uri" }\n` +
        `  To:     versioning: { strategy: "uri" }`,
      );
    }
  }

  const inference = isObject(config.inference) ? config.inference : undefined;
  const responses = isObject(inference?.responses)
    ? inference.responses
    : undefined;
  const anonymousObjects = responses?.anonymousObjects;

  if (
    anonymousObjects !== undefined &&
    anonymousObjects !== "off" &&
    anonymousObjects !== "safe"
  ) {
    throw new Error(
      `[specord] Config error in inference.responses.anonymousObjects: ` +
        `expected "off" or "safe", got ${formatConfigValue(anonymousObjects)}`,
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConfigValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fall through to string coercion for values JSON cannot serialize.
  }

  try {
    return String(value);
  } catch {
    return "<unprintable>";
  }
}

/** CLI flags that can override config values. */
export interface CLIFlags {
  project?: string;
  root?: string;
  target?: string;
}

/**
 * Merge CLI flags, config file, and defaults following precedence rules:
 *   1. CLI flags override config file values.
 *   2. Positional project directory defaults override config source values.
 *   3. Config file values override current directory defaults.
 *   4. Current directory defaults apply only where neither CLI nor config provides values.
 */
export interface ResolvedConfig {
  project: string;
  root: string;
  config: SpecordConfigV1;
}

export interface ResolveConfigOptions {
  cwd?: string;
}

export function resolveConfig(
  flags: CLIFlags,
  fileConfig: SpecordConfigV1 | undefined,
  options: ResolveConfigOptions = {},
): ResolvedConfig {
  const config = fileConfig ?? {};
  const cwd = options.cwd ?? process.cwd();
  const targetDir = flags.target ? path.resolve(cwd, flags.target) : cwd;

  const project =
    resolveUserPath(flags.project, cwd) ??
    inferProjectPath(flags.target ? targetDir : undefined) ??
    resolveUserPath(config.source?.project, cwd) ??
    inferProjectPath(targetDir);
  const root =
    resolveUserPath(flags.root, cwd) ??
    inferRootPath(flags.target ? targetDir : undefined) ??
    resolveUserPath(config.source?.root, cwd) ??
    inferRootPath(targetDir);

  if (!project) {
    throw new Error(
      "[specord] Missing --project flag or source.project in config. " +
      sourceHint(targetDir),
    );
  }

  if (!root) {
    throw new Error(
      "[specord] Missing --root flag or source.root in config. " +
      sourceHint(targetDir),
    );
  }

  return {
    project,
    root,
    config,
  };
}

function resolveUserPath(value: string | undefined, cwd: string): string | undefined {
  return value ? path.resolve(cwd, value) : undefined;
}

function inferProjectPath(targetDir: string | undefined): string | undefined {
  if (!targetDir) {
    return undefined;
  }

  const candidate = path.join(targetDir, "tsconfig.json");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function inferRootPath(targetDir: string | undefined): string | undefined {
  if (!targetDir) {
    return undefined;
  }

  const candidate = path.join(targetDir, "src");
  return isDirectory(candidate) ? candidate : undefined;
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function sourceHint(targetDir: string): string {
  return (
    `Could not infer both tsconfig.json and src/ from ${targetDir}. ` +
    "Run from a Nest project, pass a project directory, add source.project/source.root to specord.config.ts, or use --project/--root."
  );
}
