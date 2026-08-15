import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const packagingScripts = join(repositoryRoot, "scripts");

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function addPlugin(root, name, version, skillName) {
  const pluginRoot = join(root, "plugins", name);
  writeJson(join(pluginRoot, "plugin.json"), {
    name,
    version,
    description: `${name} fixture`,
  });
  writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
    name,
    version,
  });
  writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name,
    version,
    skills: "./skills/",
  });
  for (const directory of [
    ".cursor-plugin",
    ".codebuddy-plugin",
    ".workbuddy-plugin",
    ".qoder-plugin",
  ]) {
    writeJson(join(pluginRoot, directory, "plugin.json"), {
      name,
      version,
      description: `${name} fixture`,
    });
  }
  write(
    join(pluginRoot, "skills", skillName, "SKILL.md"),
    "stale packaged skill\n",
  );
  write(join(pluginRoot, "README.md"), `${name} fixture\n`);
  write(join(pluginRoot, "LICENSE"), "fixture license\n");
  writeJson(join(pluginRoot, "package.json"), {
    name: `@example/${name}`,
    version,
    type: "module",
    exports: {
      ".": "./index.js",
      "./server": "./index.js",
      "./dsh": "./dsh/src/index.js",
    },
  });
  write(join(pluginRoot, "index.js"), "export default async () => ({});\n");
  write(join(pluginRoot, "cordis.patch.yml"), "- id: fixture\n");
  write(join(pluginRoot, "dsh", "src", "index.js"), "export default {};\n");

  write(
    join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: canonical ${skillName}\n---\n\n# ${skillName}\n`,
  );
  write(
    join(root, "skills", skillName, "references", "install.md"),
    `canonical ${skillName} reference\n`,
  );

  write(join(pluginRoot, "mcp", "server.js"), "must not ship\n");
  write(join(pluginRoot, "node_modules", "fixture", "index.js"), "nope\n");
  write(join(pluginRoot, ".DS_Store"), "nope\n");
  write(join(pluginRoot, "dist", "old.zip"), "nope\n");
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "ego-plugin-packaging-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(
    join(packagingScripts, "package-plugins.mjs"),
    join(root, "scripts", "package-plugins.mjs"),
  );
  addPlugin(root, "ego", "1.3.1", "ego-browser");
  addPlugin(root, "sample", "2.4.0", "sample-skill");
  return root;
}

function runPackager(root, args) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts", "package-plugins.mjs"), ...args],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
}

