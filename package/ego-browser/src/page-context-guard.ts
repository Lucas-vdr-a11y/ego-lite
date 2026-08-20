const PAGE_CONTEXT_HINT =
  "Page JavaScript must run inside page.evaluate(); document is not available in the Node.js script.";

/** Add one actionable hint to the common Node-versus-Page context mistake. */
export function addPageContextHint(error: unknown): unknown {
  if (
    !(error instanceof ReferenceError) ||
    !/^document is not defined\.?$/i.test(error.message.trim())
  ) {
    return error;
  }
  if (error.message.includes("page.evaluate()")) return error;

  const originalMessage = error.message;
  error.message = `${originalMessage}. ${PAGE_CONTEXT_HINT}`;
  if (typeof error.stack === "string") {
    const lines = error.stack.split("\n");
    lines[0] = `${error.name}: ${error.message}`;
    error.stack = lines.join("\n");
  }
  return error;
}

/**
 * Install an SDK-only guard so the embedding host can print the same hint even
 * though it, rather than ego-browser's CLI wrapper, executes the heredoc.
 */
export function installPageContextGuard(target: Record<string, unknown>): void {
  if (Object.getOwnPropertyDescriptor(target, "document")) return;
  Object.defineProperty(target, "document", {
    configurable: true,
    enumerable: false,
    get() {
      throw new ReferenceError(`document is not defined. ${PAGE_CONTEXT_HINT}`);
    },
  });
}
