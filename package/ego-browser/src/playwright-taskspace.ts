import type { Browser, BrowserContext, Page } from "playwright-core";

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
  getCDPEndpoint?: (taskSpaceId?: string | number) => Promise<
    | string
    | {
        endpoint?: string;
        webSocketDebuggerUrl?: string;
      }
  >;
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
  endpoint: (
    runtime: EgoPlaywrightRuntime,
    space: Record<string, unknown>,
  ) => Promise<string>;
  connectOverCDP: (endpoint: string) => Promise<Browser>;
};

export function createPlaywrightTaskSpaceConnector(
  dependencies: PlaywrightConnectorDependencies,
): PlaywrightTaskSpaceConnector {
  let browser: Browser | undefined;
  let browserEndpoint: string | undefined;

  const close = async () => {
    const currentBrowser = browser;
    browser = undefined;
    browserEndpoint = undefined;
    await currentBrowser?.close();
  };

  return async (space) => {
    const runtime = dependencies.runtime();
    if (!runtime || typeof runtime.listTabs !== "function") {
      throw new Error("Playwright TaskSpace requires ego.listTabs");
    }

    try {
      const endpoint = await dependencies.endpoint(runtime, space);
      if (browser && endpoint !== browserEndpoint) await close();
      if (!browser) {
        browser = await dependencies.connectOverCDP(endpoint);
        browserEndpoint = endpoint;
      }
      const listed = await runtime.listTabs();
      const nativeTabs = listed.tabs || listed.targetInfos || [];
      const activeTargetId = (
        nativeTabs.find((tab) => tab.active) || nativeTabs.at(-1)
      )?.targetId;
      const located = await locatePlaywrightPage(browser, activeTargetId);
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
    endpoint: (runtime, space) => nativeCdpEndpoint(runtime, space),
    connectOverCDP: async (endpoint) => {
      const { chromium } = await import("playwright-core");
      return chromium.connectOverCDP(endpoint);
    },
  });
}

async function nativeCdpEndpoint(
  runtime: EgoPlaywrightRuntime,
  space: Record<string, unknown>,
) {
  if (typeof runtime?.getCDPEndpoint !== "function") {
    throw new Error(
      "Playwright TaskSpace requires ego.getCDPEndpoint() to return a browser-level CDP endpoint; sendCDPMessage is not sufficient",
    );
  }
  const taskSpaceId =
    typeof space.id === "string" || typeof space.id === "number"
      ? space.id
      : typeof space.taskId === "string" || typeof space.taskId === "number"
        ? space.taskId
        : undefined;
  const result = await runtime.getCDPEndpoint(taskSpaceId);
  const endpoint =
    typeof result === "string"
      ? result
      : result?.endpoint || result?.webSocketDebuggerUrl;
  if (!endpoint) {
    throw new Error(
      "ego.getCDPEndpoint() did not return a browser-level CDP endpoint",
    );
  }
  return endpoint;
}

async function locatePlaywrightPage(browser: Browser, activeTargetId?: string) {
  const deadline = Date.now() + 2_000;
  const discoveredTargetIds = new Set<string>();

  while (true) {
    const contexts = browser.contexts();
    for (const context of contexts) {
      for (const page of context.pages()) {
        const targetId = await targetIdForPage(context, page);
        if (targetId) discoveredTargetIds.add(targetId);
        if (!activeTargetId || targetId === activeTargetId) {
          return { page, context };
        }
      }
    }

    if (Date.now() >= deadline) {
      if (activeTargetId) {
        throw new Error(
          `Playwright could not resolve the active task-space target ${activeTargetId}; discovered: ${[...discoveredTargetIds].join(", ") || "none"}`,
        );
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
async function targetIdForPage(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  try {
    return (await session.send("Target.getTargetInfo")).targetInfo?.targetId;
  } finally {
    await session.detach();
  }
}

export async function connectPlaywrightTaskSpace(
  space: Record<string, unknown>,
) {
  const previous = activeSession;
  const session = await connector(space);
  if (session.page === undefined || session.context === undefined) {
    await session.close();
    throw new Error(
      "Playwright TaskSpace connector did not return Page and BrowserContext",
    );
  }
  activeSession = session;
  if (previous && previous.close !== session.close) {
    await previous.close();
  }
  return session;
}

export async function disconnectPlaywrightTaskSpace() {
  const session = activeSession;
  activeSession = undefined;
  await session?.close();
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
