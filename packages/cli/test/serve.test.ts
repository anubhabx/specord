// ============================================================================
// CLI serve command tests
// ============================================================================

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeServeHost,
  createDocsRequestHandler,
  resolveServeTryItAppUrl,
  startAppProcess,
} from "../src/commands/serve.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const fixtureRoot = path.join(repoRoot, "examples/nestjs-api");

describe("specord serve", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("serves the docs shell and generated OpenAPI JSON without starting Nest", async () => {
    vi.stubEnv("PORT", "");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const server = http.createServer(
      createDocsRequestHandler({ target: fixtureRoot }, { cwd: repoRoot }),
    );

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an HTTP server address");
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const rootResponse = await fetch(baseUrl, { redirect: "manual" });
      const htmlResponse = await fetch(`${baseUrl}/api`);
      const html = await htmlResponse.text();
      const openApiResponse = await fetch(`${baseUrl}/api/openapi.json`);
      const document = await openApiResponse.json();

      expect(rootResponse.status).toBe(302);
      expect(rootResponse.headers.get("location")).toBe("/api");
      expect(htmlResponse.status).toBe(200);
      expect(html).toContain("data-specord-docs-shell");
      expect(html).toContain("/api/openapi.json");
      expect(html).toContain("http://localhost:3000");
      expect(html).toContain("/api/specord/history");
      expect(html).toContain('"sameOriginTryIt":false');
      expect(openApiResponse.status).toBe(200);
      expect(document.openapi).toBe("3.1.0");
      expect(document.paths["/projects"].get.operationId).toBe("listProjects");

      const repeatedOpenApiResponse = await fetch(`${baseUrl}/api/openapi.json`);
      expect(repeatedOpenApiResponse.status).toBe(200);

      const historyResponse = await fetch(`${baseUrl}/api/specord/history`);
      const history = await historyResponse.json();
      expect(historyResponse.status).toBe(200);
      expect(history.records.some((record: { operationId?: string }) =>
        record.operationId === "loginUser",
      )).toBe(true);

      const legacyHistoryResponse = await fetch(`${baseUrl}/api/history`);
      const legacyHistory = await legacyHistoryResponse.json();
      expect(legacyHistoryResponse.status).toBe(200);
      expect(legacyHistory.records.length).toBeGreaterThanOrEqual(history.records.length);

      const operationHistoryResponse = await fetch(
        `${baseUrl}/api/specord/history/operations/loginUser?limit=1`,
      );
      const operationHistory = await operationHistoryResponse.json();
      expect(operationHistoryResponse.status).toBe(200);
      expect(operationHistory).toMatchObject({
        operationId: "loginUser",
        limit: 1,
      });
      expect(operationHistory.records).toHaveLength(1);
      expect(operationHistory.records[0].operationId).toBe("loginUser");

      const fallbackIdentityResponse = await fetch(
        `${baseUrl}/api/specord/history/operations/${encodeURIComponent("GET /health")}`,
      );
      const fallbackIdentityHistory = await fallbackIdentityResponse.json();
      expect(fallbackIdentityResponse.status).toBe(200);
      expect(fallbackIdentityHistory.records[0].operationId).toBe("getHealth");

      const jobsResponse = await fetch(`${baseUrl}/api/specord/history/jobs`);
      const jobs = await jobsResponse.json();
      expect(jobsResponse.status).toBe(200);
      expect(jobs.jobs[0]).toMatchObject({
        id: "local-history",
        status: "ready",
        scope: "local-cache",
      });

      const loginRecord = history.records.find((record: { operationId?: string; commit?: string }) =>
        record.operationId === "loginUser",
      );
      if (!loginRecord?.commit) {
        throw new Error("Expected loginUser history record to expose a commit");
      }
      const commitHistoryResponse = await fetch(
        `${baseUrl}/api/specord/history/commits/${loginRecord.commit}?operationId=loginUser`,
      );
      const commitHistory = await commitHistoryResponse.json();
      expect(commitHistoryResponse.status).toBe(200);
      expect(commitHistory.records).toHaveLength(1);
      expect(commitHistory.records[0].commit).toBe(loginRecord.commit);
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("infers the Try It app URL from a static Nest app.listen port", async () => {
    vi.stubEnv("PORT", "");

    await expect(
      resolveServeTryItAppUrl({ target: fixtureRoot }, repoRoot),
    ).resolves.toBe("http://localhost:3000");
  });

  it("lets explicit --app-url override inferred runtime URLs", async () => {
    await expect(
      resolveServeTryItAppUrl(
        { target: fixtureRoot, appUrl: "http://127.0.0.1:4321/" },
        repoRoot,
      ),
    ).resolves.toBe("http://127.0.0.1:4321");
  });

  it("starts an optional app command from the target project directory", () => {
    const child = {
      on: vi.fn(),
      killed: false,
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: SpawnOptions;
    }> = [];

    const result = startAppProcess(
      {
        target: "examples/nestjs-api",
        appCommand: "pnpm start:dev",
      },
      {
        cwd: repoRoot,
        spawn: (command, args, options) => {
          calls.push({ command, args, options });
          return child;
        },
      },
    );

    expect(result).toBe(child);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("pnpm start:dev");
    expect(calls[0].args).toEqual([]);
    expect(calls[0].options).toMatchObject({
      cwd: fixtureRoot,
      shell: true,
      stdio: "inherit",
    });
  });

  it("keeps the docs server loopback-only unless public binding is explicit", () => {
    expect(() => assertSafeServeHost("127.0.0.1")).not.toThrow();
    expect(() => assertSafeServeHost("localhost")).not.toThrow();
    expect(() => assertSafeServeHost("::1")).not.toThrow();
    expect(() => assertSafeServeHost("0.0.0.0")).toThrow(/non-loopback host/);
    expect(() => assertSafeServeHost("192.168.1.10")).toThrow(/non-loopback host/);
    expect(() => assertSafeServeHost("0.0.0.0", true)).not.toThrow();
  });
});
