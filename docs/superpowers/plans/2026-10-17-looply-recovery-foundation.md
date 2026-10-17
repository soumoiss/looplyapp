# Looply Recovery Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a buildable, testable Looply source tree in an isolated branch without changing production behavior or infrastructure.

**Architecture:** Restore only the missing versioned application source from the supplied recovery archive, preserving existing root files in `main` where they already exist. Validate the recovered static application locally; keep server-side and hosting resources unchanged. Subsequent functional fixes are limited to defects reproducible locally or by read-only public-site evidence.

**Tech Stack:** Native ES modules, HTML/CSS, Node.js tests, Supabase client and Edge Functions, Vercel server function.

**Spec:** `docs/superpowers/specs/2026-10-17-looply-recovery-design.md`

## Global Constraints

- Work only on `codex/recovery-foundation`; never update `main` or production.
- Do not execute migrations, call privileged Supabase endpoints, upload media, or change Vercel configuration.
- Preserve the existing root `config.js`, HTML files, README, `package.json`, and `vercel.json` unless a test proves a focused change is required.
- Do not version credentials, private media, or server secrets.
- Report environment-dependent checks as blocked rather than simulated.

## Review Focus

- Every HTML entry point must resolve its local module adapter and stylesheet after recovery.
- Build and test scripts must resolve their referenced source files.
- Static GitHub Pages must not be treated as a Vercel function host.
- No recovery step may overwrite the newer public configuration in `main`.
- Browser-only, multi-account, RLS, Storage, and Realtime checks remain explicitly blocked without authorized accounts.

---

### Task 1: Recover the missing source tree

**Files:**
- Create: `assets/**`, `src/**`, `scripts/**`, `tests/**`, `supabase/**`, `.github/workflows/**`, `docs/**`
- Preserve: root files already tracked in `main`

**Interfaces:**
- Consumes: `C:\Users\User\Downloads\Looply-mainatual.zip`
- Produces: all page adapters, shared modules, build script, tests, migrations, Edge Functions, and workflow definitions referenced by the existing root files.

- [x] **Step 1: Record the missing-path baseline**

Run a read-only comparison between the checkout and recovery archive. Expected: the missing application directories are enumerated and all existing root files are excluded from restoration.

- [x] **Step 2: Restore only missing files from the archive**

Extract into an external temporary directory, then copy only paths absent from the checkout. Do not overwrite any root file or copy archive media.

- [x] **Step 3: Verify restored path integrity**

Run a static scan of HTML stylesheet/module references and package-script targets. Expected: each local page reference and build/test target exists.

- [x] **Step 4: Commit the recovery baseline**

Commit the restored source tree with a recovery-specific message.

### Task 2: Establish build and automated-test evidence

**Files:**
- Modify: only test or build files if a reproducible local failure identifies a source-level defect
- Test: `tests/foundation.test.mjs`, `tests/youtube-api.test.mjs`, `tests/gallery-access.test.mjs`

**Interfaces:**
- Consumes: recovered `scripts/build.mjs` and browser source tree
- Produces: recorded build and test result; narrowly scoped fixes only when failures are reproduced.

- [x] **Step 1: Run the existing build**

Run: `npm run build`

Expected: `dist/` contains browser assets and pages, with no privileged source or migrations copied to it.

- [x] **Step 2: Run the existing automated tests**

Run: `npm test`

Expected: foundation, YouTube API, and gallery access tests pass or reveal a reproducible source defect.

- [x] **Step 3: Address each reproducible source failure with a focused regression test**

Use the existing Node test style. Make one root-cause correction at a time and rerun the affected test plus `npm test`.

- [x] **Step 4: Commit validated source fixes**

Commit only tests and source files directly related to reproduced failures.

### Task 3: Validate static routing and deployment boundaries

**Files:**
- Modify: `.github/workflows/deploy-pages.yml`, `config.js`, or `vercel.json` only if a static verification demonstrates an internal inconsistency
- Test: build output and read-only HTTP checks

**Interfaces:**
- Consumes: `dist/`, root `config.js`, Vercel API function
- Produces: documented GitHub Pages/Vercel routing contract.

- [x] **Step 1: Inspect generated output references**

Verify each entry point in `dist/` resolves its local CSS and module files and that `/api/youtube-playlist` is not expected to execute on GitHub Pages.

- [x] **Step 2: Run read-only deployment checks**

Check the historical Pages assets and the `looplyapp` Pages endpoint. Classify Page configuration as blocked unless the repository settings/workflow can be observed safely.

- [x] **Step 3: Commit only a demonstrated static deployment correction**

Do not publish or alter Vercel. If no safe correction can be proven, record the block without code changes.

### Task 4: Produce a verified handoff

**Files:**
- Create: `docs/audits/looply-recovery-report.md`

**Interfaces:**
- Consumes: Git diff, build/test output, and read-only site checks
- Produces: evidence-backed completion report and a list of external verification blocks.

- [x] **Step 1: Record restored paths, changed behavior, test evidence, and unresolved external checks**

- [x] **Step 2: Review the branch diff for credentials and unintended media**

- [x] **Step 3: Commit the report and present the branch for review; do not merge or publish**
