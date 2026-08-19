import { isAbsolute } from "node:path";

import { resolveElementObjectId } from "../element-resolver.js";
import { type RefMap } from "../ref-map.js";
import { type KeyboardServices } from "./keyboard.js";

type PageInputServices = KeyboardServices;

/** Set one or more local files on an input in one explicit Page session. */
export async function setInputFilesInPage(
  services: PageInputServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  path: string | string[],
): Promise<void> {
  const files = Array.isArray(path) ? path : [path];
  if (
    files.length === 0 ||
    files.some(
      (file) =>
        typeof file !== "string" || file.length === 0 || !isAbsolute(file),
    )
  ) {
    throw new TypeError("page.setInputFiles requires absolute file paths");
  }
  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
  );
  try {
    await services.cdp(
      "DOM.setFileInputFiles",
      { files, objectId: resolved.objectId },
      resolved.sessionId,
    );
  } finally {
    await releaseObject(services, resolved.sessionId, resolved.objectId);
  }
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
