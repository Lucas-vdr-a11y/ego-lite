/**
 * Shared handling for ego-binding errors.
 *
 * Browser-side failures expose two signals (see the EgoBindings JS API):
 *   - human-readable text (`error` on resolved results, `message` on rejected
 *     Errors), and
 *   - a stable `error_code` such as EGO_TASK_SPACE_USER_IN_CONTROL.
 *
 * The code is the durable contract; the wording can drift between builds. Branch
 * on the code (isEgoUserControlError), not on the message. EGO_ERROR_MESSAGES is
 * the seam where ego-browser owns its own wording per code — today it only
 * supplies a fallback when the browser sent no text, but it is the place to
 * customize how each failure reads going forward.
 *
 * Single source of truth — error handling was previously duplicated across
 * helpers.ts and driver/nav.ts.
 */

/** Stable error codes emitted by the native ego bindings. */
export const EGO_ERROR_CODES = [
  "EGO_BROWSER_UNAVAILABLE",
  "EGO_CDP_CHANNEL_UNAVAILABLE",
  "EGO_CDP_SEND_FAILED",
  "EGO_INVALID_ARGUMENT",
  "EGO_INVALID_RESULT_PAYLOAD",
  "EGO_OPERATION_FAILED",
  "EGO_RESULT_CONVERSION_FAILED",
  "EGO_SNAPSHOT_FAILED",
  "EGO_TASK_HOST_DISCONNECTED",
  "EGO_TASK_SPACE_INACTIVE",
  "EGO_TASK_SPACE_NOT_FOUND",
  "EGO_TASK_SPACE_NOT_SELECTED",
  "EGO_TASK_SPACE_UNAVAILABLE",
  "EGO_TASK_SPACE_USER_IN_CONTROL",
  "EGO_WEB_CONTENTS_UNAVAILABLE",
] as const;

export type EgoErrorCode = (typeof EGO_ERROR_CODES)[number];

/**
 * ego-browser-owned message for each stable code. Used only as a fallback when
 * the browser side supplied no human-readable text; customize wording here.
 */
const EGO_ERROR_MESSAGES: Record<EgoErrorCode, string> = {
  EGO_BROWSER_UNAVAILABLE: "No active browser.",
  EGO_CDP_CHANNEL_UNAVAILABLE: "The CDP channel is not connected.",
  EGO_CDP_SEND_FAILED: "Failed to send the CDP message.",
  EGO_INVALID_ARGUMENT: "Invalid argument.",
  EGO_INVALID_RESULT_PAYLOAD: "The browser returned an invalid result payload.",
  EGO_OPERATION_FAILED: "The browser operation failed.",
  EGO_RESULT_CONVERSION_FAILED: "Failed to convert the browser result.",
  EGO_SNAPSHOT_FAILED: "Failed to capture the page snapshot.",
  EGO_TASK_HOST_DISCONNECTED: "The task host is no longer available.",
  EGO_TASK_SPACE_INACTIVE:
    "The task space is inactive or not assigned to this agent.",
  EGO_TASK_SPACE_NOT_FOUND: "Task space not found.",
  EGO_TASK_SPACE_NOT_SELECTED: "Task space not selected.",
  EGO_TASK_SPACE_UNAVAILABLE: "The task space is unavailable.",
  EGO_TASK_SPACE_USER_IN_CONTROL: "The task is under user control.",
  EGO_WEB_CONTENTS_UNAVAILABLE: "The page contents are unavailable.",
};

/** Type guard for codes this build knows about. */
export function isEgoErrorCode(value: unknown): value is EgoErrorCode {
  return (
    typeof value === "string" &&
    (EGO_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Pull the stable error_code out of any ego error shape: resolved
 * `{ error, error_code }` objects, rejected/thrown Errors carrying `.error_code`,
 * or a bare known code string. Returns the raw code (which may be one this build
 * does not know about yet) or undefined when none is present.
 */
export function egoErrorCode(err: unknown): string | undefined {
  if (typeof err === "string") {
    return isEgoErrorCode(err) ? err : undefined;
  }
  if (err && typeof err === "object") {
    const code = (err as Record<string, unknown>).error_code;
    if (typeof code === "string" && code) return code;
  }
  return undefined;
}

/**
 * Resolve any ego error into a stable `{ code, message }` pair.
 *
 * `message` prefers the live human-readable text the browser supplied, then the
 * ego-browser-owned message for the code, then the bare code, then a generic
 * string. `code` is the stable classifier and may be undefined.
 */
export function resolveEgoError(err: unknown): {
  code?: string;
  message: string;
} {
  const code = egoErrorCode(err);
  const message =
    liveErrorText(err) ??
    (isEgoErrorCode(code) ? EGO_ERROR_MESSAGES[code] : undefined) ??
    code ??
    "Unknown ego error";
  return { code, message };
}

/** Whether an ego error means the task is currently under user control. */
export function isEgoUserControlError(err: unknown): boolean {
  return egoErrorCode(err) === "EGO_TASK_SPACE_USER_IN_CONTROL";
}

/** Whether claiming the task space would cross a user-owned permission boundary. */
export function isEgoTaskSpaceInactiveError(err: unknown): boolean {
  return egoErrorCode(err) === "EGO_TASK_SPACE_INACTIVE";
}

/** Whether an ego error must stop the current agent script immediately. */
export function isEgoHardStopError(err: unknown): boolean {
  return isEgoUserControlError(err) || isEgoTaskSpaceInactiveError(err);
}

export function assertNoEgoError(result, op: string) {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    result.error != null
  ) {
    const { code, message } = resolveEgoError(result);
    const error: Error & { error_code?: string } = new Error(
      `${op}: ${message}`,
    );
    if (code) error.error_code = code;
    throw error;
  }
  return result;
}

/** Human-readable text from any ego error shape, ignoring bare codes. */
function liveErrorText(err: unknown): string | undefined {
  if (typeof err === "string") {
    return isEgoErrorCode(err) ? undefined : err;
  }
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (obj.error != null) return formatEgoError(obj.error);
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  return undefined;
}

export function formatEgoError(err: unknown): string {
  if (err == null) return String(err);
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
