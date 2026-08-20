import { isAbsolute } from "node:path";

import { resolveElementObjectId } from "../element-resolver.js";
import { type RefMap } from "../ref-map.js";
import { type KeyboardServices } from "./keyboard.js";

type PageInputServices = KeyboardServices;

const RESOLVE_FILE_INPUT_SOURCE = `function resolveFileInputForUpload() {
  const isFileInput = (element) =>
    element instanceof HTMLInputElement && element.type === "file";
  if (isFileInput(this)) return this;
  if (this instanceof HTMLLabelElement && isFileInput(this.control)) {
    return this.control;
  }
  const descendant = this.querySelector?.('input[type="file"]');
  if (isFileInput(descendant)) return descendant;
  throw new TypeError(
    "page.setInputFiles requires a file input, its label, or a container with a file input",
  );
}`;

/** Set one or more local files on an input in one explicit Page session. */
export async function setInputFilesInPage(
  services: PageInputServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  path: string | string[],
  iframeSessions = new Map<string, string>(),
): Promise<void> {
  const files = normalizeFilePaths(path, "page.setInputFiles");
  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
    iframeSessions,
  );
  let inputObjectId: string | undefined;
  try {
    const input = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: RESOLVE_FILE_INPUT_SOURCE,
        objectId: resolved.objectId,
        returnByValue: false,
        awaitPromise: false,
      },
      resolved.sessionId,
    );
    if (input?.exceptionDetails) {
      throw new TypeError(
        input.exceptionDetails.exception?.description ||
          input.exceptionDetails.text ||
          "page.setInputFiles could not resolve a file input",
      );
    }
    inputObjectId = input?.result?.objectId;
    if (!inputObjectId) {
      throw new TypeError("page.setInputFiles could not resolve a file input");
    }
    await setFilesOnBackendNode(
      services,
      resolved.sessionId,
      files,
      undefined,
      inputObjectId,
    );
  } finally {
    if (inputObjectId && inputObjectId !== resolved.objectId) {
      await releaseObject(services, resolved.sessionId, inputObjectId);
    }
    await releaseObject(services, resolved.sessionId, resolved.objectId);
  }
}

/** Validate local file paths without touching the operating-system chooser. */
export function normalizeFilePaths(
  path: string | string[],
  methodName: string,
): string[] {
  const files = Array.isArray(path) ? path : [path];
  if (
    files.some(
      (file) =>
        typeof file !== "string" || file.length === 0 || !isAbsolute(file),
    )
  ) {
    throw new TypeError(`${methodName} requires absolute file paths`);
  }
  return files;
}

/** Set files using the file input identity supplied by a chooser event. */
export async function setFilesOnBackendNode(
  services: PageInputServices,
  sessionId: string,
  files: string[],
  backendNodeId?: number,
  objectId?: string,
): Promise<void> {
  await services.cdp(
    "DOM.setFileInputFiles",
    {
      files,
      ...(backendNodeId === undefined ? {} : { backendNodeId }),
      ...(objectId === undefined ? {} : { objectId }),
    },
    sessionId,
  );
}

function cdpAdapter(services: PageInputServices) {
  return {
    sendRaw(method, params, sessionId) {
      return services.cdp(method, params, sessionId);
    },
  };
}

async function releaseObject(
  services: PageInputServices,
  sessionId: string,
  objectId: string,
): Promise<void> {
  await services
    .cdp("Runtime.releaseObject", { objectId }, sessionId)
    .catch(() => {});
}
