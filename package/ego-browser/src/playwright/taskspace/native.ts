import { chromium } from "#playwright-runtime";

import { syncCssPixelScreenshots } from "../device-scale.js";
import { createEgoPlaywrightTransport } from "../transport.js";
import { createPlaywrightTaskSpaceConnector } from "./connector.js";
import { installPlaywrightFrameTimerUnref } from "./frame-timer-patch.js";
import type { EgoPlaywrightRuntime } from "./types.js";

/**
 * The connector as it is wired in the real browser: the native `ego` runtime,
 * the CDP transport over it, and Playwright's own chromium client.
 */
export function createNativePlaywrightTaskSpaceConnector() {
  return createPlaywrightTaskSpaceConnector({
    runtime: () => (globalThis as any).ego,
    transport: (runtime) => createNativePlaywrightTransport(runtime),
    connectOverCDP: async (connectToken) => {
      const restoreTimerPatch = installPlaywrightFrameTimerUnref();
      try {
        const browser = await chromium.connectOverCDP(connectToken);
        browser.once("disconnected", restoreTimerPatch);
        return browser;
      } catch (error) {
        restoreTimerPatch();
        throw error;
      }
    },
    // Read on every connect rather than once per process: the ratio changes
    // when the user drags the browser window to a display with a different one.
    prepareSession: async (session) => {
      await syncCssPixelScreenshots(session);
      // Remove Playwright-injected globals that bot-detection scripts check for.
      // Safe because this project does not use exposeFunction/exposeBinding,
      // which are the only consumers of __playwright__binding__.
      await session.context.addInitScript(() => {
        delete (window as any).__pwInitScripts;
        delete (window as any).__playwright__binding__;
      });
      await session.page.evaluate(() => {
        delete (window as any).__pwInitScripts;
        delete (window as any).__playwright__binding__;
      });
    },
  });
}

export async function createNativePlaywrightTransport(
  runtime: EgoPlaywrightRuntime,
) {
  if (typeof runtime?.sendCDPMessage === "function") {
    return createEgoPlaywrightTransport(
      runtime as EgoPlaywrightRuntime & {
        sendCDPMessage: (payload: string) => unknown;
      },
    );
  }
  throw new Error("Playwright TaskSpace requires ego.sendCDPMessage");
}
