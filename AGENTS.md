# Repository Guidelines

## Project Overview
`ego-browser` is a Node.js CDP browser-automation harness for AI agents. It drives the ego lite browser through `globalThis.ego` bindings (provided by the closed-source ego lite app), exposes a compact snapshot/ref workflow, and layers reusable site-specific knowledge ("learnings") on top of the browser runtime.

This repo contains the open-source harness and the agent skill package — **not** the browser itself. The ego lite app bundles its own `ego-browser` binary that embeds this runtime; `skills/ego-browser/SKILL.md` documents that binary's usage (`ego-browser nodejs <<'EOF' ... EOF`). The repo CLI built here takes the heredoc directly on stdin with no subcommand.

## Branch & Release Workflow
- `main` is the baseline for every version.
- Create a new `sprint-X.Y.Z` branch from the latest `main` when a version starts.
- Base development for that version on its `sprint-*` branch.
- When the team gives the release signal, open the release PR from that `sprint-*` branch to `main`.
- Start the next version from a new `sprint-*` branch created from the then-current `main`.

## Architecture & Data Flow
- `package/ego-browser/src/index.ts` is the entrypoint with two startup paths:
  - Executed directly as a CLI → `runMain()` (reads JavaScript from stdin, executes it).
  - Imported as a module (how the app embeds it) → `installEgoSdk(globalThis)`.
- Both paths expose the same helper surface, built by `helperContext()` in `src/helpers.ts` — the single source of truth for what agents can call (including `egoBrowser.helper()` and `agent_helpers.js` extensions).
- `src/run.ts` executes stdin JavaScript inside an async function with the helpers injected as parameters.
- `src/browser-runtime.ts` owns CDP transport over `ego.sendCDPMessage`, session attach/caching (2s TTL, auto re-attach on session loss), the buffered event queue (10k cap), and JS dialog tracking.
- `src/cdp-eval.ts` provides `cdp()` and `js()` (string-expression evaluation; top-level `return` is auto-wrapped in an IIFE).
- `src/element-resolver.ts` resolves all target forms — `@N` refs, `loc=css:` / `loc=role:` / `loc=href:` locators, `xpath=`, raw CSS — and classifies failures as `transient` (retryable) or `permanent`.
- `src/ref-map.ts` + `src/ref-state.ts`: refs are numeric `backendNodeId`s (`@21`, not `@e21`). The map is rebuilt on every snapshot; using a ref while the map is empty triggers an automatic re-snapshot, which is what makes refs work across heredoc rounds.
- `src/driver/` — `nav` (tabs, navigation), `pointer` (click/scroll/drag), `keyboard`, `observe` (snapshot/screenshot), `waits`, `files` (upload), `element-ops` (objectId handles), `load`.
- `src/learning/` — discovery, validation, and execution of site skills from `skills/ego-browser/learnings/<site>/manifest.json` (`runSiteTool`, `runSiteBrowserTool`, `learnContext`).
- `src/state.ts` is the shared mutable runtime state singleton; `src/env.ts` resolves the agent workspace (`EGO_BROWSER_AGENT_WORKSPACE`, falling back to the skill dir bundled next to the build output, then the repo's `skills/ego-browser`).
- `src/format.ts` owns `PUBLIC_API_DOCS`, the public facade-path documentation read through `egoBrowser.helper()`. `src/help-runtime.ts` resolves exact paths and namespaces; build-time JSDoc extraction remains a compatibility fallback for genuinely exposed top-level extension helpers.

Data flow: `stdin JS` → `runMain()` → `helperContext()` helpers → browser runtime/CDP → snapshot or DOM/AX resolution → optional site tools → `console.log(...)`.

## Task Spaces
Task spaces are isolated browsing contexts with an ownership model (`agent` / `user`):
- `listProfile()` returns the profiles available to new task spaces. Pass a returned profile `id` to `newTaskSpace(name, profileId)`; a task space's profile cannot be changed after creation.
- `newTaskSpace(name, profileId?)` creates a uniquely named space and rejects an existing exact name. Preserve its numeric `task.id`; every later round uses `switchTaskSpace(id)`, which requires agent ownership. Use `claimTaskSpace(id)` only after the user explicitly permits taking over a user-owned space.
- `completeTaskSpace(id)` preserves the result for the user; `closeTaskSpace(id)` destructively removes it.
- Control handoff: `handOffTaskSpace` / `takeOverTaskSpace` / `waitForAgentControl`.

## Key Directories
- `package/ego-browser/src/` — runtime, helpers, resolver, drivers, learning subsystem, and colocated unit tests (`src/**/*.test.mjs`).
- `package/ego-browser/test/` — cross-module and policy tests plus real-browser E2E cases, fixtures, runner, and test site (`test/**/*.test.js`, `test/real-browser-e2e/`).
- `package/ego-browser/scripts/` — build and validation scripts plus the thin real-browser E2E command entrypoint.
- `skills/ego-browser/` — agent skill package: `SKILL.md` (canonical agent-facing usage guide), `references/install.md`, `scripts/install.sh`.
- `skills/ego-browser/learnings/` — reusable per-site experience packs (`manifest.json` + `notes/` + `tools/` + `browser-tools/`).

## Development Commands
Run from `package/ego-browser/`:
- `npm test` — build, typecheck, then `node --test` over `src/**/*.test.mjs` and `test/**/*.test.js`.
- `npm run e2e` — real-browser TaskSpace and Playwright suite (`test/real-browser-e2e/`).
- `npm run validate:site-skills` (alias `validate:learnings`) — validate learned site skills.
- `node dist/out/index.js <<'JS' ... JS` — run the built CLI from this checkout (requires an `ego` runtime for real browser work; `--doctor`, `--reload`, `-h` also supported).

## Code Conventions & Common Patterns
- ESM only (`"type": "module"`); Node 22+.
- Public helpers are camelCase, verb-first for async actions (`ensureSession`, `runSiteTool`).
- All public time parameters and options use milliseconds.
- Helpers are injected into the script scope, not imported by agent scripts.
- New public helpers go through `helperContext()` in `src/helpers.ts`, need JSDoc on their implementation, and need a matching facade-path entry in `PUBLIC_API_DOCS`; the help completeness test enforces coverage. Keep `SKILL.md` in sync when behavior visible to agents changes.
- Snapshot refs (`@N`) are short-lived; re-snapshot after navigation or DOM changes and prefer stable `loc=...` values for reuse.
- Element-resolution failures should use `ElementResolutionError` with an honest `transient`/`permanent` kind — wait loops rely on it.
- The code prefers the small shared state singleton (`src/state.ts`) over threading connection state through call sites.
- Site skills must stay site-shaped and verifiable: stable URLs, durable selectors, no pixel coordinates, no secrets.

## Testing & QA
- Framework: Node's built-in runner (`node --test`), assertions via `node:assert/strict`.
- Tests run against the build output (`dist/src/...`) — `npm test` builds first.
- Behavior-focused tests inject overrides (`__testing.setOverrides`) or a `FakeEgo` double (see `src/helpers.test.mjs`, `src/taskspace-e2e.test.mjs`).
- Cover session handling, locator resolution, helper behavior, and site-skill validation when changing runtime code; run `npm run validate:site-skills` for learning changes.
- For real-browser dogfooding of uncommitted runtime changes, use `npm run e2e`: its runner passes the current `dist/out/index.js` through `ego-browser nodejs --sdk-path`. The global `ego-browser` binary belongs to the installed app and may intentionally be older than the worktree.
