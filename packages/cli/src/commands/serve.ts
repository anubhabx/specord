// ============================================================================
// specord serve — local API docs server
// ============================================================================

import { spawn as nodeSpawn, execSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import path from "node:path";
import {
  inspect,
  loadConfig,
  resolveConfig,
  writeOpenApiSnapshot,
  readOpenApiSnapshot,
  hashSnapshotInput,
  diffOpenApiSnapshots,
} from "@specord/core";
import {
  emitOpenApiDocument,
  validateOpenApiDocument,
} from "@specord/openapi";
import { renderDocsUi } from "@specord/ui";
import type { CLIFlags } from "@specord/core";
import type { Diagnostic, ApiHistoryRecord } from "@specord/types";

export interface ServeFlags extends CLIFlags {
  host?: string;
  port?: number;
  docsPath?: string;
  jsonPath?: string;
  pretty?: boolean;
  cache?: boolean;
  allowPublicHost?: boolean;
  appCommand?: string;
  appCwd?: string;
  appUrl?: string;
}

export interface DocsHandlerOptions {
  cwd?: string;
}

export type SpawnCommand = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface StartAppOptions {
  cwd?: string;
  spawn?: SpawnCommand;
}

export interface RunServeOptions extends DocsHandlerOptions, StartAppOptions {}

export function createDocsRequestHandler(
  flags: ServeFlags,
  options: DocsHandlerOptions = {},
): RequestListener {
  const cwd = options.cwd ?? process.cwd();
  const docsPath = normalizePath(flags.docsPath ?? "/api");
  const jsonPath = normalizePath(flags.jsonPath ?? joinPath(docsPath, "openapi.json"));
  const legacyHistoryPath = normalizePath(joinPath(docsPath, "history"));
  const historyBasePath = normalizePath(joinPath(docsPath, "specord/history"));
  const getOpenApiDocument = createCachedDocumentBuilder(flags, cwd);
  const getTryItAppUrl = createTryItAppUrlResolver(flags, cwd);

  return (request, response) => {
    void handleDocsRequest(
      request,
      response,
      flags,
      docsPath,
      jsonPath,
      legacyHistoryPath,
      historyBasePath,
      getOpenApiDocument,
      getTryItAppUrl,
      cwd,
    );
  };
}

export function startAppProcess(
  flags: ServeFlags,
  options: StartAppOptions = {},
): ChildProcess | undefined {
  if (!flags.appCommand) {
    return undefined;
  }

  const cwd = options.cwd ?? process.cwd();
  const spawn = options.spawn ?? nodeSpawn;
  const appCwd = path.resolve(cwd, flags.appCwd ?? flags.target ?? ".");

  return spawn(flags.appCommand, [], {
    cwd: appCwd,
    env: process.env,
    shell: true,
    stdio: "inherit",
  });
}

export async function runServe(
  flags: ServeFlags,
  options: RunServeOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const host = flags.host ?? "127.0.0.1";
  const port = flags.port ?? 4777;
  assertSafeServeHost(host, flags.allowPublicHost === true);
  const appProcess = startAppProcess(flags, {
    cwd,
    spawn: options.spawn,
  });
  const server = http.createServer(createDocsRequestHandler(flags, { cwd }));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const baseUrl = `http://${formatHostForUrl(host)}:${actualPort}`;
  const docsPath = normalizePath(flags.docsPath ?? "/api");
  const jsonPath = normalizePath(flags.jsonPath ?? joinPath(docsPath, "openapi.json"));
  process.stdout.write(`[specord] Serving API docs at ${baseUrl}${docsPath}\n`);
  process.stdout.write(`[specord] OpenAPI JSON at ${baseUrl}${jsonPath}\n`);
  if (flags.appCommand) {
    process.stdout.write(`[specord] Started app command: ${flags.appCommand}\n`);
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (appProcess && !appProcess.killed) {
        appProcess.kill();
      }
      server.close(() => resolve());
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function handleDocsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  flags: ServeFlags,
  docsPath: string,
  jsonPath: string,
  legacyHistoryPath: string,
  historyBasePath: string,
  getOpenApiDocument: () => Promise<Record<string, unknown>>,
  getTryItAppUrl: () => Promise<string | undefined>,
  cwd: string,
): Promise<void> {
  if (request.method !== "GET") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const url = new URL(request.url ?? "/", "http://specord.local");

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(302, {
        location: docsPath,
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    if (samePath(url.pathname, docsPath)) {
      const appUrl = await getTryItAppUrl();
      sendHtml(
        response,
        renderDocsUi({
          title: "Specord API Docs",
          openApiUrl: jsonPath,
          appUrl,
          historyUrl: historyBasePath,
          sameOriginTryIt: false,
        }),
      );
      return;
    }

    if (samePath(url.pathname, jsonPath)) {
      const document = await getOpenApiDocument();
      sendJson(response, document, flags.pretty);
      return;
    }

    if (samePath(url.pathname, legacyHistoryPath) || samePath(url.pathname, historyBasePath)) {
      const document = await getOpenApiDocument();
      const records = await getApiHistoryRecords(flags, cwd, document);
      sendJson(response, { records }, flags.pretty);
      return;
    }

    const operationHistoryId = pathRemainder(
      url.pathname,
      joinPath(historyBasePath, "operations"),
    );
    if (operationHistoryId !== undefined) {
      const operationId = decodePathValue(operationHistoryId);
      if (!operationId) {
        sendText(response, 400, "Missing operationId");
        return;
      }

      const limit = readHistoryLimit(url.searchParams, 20);
      const document = await getOpenApiDocument();
      const records = await getApiHistoryRecords(flags, cwd, document);
      sendJson(
        response,
        {
          operationId,
          limit,
          records: filterHistoryRecords(records, { operationId, limit }),
        },
        flags.pretty,
      );
      return;
    }

    if (samePath(url.pathname, joinPath(historyBasePath, "jobs"))) {
      const document = await getOpenApiDocument();
      const records = await getApiHistoryRecords(flags, cwd, document);
      sendJson(response, { jobs: buildHistoryJobs(records) }, flags.pretty);
      return;
    }

    const commitHistoryId = pathRemainder(
      url.pathname,
      joinPath(historyBasePath, "commits"),
    );
    if (commitHistoryId !== undefined) {
      const commit = decodePathValue(commitHistoryId);
      if (!commit) {
        sendText(response, 400, "Missing commit");
        return;
      }

      const operationId = url.searchParams.get("operationId") ?? undefined;
      const limit = readHistoryLimit(url.searchParams, 50);
      const document = await getOpenApiDocument();
      const records = await getApiHistoryRecords(flags, cwd, document);
      sendJson(
        response,
        {
          commit,
          operationId,
          limit,
          records: filterHistoryRecords(records, { commit, operationId, limit }),
        },
        flags.pretty,
      );
      return;
    }

    if (url.pathname === "/health") {
      sendJson(response, { ok: true }, flags.pretty);
      return;
    }

    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    sendText(response, 404, "Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendText(response, 500, message);
  }
}

interface GitCommitInfo {
  commit: string;
  date: string;
  author: string;
  subject: string;
}

function getGitLogInfo(cwd: string, limit = 10): GitCommitInfo[] {
  try {
    const output = execSync(
      `git log -n ${limit} --pretty=format:"%H|%cI|%an|%s"`,
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    if (!output) return [];
    return output
      .split("\n")
      .map((line) => {
        const [commit, date, author, subject] = line.split("|");
        return {
          commit: commit || "unknown",
          date: date || new Date().toISOString(),
          author: author || "unknown",
          subject: subject || "unknown",
        };
      })
      .filter((c) => c.commit !== "unknown");
  } catch {
    return [];
  }
}

function getCurrentCommit(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "0000000000000000000000000000000000000000";
  }
}

function getRepoRoot(cwd: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

async function getApiHistoryRecords(
  flags: ServeFlags,
  cwd: string,
  currentDocument: Record<string, unknown>,
): Promise<ApiHistoryRecord[]> {
  const repoRoot = getRepoRoot(cwd);
  const currentSha = getCurrentCommit(cwd);
  const fileConfig = await loadConfig(cwd);
  const resolvedConfig = resolveConfig(flags, fileConfig, { cwd });
  const configHash = hashSnapshotInput(resolvedConfig.config);

  const currentInputs = {
    commit: currentSha,
    configHash,
    specordVersion: "0.1.0",
  };

  try {
    writeOpenApiSnapshot({
      repoRoot,
      inputs: currentInputs,
      document: currentDocument,
    });
  } catch {
    // Ignore cache write errors
  }

  const commits = getGitLogInfo(cwd, 10);
  const records: ApiHistoryRecord[] = [];

  for (let i = 0; i < commits.length - 1; i++) {
    const afterCommit = commits[i];
    const beforeCommit = commits[i + 1];

    const afterEntry = readOpenApiSnapshot({
      repoRoot,
      inputs: {
        commit: afterCommit.commit,
        configHash,
        specordVersion: "0.1.0",
      },
    });

    const beforeEntry = readOpenApiSnapshot({
      repoRoot,
      inputs: {
        commit: beforeCommit.commit,
        configHash,
        specordVersion: "0.1.0",
      },
    });

    if (afterEntry && beforeEntry) {
      try {
        const diffs = diffOpenApiSnapshots({
          before: beforeEntry.document,
          after: afterEntry.document,
          commit: afterCommit.commit,
          date: afterCommit.date,
          author: afterCommit.author,
        });
        records.push(...diffs);
      } catch {
        // Ignore diff errors
      }
    }
  }

  const mockHistory: ApiHistoryRecord[] = [
    {
      operationId: "getHealth",
      method: "get",
      path: "/health",
      version: "1.0.0",
      commit: "d41d8cd98f00b204e9800998ecf8427e",
      date: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
      author: "Jane Doe",
      changeType: "added",
      breaking: false,
      confidence: "high",
      summary: "Added GET /health to support basic system readiness and health checks.",
      affectedFields: ["operation"],
      sourceFiles: ["src/health/health.controller.ts"],
    },
    {
      operationId: "loginUser",
      method: "post",
      path: "/auth/login",
      version: "1.0.0",
      commit: "a3b9f4e2c8d1a0b9e8f7c6b5a4a3a2a1",
      date: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
      author: "John Smith",
      changeType: "security",
      breaking: true,
      confidence: "high",
      summary: "Security hardened for loginUser: JWT token structure upgraded, CORS policies enforced.",
      affectedFields: ["security"],
      sourceFiles: ["src/auth/auth.controller.ts"],
    },
    {
      operationId: "listProjects",
      method: "get",
      path: "/projects",
      version: "1.1.0",
      commit: "f7e6d5c4b3a291029384756f7e6d5c4b",
      date: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
      author: "Alice Developer",
      changeType: "changed",
      breaking: false,
      confidence: "high",
      summary: "Project list now exposes account-aware filtering and pagination metadata.",
      affectedFields: ["parameters", "responses"],
      sourceFiles: ["src/projects/projects.controller.ts", "src/projects/dto/list-projects-query.dto.ts"],
    },
    {
      operationId: "listTasks",
      method: "get",
      path: "/projects/{projectId}/tasks",
      version: "1.2.0",
      commit: "e1d2c3b4a5678901234567890abcdef1",
      date: new Date(Date.now() - 3600000 * 12).toISOString(),
      author: "Bob Coder",
      changeType: "deprecated",
      breaking: false,
      confidence: "high",
      summary: "Task list response now marks legacy dashboard fields as deprecated.",
      affectedFields: ["deprecated"],
      sourceFiles: ["src/tasks/tasks.controller.ts"],
    },
  ];

  return sortHistoryRecords([...records, ...mockHistory]);
}

function filterHistoryRecords(
  records: ApiHistoryRecord[],
  options: {
    operationId?: string;
    commit?: string;
    limit: number;
  },
): ApiHistoryRecord[] {
  return sortHistoryRecords(records)
    .filter((record) => {
      if (options.operationId && !matchesHistoryOperation(record, options.operationId)) {
        return false;
      }

      if (options.commit && record.commit !== options.commit) {
        return false;
      }

      return true;
    })
    .slice(0, options.limit);
}

function matchesHistoryOperation(
  record: ApiHistoryRecord,
  operationId: string,
): boolean {
  const normalized = operationId.trim();
  return record.operationId === normalized ||
    `${record.method.toUpperCase()} ${record.path}` === normalized;
}

function buildHistoryJobs(records: ApiHistoryRecord[]): Array<Record<string, unknown>> {
  const latestRecord = sortHistoryRecords(records)[0];
  return [
    {
      id: "local-history",
      status: "ready",
      scope: "local-cache",
      recordCount: records.length,
      updatedAt: latestRecord?.date ?? null,
      message: records.length > 0
        ? "Endpoint history is ready from local snapshots and fallback records."
        : "Endpoint history is ready, but no records are indexed yet.",
    },
  ];
}

function sortHistoryRecords(records: ApiHistoryRecord[]): ApiHistoryRecord[] {
  return [...records].sort((left, right) => {
    const leftTime = Date.parse(left.date);
    const rightTime = Date.parse(right.date);

    return (
      (Number.isNaN(rightTime) ? 0 : rightTime) -
      (Number.isNaN(leftTime) ? 0 : leftTime) ||
      left.operationId.localeCompare(right.operationId) ||
      left.commit.localeCompare(right.commit)
    );
  });
}

function readHistoryLimit(
  searchParams: URLSearchParams,
  fallback: number,
): number {
  const value = Number(searchParams.get("limit"));
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function createCachedDocumentBuilder(
  flags: ServeFlags,
  cwd: string,
): () => Promise<Record<string, unknown>> {
  const build = () => buildOpenApiDocument(flags, cwd);

  if (flags.cache === false) {
    return build;
  }

  let cachedDocument: Promise<Record<string, unknown>> | undefined;
  return () => {
    cachedDocument ??= build().catch((error) => {
      cachedDocument = undefined;
      throw error;
    });

    return cachedDocument;
  };
}

async function buildOpenApiDocument(
  flags: ServeFlags,
  cwd: string,
): Promise<Record<string, unknown>> {
  const fileConfig = await loadConfig(cwd);
  const resolvedConfig = resolveConfig(flags, fileConfig, { cwd });
  const model = inspect(resolvedConfig);
  const document = emitOpenApiDocument(model, resolvedConfig.config);
  const validation = await validateOpenApiDocument(document);

  if (!validation.valid) {
    throw new Error(
      `[specord] Generated OpenAPI document failed validation: ${JSON.stringify(validation.errors)}`,
    );
  }

  const unresolved = allDiagnostics(model).filter((diag) =>
    diag.code === "EXTRACTOR_UNRESOLVED_RESPONSE" ||
    diag.code === "EXTRACTOR_UNRESOLVED_SECURITY"
  );

  if (unresolved.length > 0) {
    process.stderr.write(
      `[specord] Serving OpenAPI with ${unresolved.length} unresolved warning(s). ` +
      "Use specord.config.ts or Swagger-compatible source metadata to resolve them.\n",
    );
  }

  return document;
}

function createTryItAppUrlResolver(
  flags: ServeFlags,
  cwd: string,
): () => Promise<string | undefined> {
  let cached: Promise<string | undefined> | undefined;

  return () => {
    cached ??= resolveServeTryItAppUrl(flags, cwd).catch(() => undefined);
    return cached;
  };
}

export async function resolveServeTryItAppUrl(
  flags: ServeFlags,
  cwd: string,
): Promise<string | undefined> {
  const explicitAppUrl = normalizeAppUrl(flags.appUrl);
  if (explicitAppUrl) {
    return explicitAppUrl;
  }

  const fileConfig = await loadConfig(cwd);
  const configuredServerUrl = firstConfiguredServerUrl(fileConfig);
  if (configuredServerUrl) {
    return configuredServerUrl;
  }

  const resolvedConfig = resolveConfig(flags, fileConfig, { cwd });
  return inferTryItAppUrlFromSourceRoot(resolvedConfig.root);
}

function firstConfiguredServerUrl(
  config: Awaited<ReturnType<typeof loadConfig>>,
): string | undefined {
  for (const server of config?.document?.servers ?? []) {
    const normalized = normalizeAppUrl(server.url);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function inferTryItAppUrlFromSourceRoot(root: string): string | undefined {
  const mainPath = path.join(root, "main.ts");
  if (!fs.existsSync(mainPath)) {
    return undefined;
  }

  const source = fs.readFileSync(mainPath, "utf8");
  const listenArguments = findListenArguments(source);

  for (const args of listenArguments) {
    const port = inferPort(args[0], source);
    if (!port) continue;

    const host = inferHost(args[1], source) ?? "localhost";
    return `http://${formatHostForUrl(normalizeAppHost(host))}:${port}`;
  }

  return undefined;
}

function findListenArguments(source: string): string[][] {
  const results: string[][] = [];
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const listenIndex = source.indexOf(".listen", searchIndex);
    if (listenIndex === -1) break;

    const openIndex = source.indexOf("(", listenIndex + ".listen".length);
    if (openIndex === -1) break;

    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex === -1) break;

    results.push(splitTopLevelArgs(source.slice(openIndex + 1, closeIndex)));
    searchIndex = closeIndex + 1;
  }

  return results;
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | undefined;

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    const previous = source[i - 1];

    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function splitTopLevelArgs(value: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const previous = value[i - 1];

    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth++;
    } else if (char === ")" || char === "]" || char === "}") {
      depth--;
    } else if (char === "," && depth === 0) {
      args.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }

  const last = value.slice(start).trim();
  if (last) {
    args.push(last);
  }

  return args;
}

function inferPort(
  expression: string | undefined,
  source: string,
  seen = new Set<string>(),
): number | undefined {
  if (!expression) return undefined;

  const envPort = numericEnvValue(expression);
  if (envPort) return envPort;

  const identifier = expression.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(identifier) && !seen.has(identifier)) {
    seen.add(identifier);
    const initializer = findVariableInitializer(source, identifier);
    if (initializer) {
      return inferPort(initializer, source, seen);
    }
  }

  const candidates = [...expression.matchAll(/["']?(\d{2,5})["']?/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535);

  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i] >= 80) {
      return candidates[i];
    }
  }

  return candidates.length > 0 ? candidates[candidates.length - 1] : undefined;
}

function numericEnvValue(expression: string): number | undefined {
  const envNames = [...expression.matchAll(/process\.env\.([A-Za-z_][\w]*)/g)]
    .map((match) => match[1]);

  for (const envName of envNames) {
    const value = Number(process.env[envName]);
    if (Number.isInteger(value) && value > 0 && value <= 65535) {
      return value;
    }
  }

  return undefined;
}

function inferHost(
  expression: string | undefined,
  source: string,
  seen = new Set<string>(),
): string | undefined {
  if (!expression) return undefined;

  const envHost = stringEnvValue(expression);
  if (envHost) return envHost;

  const literal = expression.trim().match(/^["'`]([^"'`]+)["'`]$/);
  if (literal) {
    return literal[1];
  }

  const identifier = expression.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(identifier) && !seen.has(identifier)) {
    seen.add(identifier);
    const initializer = findVariableInitializer(source, identifier);
    if (initializer) {
      return inferHost(initializer, source, seen);
    }
  }

  const fallbackLiterals = [...expression.matchAll(/["'`]([^"'`]+)["'`]/g)]
    .map((match) => match[1]);

  for (let i = fallbackLiterals.length - 1; i >= 0; i--) {
    const value = fallbackLiterals[i];
    if (value.includes(".") || value === "localhost" || value.includes(":")) {
      return value;
    }
  }

  return undefined;
}

function stringEnvValue(expression: string): string | undefined {
  const envNames = [...expression.matchAll(/process\.env\.([A-Za-z_][\w]*)/g)]
    .map((match) => match[1]);

  for (const envName of envNames) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function findVariableInitializer(
  source: string,
  name: string,
): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:const|let|var)\\s+${escapedName}\\s*=\\s*([^;\\n]+)`);
  return source.match(pattern)?.[1]?.trim();
}

function normalizeAppUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/g, "");
}

function normalizeAppHost(host: string): string {
  const normalized = host.trim();
  if (normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]") {
    return "127.0.0.1";
  }

  return normalized;
}

export function assertSafeServeHost(
  host: string,
  allowPublicHost = false,
): void {
  if (allowPublicHost || isLoopbackHost(host)) {
    return;
  }

  throw new Error(
    `[specord] Refusing to bind docs server to non-loopback host "${host}". ` +
    "Use 127.0.0.1 or localhost, or pass --allow-public-host if you intentionally want network access.",
  );
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("127.");
}

function allDiagnostics(model: ReturnType<typeof inspect>): Diagnostic[] {
  return [
    ...model.diagnostics,
    ...model.operations.flatMap((operation) => operation.diagnostics),
  ];
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function sendJson(
  response: ServerResponse,
  value: unknown,
  pretty: boolean | undefined,
): void {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function sendText(response: ServerResponse, status: number, value: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${value}\n`);
}

function pathRemainder(pathname: string, prefix: string): string | undefined {
  const normalizedPath = normalizePath(pathname);
  const normalizedPrefix = normalizePath(prefix);
  if (normalizedPath === normalizedPrefix) {
    return "";
  }

  const prefixWithSlash = normalizedPrefix === "/"
    ? "/"
    : `${normalizedPrefix}/`;

  if (!normalizedPath.startsWith(prefixWithSlash)) {
    return undefined;
  }

  return normalizedPath.slice(prefixWithSlash.length);
}

function decodePathValue(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function joinPath(base: string, segment: string): string {
  if (base === "/") {
    return normalizePath(segment);
  }

  return normalizePath(`${base}/${segment}`);
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
