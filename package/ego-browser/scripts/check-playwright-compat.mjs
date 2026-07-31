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
