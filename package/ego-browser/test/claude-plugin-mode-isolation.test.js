import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const repoFile = (path) => new URL(`../../../${path}`, import.meta.url);

const standaloneSkillPath = "skills/ego-browser/SKILL.md";
const claudePluginRoot = "plugins/ego";
const claudeManifestPath = `${claudePluginRoot}/.claude-plugin/plugin.json`;
const claudeSkillPath = `${claudePluginRoot}/skills/ego-browser/SKILL.md`;
const claudeSkillSupportPaths = [
  `${claudePluginRoot}/skills/ego-browser/references/install.md`,
  `${claudePluginRoot}/skills/ego-browser/references/profiler.md`,
  `${claudePluginRoot}/skills/ego-browser/references/captcha.md`,
  `${claudePluginRoot}/skills/ego-browser/scripts/install.sh`,
];
const runtimeTerms =
  /\b(?:REPL|MCP|Bun)\b|\brepl_(?:start|eval|read|status|interrupt|stop)\b/i;

function readRequiredFile(path) {
  const url = repoFile(path);
  assert.equal(existsSync(url), true, `${path} must exist`);
  return readFileSync(url, "utf8");
}

function assertMissing(path) {
  assert.equal(existsSync(repoFile(path)), false, `${path} must not exist`);
}

function assertPureSkillText(value, label) {
  assert.doesNotMatch(value, runtimeTerms, `${label} must use heredoc only`);
}

function assertTaskSpaceSafety(skill, label) {
  assert.match(
    skill,
    /one task space for one user goal/i,
    `${label} must keep one TaskSpace per user goal`,
  );
  assert.match(
    skill,
    /switchTaskSpace[^\n]*agent-owned/i,
    `${label} must restrict TaskSpace switching to agent-owned spaces`,
  );
  assert.match(
    skill,
    /never claims? (?:a )?user-owned/i,
    `${label} must not implicitly claim a user-owned TaskSpace`,
  );
  assert.match(
    skill,
    /(?:do not|never)[^\n]*takeOverTaskSpace[^\n]*automatically/i,
    `${label} must forbid automatic TaskSpace takeover`,
  );
  assert.match(
    skill,
    /explicit (?:confirmation|permission)/i,
    `${label} must require explicit user approval before taking control`,
  );
  assert.match(skill, /completeTaskSpace/, `${label} must document completion`);
  assert.match(skill, /closeTaskSpace/, `${label} must document cleanup`);
  assert.match(
    skill,
    /(?:check|determines)[^\n]*\bdone\b/i,
    `${label} must require checking the structured action result`,
  );
}

test("Claude marketplace routes the plugin to its portable subtree", () => {
  const marketplace = JSON.parse(
    readRequiredFile(".claude-plugin/marketplace.json"),
  );

  assert.equal(marketplace.plugins?.length, 1);
  assert.equal(marketplace.plugins[0].source, `./${claudePluginRoot}`);
});

test("Claude plugin subtree contains its manifest and complete Skill only", () => {
  for (const path of [
    claudeManifestPath,
    claudeSkillPath,
    ...claudeSkillSupportPaths,
  ]) {
    readRequiredFile(path);
  }

  assertMissing(`${claudePluginRoot}/.mcp.json`);
  assertMissing(`${claudePluginRoot}/mcp.json`);
  assertMissing(`${claudePluginRoot}/mcp`);
  assertMissing(`${claudePluginRoot}/commands`);
});

test("Claude plugin versions align without an executable runtime", () => {
  const marketplace = JSON.parse(
    readRequiredFile(".claude-plugin/marketplace.json"),
  );
  const source = readRequiredFile(claudeManifestPath);
  const manifest = JSON.parse(source);
  const skill = readRequiredFile(claudeSkillPath);

  assert.equal(manifest.name, marketplace.plugins[0].name);
  assert.equal(manifest.version, marketplace.plugins[0].version);
  assert.match(skill, new RegExp(`version: ["']${manifest.version}["']`));
  assertPureSkillText(source, "Claude plugin manifest");
});

test("Claude plugin publishes under the ego install and slash namespace", () => {
  const marketplace = JSON.parse(
    readRequiredFile(".claude-plugin/marketplace.json"),
  );
  const manifest = JSON.parse(readRequiredFile(claudeManifestPath));
  const rootReadme = readRequiredFile("README.md");
  const pluginReadme = readRequiredFile(`${claudePluginRoot}/README.md`);

  assert.equal(marketplace.plugins[0].name, "ego");
  assert.equal(manifest.name, "ego");
  assert.match(rootReadme, /claude plugin install ego@ego-agent-skills/);
  assert.match(`${rootReadme}\n${pluginReadme}`, /\/ego:ego-browser/);
  assert.doesNotMatch(
    `${rootReadme}\n${pluginReadme}`,
    /ego-skills|browser-skills/,
  );
});

test("standalone Skill keeps the heredoc execution contract", () => {
  const skill = readRequiredFile(standaloneSkillPath);

  assert.match(skill, /ego-browser nodejs <<'EOF'/);
  assertPureSkillText(skill, "standalone Skill");
});

test("portable Skill and support files use the same heredoc contract", () => {
  const standalone = readRequiredFile(standaloneSkillPath);
  const portable = readRequiredFile(claudeSkillPath);
  const support = claudeSkillSupportPaths.map(readRequiredFile).join("\n");

  assert.equal(portable, standalone);
  assert.match(portable, /ego-browser nodejs <<'EOF'/);
  assertPureSkillText(`${portable}\n${support}`, "portable Skill package");
});

test("portable Skill refreshes snapshot refs across heredoc execution rounds", () => {
  const skill = readRequiredFile(claudeSkillPath);

  assert.match(
    skill,
    /every later working Bash round[\s\S]*switchTaskSpace[\s\S]*before taking the snapshot/i,
  );
  assert.match(
    skill,
    /Do not reuse them across snapshots, pages, frames, or execution rounds/i,
  );
  assert.doesNotMatch(skill, /reused across evaluations/i);
});

test("portable Skill preserves the standalone guidance exactly", () => {
  const standalone = readRequiredFile(standaloneSkillPath);
  const portable = readRequiredFile(claudeSkillPath);

  assert.equal(portable, standalone);
});

test("both Skill copies preserve TaskSpace safety policy", () => {
  for (const [label, path] of [
    ["standalone Skill", standaloneSkillPath],
    ["portable Skill", claudeSkillPath],
  ]) {
    assertTaskSpaceSafety(readRequiredFile(path), label);
  }
});
