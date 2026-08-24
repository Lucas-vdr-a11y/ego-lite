import test from "node:test";
import assert from "node:assert/strict";

import {
  extractReloadToken,
  isReloadUrl,
  parseTurnstileTokens,
} from "../../dist/src/captcha/parse.js";

test("extractReloadToken pulls the rresp value from a reload body", () => {
  assert.equal(
    extractReloadToken('...{"rresp","6Le-abc123"}...'),
    "6Le-abc123",
  );
});

test("extractReloadToken returns null when there is no token", () => {
  assert.equal(extractReloadToken("no token here"), null);
  assert.equal(extractReloadToken(null), null);
  assert.equal(extractReloadToken(""), null);
});

test("isReloadUrl matches api2 and enterprise reload endpoints", () => {
  assert.ok(isReloadUrl("https://www.google.com/recaptcha/api2/reload"));
  assert.ok(isReloadUrl("https://www.google.com/recaptcha/enterprise/reload"));
  assert.ok(!isReloadUrl("https://example.com/api2/reload"));
  assert.ok(!isReloadUrl(""));
});

test("parseTurnstileTokens handles arrays, JSON-array strings, and single tokens", () => {
  assert.deepEqual(parseTurnstileTokens(["a", "b"]), ["a", "b"]);
  assert.deepEqual(parseTurnstileTokens('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseTurnstileTokens("single-token"), ["single-token"]);
  assert.deepEqual(parseTurnstileTokens(null), []);
  assert.deepEqual(parseTurnstileTokens(""), []);
  assert.deepEqual(parseTurnstileTokens([""]), []);
});
