import { chromium } from "#playwright-runtime";
import type { Browser, BrowserContext, Page } from "playwright-core";

import { createEgoPlaywrightTransport } from "./transport.js";

export type PlaywrightTaskSpaceSession = {
  page: Page;
  context: BrowserContext;
  close: () => Promise<void>;
};

export type PlaywrightTaskSpaceConnector = (
  space: Record<string, unknown>,
) => Promise<PlaywrightTaskSpaceSession>;

const disconnectedConnector: PlaywrightTaskSpaceConnector = async () => {
  throw new Error("Playwright TaskSpace connector is not configured");
};

let connector = disconnectedConnector;
let activeSession: PlaywrightTaskSpaceSession | undefined;

export type EgoPlaywrightRuntime = {
  listTabs?: () => Promise<{
    tabs?: EgoTab[];
    targetInfos?: EgoTab[];
  }>;
  createTab?: (
    url?: string,
  ) => Promise<
    | { targetId?: string; result?: { targetId?: string }; error?: unknown }
    | unknown
  >;
  sendCDPMessage?: (payload: string) => unknown;
  onCDPMessage?: (payload: string) => void;
  onSendCDPMessageError?: (message: unknown, errorCode?: string) => void;
};

type EgoTab = {
  targetId?: string;
  active?: boolean;
  type?: string;
  title?: string;
  url?: string;
};

export type PlaywrightConnectorDependencies = {
  runtime: () => EgoPlaywrightRuntime;
  transport: (
    runtime: EgoPlaywrightRuntime,
    space: Record<string, unknown>,
  ) => Promise<PlaywrightTransportLease>;
  connectOverCDP: (connectToken: string) => Promise<Browser>;
};

export type PlaywrightTransportLease = {
  connectToken: string;
  connected?: () => void;
  close?: () => Promise<void>;
};

let playwrightTimerPatchUsers = 0;
let originalSetTimeout: typeof globalThis.setTimeout | undefined;
let patchedSetTimeout: typeof globalThis.setTimeout | undefined;

export function createPlaywrightTaskSpaceConnector(
  dependencies: PlaywrightConnectorDependencies,
): PlaywrightTaskSpaceConnector {
  let browser: Browser | undefined;
  let closeTransport: (() => Promise<void>) | undefined;

  const close = async () => {
    const currentBrowser = browser;
    const currentTransportClose = closeTransport;
    browser = undefined;
    closeTransport = undefined;
    if (currentTransportClose) {
      try {
        await currentTransportClose();
      } finally {
        await currentBrowser?.close();
      }
    } else {
      await currentBrowser?.close();
    }
  };

  return async (space) => {
    const runtime = dependencies.runtime();
    if (!runtime || typeof runtime.listTabs !== "function") {
      throw new Error("Playwright TaskSpace requires ego.listTabs");
    }

    try {
      if (browser) await close();
      const transport = await dependencies.transport(runtime, space);
      closeTransport = transport.close;
      browser = await dependencies.connectOverCDP(transport.connectToken);
      transport.connected?.();
      const listed = await runtime.listTabs();
      const nativeTabs = listed.tabs || listed.targetInfos || [];
      const activeTab =
        nativeTabs.find((tab) => tab.active) || nativeTabs.at(-1);
      const located = await locatePlaywrightPage(
        browser,
        activeTab,
        nativeTabs,
      );
      return {
        page: located.page,
        context: located.context,
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  };
}

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
  });
}

export function isPlaywrightFrameThrottlerTimer(
  delay: unknown,
  stack: string | undefined,
) {
  return (
    (delay === 35 || delay === 200) &&
    typeof stack === "string" &&
    (stack.includes("FrameThrottler._tick") ||
      /\bat [\w$]{1,3}\._tick \(/.test(stack))
  );
}

function installPlaywrightFrameTimerUnref() {
  playwrightTimerPatchUsers += 1;
  if (playwrightTimerPatchUsers === 1) {
    originalSetTimeout = globalThis.setTimeout;
    patchedSetTimeout = ((callback, delay, ...args) => {
      const stack = new Error().stack;
      const timer = originalSetTimeout!(callback, delay, ...args);
      if (isPlaywrightFrameThrottlerTimer(delay, stack)) timer.unref?.();
      return timer;
    }) as typeof globalThis.setTimeout;
    globalThis.setTimeout = patchedSetTimeout;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    playwrightTimerPatchUsers -= 1;
    if (
      playwrightTimerPatchUsers === 0 &&
      originalSetTimeout &&
      globalThis.setTimeout === patchedSetTimeout
    ) {
      globalThis.setTimeout = originalSetTimeout;
      originalSetTimeout = undefined;
      patchedSetTimeout = undefined;
    }
  };
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

async function locatePlaywrightPage(
  browser: Browser,
  activeTab?: EgoTab,
  nativeTabs: EgoTab[] = [],
) {
  const deadline = Date.now() + 2_000;

  while (true) {
    const contexts = browser.contexts();
    for (const context of contexts) {
      const pages = context.pages();
      if (activeTab?.url) {
        const matches = pages.filter(
          (page) =>
            typeof page.url === "function" && page.url() === activeTab.url,
        );
        if (matches.length > 0) {
          const activeIndex = nativeTabs.indexOf(activeTab);
          const occurrence = nativeTabs
            .slice(0, activeIndex + 1)
            .filter((tab) => tab.url === activeTab.url).length;
          return { page: matches[occurrence - 1] || matches.at(-1), context };
        }
      }
      if (pages.length === 1) return { page: pages[0], context };
      const activeIndex = nativeTabs.indexOf(activeTab);
      if (!activeTab?.url && activeIndex >= 0 && pages[activeIndex]) {
        return { page: pages[activeIndex], context };
      }
      if (!activeTab && pages.length > 0) {
        return { page: pages.at(-1), context };
      }
    }

    if (Date.now() >= deadline) {
      const activeIndex = nativeTabs.indexOf(activeTab);
      if (activeIndex >= 0) {
        for (const context of contexts) {
          const page = context.pages()[activeIndex];
          if (page) return { page, context };
        }
      }
      const context = contexts[0];
      if (!context) {
        throw new Error("Playwright CDP connection returned no BrowserContext");
      }
      if (typeof context.newPage !== "function") {
        throw new Error("Playwright BrowserContext cannot create a Page");
      }
      return { page: await context.newPage(), context };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function connectPlaywrightTaskSpace(
  space: Record<string, unknown>,
) {
  await disconnectPlaywrightTaskSpace();
  const session = await connector(space);
  if (session.page === undefined || session.context === undefined) {
    await session.close();
    throw new Error(
      "Playwright TaskSpace connector did not return Page and BrowserContext",
    );
  }
  activeSession = session;
  return session;
}

export async function disconnectPlaywrightTaskSpace() {
  const session = activeSession;
  activeSession = undefined;
  await session?.close();
}

export async function disconnectPlaywrightTaskSpaceForSelection(
  _space: Record<string, unknown>,
) {
  await disconnectPlaywrightTaskSpace();
}

export function setPlaywrightTaskSpaceConnector(
  next: PlaywrightTaskSpaceConnector,
) {
  const previous = connector;
  connector = next;
  return () => {
    connector = previous;
  };
}
