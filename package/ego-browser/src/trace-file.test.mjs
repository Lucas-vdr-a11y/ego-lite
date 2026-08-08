import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  diagnosticTraceBuild,
  startTrace,
  traceOutput,
  traceTarget,
} from "../dist/src/trace-file.js";

const tempDirs = [];

function tempTarget() {
  const directory = mkdtempSync(join(tmpdir(), "ego-trace-"));
  tempDirs.push(directory);
  return join(directory, "trace.log");
}

test.after(() => {
  for (const directory of tempDirs) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tracing stays inert when the env var is unset", () => {
  startTrace({});
  assert.equal(traceTarget(), null);
  // Must not throw, and must not create anything.
  traceOutput("ignored\n");
});

test(
  "a release build ignores the trace env var and creates no file",
  { skip: diagnosticTraceBuild() },
  () => {
    const target = tempTarget();
    startTrace({ EGO_BROWSER_TRACE_FILE: target });
    traceOutput("must not be written\n");
    assert.equal(traceTarget(), null);
    assert.equal(existsSync(target), false);
  },
);

test(
  "an enabled trace writes each chunk through immediately",
  {
    skip: !diagnosticTraceBuild(),
  },
  () => {
    const target = tempTarget();
    startTrace({ EGO_BROWSER_TRACE_FILE: target });
    assert.equal(traceTarget(), target);

    traceOutput("first\n");
    // Readable while the run is still in flight — nothing is held back.
    assert.match(readFileSync(target, "utf8"), /first/);

    traceOutput("second\n");
    const text = readFileSync(target, "utf8");
    assert.match(text, /run start/);
    assert.ok(
      text.indexOf("first") < text.indexOf("second"),
      "records keep the order they were written in",
    );
    startTrace({});
  },
);

test(
  "every record carries a timestamp, the pid, and a run id",
  {
    skip: !diagnosticTraceBuild(),
  },
  () => {
    const target = tempTarget();
    startTrace({ EGO_BROWSER_TRACE_FILE: target });
    traceOutput("payload\n");
    const line = readFileSync(target, "utf8")
      .split("\n")
      .find((entry) => entry.endsWith("payload"));

    assert.ok(line, "expected the payload record");
    assert.match(
      line,
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z pid=${process.pid} run=[a-z0-9]+ payload$`,
      ),
    );
    startTrace({});
  },
);

test(
  "concurrent runs sharing one file stay attributable",
  {
    skip: !diagnosticTraceBuild(),
  },
  () => {
    const target = tempTarget();
    startTrace({ EGO_BROWSER_TRACE_FILE: target });
    traceOutput("from run A\n");
    const first = readFileSync(target, "utf8").match(/run=([a-z0-9]+)/)[1];

    // A second startTrace is a second logical run, as happens when the host reuses the
    // process for another script.
    startTrace({ EGO_BROWSER_TRACE_FILE: target });
    traceOutput("from run B\n");
    const text = readFileSync(target, "utf8");
    const second = text
      .split("\n")
      .find((entry) => entry.endsWith("from run B"))
      .match(/run=([a-z0-9]+)/)[1];

    assert.notEqual(first, second);
    startTrace({});
  },
);

test(
  "a multi-line chunk prefixes every line so interleaving stays readable",
  {
    skip: !diagnosticTraceBuild(),
  },
  () => {
    const target = tempTarget();
    startTrace({ EGO_BROWSER_TRACE_FILE: target });
    traceOutput("{\n  a: 1\n}\n");
    const payload = readFileSync(target, "utf8")
      .split("\n")
      .filter((entry) => entry && !entry.endsWith("run start"));

    assert.equal(payload.length, 3);
    for (const entry of payload) {
      assert.match(entry, new RegExp(`pid=${process.pid} run=[a-z0-9]+ `));
    }
    startTrace({});
  },
);

test(
  "an unwritable target never takes the run down",
  {
    skip: !diagnosticTraceBuild(),
  },
  () => {
    const target = join(tempTarget(), "no", "such", "dir", "trace.log");
    startTrace({ EGO_BROWSER_TRACE_FILE: target });
    assert.doesNotThrow(() => traceOutput("still fine\n"));
    assert.equal(existsSync(target), false);
    startTrace({});
  },
);
