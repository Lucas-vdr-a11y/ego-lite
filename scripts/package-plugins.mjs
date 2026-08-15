#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "__MACOSX",
  "dist",
  "mcp",
  "node_modules",
]);

function usage() {
  return `Usage:
  node scripts/package-plugins.mjs <plugin> [--output <directory>]
  node scripts/package-plugins.mjs --all [--output <directory>]`;
}

function parseArguments(args) {
  let all = false;
  let output;
  let plugin;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--all") {
      all = true;
    } else if (argument === "--output") {
      output = args[index + 1];
      if (!output) throw new Error("--output requires a directory");
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (plugin) {
      throw new Error("Choose one plugin or --all");
    } else {
      plugin = argument;
    }
  }

  if (all && plugin) throw new Error("Choose either one plugin or --all");
  if (!all && !plugin) throw new Error(usage());
  return { all, output, plugin };
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function findRepositoryRoot(start) {
  let directory = resolve(start);
  while (true) {
    if (
      await isDirectory(join(directory, "plugins")) &&
      await isDirectory(join(directory, "skills"))
    ) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not find a repository with plugins/ and skills/");
    }
    directory = parent;
  }
}

async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await canonicalPath(parent), basename(path));
  }
}

async function assertNoSymbolicLinks(root, label) {
  const information = await lstat(root);
  if (information.isSymbolicLink()) {
    throw new Error(`${label} contains a symbolic link: ${root}`);
  }
  if (!information.isDirectory()) return;

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    const child = await lstat(path);
    if (child.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link: ${path}`);
    }
    if (child.isDirectory()) await assertNoSymbolicLinks(path, label);
  }
}

async function pluginNames(repositoryRoot) {
  const entries = await readdir(join(repositoryRoot, "plugins"), {
    withFileTypes: true,
  });
  const names = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      await isDirectory(join(repositoryRoot, "plugins", entry.name))
    ) {
      try {
        await readFile(
          join(repositoryRoot, "plugins", entry.name, "plugin.json"),
          "utf8",
        );
        names.push(entry.name);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return names.sort();
}

async function syncSkills(repositoryRoot, pluginRoot) {
  const packagedSkillsRoot = join(pluginRoot, "skills");
  if (!await isDirectory(packagedSkillsRoot)) {
    throw new Error(`Plugin has no skills directory: ${pluginRoot}`);
  }

  const entries = await readdir(packagedSkillsRoot, { withFileTypes: true });
  const skills = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .sort();
  if (skills.length === 0) {
    throw new Error(`Plugin has no packaged Skills: ${pluginRoot}`);
  }

  for (const skill of skills) {
    const canonical = join(repositoryRoot, "skills", skill);
    if (!await isDirectory(canonical)) {
      throw new Error(`Canonical Skill not found: skills/${skill}`);
    }
    await assertNoSymbolicLinks(canonical, `Canonical Skill ${skill}`);
    const packaged = join(packagedSkillsRoot, skill);
    await rm(packaged, { recursive: true, force: true });
    await cp(canonical, packaged, {
      dereference: false,
      preserveTimestamps: true,
      recursive: true,
    });
  }
  return skills;
}

function isAtOrBelow(path, parent) {
  const result = relative(parent, path);
  return result === "" || (result !== ".." && !result.startsWith(`..${sep}`));
}

function copyFilter(pluginRoot, outputRoot) {
  const outputWithinPlugin =
    outputRoot !== pluginRoot && isAtOrBelow(outputRoot, pluginRoot);
  return (source) => {
    const absolute = resolve(source);
    if (outputWithinPlugin && isAtOrBelow(absolute, outputRoot)) return false;

    const path = relative(pluginRoot, absolute);
    if (!path) return true;
    const parts = path.split(sep);
    if (parts.some((part) => EXCLUDED_DIRECTORIES.has(part))) return false;

    const name = basename(path);
    return name !== ".DS_Store" && !/\.(?:tgz|zip)$/i.test(name);
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    throw new Error(`${command} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${command} failed${details ? `: ${details}` : ""}`);
  }
}

async function packagePlugin(repositoryRoot, name, outputRoot) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`Invalid plugin name: ${name}`);
  }
  const pluginRoot = join(repositoryRoot, "plugins", name);
  if (!await isDirectory(pluginRoot)) {
    throw new Error(`Unknown plugin: ${name}`);
  }
  await assertNoSymbolicLinks(pluginRoot, `Plugin ${name}`);

  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8"));
  } catch (error) {
    throw new Error(`Invalid plugin.json for ${name}: ${error.message}`);
  }
  if (manifest.name !== name) {
    throw new Error(`Plugin directory ${name} does not match manifest name ${manifest.name}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.version ?? "")) {
    throw new Error(`Plugin ${name} has an invalid version`);
  }

  const skills = await syncSkills(repositoryRoot, pluginRoot);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ego-plugin-package-"));
  const stagingRoot = join(temporaryRoot, name);
  await mkdir(outputRoot, { recursive: true });
  const archiveName = `${name}-v${manifest.version}.zip`;
  const temporaryArchive = join(
    outputRoot,
    `.${archiveName}.${process.pid}.${randomUUID()}.tmp.zip`,
  );
  const archive = join(outputRoot, archiveName);

  try {
    await cp(pluginRoot, stagingRoot, {
      dereference: false,
      filter: copyFilter(pluginRoot, outputRoot),
      preserveTimestamps: true,
      recursive: true,
    });
    await assertNoSymbolicLinks(stagingRoot, `Staged plugin ${name}`);
    const stagedOutput = relative(pluginRoot, outputRoot);
    if (
      stagedOutput &&
      stagedOutput !== ".." &&
      !stagedOutput.startsWith(`..${sep}`)
    ) {
      await rm(join(stagingRoot, stagedOutput), {
        recursive: true,
        force: true,
      });
    }
    await readFile(join(stagingRoot, ".claude-plugin", "plugin.json"), "utf8");
    for (const skill of skills) {
      await readFile(join(stagingRoot, "skills", skill, "SKILL.md"), "utf8");
    }

    run("zip", ["-q", "-r", "-X", temporaryArchive, "."], {
      cwd: stagingRoot,
    });
    run("unzip", ["-tqq", temporaryArchive]);
    await rename(temporaryArchive, archive);
  } finally {
    await rm(temporaryArchive, { force: true });
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  console.log(`Packaged ${name}: ${archive}`);
  return archive;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const repositoryRoot = await findRepositoryRoot(process.cwd());
  const outputRoot = await canonicalPath(resolve(
    options.output ?? join(repositoryRoot, "dist", "plugins"),
  ));
  const names = options.all
    ? await pluginNames(repositoryRoot)
    : [options.plugin];
  if (names.length === 0) throw new Error("No plugins found");

  for (const name of names) {
    await packagePlugin(repositoryRoot, name, outputRoot);
  }
}

main().catch((error) => {
  console.error(`package-plugins: ${error.message}`);
  process.exitCode = 1;
});
