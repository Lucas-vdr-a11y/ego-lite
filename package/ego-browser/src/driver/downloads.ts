import { createReadStream, mkdirSync } from "node:fs";
import { access, copyFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { cdp } from "../cdp-eval.js";
import {
  ensureSession,
  subscribeBrowserEvent,
  waitForBrowserEvent,
} from "../browser-runtime.js";
import { state } from "../state.js";
import { normalizeTimeout, operationTimeout } from "../playwright-errors.js";

type WaitForEventOptions = {
  timeout?: number;
};

type DownloadWillBegin = {
  method: "Page.downloadWillBegin" | "Browser.downloadWillBegin";
  params?: {
    guid?: string;
    url?: string;
    suggestedFilename?: string;
  };
};

type DownloadProgress = {
  method: "Page.downloadProgress" | "Browser.downloadProgress";
  params?: {
    guid?: string;
    state?: string;
  };
};

/**
 * Wait for a Playwright-style page event. Currently supports "download".
 * @param {"download"} eventName Event name.
 * @param {{timeout?: number}} [options] Timeout in milliseconds.
 * @returns {Promise<object>} Download facade with Playwright-style lifecycle methods.
 */
export async function waitForEvent(
  eventName,
  options: WaitForEventOptions = {},
) {
  if (eventName !== "download") {
    throw new Error(
      `page.waitForEvent currently supports only "download", got ${JSON.stringify(eventName)}`,
    );
  }
  const timeout = normalizeTimeout(
    `page.waitForEvent(${JSON.stringify(eventName)})`,
    options.timeout ?? state.defaultTimeout,
  );
  try {
    return await waitForDownload(timeout);
  } catch (error) {
    if (
      /page\.waitForEvent timed out|CDP request timed out: (?:Browser|Page)\.setDownloadBehavior/i.test(
        error?.message || "",
      )
    ) {
      throw operationTimeout(
        `page.waitForEvent(${JSON.stringify(eventName)})`,
        timeout,
      );
    }
    throw error;
  }
}

async function waitForDownload(timeout: number) {
  const downloadDir = join(
    tmpdir(),
    `ego-browser-downloads-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(downloadDir, { recursive: true });
  const sessionPromise = ensureSession();
  const behaviorPromise = setDownloadBehavior(downloadDir, timeout);
  const progressTracker = trackDownloadProgress();
  const abortController = new AbortController();
  const willBeginPromise = waitForBrowserEvent(
    (event) =>
      event?.method === "Page.downloadWillBegin" ||
      event?.method === "Browser.downloadWillBegin",
    browserEventTimeout(timeout),
    abortController.signal,
  ) as Promise<DownloadWillBegin>;
  void willBeginPromise.catch(() => {});
  let willBegin;
  try {
    [, , willBegin] = await Promise.all([
      sessionPromise,
      behaviorPromise,
      willBeginPromise,
    ]);
  } catch (error) {
    abortController.abort();
    await willBeginPromise.catch(() => {});
    progressTracker.dispose();
    throw error;
  }
  const guid = willBegin.params?.guid;
  progressTracker.setGuid(guid);
  const suggestedFilename =
    willBegin.params?.suggestedFilename || guid || "download";
  const downloadedPath = join(downloadDir, suggestedFilename);
  const completion = progressTracker.completion;
  let outcomePromise: Promise<DownloadProgress> | null = null;
  const downloadOutcome = () => {
    outcomePromise ??= waitForDownloadOutcome(
      completion,
      downloadedPath,
      progressTracker.dispose,
    );
    return outcomePromise;
  };
  const completedPath = async () => {
    const progress = await downloadOutcome();
    if (progress.params?.state === "canceled") {
      throw new Error(`Download canceled: ${suggestedFilename}`);
    }
    return downloadedPath;
  };
  return {
    suggestedFilename: () => suggestedFilename,
    url: () => willBegin.params?.url || "",
    path: completedPath,
    saveAs: async (targetPath) => {
      const source = await completedPath();
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(source, targetPath);
    },
    failure: async () => {
      const progress = await downloadOutcome();
      return progress.params?.state === "canceled"
        ? `Download canceled: ${suggestedFilename}`
        : null;
    },
    cancel: async () => {
      if (!guid) return;
      await cdp("Browser.cancelDownload", { guid }).catch(async () => {
        await cdp("Page.cancelDownload", { guid });
      });
    },
    delete: async () => {
      const source = await completedPath();
      await unlink(source).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    },
    createReadStream: async () => createReadStream(await completedPath()),
  };
}

async function waitForDownloadOutcome(
  completion: Promise<DownloadProgress>,
  downloadedPath: string,
  dispose: () => void,
) {
  const progressOutcome = completion.then((progress) => ({
    kind: "progress" as const,
    progress,
  }));
  while (true) {
    const outcome = await Promise.race([
      progressOutcome,
      downloadedFileTick(downloadedPath),
    ]);
    if (outcome.kind === "progress") return outcome.progress;
    if (outcome.kind === "file") {
      // Some ego browser builds forward downloadWillBegin but not the final
      // progress event. Chromium exposes the final filename only after its
      // temporary download has completed, so file appearance is equivalent
      // completion evidence for path-oriented APIs.
      dispose();
      return {
        method: "Browser.downloadProgress",
        params: { state: "completed" },
      } satisfies DownloadProgress;
    }
  }
}

async function downloadedFileTick(downloadedPath: string) {
  try {
    await access(downloadedPath);
    return { kind: "file" as const };
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { kind: "pending" as const };
  }
}

function browserEventTimeout(timeout) {
  return Math.min(timeout, 2147483647);
}

function trackDownloadProgress() {
  let guid;
  let settled = false;
  const buffered: DownloadProgress[] = [];
  let resolveCompletion;
  const completion = new Promise<DownloadProgress>((resolve) => {
    resolveCompletion = resolve;
  });
  const onProgress = (event: DownloadProgress) => {
    if (
      event?.params?.state !== "completed" &&
      event?.params?.state !== "canceled"
    ) {
      return;
    }
    if (!guid) {
      buffered.push(event);
      return;
    }
    if (event?.params?.guid === guid) finish(event);
  };
  const unsubscribe = [
    subscribeBrowserEvent("Page.downloadProgress", undefined, onProgress),
    subscribeBrowserEvent("Browser.downloadProgress", undefined, onProgress),
  ];
  const finish = (event) => {
    if (settled) return;
    settled = true;
    for (const remove of unsubscribe) remove();
    resolveCompletion(event);
  };
  return {
    completion,
    setGuid(value) {
      guid = value;
      const match = buffered.find((event) => event?.params?.guid === guid);
      if (match) finish(match);
    },
    dispose() {
      if (settled) return;
      settled = true;
      for (const remove of unsubscribe) remove();
    },
  };
}

async function setDownloadBehavior(downloadDir, timeout) {
  try {
    await cdp(
      "Browser.setDownloadBehavior",
      {
        behavior: "allow",
        downloadPath: downloadDir,
        eventsEnabled: true,
      },
      undefined,
      timeout,
    );
  } catch (error) {
    if (
      !/Browser\.setDownloadBehavior.*wasn't found|wasn't found/i.test(
        error?.message || "",
      )
    ) {
      throw error;
    }
    await cdp(
      "Page.setDownloadBehavior",
      {
        behavior: "allow",
        downloadPath: downloadDir,
      },
      undefined,
      timeout,
    );
  }
}
