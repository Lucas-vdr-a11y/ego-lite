import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNoEgoError,
  callEgo,
  egoErrorCode,
  isEgoErrorCode,
  isEgoUserControlError,
  resolveEgoError,
} from "../dist/src/ego-errors.js";

test("egoErrorCode extracts the code from every error shape", () => {
  // resolved { error, error_code } object
  assert.equal(
    egoErrorCode({ error: "nope", error_code: "EGO_BROWSER_UNAVAILABLE" }),
    "EGO_BROWSER_UNAVAILABLE",
  );
  // rejected / thrown Error carrying .error_code
  const err = Object.assign(new Error("boom"), {
    error_code: "EGO_SNAPSHOT_FAILED",
  });
  assert.equal(egoErrorCode(err), "EGO_SNAPSHOT_FAILED");
  // bare known code string (e.g. onSendCDPMessageError second arg)
  assert.equal(
    egoErrorCode("EGO_TASK_SPACE_USER_IN_CONTROL"),
    "EGO_TASK_SPACE_USER_IN_CONTROL",
  );
  // future code this build does not know about is still returned
  assert.equal(
    egoErrorCode({ error_code: "EGO_FUTURE_CODE" }),
    "EGO_FUTURE_CODE",
  );
  // no code present
  assert.equal(egoErrorCode({ error: "plain message" }), undefined);
  assert.equal(egoErrorCode("plain message"), undefined);
});

test("isEgoErrorCode narrows to known codes only", () => {
  assert.equal(isEgoErrorCode("EGO_PROFILE_NOT_FOUND"), true);
  assert.equal(isEgoErrorCode("EGO_TASK_SPACE_NOT_FOUND"), true);
  assert.equal(isEgoErrorCode("EGO_FUTURE_CODE"), false);
  assert.equal(isEgoErrorCode(undefined), false);
});

test("resolveEgoError overrides the native error message with the owned wording for an owned code", () => {
  const { code, message } = resolveEgoError({
    error: "Task space 7 is not assigned to an agent.",
    error_code: "EGO_TASK_SPACE_INACTIVE",
  });
  assert.equal(code, "EGO_TASK_SPACE_INACTIVE");
  // Owned id-less guidance replaces the native "Task space 7 ..." text.
  assert.match(message, /egoBrowser\.claimTaskSpace\(id\)/);
  assert.doesNotMatch(message, /\b7\b/);
});

test("resolveEgoError keeps the native error message for an unknown future code", () => {
  assert.deepEqual(
    resolveEgoError({
      error: "Some build-specific detail",
      error_code: "EGO_FUTURE_CODE",
    }),
    {
      code: "EGO_FUTURE_CODE",
      message: "Some build-specific detail",
    },
  );
});

test("resolveEgoError defers to the native error message for a code ego-browser does not own", () => {
  // EGO_OPERATION_FAILED is not owned: the client wording (e.g. which operation
  // failed) is more specific than any static line.
  assert.deepEqual(
    resolveEgoError({
      error: "Failed to create task space",
      error_code: "EGO_OPERATION_FAILED",
    }),
    {
      code: "EGO_OPERATION_FAILED",
      message: "Failed to create task space",
    },
  );
});

test("resolveEgoError falls back to the raw code for a bare non-owned code", () => {
  // ego-browser does not own NOT_SELECTED and a bare code carries no native error message,
  // so the stable code itself is the most specific thing to surface.
  assert.deepEqual(resolveEgoError("EGO_TASK_SPACE_NOT_SELECTED"), {
    code: "EGO_TASK_SPACE_NOT_SELECTED",
    message: "EGO_TASK_SPACE_NOT_SELECTED",
  });
});

test("resolveEgoError uses the id-less guidance block for a bare user-control code", () => {
  const { code, message } = resolveEgoError("EGO_TASK_SPACE_USER_IN_CONTROL");
  assert.equal(code, "EGO_TASK_SPACE_USER_IN_CONTROL");
  assert.match(message, /taken control of this task space/);
  assert.match(message, /egoBrowser\.takeOverTaskSpace\(\)/);
  assert.doesNotMatch(message, /<id>/);
});

// Native reports why control moved as the error text itself — a bare
// user_action_reason key, not a sentence. Each key maps to its own wording; the raw
// key must never reach the agent.
test("resolveEgoError maps a user-control reason key to its own wording", () => {
  for (const [reason, expected] of [
    ["location", /permission prompt for location, precise or approximate/],
    ["camera", /permission prompt for camera access/],
    ["pan_tilt_zoom_microphone", /camera control and microphone access/],
    ["bluetooth", /device chooser for Bluetooth/],
    ["serial", /port chooser for serial access/],
    ["protocol_handler", /protocol handler registration/],
    ["fallback_site_dialog_required_notice", /dialog that requires review/],
  ]) {
    for (const err of [
      { error: reason, error_code: "EGO_TASK_SPACE_USER_IN_CONTROL" },
      // ego.snapshot rejects instead of resolving, so the key arrives as .message
      Object.assign(new Error(reason), {
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      }),
    ]) {
      const { message } = resolveEgoError(err);
      assert.match(message, expected, `reason ${reason}`);
      assert.match(
        message,
        /Control of this browser space has been handed over/,
      );
      assert.notEqual(message, reason);
    }
  }
});

