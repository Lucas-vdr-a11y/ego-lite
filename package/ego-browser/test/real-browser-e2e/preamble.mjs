// Injected into each real-browser test script.
const { readFile, writeFile } = await import("node:fs/promises");
const { join } = await import("node:path");

let __assertionCount = 0;

function formatAssertionValue(value) {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function logAssertion(status, message, details = {}) {
  if (!verboseAssertions) return;
  console.log(JSON.stringify({ assertion: { status, message, ...details } }));
}

function assert(condition, message) {
  __assertionCount += 1;
  logAssertion("start", message);
  if (!condition) {
    logAssertion("fail", message);
    throw new Error(message);
  }
  logAssertion("pass", message);
}

function assertEqual(actual, expected, message) {
  __assertionCount += 1;
  logAssertion("start", message);
  if (actual !== expected) {
    logAssertion("fail", message, {
      expected: formatAssertionValue(expected),
      actual: formatAssertionValue(actual),
    });
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
  logAssertion("pass", message);
}

function assertIncludes(text, expected, message) {
  __assertionCount += 1;
  logAssertion("start", message);
  if (!String(text).includes(expected)) {
    logAssertion("fail", message, {
      expected: formatAssertionValue(expected),
      actual: formatAssertionValue(text),
    });
    throw new Error(
      `${message}: expected ${JSON.stringify(String(text))} to include ${JSON.stringify(expected)}`,
    );
  }
  logAssertion("pass", message);
}

async function assertRejects(fn, expected, message) {
  __assertionCount += 1;
  logAssertion("start", message);
  try {
    await fn();
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (!String(errorMessage).includes(expected)) {
      throw new Error(
        `${message}: expected ${JSON.stringify(errorMessage)} to include ${JSON.stringify(expected)}`,
      );
    }
    logAssertion("pass", message);
    return;
  }
  throw new Error(`${message}: expected rejection`);
}

async function openE2eTaskSpace(name) {
  const matches = (await egoBrowser.listTaskSpace()).filter(
    (space) => space.name === name,
  );
  if (matches.length > 1) {
    throw new Error(
      `E2E fixture found duplicate TaskSpaces named ${JSON.stringify(name)}`,
    );
  }
  return matches.length === 1
    ? egoBrowser.switchTaskSpace(matches[0].id)
    : egoBrowser.newTaskSpace(name);
}

// After a cross-document navigation Chromium discards mouse input for the whole
// page - the top document included - until the top-level document produces
// contentful content of its own. Text and images satisfy it; a background colour
// does not. A document that never can, such as a <frameset> or a body holding
// only frames, instead rides out a fixed deadline of roughly 500ms during which
// every click is dropped rather than queued, and nothing reports an error:
// locator.click() resolves and the page does nothing.
//
// One compositor-produced frame marks the moment input starts being delivered.
// It costs a few milliseconds on an ordinary page and only pays the deadline on
// the documents that need it, so it is safe to call after any navigation.
async function waitForFirstCompositorFrame(page, timeoutMs = 5_000) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Page.enable");
    const delivered = new Promise((resolve) => {
      const onScreencastFrame = (payload) => {
        session.off("Page.screencastFrame", onScreencastFrame);
        session
          .send("Page.screencastFrameAck", { sessionId: payload.sessionId })
          .catch(() => {});
        resolve(true);
      };
      session.on("Page.screencastFrame", onScreencastFrame);
      setTimeout(() => resolve(false), timeoutMs);
    });
    await session.send("Page.startScreencast", {
      format: "jpeg",
      quality: 1,
      maxWidth: 64,
      maxHeight: 64,
      everyNthFrame: 1,
    });
    const result = await delivered;
    await session.send("Page.stopScreencast").catch(() => {});
    return result;
  } finally {
    await session.detach().catch(() => {});
  }
}
