import { cdp, runtimeValue } from "../cdp-eval.js";
import { isEgoHardStopError } from "../ego-errors.js";
import { state } from "../state.js";
import { normalizeTimeout, timeoutDeadline } from "../playwright-errors.js";

export type WaitForLoadOptions = {
  timeout?: number;
  until?: "load" | "domcontentloaded";
  requireCommitted?: boolean;
  onState?: (state: { url: string; readyState: string }) => void;
};

export async function waitForDocumentLoad(options: WaitForLoadOptions = {}) {
  const timeout = normalizeTimeout(
    "page navigation",
    options.timeout ?? state.defaultNavigationTimeout ?? state.defaultTimeout,
  );
  const ready =
    options.until === "domcontentloaded"
      ? ["interactive", "complete"]
      : ["complete"];
  const deadline = timeoutDeadline(timeout, state.now());
  while (state.now() < deadline) {
    let committed = true;
    let url = "";
    try {
      const tree = await cdp("Page.getFrameTree");
      url = tree.frameTree?.frame?.url || "";
      committed =
        options.requireCommitted === false ||
        (url !== "" && url !== ":" && url !== "about:blank");
    } catch (error) {
      if (isEgoHardStopError(error)) throw error;
      // Page.getFrameTree may not be supported in some sessions; fall back to readyState only.
    }
    const readyState = String(
      runtimeValue(
        await cdp("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true,
          awaitPromise: false,
        }),
        "document.readyState",
      ),
    );
    options.onState?.({ url, readyState });
    if (committed && ready.includes(readyState)) {
      return true;
    }
    await state.sleep(300);
  }
  return false;
}
