import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_TASK_SPACE_REPLACEMENTS,
  STALE_SKILL_PREFIX,
  installLegacySkillGuards,
} from "../dist/src/legacy-skill-guard.js";
import { resetSink } from "../dist/src/output-sink.js";

const EXPECTED_TASK_SPACE_REPLACEMENTS = {
  listTaskSpaces: "egoBrowser.listTaskSpace()",
  switchTaskSpace: "egoBrowser.switchTaskSpace(nameOrId)",
  newTaskSpace: "egoBrowser.newTaskSpace(name)",
  useOrCreateTaskSpace: "egoBrowser.useOrCreateTaskSpace(nameOrId)",
  claimTaskSpace: "egoBrowser.claimTaskSpace(nameOrId)",
  completeTaskSpace: "egoBrowser.completeTaskSpace(nameOrId)",
  handOffTaskSpace: "egoBrowser.handOffTaskSpace(nameOrId)",
  takeOverTaskSpace: "egoBrowser.takeOverTaskSpace(nameOrId)",
  waitForAgentControl: "egoBrowser.waitForAgentControlTaskSpace(nameOrId)",
};

test("legacy skill guards cover only the removed task-space global surface", () => {
  assert.deepEqual(
    LEGACY_TASK_SPACE_REPLACEMENTS,
    EXPECTED_TASK_SPACE_REPLACEMENTS,
  );

  const target = {
    browser: { listTabs() {} },
    click() {},
    siteSkills() {},
  };
  for (const name of Object.keys(EXPECTED_TASK_SPACE_REPLACEMENTS)) {
    target[name] = () => {};
  }

  installLegacySkillGuards(target);

  assert.equal(target.click, undefined);
  assert.equal(target.browser, undefined);
  assert.equal(target.siteSkills, undefined);
  for (const [legacyHelper, replacement] of Object.entries(
    EXPECTED_TASK_SPACE_REPLACEMENTS,
  )) {
    assert.equal(typeof target[legacyHelper], "function");
    assert.equal(
      Object.prototype.propertyIsEnumerable.call(target, legacyHelper),
      false,
    );
    resetSink();
    assert.throws(
      () => target[legacyHelper](),
      (error) => {
        assert.equal(error.name, "EgoBrowserSkillStaleError");
        assert.ok(error.message.startsWith(STALE_SKILL_PREFIX));
        assert.ok(error.message.includes(`"${legacyHelper}"`));
        assert.match(
          error.message,
          /skill in this conversation no longer matches the installed runtime/,
        );
        assert.doesNotMatch(error.message, /Playwright/i);
        assert.ok(error.message.includes(`await ${replacement}`));
        return true;
      },
    );
  }
  resetSink();
});
