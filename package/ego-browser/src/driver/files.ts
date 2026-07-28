import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { cdp, runtimeValue } from "../cdp-eval.js";
import { state } from "../state.js";
import { withHandle } from "./element-ops.js";
import { waitForActionableElement } from "./actionability.js";

type FilePayload = {
  name: string;
  mimeType: string;
  buffer: Buffer | Uint8Array;
};

let payloadSequence = 0;
const payloadRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Set files on a file input.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for an input[type=file].
 * @param {string|string[]|FilePayload|FilePayload[]} filesValue Paths, in-memory FilePayload objects, or [] to clear.
 * @returns {Promise<void>}
 */
export async function setInputFiles(
  selector,
  filesValue,
  options: { timeout?: number } = {},
) {
  await waitForActionableElement(selector, { timeout: options.timeout });
  const values = Array.isArray(filesValue) ? filesValue : [filesValue];
  const files: string[] = [];
  const descriptors: Array<
    { kind: "path" } | { kind: "payload"; name: string; mimeType: string }
  > = [];
  for (const value of values) {
    if (typeof value === "string") {
      files.push(value);
      descriptors.push({ kind: "path" });
      continue;
    }
    if (!isFilePayload(value)) {
      throw new TypeError(
        "setInputFiles expects file paths or { name, mimeType, buffer } payloads",
      );
    }
    files.push(await materializeFilePayload(value));
    descriptors.push({
      kind: "payload",
      name: value.name,
      mimeType: value.mimeType,
    });
  }
  await withHandle(selector, async ({ objectId, sessionId }) => {
    await cdp("DOM.setFileInputFiles", { files, objectId }, sessionId);
    if (!descriptors.some((entry) => entry.kind === "payload")) return;
    const result = await cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: `async function(entries) {
          if (!(this instanceof HTMLInputElement) || this.type !== "file") {
            throw new Error("setInputFiles target must be a file input");
          }
          const sourceFiles = Array.from(this.files || []);
          if (sourceFiles.length !== entries.length) {
            throw new Error("setInputFiles could not read the selected files");
          }
          const transfer = new DataTransfer();
          for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const source = sourceFiles[index];
            if (entry.kind === "payload") {
              transfer.items.add(new File([await source.arrayBuffer()], entry.name, {
                type: entry.mimeType,
                lastModified: source.lastModified,
              }));
            } else {
              transfer.items.add(source);
            }
          }
          this.files = transfer.files;
          this.dispatchEvent(new Event("input", { bubbles: true }));
          this.dispatchEvent(new Event("change", { bubbles: true }));
        }`,
        objectId,
        arguments: [{ value: descriptors }],
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
    );
    runtimeValue(result, "setInputFiles FilePayload metadata");
  });
}

function isFilePayload(value): value is FilePayload {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.mimeType === "string" &&
    (Buffer.isBuffer(value.buffer) || value.buffer instanceof Uint8Array),
  );
}

async function materializeFilePayload(payload: FilePayload) {
  const directory = join(
    tmpdir(),
    `ego-browser-file-payloads-${process.pid}-${payloadRunId}`,
    String(++payloadSequence),
  );
  await mkdir(directory, { recursive: true });
  const safeName = basename(payload.name) || "upload";
  const path = join(directory, safeName);
  await state.writeFile(path, Buffer.from(payload.buffer));
  return path;
}
