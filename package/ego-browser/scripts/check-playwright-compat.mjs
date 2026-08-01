import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const PLAYWRIGHT_VERSION = "1.52.0";
const INTERFACES = [
  "Page",
  "Locator",
  "FrameLocator",
  "Frame",
  "Browser",
  "BrowserContext",
  "Keyboard",
  "Mouse",
  "JSHandle",
  "ElementHandle",
  "CDPSession",
];

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(
  packageRoot,
  "compat",
  `playwright-${PLAYWRIGHT_VERSION}.json`,
);
const require = createRequire(import.meta.url);
const playwrightEntry = require.resolve("playwright-core");
const playwrightRoot = path.dirname(playwrightEntry);
const playwrightPackage = JSON.parse(
  await readFile(path.join(playwrightRoot, "package.json"), "utf8"),
);

assert.equal(
  playwrightPackage.version,
  PLAYWRIGHT_VERSION,
  `Expected playwright-core@${PLAYWRIGHT_VERSION}, found ${playwrightPackage.version}`,
);

const typesPath = path.join(playwrightRoot, "types", "types.d.ts");
const sourceText = await readFile(typesPath, "utf8");
const sourceFile = ts.createSourceFile(
  typesPath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
);
const printer = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: true,
});
const declarations = new Map();

for (const statement of sourceFile.statements) {
  if (ts.isInterfaceDeclaration(statement)) {
    declarations.set(statement.name.text, statement);
  }
}

const interfaces = {};
const signatures = {};
for (const interfaceName of INTERFACES) {
  const declaration = declarations.get(interfaceName);
  assert.ok(declaration, `Missing Playwright interface ${interfaceName}`);
  signatures[interfaceName] = {};
  interfaces[interfaceName] = [
    ...new Set(
      declaration.members
        .filter((member) => member.name)
        .map((member) =>
          member.name.getText(sourceFile).replace(/^["']|["']$/g, ""),
        ),
    ),
  ].sort();
  for (const member of declaration.members.filter((item) => item.name)) {
    const memberName = member.name
      .getText(sourceFile)
      .replace(/^["']|["']$/g, "");
    const signature = printer
      .printNode(ts.EmitHint.Unspecified, member, sourceFile)
      .replace(/\s+/g, " ")
      .trim();
    signatures[interfaceName][memberName] ||= [];
    signatures[interfaceName][memberName].push(signature);
  }
  for (const values of Object.values(signatures[interfaceName])) {
    values.sort();
  }
}

const expected = {
  package: "playwright-core",
  version: PLAYWRIGHT_VERSION,
  source: "types/types.d.ts",
  interfaces,
  signatures,
};
const serialized = `${JSON.stringify(expected, null, 2)}\n`;

if (process.argv.includes("--write")) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, serialized);
  console.log(`Wrote ${path.relative(packageRoot, manifestPath)}`);
} else {
  const actual = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(
    actual,
    expected,
    `Compatibility manifest is stale. Run: node scripts/check-playwright-compat.mjs --write`,
  );
  console.log(
    `Verified ${path.relative(packageRoot, manifestPath)} against playwright-core@${PLAYWRIGHT_VERSION}`,
  );
}

if (process.argv.includes("--report")) {
  const formatSource = await readFile(
    path.join(packageRoot, "src", "format.ts"),
    "utf8",
  );
  const documentedPaths = publicApiPaths(formatSource);
  const coverage = [
    interfaceCoverage("Page", documentedPaths, interfaces, [
      ...(documentedPaths.some((value) => value.startsWith("page.keyboard."))
        ? ["keyboard"]
        : []),
      ...(documentedPaths.some((value) => value.startsWith("page.mouse."))
        ? ["mouse"]
        : []),
      ...(documentedPaths.some((value) => value.startsWith("page.clock."))
        ? ["clock"]
        : []),
    ]),
    interfaceCoverage("Locator", documentedPaths, interfaces),
    interfaceCoverage("FrameLocator", documentedPaths, interfaces),
    interfaceCoverage("Keyboard", documentedPaths, interfaces),
    interfaceCoverage("Mouse", documentedPaths, interfaces),
  ];
  let covered = 0;
  let available = 0;
  for (const item of coverage) {
    covered += item.covered.length;
    available += item.available;
    console.log(
      `${item.name}: ${item.covered.length}/${item.available} (${percentage(item.covered.length, item.available)})`,
    );
    console.log(`${item.name} missing: ${item.missing.join(", ") || "none"}`);
  }
  console.log(
    `Total: ${covered}/${available} (${percentage(covered, available)})`,
  );
  console.log("Excluded by design: Browser, BrowserContext");
}

function publicApiPaths(formatSource) {
  const formatFile = ts.createSourceFile(
    "format.ts",
    formatSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = formatFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((item) => item.name.getText(formatFile) === "PUBLIC_API_DOCS");
  assert.ok(
    declaration?.initializer &&
      ts.isObjectLiteralExpression(declaration.initializer),
    "Missing PUBLIC_API_DOCS object literal",
  );
  return declaration.initializer.properties
    .filter((property) => property.name)
    .map((property) =>
      property.name.getText(formatFile).replace(/^["']|["']$/g, ""),
    );
}

function interfaceCoverage(
  name,
  documentedPaths,
  interfaceMembers,
  extras = [],
) {
  const prefixes = {
    Page: ["page."],
    Locator: ["locator."],
    FrameLocator: ["frameLocator."],
    Keyboard: ["page.keyboard."],
    Mouse: ["page.mouse."],
  }[name];
  const depth = name === "Keyboard" || name === "Mouse" ? 3 : 2;
  const candidates = documentedPaths
    .filter(
      (value) =>
        prefixes.some((prefix) => value.startsWith(prefix)) &&
        value.split(".").length === depth,
    )
    .map((value) => value.split(".").at(-1));
  const covered = [...new Set([...candidates, ...extras])]
    .filter((member) => interfaceMembers[name].includes(member))
    .sort();
  return {
    name,
    covered,
    available: interfaceMembers[name].length,
    missing: interfaceMembers[name].filter(
      (member) => !covered.includes(member),
    ),
  };
}

function percentage(covered, available) {
  return `${((covered / available) * 100).toFixed(1)}%`;
}
