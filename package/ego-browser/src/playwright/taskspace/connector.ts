import type { Browser } from "playwright-core";

import {
  BRING_UP_TEARDOWN_TIMEOUT_MS,
  BRING_UP_TIMEOUT_MS,
  bringUpBudget,
  withDeadline,
} from "./bring-up-deadline.js";
import { locatePlaywrightPage } from "./locate-page.js";
import type {
  PlaywrightConnectorDependencies,
  PlaywrightTaskSpaceConnector,
} from "./types.js";

/**
 * The bring-up sequence: a transport to native, a Playwright browser over it,
 * and the Page for the tab the user is looking at.
 *
 * Every step runs under one shared deadline, and every resource is released by
 * exactly one closer. The connection is single-occupancy — connecting again
 * closes whatever holds it now — and each session closes over its own browser
 * and transport, so a stale session handle can never tear down a newer session.
 */
export function createPlaywrightTaskSpaceConnector(
  dependencies: PlaywrightConnectorDependencies,
): PlaywrightTaskSpaceConnector {
  // The closer of the session currently owning the connection. Each session
  // gets its own close closure over its own browser/transport, so a stale
  // session handle can never tear down a newer session's resources.
  let closeCurrent: (() => Promise<void>) | undefined;

  return async (space) => {
    const runtime = dependencies.runtime();
    if (!runtime || typeof runtime.listTabs !== "function") {
      throw new Error("Playwright TaskSpace requires ego.listTabs");
    }

    const step = bringUpBudget(
      dependencies.bringUpTimeoutMs ?? BRING_UP_TIMEOUT_MS,
    );

    if (closeCurrent) {
      const closePrevious = closeCurrent;
      closeCurrent = undefined;
      await step("closing the previous TaskSpace", closePrevious());
    }

    let browser: Browser | undefined;
    let closeTransport: (() => Promise<void>) | undefined;
    const closeSession = async () => {
      if (closeCurrent === closeSession) closeCurrent = undefined;
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

    try {
      const transport = await step(
        "transport setup",
        dependencies.transport(runtime, space),
        // Only reached when this step lost its race: closeSession() below can
        // only release what the assignments after this await recorded.
        (lease) => lease.close?.(),
      );
      closeTransport = transport.close;
      browser = await step(
        "connectOverCDP",
        dependencies.connectOverCDP(transport.connectToken),
        (late) => late.close(),
      );
      closeCurrent = closeSession;
      transport.connected?.();
      const listed = await step("ego.listTabs", runtime.listTabs());
      const nativeTabs = listed.tabs || listed.targetInfos || [];
      const activeTab =
        nativeTabs.find((tab) => tab.active) || nativeTabs.at(-1);
      const located = await step(
        "locating the active Page",
        locatePlaywrightPage(browser, activeTab, nativeTabs),
      );
      const session = {
        page: located.page,
        context: located.context,
        close: closeSession,
      };
      if (dependencies.prepareSession) {
        await step("prepareSession", dependencies.prepareSession(session));
      }
      return session;
    } catch (error) {
      // Bounded, and its own failure is discarded: whatever went wrong above is
      // the diagnosis worth keeping.
      await withDeadline(
        "TaskSpace teardown",
        closeSession(),
        Date.now() + BRING_UP_TEARDOWN_TIMEOUT_MS,
        BRING_UP_TEARDOWN_TIMEOUT_MS,
      ).catch(() => undefined);
      throw error;
    }
  };
}
