/**
 * Shared handling for ego-binding errors.
 *
 * Browser-side failures expose two signals (see the EgoBindings JS API):
 *   - human-readable text (`error` on resolved results, `message` on rejected
 *     Errors), and
 *   - a stable `error_code` such as EGO_TASK_SPACE_USER_IN_CONTROL.
 *
 * The code is the durable contract; the wording can drift between builds. Branch
 * on the code (isEgoUserControlError), not on the message. EGO_ERROR_MESSAGES and
 * USER_CONTROL_REASON_MESSAGES are where ego-browser owns its wording for the few
 * codes an agent must act on; every other code (and any unknown future code) defers
 * to the native error message.
 *
 * Both failure shapes must reach this module. Native picks per method whether a
 * failure resolves as `{ error, error_code }` or rejects as an Error, so a call site
 * that only handles one shape lets raw native text through — callEgo normalizes both.
 *
 * Single source of truth — error handling was previously duplicated across
 * helpers.ts and browser-runtime.ts.
 */

/** Stable error codes emitted by the native ego bindings. */
export const EGO_ERROR_CODES = [
  "EGO_BROWSER_UNAVAILABLE",
  "EGO_CDP_CHANNEL_UNAVAILABLE",
  "EGO_CDP_SEND_FAILED",
  "EGO_INVALID_ARGUMENT",
  "EGO_INVALID_RESULT_PAYLOAD",
  "EGO_OPERATION_FAILED",
  "EGO_PROFILE_NOT_FOUND",
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
 * Codes whose wording ego-browser owns. A listed code returns this static, id-less
 * message instead of the native error message — reserved for the two business signals
 * an agent must react to, not just report. Every other code is absent here and defers
 * to the native error message (and any unknown future code does too), which is more
 * specific than any static line.
 *
 * EGO_TASK_SPACE_USER_IN_CONTROL is owned too, but its wording depends on why control
 * moved, so it resolves through USER_CONTROL_REASON_MESSAGES instead of this table.
 */
const EGO_ERROR_MESSAGES: Partial<Record<EgoErrorCode, string>> = {
  EGO_TASK_SPACE_INACTIVE: [
    "The user has taken control of this task space and ended the task, so it is no longer assigned to the agent and browser commands are paused.",
    "This is a hard stop, not an obstacle to route around — do not retry and do not take ownership back on your own.",
    "Wait until the user explicitly asks you to continue, then claim the space and resume:",
    "  await egoBrowser.claimTaskSpace(id)",
    "",
    `Offer the user choices like "Continue" or "Finish task" if your harness supports it; otherwise tell them: "You now control this task space. Reply 'continue' when ready and I will resume."`,
  ].join("\n"),
};

/**
 * The user-control guidance block: the wording for a manual takeover, and the
 * fallback whenever the reason for the handover is missing or not one this build
 * knows (an unknown future reason key, or the CDP send channel, which reports a
 * static sentence rather than a reason key).
 */
const USER_CONTROL_GUIDANCE = [
  "The user has taken control of this task space, so browser commands are paused.",
  "This is a hard stop, not an obstacle to route around — do not retry and do not take control back on your own.",
  "Wait until the user explicitly asks you to continue, then take control back and resume:",
  "  await egoBrowser.takeOverTaskSpace()",
  "",
  `Offer the user choices like "Continue" or "Finish task" if your harness supports it; otherwise tell them: "You now control this task space. Reply 'continue' when ready and I will resume."`,
].join("\n");

/**
 * Agent-facing wording per native `user_action_reason`, for
 * EGO_TASK_SPACE_USER_IN_CONTROL.
 *
 * Native reports the reason as the error text itself, so what reaches this package is
 * a bare key rather than a sentence:
 *   {"error":"location","error_code":"EGO_TASK_SPACE_USER_IN_CONTROL"}
 * Every key native emits gets an entry here, because an unmapped key would otherwise
 * surface to the agent as the raw word "location". Unknown keys fall back to
 * USER_CONTROL_GUIDANCE (see userControlMessage).
 */
const USER_CONTROL_REASON_MESSAGES: Record<string, string> = {
  notifications:
    "A browser permission prompt for notifications has appeared. Control of this browser space has been handed over.",
  location:
    "A browser permission prompt for location, precise or approximate, has appeared. Control of this browser space has been handed over.",
  camera:
    "A browser permission prompt for camera access has appeared. Control of this browser space has been handed over.",
  microphone:
    "A browser permission prompt for microphone access has appeared. Control of this browser space has been handed over.",
  pan_tilt_zoom_microphone:
    "A browser permission prompt for camera control and microphone access has appeared. Control of this browser space has been handed over.",
  midi: "A browser permission prompt for MIDI device access has appeared. Control of this browser space has been handed over.",
  bluetooth:
    "A browser device chooser for Bluetooth has appeared. Control of this browser space has been handed over.",
  usb: "A browser device chooser for USB has appeared. Control of this browser space has been handed over.",
  serial:
    "A browser port chooser for serial access has appeared. Control of this browser space has been handed over.",
  hid: "A browser device chooser for HID has appeared. Control of this browser space has been handed over.",
  protocol_handler:
    "A browser permission prompt for protocol handler registration has appeared. Control of this browser space has been handed over.",
  fallback_site_dialog_required_notice:
    "The page has displayed a dialog that requires review. Control of this browser space has been handed over.",
  manual_takeover: USER_CONTROL_GUIDANCE,
};

/**
 * The wording for a user-control failure, keyed on the `user_action_reason` native
 * put in the error text. Anything that is not a reason key this build knows about
 * (an unknown future reason, a static sentence, no text at all) resolves to the
 * guidance block, so the agent never sees a bare key.
 */
function userControlMessage(err: unknown): string {
  const reason = nativeErrorText(err)?.trim();
  return reason && Object.hasOwn(USER_CONTROL_REASON_MESSAGES, reason)
    ? USER_CONTROL_REASON_MESSAGES[reason]
    : USER_CONTROL_GUIDANCE;
}

/** The wording ego-browser owns for a known code, or undefined to defer to native. */
function ownedEgoMessage(code: EgoErrorCode, err: unknown): string | undefined {
  return code === "EGO_TASK_SPACE_USER_IN_CONTROL"
    ? userControlMessage(err)
    : EGO_ERROR_MESSAGES[code];
}

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
 * For a code ego-browser owns wording for, `message` is that owned wording.
 * Otherwise (a code not owned here, or an unknown future code) it falls back to
 * the native error message the binding returned, then the bare code, then a
 * generic string. `code` is the stable classifier and may be undefined.
 */
export function resolveEgoError(err: unknown): {
  code?: string;
  message: string;
} {
  const code = egoErrorCode(err);
  const message =
    (isEgoErrorCode(code) ? ownedEgoMessage(code, err) : undefined) ??
    nativeErrorText(err) ??
    code ??
    "Unknown ego error";
  return { code, message };
}

/** Whether an ego error means the task is currently under user control. */
export function isEgoUserControlError(err: unknown): boolean {
  return egoErrorCode(err) === "EGO_TASK_SPACE_USER_IN_CONTROL";
}

/**
 * Codes that halt the whole agent task rather than mark a routable obstacle: a task
 * space the user has taken back, or one that is inactive / not assigned to this agent.
 * Both require the user to explicitly hand control back before work can resume.
 */
function isEgoHardStopCode(code: string | undefined): boolean {
  return (
    code === "EGO_TASK_SPACE_USER_IN_CONTROL" ||
    code === "EGO_TASK_SPACE_INACTIVE"
  );
}

/** Whether an ego error is a hard stop the agent must not retry or route around. */
export function isEgoHardStopError(err: unknown): boolean {
  return isEgoHardStopCode(egoErrorCode(err));
}

/**
 * Build an Error carrying the resolved message and stable error_code from any ego
 * error shape. `op`, when given, prefixes the message with the failing operation.
 * Shared by assertNoEgoError (which throws it) and the CDP-send failure path (which
 * rejects pending requests with it) so every ego failure surfaces an identical
 * Error shape.
 */
export function buildEgoError(
  err: unknown,
  op?: string,
): Error & { error_code?: string } {
  const { code, message } = resolveEgoError(err);
  const error: Error & { error_code?: string } = new Error(
    op ? `${op}: ${message}` : message,
  );
  if (code) error.error_code = code;
  return error;
}

/**
 * Await a native ego call and normalize both failure shapes it can produce: a resolved
 * `{ error, error_code }` payload and a rejected Error. Native decides per method
 * (ego.listTabs resolves, ego.snapshot rejects), so awaiting inside assertNoEgoError
 * only covers the resolved half — the rejection escapes with the native text intact,
 * which under the reason-key contract means a bare key such as "location" reaches the
 * agent. Use this for every native call whose failure the agent may see.
 */
export async function callEgo(call, op?: string) {
  let result;
  try {
    result = await call;
  } catch (err) {
    throw buildEgoError(err, op);
  }
  return assertNoEgoError(result, op);
}

export function assertNoEgoError(result, op?: string) {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    result.error != null
  ) {
    throw buildEgoError(result, op);
  }
  return result;
}

/**
 * The native error message from any ego error shape — the binding's runtime
 * `error`/`message` text (dynamic, may vary across builds). Ignores bare codes.
 */
function nativeErrorText(err: unknown): string | undefined {
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
