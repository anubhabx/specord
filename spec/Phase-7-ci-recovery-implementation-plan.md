# Phase 7 CI Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore deterministic Linux CI by installing `examples/nestjs-api` outside the parent pnpm workspace and reconcile the cumulative Phase 7 report.

**Architecture:** Keep the fixture outside the publishable root workspace and make its CI install explicitly standalone with pnpm's `--ignore-workspace` option. Reuse the canonical extractor snapshot and full workspace verification as the behavioral regression gate; do not change extractor output or snapshot artifacts.

**Tech Stack:** GitHub Actions, pnpm 10.33.4, Turborepo, TypeScript, Vitest

---

### Task 1: Correct the standalone fixture installation

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Capture the failing CI evidence**

Run:

```powershell
gh run view 26954582547 --log-failed
```

Expected: the fixture install reports `Scope: all 7 workspace projects`, then
`@specord/core` fails because `ProjectsController.exportCsv` produces a
different response inference and snapshot hash on Linux.

- [ ] **Step 2: Verify the standalone pnpm option against the fixture lockfile**

Run:

```powershell
pnpm.cmd --dir examples/nestjs-api install --frozen-lockfile --ignore-workspace --lockfile-only
```

Expected: exit code 0 and no tracked lockfile changes.

- [ ] **Step 3: Apply the minimal workflow correction**

Change the fixture installation step to:

```yaml
      - name: Install fixture dependencies
        run: pnpm install --frozen-lockfile --ignore-workspace
        working-directory: examples/nestjs-api
```

- [ ] **Step 4: Install the fixture as CI will install it**

Run:

```powershell
pnpm.cmd --dir examples/nestjs-api install --frozen-lockfile --ignore-workspace
node -e "console.log(require.resolve('@nestjs/common/package.json', { paths: ['examples/nestjs-api'] }))"
```

Expected: both commands exit 0 and Node prints a path under the fixture's
dependency installation.

- [ ] **Step 5: Verify the workflow diff is narrow**

Run:

```powershell
git diff --check
git diff -- .github/workflows/ci.yml
```

Expected: no whitespace errors and exactly one command-line addition:
`--ignore-workspace`.

### Task 2: Run the repository acceptance gates

**Files:**
- No production files changed

- [ ] **Step 1: Build every workspace package**

Run:

```powershell
pnpm.cmd build
```

Expected: 6/6 package build tasks pass.

- [ ] **Step 2: Run every workspace test**

Run:

```powershell
pnpm.cmd test
```

Expected: all Turborepo tasks and all Vitest tests pass, including the canonical
pipeline snapshot and registry synchronization tests.

- [ ] **Step 3: Verify canonical inspection**

Run:

```powershell
pnpm.cmd inspect -- --project examples/nestjs-api/tsconfig.json --root examples/nestjs-api/src
```

Expected: exit code 0 and a V1 inspection document for the canonical fixture.

- [ ] **Step 4: Verify canonical OpenAPI generation**

Run:

```powershell
pnpm.cmd generate -- --project examples/nestjs-api/tsconfig.json --root examples/nestjs-api/src --pretty
```

Expected: exit code 0 and an OpenAPI 3.1 document; unresolved warnings remain
diagnostic output rather than command failures.

### Task 3: Reconcile the Phase 7 report

**Files:**
- Modify: `reports/phase-7.md`

- [ ] **Step 1: Update the cumulative release and CI status**

Record the report date as `2026-06-24`, change the public beta publication from
blocked to completed, and document the standalone fixture-install correction.
Keep the hosted CI status honest: local gates may be recorded as passing, but a
remote GitHub Actions run remains pending until the workflow change is pushed.

- [ ] **Step 2: Refresh verification counts from actual command output**

Update the build-task and test-count rows only from the fresh Task 2 results.
Do not copy stale counts when the current output differs.

- [ ] **Step 3: Update decisions, roadmap, and risks**

Record `--ignore-workspace` as the fixture dependency boundary, mark Phase 7d
publication complete, make hosted CI confirmation the remaining closeout item,
and retain Phase 8 history indexing/source-diff work as the next product phase.

- [ ] **Step 4: Validate the final diff and report contract**

Run:

```powershell
git diff --check
git status --short
git diff --stat
git diff -- .github/workflows/ci.yml reports/phase-7.md
```

Expected: no whitespace errors; only the approved workflow correction and the
cumulative report reconciliation are uncommitted. This implementation plan was
committed before the isolated implementation worktree was created.

- [ ] **Step 5: Commit the completed recovery slice**

Run:

```powershell
git add -- .github/workflows/ci.yml reports/phase-7.md
git commit -m "fix(ci): install fixture outside workspace"
```

Expected: one scoped Conventional Commit containing the CI recovery and updated
phase report.
