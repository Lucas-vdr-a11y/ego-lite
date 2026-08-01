import { mkdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

import { state } from "../state.js";
import { cdp, evaluate, runtimeValue } from "../cdp-eval.js";
import { pageInfo } from "./nav.js";
import {
  browserEgo,
  browserSnapshotRefsToRefMap,
  drainBrowserEvents,
  ensureSession,
  isBrowserRuntime,
  pendingDialog,
} from "../browser-runtime.js";
import { buildEgoError } from "../ego-errors.js";
import { resolveElementCenter } from "../element-resolver.js";
import {
  currentRefMap,
  ensureRefMapForRef,
  registerSnapshotForRefRefresh,
} from "../ref-state.js";

type SnapshotOptions = {
  scope?: "only_within_viewport" | "full_page";
  includeActionMarks?: boolean;
  includeStableLocator?: boolean;
};

type ScreenshotClip = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
};

type ScreenshotOptions = {
  path?: string;
  type?: "png" | "jpeg" | "webp";
  quality?: number;
  scale?: "css" | "device";
  fullPage?: boolean;
  raw?: boolean;
  clip?: ScreenshotClip;
  omitBackground?: boolean;
  animations?: "allow" | "disabled";
  caret?: "hide" | "initial";
  style?: string;
};

export function drainEvents() {
  return drainBrowserEvents();
}

export async function snapshotRaw(options: SnapshotOptions = {}) {
  let result;
  try {
    result = await browserEgo().snapshot(options);
  } catch (err) {
    // ego.snapshot rejects directly (it never resolves with { error }), so it never
    // reached buildEgoError — the single birthplace that records a hard stop for the
    // output sink and swaps native wording for ego-browser's owned guidance. Route the
    // rejection through it so a swallowed snapshot hard stop collapses like every other
    // ego error instead of leaking repeated native text.
    throw buildEgoError(err, "snapshot");
  }
  browserSnapshotRefsToRefMap(currentRefMap(), result.refs || []);
  return result;
}

registerSnapshotForRefRefresh(() => snapshotRaw());

/**
 * Return snapshot content with agent-friendly defaults. The text surface most
 * agents want; use snapshotRaw when you need the structured { content, refs }.
 * @param {{scope?: "only_within_viewport"|"full_page", includeActionMarks?: boolean, includeStableLocator?: boolean}} [options]
 * @returns {Promise<string>}
 */
export async function snapshot(options: SnapshotOptions = {}) {
  const result = await snapshotRaw({
    scope: options.scope ?? "full_page",
    includeActionMarks: options.includeActionMarks ?? true,
    includeStableLocator: options.includeStableLocator ?? true,
  });
  return result.content || "";
}

export async function elementCenter(selectorOrRef) {
  await ensureRefMapForRef(selectorOrRef);
  return resolveElementCenter(
    { sendRaw: cdp },
    undefined,
    currentRefMap(),
    selectorOrRef,
  );
}

// Sequence number for default screenshot file names. Combined with the pid it
// keeps concurrent agent processes (parallel task spaces) from overwriting each
// other's shots in the shared tmpdir, and successive shots in one run distinct.
let screenshotSeq = 0;

/**
 * Capture a Playwright-style screenshot Buffer and optionally write it to path.
 * @param {{path?: string, type?: "png"|"jpeg"|"webp", quality?: number, scale?: "css"|"device", fullPage?: boolean, clip?: object, omitBackground?: boolean, animations?: "allow"|"disabled", caret?: "hide"|"initial", style?: string}} [options]
 * @returns {Promise<Buffer>}
 */
