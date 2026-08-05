import { readFile } from "node:fs/promises";

const PLAYWRIGHT_CORE_PREFIX = "node_modules/playwright-core/lib/";

const patches = new Map([
  ["inProcessFactory.js", patchInProcessFactory],
  ["client/connection.js", patchClientConnection],
  ["client/playwright.js", patchClientPlaywright],
  ["protocol/validator.js", patchProtocolValidator],
  ["server/errors.js", patchPlaywrightServerErrors],
  ["server/dispatchers/playwrightDispatcher.js", patchPlaywrightDispatcher],
  ["server/playwright.js", patchServerPlaywright],
  ["server/utils/nodePlatform.js", patchNodePlatform],
]);

export function playwrightCoreBundlePlugin() {
  return {
    name: "playwright-core-bundle",
    setup(build) {
      build.onLoad(
        { filter: /[\\/]playwright-core[\\/]lib[\\/].*\.js$/ },
        async ({ path }) => {
          const normalizedPath = path.replaceAll("\\", "/");
          const relativePath = normalizedPath.split(PLAYWRIGHT_CORE_PREFIX)[1];
          const patch = patches.get(relativePath);
          if (!patch) return;
          return {
            contents: patch(await readFile(path, "utf-8"), relativePath),
            loader: "js",
          };
        },
      );
    },
  };
}

export function assertPlaywrightBundleInputs(metafile) {
  const inputs = Object.keys(metafile.inputs).map((path) =>
    path.replaceAll("\\", "/"),
  );
  const forbidden = inputs.filter((path) =>
    /node_modules\/playwright-core\/lib\/(?:androidServerImpl|browserServerImpl|client\/(?:android|electron)|server\/(?:android|bidi|electron|firefox|webkit))/.test(
      path,
    ),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `non-Chromium Playwright modules entered the bundle:\n${forbidden.join("\n")}`,
    );
  }

  for (const required of [
    "client/browserContext.js",
    "client/frame.js",
    "client/locator.js",
    "client/network.js",
    "client/page.js",
    "server/chromium/crBrowser.js",
    "server/chromium/crPage.js",
  ]) {
    if (
      !inputs.some((path) => path.endsWith(`/playwright-core/lib/${required}`))
    ) {
      throw new Error(
        `required Playwright module missing from bundle: ${required}`,
      );
    }
  }
}

function patchInProcessFactory(source, path) {
  source = removeRequired(
    source,
    'var import_androidServerImpl = require("./androidServerImpl");\n',
    path,
  );
  source = removeRequired(
    source,
    'var import_browserServerImpl = require("./browserServerImpl");\n',
    path,
  );
  source = replaceRequired(
    source,
    'var import_server = require("./server");',
    [
      'var import_playwright = require("./server/playwright");',
      'var import_dispatcher = require("./server/dispatchers/dispatcher");',
      'var import_playwrightDispatcher = require("./server/dispatchers/playwrightDispatcher");',
    ].join("\n"),
    path,
  );
  source = replaceRequired(
    source,
    "(0, import_server.createPlaywright)",
    "(0, import_playwright.createPlaywright)",
    path,
  );
  source = replaceRequired(
    source,
    "new import_server.DispatcherConnection",
    "new import_dispatcher.DispatcherConnection",
    path,
  );
  source = replaceRequired(
    source,
    "new import_server.RootDispatcher",
    "new import_dispatcher.RootDispatcher",
    path,
  );
  source = replaceRequired(
    source,
    "new import_server.PlaywrightDispatcher",
    "new import_playwrightDispatcher.PlaywrightDispatcher",
    path,
  );
  for (const line of [
    '  playwrightAPI.chromium._serverLauncher = new import_browserServerImpl.BrowserServerLauncherImpl("chromium");\n',
    '  playwrightAPI.firefox._serverLauncher = new import_browserServerImpl.BrowserServerLauncherImpl("firefox");\n',
    '  playwrightAPI.webkit._serverLauncher = new import_browserServerImpl.BrowserServerLauncherImpl("webkit");\n',
    "  playwrightAPI._android._serverLauncher = new import_androidServerImpl.AndroidServerLauncherImpl();\n",
    '  playwrightAPI._bidiChromium._serverLauncher = new import_browserServerImpl.BrowserServerLauncherImpl("bidiChromium");\n',
    '  playwrightAPI._bidiFirefox._serverLauncher = new import_browserServerImpl.BrowserServerLauncherImpl("bidiFirefox");\n',
  ]) {
    source = removeRequired(source, line, path);
  }
  return source;
}

function patchServerPlaywright(source, path) {
  for (const line of [
    'var import_android = require("./android/android");\n',
    'var import_backendAdb = require("./android/backendAdb");\n',
    'var import_bidiChromium = require("./bidi/bidiChromium");\n',
    'var import_bidiFirefox = require("./bidi/bidiFirefox");\n',
    'var import_debugController = require("./debugController");\n',
    'var import_electron = require("./electron/electron");\n',
    'var import_firefox = require("./firefox/firefox");\n',
    'var import_webkit = require("./webkit/webkit");\n',
    "    this.bidiChromium = new import_bidiChromium.BidiChromium(this);\n",
    "    this.bidiFirefox = new import_bidiFirefox.BidiFirefox(this);\n",
    "    this.firefox = new import_firefox.Firefox(this);\n",
    "    this.webkit = new import_webkit.WebKit(this);\n",
    "    this.electron = new import_electron.Electron(this);\n",
    "    this.android = new import_android.Android(this, new import_backendAdb.AdbBackend());\n",
    "    this.debugController = new import_debugController.DebugController(this);\n",
  ]) {
    source = removeRequired(source, line, path);
  }
  return source;
}

