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
