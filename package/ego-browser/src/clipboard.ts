import { spawn } from "node:child_process";
import type { Writable } from "node:stream";

export type ClipboardTransactionStatus = "restored" | "changed";

export type ClipboardTransaction = {
  finish(): Promise<ClipboardTransactionStatus>;
};

type ClipboardTransactionOptions = {
  beginTransaction?: (text: string) => Promise<ClipboardTransaction>;
};

type ClipboardHostMessage = {
  state: "ready" | "restored" | "changed" | "error";
  message?: string;
};

export class ClipboardRestoreError extends Error {
  readonly code = "EGO_CLIPBOARD_RESTORE_FAILED";
  readonly pasteCompleted = true;

  constructor(cause: unknown) {
    super(
      "The paste completed, but ego-browser could not restore the clipboard. Do not retry the paste.",
      { cause },
    );
    this.name = "ClipboardRestoreError";
  }
}

let transactionQueue: Promise<void> = Promise.resolve();

/**
 * Run one action while the macOS clipboard temporarily contains `text`.
 * Transactions are serialized within the process because the pasteboard is a
 * single user resource shared by every Page.
 */
export async function withTemporaryClipboardText<T>(
  text: string,
  action: () => Promise<T>,
  options: ClipboardTransactionOptions = {},
): Promise<T> {
  if (typeof text !== "string") {
    throw new TypeError("page.keyboard.paste text must be a string");
  }
  if (typeof action !== "function") {
    throw new TypeError("clipboard action must be a function");
  }

  let releaseQueue!: () => void;
  const previous = transactionQueue;
  transactionQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;

  try {
    const beginTransaction =
      options.beginTransaction ?? beginDarwinClipboardTransaction;
    const transaction = await beginTransaction(text);
    let value!: T;
    let actionError: unknown;
    try {
      value = await action();
    } catch (error) {
      actionError = error;
    }

    let restoreError: unknown;
    try {
      await transaction.finish();
    } catch (error) {
      restoreError = error;
    }

    if (actionError !== undefined) {
      if (restoreError !== undefined) {
        throw new AggregateError(
          [actionError, restoreError],
          "The paste action failed and ego-browser could not restore the clipboard.",
        );
      }
      throw actionError;
    }
    if (restoreError !== undefined) {
      throw new ClipboardRestoreError(restoreError);
    }
    return value;
  } finally {
    releaseQueue();
  }
}

/**
 * Keep the original NSPasteboard items inside a short-lived JXA process. The
 * data never crosses stdout or enters the Node heap, and every readable format
 * is restored unless another process changes the clipboard first.
 */
async function beginDarwinClipboardTransaction(
  text: string,
): Promise<ClipboardTransaction> {
  if (process.platform !== "darwin") {
    throw new Error(
      "page.keyboard.paste currently requires macOS clipboard support",
    );
  }

  const child = spawn(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", DARWIN_CLIPBOARD_HOST],
    { stdio: ["pipe", "pipe", "pipe", "pipe"] },
  );
  const messages = clipboardMessages(child.stdout);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 16_384) stderr += chunk;
  });
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  child.stdin.end(text, "utf8");
  const first = await nextHostMessage(messages, exit, () => stderr);
  if (first.state !== "ready") {
    throw new Error(first.message || "could not prepare the macOS clipboard");
  }

  let finished = false;
  return {
    async finish() {
      if (finished) throw new Error("clipboard transaction already finished");
      finished = true;
      const signalPipe = child.stdio[3] as Writable | null;
      if (!signalPipe) {
        throw new Error("clipboard restore pipe is unavailable");
      }
      signalPipe.end("1");
      const result = await nextHostMessage(messages, exit, () => stderr);
      const completion = await exit;
      if (completion.code !== 0) {
        throw clipboardHostExitError(completion, stderr);
      }
      if (result.state === "restored" || result.state === "changed") {
        return result.state;
      }
      throw new Error(
        result.message || "could not restore the macOS clipboard",
      );
    },
  };
}

