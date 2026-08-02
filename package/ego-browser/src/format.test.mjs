import test from "node:test";
import assert from "node:assert/strict";

import { formatCliLogValue } from "../dist/src/format.js";

test("formatCliLogValue omits function properties from ordinary object output", () => {
  const formatted = formatCliLogValue({
    id: 7,
    listTabs() {},
    nested: {
      value: "kept",
      sendCDPMessage() {},
    },
  });

  const parsed = JSON.parse(formatted);
  assert.deepEqual(parsed, {
    id: 7,
    nested: { value: "kept" },
  });
  assert.doesNotMatch(
    formatted,
    /listTabs|sendCDPMessage|signature|description/,
  );
});

test("formatCliLogValue can use Node's native object inspection", () => {
  const formatted = formatCliLogValue(
    {
      createTab() {},
      listTabs() {},
      onCDPMessage: undefined,
    },
    { nativeInspect: true },
  );

  assert.match(formatted, /createTab: \[Function: createTab\]/);
  assert.match(formatted, /listTabs: \[Function: listTabs\]/);
  assert.match(formatted, /onCDPMessage: undefined/);
  assert.doesNotMatch(formatted, /signature|description|"undefined"/);
});

test("formatCliLogValue handles nested bigint and circular references", () => {
  const value = { id: 1n, child: {} };
  value.child.self = value;

  const formatted = formatCliLogValue(value);

  const parsed = JSON.parse(formatted);
  assert.equal(parsed.id, "1n");
  assert.equal(parsed.child.self, "[Circular]");
});