export async function screenshot(options: ScreenshotOptions = {}) {
  const full = options.fullPage ?? false;
  const raw = options.raw ?? false;
  const scale = screenshotScale(options.scale);
  const format = screenshotFormat(options);
  const params: any = {
    format,
    captureBeyondViewport: full,
  };
  if (options.quality !== undefined) {
    const quality = Number(options.quality);
    if (
      !Number.isInteger(quality) ||
      quality < 0 ||
      quality > 100 ||
      format === "png"
    ) {
      throw new TypeError(
        "screenshot quality must be an integer from 0 to 100 for jpeg or webp",
      );
    }
    params.quality = quality;
  }
  const sessionId = isBrowserRuntime() ? await ensureSession() : undefined;
  let styleToken: string | null = null;
  let transparentBackground = false;
  try {
    if (!raw && !pendingDialog(sessionId)) {
      styleToken = await installScreenshotStyle(options);
      if (options.omitBackground) {
        await cdp("Emulation.setDefaultBackgroundColorOverride", {
          color: { r: 0, g: 0, b: 0, a: 0 },
        });
        transparentBackground = true;
      }
    }
    if (raw) {
      if (options.clip) {
        params.clip = { ...options.clip };
      }
    } else {
      if (!pendingDialog(sessionId)) {
        let captureScale = full ? 1 : await visualViewportScale(sessionId);
        if (scale === "css") {
          captureScale /= await devicePixelRatio(sessionId);
        }
        if (options.clip) {
          params.clip = { ...options.clip, scale: captureScale };
        } else {
          const info = await pageInfo();
          if ("dialog" in info) {
            return screenshot({ ...options, raw: true });
          }
          params.clip = {
            x: full ? 0 : info.sx,
            y: full ? 0 : info.sy,
            width: full ? info.pw : info.w,
            height: full ? info.ph : info.h,
            scale: captureScale,
          };
        }
      }
    }
    const result = await cdp("Page.captureScreenshot", params);
    const buffer = Buffer.from(result.data, "base64");
    if (options.path) {
      await mkdir(dirname(options.path), { recursive: true });
      await state.writeFile(options.path, buffer);
    }
    return buffer;
  } finally {
    if (styleToken) {
      await removeScreenshotStyle(styleToken).catch(() => {});
    }
    if (transparentBackground) {
      await cdp("Emulation.setDefaultBackgroundColorOverride").catch(() => {});
    }
  }
}

/**
 * Save a screenshot and return its path. This is the ego-browser path-oriented
 * companion to Playwright-compatible page.screenshot(), which returns Buffer.
 */
export async function saveScreenshot(options: ScreenshotOptions = {}) {
  const format = screenshotFormat(options);
  const path =
    options.path ??
    join(
      tmpdir(),
      `ego-browser-shot-${process.pid}-${Date.now()}-${++screenshotSeq}-${Math.random().toString(16).slice(2)}.${format === "jpeg" ? "jpg" : format}`,
    );
  await screenshot({ ...options, path });
  return path;
}

function screenshotFormat(options: ScreenshotOptions) {
  if (options.type) return options.type;
  const extension = options.path ? extname(options.path).toLowerCase() : "";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".webp") return "webp";
  return "png";
}

function screenshotScale(value: ScreenshotOptions["scale"]) {
  const scale = value ?? "device";
  if (scale !== "css" && scale !== "device") {
    throw new TypeError('screenshot scale must be "css" or "device"');
  }
  return scale;
}

async function visualViewportScale(sessionId?: string) {
  const metrics = await cdp("Page.getLayoutMetrics", {}, sessionId);
  return (
    Number(metrics.cssVisualViewport?.scale ?? metrics.visualViewport?.scale) ||
    1
  );
}

async function devicePixelRatio(sessionId?: string) {
  const expression = "window.devicePixelRatio";
  const result = await cdp(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: false },
    sessionId,
  );
  return Number(runtimeValue(result, expression)) || 1;
}

async function installScreenshotStyle(options: ScreenshotOptions) {
  const rules: string[] = [];
  if (options.animations === "disabled") {
    rules.push(
      "*,*::before,*::after{animation-delay:-1ms!important;animation-duration:0s!important;transition-duration:0s!important;}",
    );
  }
  if ((options.caret ?? "hide") === "hide") {
    rules.push("*{caret-color:transparent!important;}");
  }
  if (options.style) rules.push(String(options.style));
  if (!rules.length) return null;
  const token = `ego-screenshot-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await evaluate(`(() => {
    const style = document.createElement("style");
    style.dataset.egoScreenshot = ${JSON.stringify(token)};
    style.textContent = ${JSON.stringify(rules.join("\n"))};
    (document.head || document.documentElement).appendChild(style);
  })()`);
  return token;
}

async function removeScreenshotStyle(token: string) {
  await evaluate(
    `document.querySelector(${JSON.stringify(
      `style[data-ego-screenshot="${token}"]`,
    )})?.remove()`,
  );
}
