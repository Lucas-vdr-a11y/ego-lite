type InstallTarget = Record<string, unknown>;

/**
 * Globals removed when the agent-facing API moved to TaskSpace-bound Playwright.
 * Keep this list as the single cleanup source for both embedded and direct-CLI runs.
 */
const LEGACY_GLOBAL_HELPERS = [
  "browser",
  "click",
  "dblclick",
  "hover",
  "drag",
  "wheel",
  "scrollIntoViewIfNeeded",
  "press",
  "insertText",
  "focus",
  "fill",
  "pressSequentially",
  "check",
  "uncheck",
  "setChecked",
  "selectOption",
  "dispatchEvent",
  "textContent",
  "innerText",
  "inputValue",
  "isChecked",
  "getAttribute",
  "count",
  "allInnerTexts",
  "allTextContents",
  "evaluateAll",
  "goto",
  "pageInfo",
  "listTabs",
  "currentTab",
  "switchTab",
  "openOrReuseTab",
  "closeTab",
  "snapshot",
  "snapshotRaw",
  "screenshot",
  "elementCenter",
  "drainEvents",
  "waitForTimeout",
  "waitForLoadState",
  "waitForSelector",
  "waitForFunction",
  "waitForURL",
  "waitForRequest",
  "waitForResponse",
  "setInputFiles",
  "evaluate",
  "serverFetch",
  "browserFetch",
  "listTaskSpaces",
  "switchTaskSpace",
  "newTaskSpace",
  "useOrCreateTaskSpace",
  "claimTaskSpace",
  "completeTaskSpace",
  "handOffTaskSpace",
  "takeOverTaskSpace",
  "waitForAgentControl",
  "siteSkills",
  "siteSkillsForUrl",
  "runSiteTool",
  "runSiteBrowserTool",
  "learnContext",
] as const;

/**
 * Task-space helpers can be the first call in a valid old-skill execution round.
 * Install migration tombstones for this narrow set; every other removed global stays
 * absent rather than becoming a second supported API.
 */
export const LEGACY_TASK_SPACE_REPLACEMENTS = {
  listTaskSpaces: "egoBrowser.listTaskSpace()",
  switchTaskSpace: "egoBrowser.switchTaskSpace(nameOrId)",
  newTaskSpace: "egoBrowser.newTaskSpace(name)",
  useOrCreateTaskSpace: "egoBrowser.newTaskSpace(name)",
  claimTaskSpace: "egoBrowser.claimTaskSpace(nameOrId)",
  completeTaskSpace: "egoBrowser.completeTaskSpace(nameOrId)",
  handOffTaskSpace: "egoBrowser.handOffTaskSpace(nameOrId)",
  takeOverTaskSpace: "egoBrowser.takeOverTaskSpace(nameOrId)",
  waitForAgentControl: "egoBrowser.waitForAgentControlTaskSpace(nameOrId)",
} as const;

/**
 * The generation in between moved those same calls behind a `taskSpaces` namespace, so
 * its scripts open with `taskSpaces.useOrCreate(...)` — a property read, not a call. A
 * call tombstone cannot catch that, because the read itself would resolve to undefined
 * and fail as "not a function" before any guard ran. So the namespace gets its own
 * tombstone, and each member resolves to the same replacement its flat spelling maps to.
 */
export const LEGACY_TASK_SPACE_NAMESPACE = "taskSpaces";

const LEGACY_NAMESPACE_REPLACEMENTS: Record<string, string> = {
  list: LEGACY_TASK_SPACE_REPLACEMENTS.listTaskSpaces,
  switch: LEGACY_TASK_SPACE_REPLACEMENTS.switchTaskSpace,
  new: LEGACY_TASK_SPACE_REPLACEMENTS.newTaskSpace,
  useOrCreate: LEGACY_TASK_SPACE_REPLACEMENTS.useOrCreateTaskSpace,
  claim: LEGACY_TASK_SPACE_REPLACEMENTS.claimTaskSpace,
  complete: LEGACY_TASK_SPACE_REPLACEMENTS.completeTaskSpace,
  handOff: LEGACY_TASK_SPACE_REPLACEMENTS.handOffTaskSpace,
  takeOver: LEGACY_TASK_SPACE_REPLACEMENTS.takeOverTaskSpace,
  waitForAgentControl: LEGACY_TASK_SPACE_REPLACEMENTS.waitForAgentControl,
};

export const STALE_SKILL_PREFIX = "[ego-browser:skill-stale]";

type LegacyTaskSpaceHelper = keyof typeof LEGACY_TASK_SPACE_REPLACEMENTS;

export class EgoBrowserSkillStaleError extends Error {
  constructor(legacyHelper: string, replacement: string) {
    super(
      [
        `${STALE_SKILL_PREFIX} The loaded ego-browser skill uses the removed global helper "${legacyHelper}".`,
        "The ego-browser skill in this conversation no longer matches the installed runtime. Stop this script, re-read the current ego-browser skill, then retry with:",
        `  await ${replacement}`,
        "This is a skill-context mismatch, not an app-update notice.",
      ].join("\n"),
    );
    this.name = "EgoBrowserSkillStaleError";
  }
}

/**
 * Remove every legacy global, then leave non-enumerable migration tombstones only for
 * the old task-space surface. Calling a tombstone hard-stops the current script with a
 * self-contained recovery instruction and marks buffered runs even if agent code catches
 * the Error.
 */
export function installLegacySkillGuards(target: InstallTarget): void {
  for (const name of LEGACY_GLOBAL_HELPERS) {
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      delete target[name];
    }
  }

  for (const [legacyHelper, replacement] of Object.entries(
    LEGACY_TASK_SPACE_REPLACEMENTS,
  ) as [LegacyTaskSpaceHelper, string][]) {
    Object.defineProperty(target, legacyHelper, {
      value: function legacyTaskSpaceSkillGuard(): never {
        throw new EgoBrowserSkillStaleError(legacyHelper, replacement);
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  Object.defineProperty(target, LEGACY_TASK_SPACE_NAMESPACE, {
    // A null-prototype target keeps inspection from reporting inherited Object members
    // the namespace never had.
    value: new Proxy(Object.create(null) as object, {
      get(_target, property) {
        // Throw only for the members that namespace actually had. Every other read —
        // a symbol probe from `console.log`, a feature test, anything walking the
        // globals — resolves to undefined, exactly as it would have without a
        // tombstone. A guard is not worth turning an unrelated read into an exception.
        const replacement =
          typeof property === "string"
            ? LEGACY_NAMESPACE_REPLACEMENTS[property]
            : undefined;
        if (replacement === undefined) return undefined;
        throw new EgoBrowserSkillStaleError(
          `${LEGACY_TASK_SPACE_NAMESPACE}.${property as string}`,
          replacement,
        );
      },
    }),
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
