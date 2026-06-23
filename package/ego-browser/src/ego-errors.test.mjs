import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNoEgoError,
  egoErrorCode,
  isEgoErrorCode,
  isEgoHardStopError,
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
  assert.equal(isEgoErrorCode("EGO_TASK_SPACE_NOT_FOUND"), true);
  assert.equal(isEgoErrorCode("EGO_FUTURE_CODE"), false);
  assert.equal(isEgoErrorCode(undefined), false);
});

test("resolveEgoError prefers the live browser text", () => {
  const resolved = resolveEgoError({
    error: "Task space not found: 7",
    error_code: "EGO_TASK_SPACE_NOT_FOUND",
  });
  assert.deepEqual(resolved, {
    code: "EGO_TASK_SPACE_NOT_FOUND",
    message: "Task space not found: 7",
  });
});

test("resolveEgoError falls back to the ego-browser message for a bare code", () => {
  assert.deepEqual(resolveEgoError("EGO_TASK_SPACE_USER_IN_CONTROL"), {
    code: "EGO_TASK_SPACE_USER_IN_CONTROL",
    message: "The task is under user control.",
  });
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

test("hard-stop classification includes user-control and inactive task spaces", () => {
  assert.equal(
    isEgoHardStopError({
      error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      error: "user has control",
    }),
    true,
  );
  assert.equal(
    isEgoHardStopError({
      error_code: "EGO_TASK_SPACE_INACTIVE",
      error: "not assigned",
    }),
    true,
  );
  assert.equal(
    isEgoHardStopError({
      error_code: "EGO_TASK_SPACE_NOT_FOUND",
      error: "not found",
    }),
    false,
  );
});

test("assertNoEgoError preserves the message and attaches error_code", () => {
  try {
    assertNoEgoError(
      {
        error: "The task is under user control",
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      },
      "listTabs",
    );
    assert.fail("expected assertNoEgoError to throw");
  } catch (err) {
    assert.equal(err.message, "listTabs: The task is under user control");
    assert.equal(err.error_code, "EGO_TASK_SPACE_USER_IN_CONTROL");
  }
});

test("assertNoEgoError passes through results with no error", () => {
  const ok = { tabs: [] };
  assert.equal(assertNoEgoError(ok, "listTabs"), ok);
});
