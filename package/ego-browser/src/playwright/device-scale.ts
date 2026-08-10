import type { BrowserContext, Page } from "playwright-core";

type InProcessConnection = { toImpl?: (target: unknown) => unknown };
type ServerSideContext = { _options?: unknown };

/**
 * Playwright derives the `scale: "css"` screenshot conversion from the
 * deviceScaleFactor recorded when the BrowserContext was created, not from the
 * live ratio: `clip.scale /= this._browserContext._options.deviceScaleFactor || 1`.
 * ego attaches over CDP to a context the app already owns, so that option is
 * absent and every screenshot comes back in device pixels while page.mouse
 * keeps taking css pixels. An agent reading a coordinate out of a screenshot
 * then clicks at twice the position it aimed at, with nothing raised. Recording
 * the live ratio on the server-side options restores the conversion for
 * page, locator and full-page screenshots at once.
 *
 * Writing deviceScaleFactor cannot leak into the browser the user sees: the
 * only other consumer is _updateViewport, which returns early while the page
 * has no emulated size, and attaching over CDP never gives it one.
 * `test/playwright-version-contract.test.js` pins both shapes.
 */
export async function syncCssPixelScreenshots(session: {
  page: Page;
  context: BrowserContext;
}): Promise<number> {
  const options = resolveServerSideOptions(session.context);
  const ratio: unknown = await session.page.evaluate(
    () => window.devicePixelRatio,
  );
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(
      `Cannot apply deviceScaleFactor: window.devicePixelRatio read back as ${String(ratio)}`,
    );
  }
  options.deviceScaleFactor = ratio;
  return ratio;
}

/**
 * Reaches the server-side BrowserContext through the bridge that
 * inProcessFactory installs on the client connection. Both hops are private
 * Playwright shape, so a missing one means the pinned version moved and
 * screenshots would quietly fall back to device pixels: throw rather than
 * hand back a context whose screenshots no longer match page.mouse.
 */
function resolveServerSideOptions(
  context: BrowserContext,
): Record<string, unknown> {
  const connection = (
    context as unknown as { _connection?: InProcessConnection }
  )._connection;
  const toImpl = connection?.toImpl;
  if (typeof toImpl !== "function") {
    throw new Error(
      "Cannot apply deviceScaleFactor: the in-process Playwright connection exposes no toImpl bridge",
    );
  }
  const serverSideContext = toImpl(context) as ServerSideContext | null;
  const options = serverSideContext?._options;
  if (!options || typeof options !== "object") {
    throw new Error(
      "Cannot apply deviceScaleFactor: the server-side BrowserContext exposes no options object",
    );
  }
  return options as Record<string, unknown>;
}