function assertSuccess(result) {
  assert.equal(
    result.status,
    0,
    `packager failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function zipFiles(output) {
  return readdirSync(output)
    .filter((name) => name.endsWith(".zip"))
    .sort();
}

function zipEntries(archive) {
  const result = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n").filter(Boolean);
}

function zipText(archive, entry) {
  const result = spawnSync("unzip", ["-p", archive, entry], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function assertPortableArchive(archive, pluginName, skillName) {
  const entries = zipEntries(archive);

  assert.ok(entries.includes("plugin.json"));
  assert.ok(entries.includes(".claude-plugin/plugin.json"));
  assert.ok(entries.includes(".codex-plugin/plugin.json"));
  assert.ok(entries.includes(".cursor-plugin/plugin.json"));
  assert.ok(entries.includes(".codebuddy-plugin/plugin.json"));
  assert.ok(entries.includes(".workbuddy-plugin/plugin.json"));
  assert.ok(entries.includes(".qoder-plugin/plugin.json"));
  assert.ok(entries.includes("LICENSE"));
  assert.ok(entries.includes("package.json"));
  assert.ok(entries.includes("index.js"));
  assert.ok(entries.includes("cordis.patch.yml"));
  assert.ok(entries.includes("dsh/src/index.js"));
  assert.ok(entries.includes(`skills/${skillName}/SKILL.md`));
  assert.ok(
    entries.every((entry) => !entry.startsWith(`${pluginName}/`)),
    "ZIP contents must start at the plugin root",
  );
  assert.ok(
    entries.every(
      (entry) =>
        !/(^|\/)(?:mcp|node_modules|dist|release-output)(?:\/|$)/.test(entry) &&
        !entry.endsWith(".DS_Store"),
    ),
    `ZIP contains a forbidden runtime or artifact: ${entries.join(", ")}`,
  );
}

test("single-plugin packaging syncs the canonical Skill into a flat ZIP", () => {
  const root = createFixture();
  const output = join(root, "plugins", "ego", "release-output");

  try {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "old-artifact.zip"), "must not ship\n");

    const first = runPackager(root, ["ego", "--output", output]);
    assertSuccess(first);
    assert.deepEqual(zipFiles(output), ["ego-v1.3.1.zip", "old-artifact.zip"]);

    const archive = join(output, "ego-v1.3.1.zip");
    assertPortableArchive(archive, "ego", "ego-browser");
    assert.match(
      zipText(archive, "skills/ego-browser/SKILL.md"),
      /description: canonical ego-browser/,
    );
    assert.equal(
      readFileSync(
        join(root, "plugins", "ego", "skills", "ego-browser", "SKILL.md"),
        "utf8",
      ),
      readFileSync(join(root, "skills", "ego-browser", "SKILL.md"), "utf8"),
    );
    assert.equal(
      zipText(archive, "skills/ego-browser/references/install.md"),
      "canonical ego-browser reference\n",
    );

    const second = runPackager(root, ["ego", "--output", output]);
    assertSuccess(second);
    assert.ok(
      zipFiles(output).includes(basename(archive)),
      "repeated packaging must reuse the stable versioned filename",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--all creates one stable versioned ZIP for every plugin", () => {
  const root = createFixture();
  const output = join(root, "release");

  try {
    const result = runPackager(root, ["--all", "--output", output]);
    assertSuccess(result);
    assert.deepEqual(zipFiles(output), ["ego-v1.3.1.zip", "sample-v2.4.0.zip"]);
    assertPortableArchive(join(output, "ego-v1.3.1.zip"), "ego", "ego-browser");
    assertPortableArchive(
      join(output, "sample-v2.4.0.zip"),
      "sample",
      "sample-skill",
    );
    assert.match(
      zipText(
        join(output, "sample-v2.4.0.zip"),
        "skills/sample-skill/SKILL.md",
      ),
      /description: canonical sample-skill/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an output directory above plugins does not exclude the plugin itself", () => {
  const root = createFixture();

  try {
    const result = runPackager(root, ["ego", "--output", root]);
    assertSuccess(result);
    const archive = join(root, "ego-v1.3.1.zip");
    assertPortableArchive(archive, "ego", "ego-browser");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin symlinks are rejected instead of copying external files", () => {
  const root = createFixture();
  const output = join(root, "release");
  const secret = join(root, "outside-secret.txt");

  try {
    writeFileSync(secret, "PRIVATE-DATA\n");
    symlinkSync(secret, join(root, "plugins", "ego", "leak.txt"));

    const result = runPackager(root, ["ego", "--output", output]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /symbolic link/i);
    assert.equal(existsSync(join(output, "ego-v1.3.1.zip")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlinked output inside the plugin cannot leak output files", () => {
  const root = createFixture();
  const outside = mkdtempSync(join(tmpdir(), "ego-plugin-output-"));
  const output = join(root, "plugins", "ego", "release-output");

  try {
    writeFileSync(join(outside, "leak.txt"), "PRIVATE-DATA\n");
    symlinkSync(outside, output);

    const result = runPackager(root, ["ego", "--output", output]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /symbolic link/i);
    assert.equal(existsSync(join(outside, "ego-v1.3.1.zip")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("invalid selectors fail with clear errors", () => {
  const root = createFixture();
  const output = join(root, "release");

  try {
    const unknown = runPackager(root, ["missing", "--output", output]);
    assert.notEqual(unknown.status, 0);
    assert.match(
      `${unknown.stdout}\n${unknown.stderr}`,
      /unknown plugin.*missing/i,
    );

    const conflict = runPackager(root, ["ego", "--all", "--output", output]);
    assert.notEqual(conflict.status, 0);
    assert.match(
      `${conflict.stdout}\n${conflict.stderr}`,
      /(?:cannot|choose|conflict|either).*(?:--all|plugin)|--all.*(?:cannot|choose|conflict|either)/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("npm payload includes every promised host entry and the license", () => {
  const pluginRoot = join(repositoryRoot, "plugins", "ego");
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: pluginRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const files = new Set(
    JSON.parse(result.stdout)[0].files.map(({ path }) => path),
  );

  for (const path of [
    "LICENSE",
    "plugin.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".codebuddy-plugin/plugin.json",
    ".workbuddy-plugin/plugin.json",
    ".qoder-plugin/plugin.json",
    "index.js",
    "cordis.patch.yml",
    "dsh/src/index.js",
    "skills/ego-browser/SKILL.md",
  ]) {
    assert.equal(files.has(path), true, `${path} must ship in the npm payload`);
  }
});
