import type {
  PlaywrightTaskSpaceConnector,
  PlaywrightTaskSpaceSession,
} from "./types.js";

/**
 * The one TaskSpace the process is connected to, and the connector used to
 * reach it.
 *
 * Both are module state on purpose: the helpers the agent script calls take no
 * session argument, so "the active TaskSpace" has to be a single place. The
 * connector is swappable so tests (and the native entry point) can install
 * their own without going through the browser.
 */

const disconnectedConnector: PlaywrightTaskSpaceConnector = async () => {
  throw new Error("Playwright TaskSpace connector is not configured");
};

let connector = disconnectedConnector;
let activeSession: PlaywrightTaskSpaceSession | undefined;

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

export function activePlaywrightTaskSpace() {
  if (!activeSession) {
    throw new Error(
      "site tools require an active TaskSpace; call egoBrowser.newTaskSpace() or egoBrowser.switchTaskSpace() first",
    );
  }
  return activeSession;
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
