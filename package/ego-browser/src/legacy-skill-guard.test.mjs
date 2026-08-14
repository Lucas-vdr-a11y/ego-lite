import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_TASK_SPACE_NAMESPACE,
  LEGACY_TASK_SPACE_REPLACEMENTS,
  STALE_SKILL_PREFIX,
  installLegacySkillGuards,
} from "../dist/src/legacy-skill-guard.js";

const EXPECTED_TASK_SPACE_REPLACEMENTS = {
  listTaskSpaces: "egoBrowser.listTaskSpace()",
  switchTaskSpace: "egoBrowser.switchTaskSpace(nameOrId)",
  newTaskSpace: "egoBrowser.newTaskSpace(name)",
  useOrCreateTaskSpace: "egoBrowser.newTaskSpace(name)",
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
});

test("the entry point of a flat-global skill is guided, not a bare ReferenceError", () => {
  // Every script of that generation opens with this call, so it is the one name that
  // decides whether the guidance is ever reached.
  const target = {};
  installLegacySkillGuards(target);

  assert.throws(
    () => target.useOrCreateTaskSpace("inspect example page"),
    (error) => {
      assert.equal(error.name, "EgoBrowserSkillStaleError");
      assert.ok(error.message.startsWith(STALE_SKILL_PREFIX));
      assert.ok(error.message.includes("await egoBrowser.newTaskSpace(name)"));
      return true;
    },
  );
});

test("the entry point of a namespaced skill is guided on the property read", () => {
  // That generation opens with `taskSpaces.useOrCreate(...)`, which fails at the read
  // rather than the call, so a call tombstone would never see it.
  const target = {};
  installLegacySkillGuards(target);

  assert.throws(
    () => target.taskSpaces.useOrCreate("inspect example page"),
    (error) => {
      assert.equal(error.name, "EgoBrowserSkillStaleError");
      assert.ok(error.message.startsWith(STALE_SKILL_PREFIX));
      assert.ok(error.message.includes('"taskSpaces.useOrCreate"'));
      assert.ok(error.message.includes("await egoBrowser.newTaskSpace(name)"));
      return true;
    },
  );
});

test("every member of the removed namespace maps to its flat spelling's replacement", () => {
  const target = {};
  installLegacySkillGuards(target);

  const members = {
    list: "listTaskSpaces",
    switch: "switchTaskSpace",
    new: "newTaskSpace",
    useOrCreate: "useOrCreateTaskSpace",
    claim: "claimTaskSpace",
    complete: "completeTaskSpace",
    handOff: "handOffTaskSpace",
    takeOver: "takeOverTaskSpace",
    waitForAgentControl: "waitForAgentControl",
  };
  for (const [member, flatSpelling] of Object.entries(members)) {
    assert.throws(
      () => target[LEGACY_TASK_SPACE_NAMESPACE][member],
      (error) => {
        assert.ok(
          error.message.includes(
            `await ${EXPECTED_TASK_SPACE_REPLACEMENTS[flatSpelling]}`,
          ),
          `${member} should map to the ${flatSpelling} replacement`,
        );
        return true;
      },
    );
  }
});

test("the namespace tombstone stays out of enumeration and throws for nothing else", () => {
  const target = {};
  installLegacySkillGuards(target);

  assert.equal(
    Object.prototype.propertyIsEnumerable.call(
      target,
      LEGACY_TASK_SPACE_NAMESPACE,
    ),
    false,
  );
  // Anything that is not a member of the removed namespace reads as undefined, exactly
  // as it would without a tombstone: inspection, feature tests, and any native path
  // walking the globals must not be turned into an exception by a migration aid.
  assert.doesNotThrow(() => String(Object.keys(target.taskSpaces)));
  assert.equal(target.taskSpaces.somethingElse, undefined);
  assert.equal(target.taskSpaces.then, undefined);
  assert.equal(target.taskSpaces[Symbol.toPrimitive], undefined);
});