test("resolveEgoError keeps the existing hard-stop wording for manual_takeover", () => {
  const { message } = resolveEgoError({
    error: "manual_takeover",
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
  // Same block a bare user-control code resolves to — unchanged by the reason table.
  assert.equal(
    message,
    resolveEgoError("EGO_TASK_SPACE_USER_IN_CONTROL").message,
  );
  assert.match(message, /egoBrowser\.takeOverTaskSpace\(\)/);
});

test("resolveEgoError falls back to the guidance block for an unmapped user-control reason", () => {
  const guidance = resolveEgoError("EGO_TASK_SPACE_USER_IN_CONTROL").message;
  for (const text of [
    "some_future_reason", // a reason key this build predates
    "The task is under user control.", // the CDP send channel, which sends no key
    "constructor", // must not reach through to Object.prototype
    "",
  ]) {
    const { message } = resolveEgoError({
      error: text,
      error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
    });
    assert.equal(message, guidance, `text ${JSON.stringify(text)}`);
  }
});

test("resolveEgoError falls back to the raw code, then a generic message", () => {
  assert.deepEqual(resolveEgoError({ error_code: "EGO_FUTURE_CODE" }), {
    code: "EGO_FUTURE_CODE",
    message: "EGO_FUTURE_CODE",
  });
  assert.deepEqual(resolveEgoError({}), {
    code: undefined,
    message: "Unknown ego error",
  });
});

test("isEgoUserControlError keys on the stable code, not wording", () => {
  assert.equal(
    isEgoUserControlError(
      Object.assign(new Error("anything at all"), {
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      }),
    ),
    true,
  );
  // wording that mentions user control but lacks the code is not a match
  assert.equal(
    isEgoUserControlError(new Error("the user is controlling this")),
    false,
  );
  assert.equal(
    isEgoUserControlError({ error_code: "EGO_SNAPSHOT_FAILED" }),
    false,
  );
});

test("assertNoEgoError resolves the message via the code and attaches error_code", () => {
  try {
    assertNoEgoError(
      {
        error: "Task space not selected",
        error_code: "EGO_TASK_SPACE_NOT_SELECTED",
      },
      "listTabs",
    );
    assert.fail("expected assertNoEgoError to throw");
  } catch (err) {
    assert.equal(err.message, "listTabs: Task space not selected");
    assert.equal(err.error_code, "EGO_TASK_SPACE_NOT_SELECTED");
  }
});

test("assertNoEgoError omits the prefix when no op is given", () => {
  try {
    assertNoEgoError({
      error: "The task space is inactive: 10",
      error_code: "EGO_TASK_SPACE_INACTIVE",
    });
    assert.fail("expected assertNoEgoError to throw");
  } catch (err) {
    // No op given, so no "<op>: " prefix — the owned block starts the message.
    assert.match(err.message, /^The user has taken control/);
    assert.match(err.message, /egoBrowser\.claimTaskSpace\(id\)/);
    assert.doesNotMatch(err.message, /\b10\b/);
    assert.equal(err.error_code, "EGO_TASK_SPACE_INACTIVE");
  }
});

test("assertNoEgoError passes through results with no error", () => {
  const ok = { tabs: [] };
  assert.equal(assertNoEgoError(ok, "listTabs"), ok);
});

// Native picks per method whether a failure resolves as { error, error_code } or
// rejects as an Error. callEgo covers both so the resolved wording reaches the agent
// either way.
test("callEgo resolves the message for a rejected native call", async () => {
  await assert.rejects(
    () =>
      callEgo(
        Promise.reject(
          Object.assign(new Error("location"), {
            error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
          }),
        ),
        "snapshot",
      ),
    (err) => {
      assert.match(
        err.message,
        /^snapshot: A browser permission prompt for location/,
      );
      assert.equal(err.error_code, "EGO_TASK_SPACE_USER_IN_CONTROL");
      return true;
    },
  );
});

test("callEgo resolves the message for a resolved native error payload", async () => {
  await assert.rejects(
    () =>
      callEgo(
        Promise.resolve({
          error: "camera",
          error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
        }),
        "listTabs",
      ),
    (err) => {
      assert.match(
        err.message,
        /^listTabs: A browser permission prompt for camera/,
      );
      assert.equal(err.error_code, "EGO_TASK_SPACE_USER_IN_CONTROL");
      return true;
    },
  );
});

test("callEgo passes through a successful result", async () => {
  const ok = { tabs: [] };
  assert.equal(await callEgo(Promise.resolve(ok), "listTabs"), ok);
});
