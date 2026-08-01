# ego-browser (Node helper runtime)

The Node.js helper layer that runs inside the `ego-browser` Chromium browser. The browser exposes an `ego` runtime (tabs, CDP, snapshots, task spaces); this package bundles the agent-facing helpers that script that runtime.

```text
ego-browser (Chromium) -> globalThis.ego -> Playwright-style helper facades -> agent heredoc
```

## Build and run

```bash
npm ci
npm run build     # bundle to dist/out/index.js
npm test          # build + tsc --noEmit + node --test
```

The build emits a single ESM file `dist/out/index.js`. The ego-browser browser dispatches `ego-browser nodejs <<'EOF' ... EOF` heredocs to that bundle. Inside the heredoc, the Playwright-style `page` facade and ego-specific `egoBrowser`, `tabs`, `site`, `fetch`, and `cdp` facades are preloaded.

```bash
ego-browser nodejs <<'EOF'
const task = await egoBrowser.newTaskSpace('demo')
const tab = await task.tabs.openOrReuse('https://example.com', { waitUntil: 'load' })
console.log(await tab.page.snapshot())
await egoBrowser.completeTaskSpace(task.id)
EOF
```

Local invocation without the browser (for debugging the helper bundle itself) reads stdin:

```bash
node dist/out/index.js <<'JS'
console.log(await page.info())
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
  helpers.ts             public Playwright-style facades plus internal helper glue
  browser-runtime.ts     bridge to globalThis.ego (CDP, sessions, events)
  element-resolver.ts    resolves @eN / CSS / XPath / ARIA targets
  page-network.ts        Page HTTP/HAR/WebSocket routing
  page-scripts.ts        init scripts and exposed Node bindings
  page-frames.ts         lightweight Frame facades
  page-environment.ts    viewport and media emulation
  page-clock.ts          target-local Playwright Clock subset
  page-handles.ts        retained Page JSHandle and injected tags
  driver/
    pointer.ts           click, hover, drag, wheel, scrollIntoViewIfNeeded
    observe.ts           snapshot, screenshot, elementCenter
    keyboard.ts          focus, insertText, press, pressSequentially, fill, check, uncheck, setChecked, selectOption, dispatchEvent
    locator.ts           first/nth/last selectors, getBy* text-style locators, textContent, innerText, inputValue, isChecked, getAttribute, count, allInnerTexts, allTextContents, evaluate, evaluateAll, extractAll
    nav.ts               tabs, goto, openOrReuseTab, closeTab
    load.ts              waitForDocumentLoad and load orchestration
    waits.ts             waitForTimeout, waitForLoadState, waitForSelector, waitForFunction, waitForURL
    files.ts             setInputFiles
    downloads.ts         page.waitForEvent("download") and download facade
  http.ts                serverFetch, browserFetch
  cdp-eval.ts            cdp() and evaluate() raw eval
  learning/              site-learnings discovery and manifest validation
scripts/
  build.mjs              esbuild bundling
```

The top-level repo README has the full helper inventory and the task-space / control-handoff protocol. See also `../../skills/ego-browser/SKILL.md` for the agent-facing contract.

## Design constraints

- The browser runtime owns tabs, task spaces, CDP transport, snapshots, and event delivery. This package keeps only agent-facing ergonomics.
- Snapshot helpers use the browser runtime contract: `ego.snapshot({ scope, includeActionMarks, includeStableLocator })`.
- A TaskSpace Tab exposes a target-bound Page. Its snapshot operations internally select the correct TaskSpace and target, serialize native capture, and keep snapshot refs scoped to that Page.
- Public agent-facing helpers are object-style facades; internal implementation helpers remain camelCase.
- Site-specific reusable experience belongs under `skills/ego-browser/learnings/`, not in this package.

## License

MIT
