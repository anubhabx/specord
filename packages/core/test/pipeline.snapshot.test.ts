// ============================================================================
// Snapshot test — full normalized inspection model
//
// This is the high-level safety net. Any change to the extractor's output
// will cause this snapshot to break, forcing explicit review.
// ============================================================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostic, InspectionModel } from "@specord/types";
import { describe, expect, it } from "vitest";
import { serializeInspectionModel } from "../src/index.ts";
import { inspectNestFixture } from "./helpers/inspect-fixture.js";
import { normalizeInspectionModel } from "./helpers/normalize-inspection-model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");

const snapshotRegistryPath = path.join(repoRoot, "reports/snapshot-registry.json");
const snapshotChangelogPath = path.join(repoRoot, "reports/snapshot-changelog.md");
const snapshotLogPath = path.join(repoRoot, "reports/snapshot-log.md");

describe("inspect pipeline snapshot", () => {
  it("produces a stable normalized inspection model", () => {
    const model = normalizeInspectionModel(inspectNestFixture());
    const json = serializeInspectionModel(model);

    expect(json).toMatchSnapshot();
  });

  it("keeps the snapshot registry, changelog, and log in sync", () => {
    const model = normalizeInspectionModel(inspectNestFixture());
    const json = serializeInspectionModel(model);
    const registry = buildSnapshotRegistry(model, json);

    expect(readJson(snapshotRegistryPath)).toEqual(registry);
    expect(readText(snapshotChangelogPath)).toContain(
      buildSnapshotChangelogEntry(registry),
    );
    expect(readText(snapshotLogPath)).toContain(buildSnapshotLogRow(registry));
  });
});

type SnapshotRegistry = {
  version: 1;
  snapshots: SnapshotRegistryEntry[];
};

type SnapshotRegistryEntry = {
  id: string;
  fixture: string;
  testFile: string;
  snapshotFile: string;
  modelVersion: string;
  hashAlgorithm: "sha256";
  snapshotHash: string;
  normalizedFields: string[];
  metrics: {
    controllers: number;
    paths: number;
    operations: number;
    schemas: number;
    diagnostics: {
      total: number;
      bySeverity: Record<string, number>;
      byCode: Record<string, number>;
    };
  };
  operations: Array<{
    id: string;
    operationId: string;
    method: string;
    path: string;
  }>;
  schemaNames: string[];
};

function readJson(filePath: string): unknown {
  return JSON.parse(readText(filePath));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function buildSnapshotRegistry(
  model: InspectionModel,
  serializedModel: string,
): SnapshotRegistry {
  const diagnostics = collectDiagnostics(model);

  return {
    version: 1,
    snapshots: [
      {
        id: "core.pipeline.nestjs-api.inspection.v1",
        fixture: "examples/nestjs-api",
        testFile: "packages/core/test/pipeline.snapshot.test.ts",
        snapshotFile:
          "packages/core/test/__snapshots__/pipeline.snapshot.test.ts.snap",
        modelVersion: model.source.version,
        hashAlgorithm: "sha256",
        snapshotHash: sha256(serializedModel),
        normalizedFields: [
          "source.project",
          "source.root",
          "source.inspectedAt",
          "diagnostic.message.typeStrings",
          "response.inference.reason.typeStrings",
        ],
        metrics: {
          controllers: new Set(model.operations.map((operation) => operation.controller))
            .size,
          paths: new Set(model.operations.map((operation) => operation.path)).size,
          operations: model.operations.length,
          schemas: Object.keys(model.schemas).length,
          diagnostics: {
            total: diagnostics.length,
            bySeverity: countBy(diagnostics.map((diagnostic) => diagnostic.severity)),
            byCode: countBy(diagnostics.map((diagnostic) => diagnostic.code)),
          },
        },
        operations: model.operations.map((operation) => ({
          id: operation.id,
          operationId: operation.operationId,
          method: operation.method,
          path: operation.path,
        })),
        schemaNames: Object.keys(model.schemas),
      },
    ],
  };
}

function buildSnapshotChangelogEntry(registry: SnapshotRegistry): string {
  const snapshot = registry.snapshots[0];
  const metrics = snapshot.metrics;

  return `## 2026-05-18 - Canonical NestJS Benchmark Baseline

| Snapshot | Hash | Controllers | Paths | Operations | Schemas | Diagnostics |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| ${snapshot.id} | \`${snapshot.snapshotHash}\` | ${metrics.controllers} | ${metrics.paths} | ${metrics.operations} | ${metrics.schemas} | ${metrics.diagnostics.total} |

Reason: reset the weak Nest examples into the canonical production-shaped \`${snapshot.fixture}\` benchmark and refreshed the normalized inspection snapshot.

Diagnostic mix:

| Code | Count |
| --- | ---: |
${renderCountRows(metrics.diagnostics.byCode)}
`;
}

function buildSnapshotLogRow(registry: SnapshotRegistry): string {
  const snapshot = registry.snapshots[0];

  return `| 2026-05-18 | ${snapshot.id} | \`${snapshot.fixture}\` | \`${snapshot.testFile}\` | \`${snapshot.snapshotFile}\` | \`${snapshot.snapshotHash}\` |`;
}

function collectDiagnostics(model: InspectionModel): Diagnostic[] {
  return [
    ...model.diagnostics,
    ...model.operations.flatMap((operation) => operation.diagnostics),
  ];
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function renderCountRows(counts: Record<string, number>): string {
  return Object.keys(counts)
    .sort()
    .map((key) => `| \`${key}\` | ${counts[key]} |`)
    .join("\n");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
