#!/usr/bin/env node
/**
 * Run the private Semblia API benchmark when the ignored checkout exists.
 *
 * Default target:
 *   testing/semblia-api/apps/api_v2
 *
 * Optional environment:
 *   SEMBLIA_API_ROOT=absolute/or/relative/path
 *   SPECORD_BENCH_EXPECTED_PATHS=107
 *   SPECORD_BENCH_EXPECTED_OPERATIONS=136
 *   SPECORD_BENCH_REQUIRED=1
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const targetRoot = path.resolve(
  repoRoot,
  process.env.SEMBLIA_API_ROOT ?? "testing/semblia-api/apps/api_v2",
);
const cliPath = path.join(repoRoot, "packages/cli/bin/specord.js");
const expectedPaths = numberFromEnv("SPECORD_BENCH_EXPECTED_PATHS", 107);
const expectedOperations = numberFromEnv("SPECORD_BENCH_EXPECTED_OPERATIONS", 136);
const required = process.env.SPECORD_BENCH_REQUIRED === "1";

if (!fs.existsSync(targetRoot)) {
  const message = `[specord] Semblia benchmark checkout not found at ${targetRoot}; skipping.`;
  if (required) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

if (!fs.existsSync(cliPath)) {
  console.error(`[specord] CLI entrypoint not found at ${cliPath}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [cliPath, "inspect", targetRoot],
  {
    cwd: targetRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const model = JSON.parse(result.stdout);
const summary = summarize(model);
const failures = [];

if (summary.paths !== expectedPaths) {
  failures.push(`paths expected ${expectedPaths}, got ${summary.paths}`);
}
if (summary.operations !== expectedOperations) {
  failures.push(
    `operations expected ${expectedOperations}, got ${summary.operations}`,
  );
}

printSummary(summary, targetRoot);

if (failures.length > 0) {
  console.error(`\n[specord] Semblia benchmark failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log("\n[specord] Semblia route parity benchmark passed.");

function summarize(model) {
  const operations = model.operations ?? [];
  const allDiagnostics = [
    ...(model.diagnostics ?? []),
    ...operations.flatMap((operation) => operation.diagnostics ?? []),
  ];
  const params = operations.flatMap((operation) => operation.params ?? []);
  const responses = operations.flatMap((operation) => operation.responses ?? []);
  const diagnosticsByCode = {};

  for (const diagnostic of allDiagnostics) {
    diagnosticsByCode[diagnostic.code] =
      (diagnosticsByCode[diagnostic.code] ?? 0) + 1;
  }

  return {
    controllers: new Set(operations.map((operation) => operation.controller)).size,
    paths: new Set(operations.map((operation) => operation.path)).size,
    operations: operations.length,
    operationIds: new Set(
      operations.map((operation) => operation.operationId ?? operation.id),
    ).size,
    schemas: Object.keys(model.schemas ?? {}).length,
    securitySchemes: Object.keys(model.securitySchemes ?? {}).length,
    operationsWithParams: operations.filter(
      (operation) => (operation.params ?? []).length > 0,
    ).length,
    totalParams: params.length,
    pathParams: params.filter((param) => param.in === "path").length,
    queryParams: params.filter((param) => param.in === "query").length,
    requestBodies: operations.filter((operation) => operation.requestBody).length,
    responses: responses.length,
    inferredResponses: responses.filter(
      (response) => response.inference?.status === "inferred",
    ).length,
    unresolvedResponses: responses.filter(
      (response) => response.inference?.status === "unresolved",
    ).length,
    inferredSecurityStates: operations.filter(
      (operation) => operation.security?.status === "inferred",
    ).length,
    overriddenSecurityStates: operations.filter(
      (operation) => operation.security?.status === "overridden",
    ).length,
    unresolvedSecurityStates: operations.filter(
      (operation) => operation.security?.status === "unresolved",
    ).length,
    diagnostics: allDiagnostics.length,
    diagnosticsByCode,
  };
}

function printSummary(summary, target) {
  console.log("# Semblia API Benchmark");
  console.log();
  console.log(`Target: ${target}`);
  console.log();
  console.log("| Metric | Count |");
  console.log("| --- | ---: |");
  for (const [key, value] of Object.entries(summary)) {
    if (key === "diagnosticsByCode") continue;
    console.log(`| ${labelFor(key)} | ${value} |`);
  }
  console.log();
  console.log("| Diagnostic code | Count |");
  console.log("| --- | ---: |");
  for (const [code, count] of Object.entries(summary.diagnosticsByCode).sort()) {
    console.log(`| \`${code}\` | ${count} |`);
  }
}

function labelFor(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`[specord] ${name} must be a non-negative integer.`);
    process.exit(1);
  }

  return parsed;
}