function patchPlaywrightDispatcher(source, path) {
  for (const block of [
    'var import_androidDispatcher = require("./androidDispatcher");\n',
    'var import_androidDispatcher2 = require("./androidDispatcher");\n',
    'var import_electronDispatcher = require("./electronDispatcher");\n',
    "    const android = new import_androidDispatcher.AndroidDispatcher(scope, playwright.android);\n",
    "    const prelaunchedAndroidDeviceDispatcher = prelaunchedAndroidDevice ? new import_androidDispatcher2.AndroidDeviceDispatcher(android, prelaunchedAndroidDevice) : void 0;\n",
    "      firefox: new import_browserTypeDispatcher.BrowserTypeDispatcher(scope, playwright.firefox),\n",
    "      webkit: new import_browserTypeDispatcher.BrowserTypeDispatcher(scope, playwright.webkit),\n",
    "      bidiChromium: new import_browserTypeDispatcher.BrowserTypeDispatcher(scope, playwright.bidiChromium),\n",
    "      bidiFirefox: new import_browserTypeDispatcher.BrowserTypeDispatcher(scope, playwright.bidiFirefox),\n",
    "      android,\n",
    "      electron: new import_electronDispatcher.ElectronDispatcher(scope, playwright.electron),\n",
    "      preConnectedAndroidDevice: prelaunchedAndroidDeviceDispatcher,\n",
  ]) {
    source = removeRequired(source, block, path);
  }
  return source;
}

function patchClientPlaywright(source, path) {
  for (const block of [
    'var import_android = require("./android");\n',
    'var import_electron = require("./electron");\n',
    "    this.firefox = import_browserType.BrowserType.from(initializer.firefox);\n",
    "    this.firefox._playwright = this;\n",
    "    this.webkit = import_browserType.BrowserType.from(initializer.webkit);\n",
    "    this.webkit._playwright = this;\n",
    "    this._android = import_android.Android.from(initializer.android);\n",
    "    this._electron = import_electron.Electron.from(initializer.electron);\n",
    "    this._bidiChromium = import_browserType.BrowserType.from(initializer.bidiChromium);\n",
    "    this._bidiChromium._playwright = this;\n",
    "    this._bidiFirefox = import_browserType.BrowserType.from(initializer.bidiFirefox);\n",
    "    this._bidiFirefox._playwright = this;\n",
  ]) {
    source = removeRequired(source, block, path);
  }
  return replaceRequired(
    source,
    "    return [this.chromium, this.firefox, this.webkit, this._bidiChromium, this._bidiFirefox];",
    "    return [this.chromium];",
    path,
  );
}

function patchClientConnection(source, path) {
  for (const block of [
    'var import_android = require("./android");\n',
    'var import_electron = require("./electron");\n',
    '      case "Android":\n        result = new import_android.Android(parent, type, guid, initializer);\n        break;\n',
    '      case "AndroidSocket":\n        result = new import_android.AndroidSocket(parent, type, guid, initializer);\n        break;\n',
    '      case "AndroidDevice":\n        result = new import_android.AndroidDevice(parent, type, guid, initializer);\n        break;\n',
    '      case "Electron":\n        result = new import_electron.Electron(parent, type, guid, initializer);\n        break;\n',
    '      case "ElectronApplication":\n        result = new import_electron.ElectronApplication(parent, type, guid, initializer);\n        break;\n',
  ]) {
    source = removeRequired(source, block, path);
  }
  return source;
}

function patchProtocolValidator(source, path) {
  for (const line of [
    '  firefox: (0, import_validatorPrimitives.tChannel)(["BrowserType"]),\n',
    '  webkit: (0, import_validatorPrimitives.tChannel)(["BrowserType"]),\n',
    '  bidiChromium: (0, import_validatorPrimitives.tChannel)(["BrowserType"]),\n',
    '  bidiFirefox: (0, import_validatorPrimitives.tChannel)(["BrowserType"]),\n',
    '  android: (0, import_validatorPrimitives.tChannel)(["Android"]),\n',
    '  electron: (0, import_validatorPrimitives.tChannel)(["Electron"]),\n',
    '  preConnectedAndroidDevice: (0, import_validatorPrimitives.tOptional)((0, import_validatorPrimitives.tChannel)(["AndroidDevice"])),\n',
  ]) {
    source = removeRequired(source, line, path);
  }
  return source;
}

function patchNodePlatform(source, path) {
  return replaceRequired(
    source,
    'require.resolve("../../../package.json")',
    "__filename",
    path,
  );
}

export function patchPlaywrightServerErrors(source, path) {
  source = replaceRequired(
    source,
    "class TimeoutError extends CustomError {\n}",
    'class TimeoutError extends CustomError {\n  constructor(message) {\n    super(message);\n    this.name = "TimeoutError";\n  }\n}',
    path,
  );
  return replaceRequired(
    source,
    '  constructor(cause, logs) {\n    super((cause || "Target page, context or browser has been closed") + (logs || ""));\n  }',
    '  constructor(cause, logs) {\n    super((cause || "Target page, context or browser has been closed") + (logs || ""));\n    this.name = "TargetClosedError";\n  }',
    path,
  );
}

function removeRequired(source, search, path) {
  return replaceRequired(source, search, "", path);
}

function replaceRequired(source, search, replacement, path) {
  const occurrences = source.split(search).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `playwright-core ${path} changed; expected one bundle adapter match, found ${occurrences}`,
    );
  }
  return source.replace(search, replacement);
}
