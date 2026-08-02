# ego-browser (Node helper runtime)

The Node.js helper layer that runs inside the `ego-browser` Chromium browser. The browser exposes an `ego` runtime (tabs, CDP, snapshots, task spaces); this package bundles the agent-facing helpers that script that runtime.

```text
ego-browser (Chromium) -> globalThis.ego -> TaskSpace -> native Playwright -> agent heredoc
```

## Build and run

```bash
npm ci
npm run build     # bundle to dist/out/index.js
npm test          # build + tsc --noEmit + node --test
```

The build emits `dist/out/index.js`; its runtime dependency is `playwright-core`. The ego-browser browser dispatches `ego-browser nodejs <<'EOF' ... EOF` heredocs to that bundle. TaskSpace creation and selection return the active native Playwright `page` and `context`.

```bash
ego-browser nodejs <<'EOF'
const task = await egoBrowser.newTaskSpace('demo')
await task.page.goto('https://example.com', { waitUntil: 'load' })
console.log(await task.page.title())
await egoBrowser.completeTaskSpace(task.id)
EOF
```

To choose a browser profile for a new TaskSpace, call `egoBrowser.listProfile()` and pass the selected unique `profile.id` to `egoBrowser.newTaskSpace(name, profileId)`. Profile display names may be duplicated, and an existing TaskSpace cannot change profiles.

When the host exposes `ego.getCDPEndpoint(taskSpaceId)`, the runtime connects to that browser-level endpoint directly. The endpoint must support the complete browser CDP session lifecycle used by `chromium.connectOverCDP` and expose only the selected TaskSpace's targets. Give different TaskSpaces distinct endpoint values so the SDK can reconnect without crossing their isolation boundary. Older hosts that expose only `ego.sendCDPMessage` use an SDK-owned local WebSocket bridge automatically (a Unix domain socket on macOS/Linux and loopback TCP on Windows); Playwright requests are assigned isolated native message ids and native responses and events are routed back to the Playwright connection.

Local invocation without the browser (for debugging the helper bundle itself) reads stdin:

```bash
node dist/out/index.js <<'JS'
console.log(egoBrowser.helper())
JS
```

Flags: `-h | --help`, `--doctor`, `--reload`, `--debug-clicks`.

## Skill workspace

By default the runtime loads agent helpers and site learnings from the sibling skill package:

```text
../../skills/ego-browser
```

Override with `EGO_BROWSER_AGENT_WORKSPACE`:

```bash
EGO_BROWSER_AGENT_WORKSPACE=/path/to/skill ego-browser nodejs <<'EOF'
console.log(await site.skills())
EOF
```

Site learnings under `agentWorkspace()/learnings/<site>/` are always active and read on every helper call. Validate them with:

```bash
npm run validate:site-skills    # alias: validate:learnings
```

## Source layout

```
src/
  run.ts                 CLI entry; reads stdin, injects helpers, executes
  helpers.ts             TaskSpace, site, fetch, CDP, and API-help surfaces
  playwright/            native Playwright TaskSpace, transport, and routing
  browser-runtime.ts     bridge to globalThis.ego (CDP, sessions, events)
  http.ts                serverFetch, browserFetch
  cdp-eval.ts            direct CDP access and site-tool evaluation
  learning/              site-learnings discovery and manifest validation
scripts/
  build.mjs              esbuild bundling
```

The top-level repo README has the full helper inventory and the task-space / control-handoff protocol. See also `../../skills/ego-browser/SKILL.md` for the agent-facing contract.

## Design constraints

- The browser runtime owns task spaces and CDP transport. Playwright owns Page, BrowserContext, Locator, input, navigation, events, and downloads.
- A TaskSpace exposes its active native Playwright `Page` and `BrowserContext`; additional pages use `task.context.pages()` and `task.context.newPage()`.
- `egoBrowser`, `site`, `fetch`, and `cdp` remain ego-browser-specific control surfaces; use `egoBrowser.helper()` to inspect their documented APIs.
- Site-specific reusable experience belongs under `skills/ego-browser/learnings/`, not in this package.

## License

MIT
