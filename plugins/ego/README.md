# ego agent plugin

This directory packages the `ego-browser` Skill for Claude Code, Codex,
Cursor, GitHub Copilot, Grok Build, WorkBuddy, QwenWork Desktop, OpenCode, and
DeepSeek Harness. Every host receives the same heredoc instructions; the
browser command remains responsible for executing each JavaScript round.

## Requirements

- macOS with ego lite and `ego-browser` on `PATH`
- A supported agent host

## Components

- `skills/ego-browser/` is an exact packaged copy of the standalone Skill.
- `plugin.json`, `.claude-plugin/`, and `.codex-plugin/` provide the shared,
  Claude, and Codex manifests.
- `.cursor-plugin/plugin.json` is the native Cursor manifest.
- `.codebuddy-plugin/plugin.json` is WorkBuddy's authoritative manifest, while
  `.workbuddy-plugin/plugin.json` is its explicit branded alias. Their contents
  are kept identical.
- `.qoder-plugin/plugin.json` is the native QwenWork/QoderWork manifest.
- `LICENSE` carries the repository's MIT terms in every distributable package.
- `index.js` adds the Skill instructions and `/ego-browser` entry to OpenCode.
- `cordis.patch.yml` and `dsh/src/index.js` register the packaged Skill in
  DeepSeek Harness.

No shared `commands/` directory is needed. Hosts that support explicit Skill
invocation expose the packaged Skill using their own naming convention.

## Installation

### Claude Code

```bash
claude plugin marketplace add citrolabs/ego-lite
claude plugin install ego@ego-agent-skills
```

Use `/ego:ego-browser`. To remove it, run
`claude plugin uninstall ego@ego-agent-skills`.

### Codex

```bash
codex plugin marketplace add citrolabs/ego-lite
codex plugin add ego@ego-agent-skills
```

Ask Codex to use `$ego-browser`. To remove it, run
`codex plugin remove ego@ego-agent-skills`.

### Cursor

Until the plugin is listed in the Cursor Marketplace, load a source checkout:

```bash
cursor-agent \
  --plugin-dir /absolute/path/to/ego-lite/plugins/ego \
  --trust
```

Cursor reads `.cursor-plugin/plugin.json` before compatibility manifests and
discovers the Skill from its explicit `skills` path. For a local Cursor Desktop
installation, link the source checkout and reload the window:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/ego-lite/plugins/ego ~/.cursor/plugins/local/ego
```

Run **Developer: Reload Window** from the command palette. A marketplace
release can instead be installed from **Customize → Plugins**. Use
`/ego-browser` in chat. Remove the local link to uninstall the source checkout.

### GitHub Copilot

```bash
copilot plugin install citrolabs/ego-lite:plugins/ego
```

Use `/ego-browser` in Copilot CLI or `/ego:ego-browser` in VS Code. To remove
the direct install, run `copilot plugin uninstall ego`.

### Grok Build

```bash
grok plugin install citrolabs/ego-lite#plugins/ego --trust
```

Use `/ego-browser`. To remove it, run `grok plugin uninstall ego`.

### WorkBuddy

WorkBuddy uses `.codebuddy-plugin/plugin.json` as its authoritative native
manifest and also receives the identical `.workbuddy-plugin/plugin.json`
branded alias. The Claude-compatible marketplace remains the installation
catalog. WorkBuddy Desktop does not install a `codebuddy` command on the shell
`PATH`, so install through its interface:

1. Open **专家·技能·连接器 → 技能 → 套件 → 添加市场**.
2. Enter `citrolabs/ego-lite` as the marketplace source. For a source checkout,
   enter the absolute path to the repository root.
3. Select **ego-agent-skills**. If it was already added, refresh it first.
4. Click **+** on the **ego** card and confirm it appears under **我安装的**.

Start a new task and use `/ego-browser`, or ask WorkBuddy to use the
ego-browser Skill. To uninstall it, open **我安装的**, use the **ego** suite's
more menu, and select **卸载**.

See the [WorkBuddy plugin guide](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Plug-In)
and [plugin reference](https://www.codebuddy.cn/docs/cli/plugins-reference).

### QwenWork Desktop

QwenWork imports third-party expert kits as ZIP files. It reads the native
`.qoder-plugin/plugin.json` manifest before the Claude-compatible fallback.
From the repository root, package this plugin with:

```bash
node scripts/package-plugins.mjs ego
```

This produces `dist/plugins/ego-v1.4.0.zip`. In QwenWork Desktop, open **扩展
(Extensions) → 专家套件 (Expert Kits) → 添加 (Add) → 上传套件 (Upload Kit)**
and select the archive. Start a new task and use `/ego-browser`, or ask
QwenWork to use the ego-browser Skill. Remove **ego** from the installed expert
kits to uninstall it.

See the [QwenWork expert-kit guide](https://qwenwork.cn/docs/desktop/expert-kits)
for the current import interface.

### OpenCode

After the npm package is published, install it with:

```bash
opencode plugin @citrolabs/ego -g
```

For a source checkout, replace the package name with
`file:/absolute/path/to/ego-lite/plugins/ego`. The `./server` package export is
only OpenCode's plugin target name and does not start a background process. It
points to `index.js`, which adds only the packaged instructions and
`/ego-browser` command. To uninstall, remove the package entry from the
`plugin` array in the applicable `opencode.json`.

### DeepSeek Harness

DeepSeek Harness installs bundles per profile. For a source checkout:

```bash
dsh plugin --profile web add /absolute/path/to/ego-lite/plugins/ego
dsh --profile web --dump-config
dsh web
```

After the npm package is published, install it by package name:

```bash
dsh plugin --profile web add @citrolabs/ego
```

Install it separately for another profile:

```bash
dsh plugin --profile headless add @citrolabs/ego
```

Use `/ego-browser`. The adapter only registers the bundled Skill; execution
follows the same heredoc instructions as every other host. Remove it with
`dsh plugin --profile web remove @citrolabs/ego`.

## Verification

Confirm that the host discovers the `ego-browser` Skill and that its
instructions contain this command form:

```bash
ego-browser nodejs <<'EOF'
console.log('ego-browser ready')
EOF
```

Running that command should print `ego-browser ready` while the ego lite app is
open. A plugin installation does not require an additional JavaScript package
manager or a long-lived helper process.

## Packaging

Run the packager from the repository root. Package one named plugin:

```bash
node scripts/package-plugins.mjs ego
```

Package every directory under `plugins/` that contains `plugin.json`:

```bash
node scripts/package-plugins.mjs --all
```

Both commands write one flat, versioned ZIP per plugin to `dist/plugins/`.
Override the destination with `--output <directory>`. Before packaging, the
script replaces every `plugins/<plugin>/skills/<name>` directory with the
canonical `skills/<name>` directory, so the repository-root Skill remains the
single source of truth. Packaging requires the system `zip` and `unzip`
commands.

## Development

The host adapters are plain ESM and have no build step. Run the repository
tests from `package/ego-browser/` after changing a manifest, adapter, or Skill.
