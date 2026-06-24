# Phase 7 CI Recovery Design

Date: 2026-06-24
Status: Approved for implementation

## Goal

Restore a green Linux CI pipeline by installing the canonical NestJS fixture as
the standalone pnpm project it is, then reconcile the Phase 7 report with the
already-published public beta release.

## Root Cause

`examples/nestjs-api` has its own `package.json` and `pnpm-lock.yaml`, but it is
not a member of the root `pnpm-workspace.yaml`. The CI workflow runs
`pnpm install --frozen-lockfile` from the fixture directory. pnpm discovers the
parent workspace and performs another root workspace install instead of using
the fixture lockfile; the run output confirms this with `Scope: all 7 workspace
projects`.

The fixture therefore lacks its NestJS dependencies on a clean Linux runner.
TypeScript resolves `StreamableFile` differently when `@nestjs/common` is
missing, which changes `ProjectsController.exportCsv` response inference. That
changes the normalized extractor snapshot and its SHA-256 registry hash.

## Design

The fixture installation step will remain in
`.github/workflows/ci.yml`, retain `examples/nestjs-api` as its working
directory, and run:

```sh
pnpm install --frozen-lockfile --ignore-workspace
```

pnpm 10.33.4 documents `--ignore-workspace` as ignoring a parent
`pnpm-workspace.yaml` and treating the installation as a normal non-workspace
install. This makes the fixture's package manifest and lockfile the dependency
boundary without adding the example application to the publishable workspace.

No extractor output, snapshot, registry hash, package dependency, or public API
contract will change. Updating the checked-in snapshot to match the dependency-
incomplete Linux result would preserve the broken fixture setup and is
explicitly rejected.

## Verification

Implementation is accepted when all of the following pass:

1. The standalone fixture install completes with the frozen fixture lockfile.
2. `@nestjs/common` resolves from `examples/nestjs-api` after installation.
3. `pnpm.cmd build` passes for all workspace packages.
4. `pnpm.cmd test` passes with the canonical snapshot and registry unchanged.
5. The canonical `inspect` and `generate` fixture commands complete.
6. The workflow diff contains only the standalone-install correction.

The workflow edit is configuration-only, so verification uses the real install
command and the existing extractor snapshot suite rather than adding a static
test that merely restates YAML text.

## Reporting

`reports/phase-7.md` will be updated cumulatively to record that:

- `@specord/*` version `0.1.0-beta.0` is publicly available on npm;
- the prior npm authentication blocker is resolved;
- the Linux CI failure was caused by parent-workspace discovery during fixture
  installation;
- the local verification state after the workflow correction is recorded with
  exact command results.

The report will not claim the hosted GitHub Actions run is green until a fresh
remote run confirms it.

## Boundaries

This slice does not redesign CI, upgrade GitHub Actions, change pnpm or Node
versions, alter the fixture dependency graph, refresh extractor snapshots, or
start the Phase 8 history indexer. Phase 8 design begins after this recovery
slice is verified and reported.
