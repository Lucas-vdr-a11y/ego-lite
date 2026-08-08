import {
  chmod,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { rollup } from "rollup";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

import { extractHelpDocs } from "./extract-help-docs.mjs";
import {
  assertPlaywrightBundleInputs,
  playwrightCoreBundlePlugin,
} from "./playwright-core-bundle-plugin.mjs";

const HELP_DOCS_PLACEHOLDER = '"__EGO_EMBEDDED_HELP_DOCS__"';
const DIAGNOSTIC_BUILD_FLAG = "--diagnostic";
const buildArguments = process.argv.slice(2);
const unknownBuildArguments = buildArguments.filter(
  (argument) => argument !== DIAGNOSTIC_BUILD_FLAG,
);
if (unknownBuildArguments.length > 0) {
  throw new Error(
    `unknown build argument(s): ${unknownBuildArguments.join(", ")}`,
  );
}
const diagnosticBuild = buildArguments.includes(DIAGNOSTIC_BUILD_FLAG);

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(root));
const distDir = join(root, "dist");
const outDir = join(distDir, "out");
const bundledCliDir = outDir;
const bundledCli = join(
  bundledCliDir,
  diagnosticBuild ? "index.diagnostic.js" : "index.js",
);
const skillSourceDir = join(repoRoot, "skills", "ego-browser");
const bundledSkillDir = join(outDir, "ego-browser");
const buildLock = join(root, ".build.lock");

let lock;
try {
  lock = await open(buildLock, "wx");
} catch (error) {
  if (error?.code === "EEXIST") {
    throw new Error("another ego-browser-v2 build is already running");
  }
  throw error;
}

try {
  await rm(distDir, { recursive: true, force: true });
  await rm(join(root, "artifacts"), { recursive: true, force: true });
  await rm(join(root, "ego-browser.js"), { force: true });
  await rm(join(root, "bin"), { recursive: true, force: true });
  await mkdir(bundledCliDir, { recursive: true });

  const common = {
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "info",
    define: {
      "process.env.EGO_BROWSER_DIAGNOSTIC_BUILD": JSON.stringify(
        diagnosticBuild ? "1" : "0",
      ),
    },
  };

  await build({
    ...common,
    entryPoints: await tsEntryPoints(["scripts", "src"]),
    outdir: "dist",
    outbase: ".",
    bundle: false,
    sourcemap: false,
    absWorkingDir: root,
  });

  const rollupConfig = {
    input: join(root, "src/index.ts"),
    external: [
      ...builtinModules,
      ...builtinModules.map((m) => `node:${m}`),
      "#playwright-runtime",
      "#playwright-transport",
      "playwright-core",
    ],
    plugins: [
      diagnosticTracePlugin(diagnosticBuild),
      resolve(),
      typescript({
        tsconfig: join(root, "tsconfig.json"),
        compilerOptions: {
          noEmit: false,
          declaration: false,
          removeComments: false,
        },
      }),
    ],
  };
  const bundle = await rollup(rollupConfig);
  await bundle.write({ file: bundledCli, format: "esm", sourcemap: false });
  await bundle.close();

  await embedHelpDocs(bundledCli, join(distDir, "src", "help-runtime.js"));

  const minifiedBundle = join(outDir, "index.bundle.js");
  const bundleResult = await build({
    ...common,
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; import { dirname as __pathDirname } from "node:path"; import { fileURLToPath as __fileURLToPath } from "node:url"; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __pathDirname(__filename);',
    },
    bundle: true,
    entryPoints: [bundledCli],
    keepNames: false,
    legalComments: "none",
    metafile: true,
    minify: true,
    outfile: minifiedBundle,
    plugins: [playwrightCoreBundlePlugin()],
    sourcemap: false,
  });
  assertPlaywrightBundleInputs(bundleResult.metafile);
  await rename(minifiedBundle, bundledCli);
  await assertDiagnosticBuild(bundledCli, diagnosticBuild);

  const playwrightPackageDir = join(root, "node_modules", "playwright-core");
  const noticeFiles = ["LICENSE", "NOTICE", "ThirdPartyNotices.txt"];
  const notices = await Promise.all(
    noticeFiles.map(async (name) => {
      const contents = await readFile(join(playwrightPackageDir, name), "utf8");
      return `===== playwright-core ${name} =====\n\n${contents.trim()}\n`;
    }),
  );
  await writeFile(
    join(outDir, "THIRD_PARTY_LICENSES.txt"),
    `${notices.join("\n")}\n`,
  );

  await cp(skillSourceDir, bundledSkillDir, { recursive: true });
  await chmod(bundledCli, 0o755);
} finally {
  await lock.close();
  await rm(buildLock, { force: true });
}

async function embedHelpDocs(...files) {
  // Implementation-level fallback docs are extracted from the emitted bundle
  // (which preserves JSDoc) and injected into each artifact that ships
  // help-runtime. Built-in public facade docs come from PUBLIC_API_DOCS; this
  // fallback keeps top-level extension helpers usable without runtime source
  // introspection. See GitHub issue #84.
  const bundleSource = await readFile(files[0], "utf-8");
  const docs = extractHelpDocs(bundleSource);
  if (docs.length === 0) {
    throw new Error("embedHelpDocs: extracted 0 helper docs from the bundle");
  }

  const injected = JSON.stringify(JSON.stringify(docs));
  for (const file of files) {
    const source = await readFile(file, "utf-8");
    if (!source.includes(HELP_DOCS_PLACEHOLDER)) {
      throw new Error(`embedHelpDocs: placeholder not found in ${file}`);
    }
    // Use a replacer function so `$` sequences in the JSON are inserted literally.
    await writeFile(
      file,
      source.replace(HELP_DOCS_PLACEHOLDER, () => injected),
    );
  }
}

async function assertDiagnosticBuild(bundlePath, enabled) {
  const source = await readFile(bundlePath, "utf8");
  const traceTokens = [
    "EGO_BROWSER_DIAGNOSTIC_BUILD",
    "EGO_BROWSER_TRACE_FILE",
    "appendFileSync",
  ];
  const unexpected = traceTokens.filter((token) => source.includes(token));
  if (!enabled && unexpected.length > 0) {
    throw new Error(
      `release bundle contains diagnostic trace code: ${unexpected.join(", ")}`,
    );
  }

  const missing = traceTokens
    .slice(1)
    .filter((token) => !source.includes(token));
  if (enabled && missing.length > 0) {
    throw new Error(
      `diagnostic bundle is missing trace code: ${missing.join(", ")}`,
    );
  }
}

function diagnosticTracePlugin(enabled) {
  const disabledModuleId = "\0ego-browser-disabled-trace";
  return {
    name: "ego-browser-diagnostic-trace",
    resolveId(source) {
      if (!enabled && source === "./trace-file.js") {
        return disabledModuleId;
      }
      return null;
    },
    load(id) {
      if (id !== disabledModuleId) return null;
      return [
        "export function startTrace() {}",
        "export function traceOutput() {}",
      ].join("\n");
    },
  };
}

async function tsEntryPoints(dirs) {
  const files = [];
  for (const dir of dirs) {
    files.push(...(await collectTsFiles(join(root, dir), dir)));
  }
  return files.sort();
}

async function collectTsFiles(absDir, relativeDir) {
  const entries = await readdir(absDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(absPath, relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }
  return files;
}