function clipboardMessages(stream: NodeJS.ReadableStream) {
  const queued: ClipboardHostMessage[] = [];
  const waiters: Array<{
    resolve: (message: ClipboardHostMessage) => void;
    reject: (error: unknown) => void;
  }> = [];
  let buffer = "";
  let ended = false;
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk) => {
    buffer += String(chunk);
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: ClipboardHostMessage;
      try {
        message = JSON.parse(line);
      } catch (error) {
        rejectWaiter(new Error(`invalid clipboard host response: ${line}`));
        continue;
      }
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(message);
      else queued.push(message);
    }
  });
  stream.on("error", rejectWaiter);
  stream.on("end", () => {
    ended = true;
    rejectWaiter(new Error("clipboard host closed without a response"));
  });

  function rejectWaiter(error: unknown) {
    const waiter = waiters.shift();
    if (waiter) waiter.reject(error);
  }

  return {
    next(): Promise<ClipboardHostMessage> {
      const message = queued.shift();
      if (message) return Promise.resolve(message);
      if (ended) {
        return Promise.reject(
          new Error("clipboard host closed without a response"),
        );
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
  };
}

async function nextHostMessage(
  messages: ReturnType<typeof clipboardMessages>,
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  stderr: () => string,
): Promise<ClipboardHostMessage> {
  try {
    // Child `exit` may be emitted before its stdout pipe drains. Read the
    // protocol message first so a successful restore cannot race with exit.
    return await messages.next();
  } catch (error) {
    const completion = await exit;
    if (completion.code !== 0 || completion.signal) {
      throw clipboardHostExitError(completion, stderr());
    }
    throw error;
  }
}

function clipboardHostExitError(
  completion: { code: number | null; signal: NodeJS.Signals | null },
  stderr: string,
) {
  const detail = stderr.trim();
  return new Error(
    `clipboard host exited ${
      completion.signal
        ? `on ${completion.signal}`
        : `with code ${completion.code}`
    }${detail ? `: ${detail}` : ""}`,
  );
}

const DARWIN_CLIPBOARD_HOST = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");

const pasteboard = $.NSPasteboard.generalPasteboard;

function emit(message) {
  const line = $(JSON.stringify(message) + "\n").dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(line);
}

function snapshotPasteboard() {
  const snapshot = [];
  const sourceItems = pasteboard.pasteboardItems;
  for (let itemIndex = 0; itemIndex < Number(sourceItems.count); itemIndex += 1) {
    const sourceItem = sourceItems.objectAtIndex(itemIndex);
    const values = [];
    const types = sourceItem.types;
    for (let typeIndex = 0; typeIndex < Number(types.count); typeIndex += 1) {
      const type = types.objectAtIndex(typeIndex);
      const data = sourceItem.dataForType(type);
      if (data) values.push({ type, data });
    }
    snapshot.push(values);
  }
  return snapshot;
}

function restorePasteboard(snapshot) {
  pasteboard.clearContents;
  if (snapshot.length === 0) return;
  const restoredItems = [];
  for (const values of snapshot) {
    const item = $.NSPasteboardItem.alloc.init;
    for (const value of values) item.setDataForType(value.data, value.type);
    restoredItems.push(item);
  }
  if (!pasteboard.writeObjects($(restoredItems))) {
    throw new Error("NSPasteboard rejected the saved clipboard items");
  }
}

const input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
const text = ObjC.unwrap(
  $.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)
);
const saved = snapshotPasteboard();

try {
  pasteboard.clearContents;
  if (!pasteboard.setStringForType($(text), $.NSPasteboardTypeString)) {
    throw new Error("NSPasteboard rejected the temporary text");
  }
} catch (error) {
  try { restorePasteboard(saved); } catch (_) {}
  emit({ state: "error", message: String(error.message || error) });
  throw error;
}

const temporaryChangeCount = Number(pasteboard.changeCount);
emit({ state: "ready" });

const restoreSignal = $.NSFileHandle.alloc.initWithFileDescriptorCloseOnDealloc(3, false);
restoreSignal.readDataOfLength(1);

try {
  if (Number(pasteboard.changeCount) !== temporaryChangeCount) {
    emit({ state: "changed" });
  } else {
    restorePasteboard(saved);
    emit({ state: "restored" });
  }
} catch (error) {
  emit({ state: "error", message: String(error.message || error) });
  throw error;
}
`;
