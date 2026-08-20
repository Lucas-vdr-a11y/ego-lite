# ego-browser (Node helper runtime)

The Node.js helper layer that runs inside the `ego-browser` Chromium browser. The browser exposes an `ego` runtime (tabs, CDP, snapshots, task spaces); this package bundles the agent-facing helpers that script that runtime.

```text
ego-browser (Chromium) → globalThis.ego → helper functions → agent heredoc
```

## Build and run

```bash
npm ci
npm run build     # bundle to dist/out/index.js
npm test          # build + tsc --noEmit + node --test
```

The build emits a single ESM file `dist/out/index.js`. The ego-browser browser dispatches `ego-browser nodejs <<'EOF' ... EOF` heredocs to that bundle. The v2 `TaskSpace` and `Page` APIs are preloaded; the v1 global helpers remain available only for existing scripts.

```bash
ego-browser nodejs <<'EOF'
const task = await taskSpace('demo')
const page = await task.openPage('https://example.com', { as: 'main' })
console.log(await page.snapshot())
EOF
```

Local invocation without the browser (for debugging the helper bundle itself) reads stdin:

```bash
node dist/out/index.js <<'JS'
console.log(await help())
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
cliLog(await siteSkills())
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
  helpers.ts             public helper surface (re-exports + glue)
  page-model.ts          TaskSpace/Page lifecycle and operations
  public-api-schema.ts   v2 validation, help, and reference source
  browser-runtime.ts     bridge to globalThis.ego (CDP, sessions, events)
  element-resolver.ts    resolves @N / CSS / XPath / ARIA targets
  driver/
    pointer.ts           click, hover, drag, scroll, scrollBy
    observe.ts           snapshot, captureScreenshot, elementCenter
    keyboard.ts          typeText, pressKey, fillInput, dispatchKey
    nav.ts               tabs, gotoUrl, openOrReuseTab, closeTab
    load.ts              waitForLoad and load orchestration
    waits.ts             waitForElement, waitForNetworkIdle, wait
    files.ts             uploadFile
  http.ts                serverFetch, browserFetch
  cdp-eval.ts            cdp() and js() raw eval
  learning/              site-learnings discovery and manifest validation
scripts/
  build.mjs              esbuild bundling
```

See `../../skills/ego-browser/SKILL.md` for the agent-facing workflow and
`../../skills/ego-browser/references/api.md` for the generated v2 API reference.
The old global helpers remain available as a v1 compatibility surface for
existing scripts.

## Design constraints

- The browser runtime owns tabs, task spaces, CDP transport, snapshots, and event delivery. This package keeps only agent-facing ergonomics.
- Snapshot helpers use the browser runtime contract: `ego.snapshot({ scope, includeActionMarks, includeStableLocator })`.
- New public APIs must be added to `public-api-schema.ts`; runtime validation,
  default `help()`, the generated reference, and the Skill must remain aligned.
- Embedded hosts should await the exported `disposeEgoSdk()` hook before
  discarding a Node context; see `../../docs/native-sdk-lifecycle-requirement.md`.
- Site-specific reusable experience belongs under `skills/ego-browser/learnings/`, not in this package.

## License

MIT
