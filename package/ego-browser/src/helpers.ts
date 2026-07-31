import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { setOverrides, state } from "./state.js";
import { assertNoEgoError, isEgoUserControlError } from "./ego-errors.js";
import { help as helpRuntime, formatHelp } from "./help-runtime.js";
import {
  cdp,
  decodeUnserializableJsValue,
  evaluate,
} from "./cdp-eval.js";
import * as pointer from "./driver/pointer.js";
import * as keyboard from "./driver/keyboard.js";
import * as locator from "./driver/locator.js";
import * as nav from "./driver/nav.js";
import * as observe from "./driver/observe.js";
import * as waits from "./driver/waits.js";
import * as files from "./driver/files.js";
import * as downloads from "./driver/downloads.js";
import * as screencast from "./driver/screencast.js";
import * as aria from "./driver/aria-snapshot.js";
import { waitForActionableElement } from "./driver/actionability.js";
import { locatorTarget } from "./frame-context.js";
import { browserFetch, serverFetch } from "./http.js";
import {
  loadBrowserToolSource,
  loadLearnedContext,
  runNodeSiteTool,
  siteSkillsForUrl as siteSkillsForUrlCore,
  wrapBrowserTool,
} from "./learning/index.js";

export { NAME } from "./state.js";
export { cdp, evaluate, evaluateInTarget } from "./cdp-eval.js";
export {
  click,
  dblclick,
  hover,
  drag,
  dragTo,
  wheel,
  scrollIntoViewIfNeeded,
} from "./driver/pointer.js";
export {
  press,
  down,
  up,
  insertText,
  focus,
  fill,
  pressSequentially,
  check,
  uncheck,
  setChecked,
  selectOption,
  dispatchEvent,
} from "./driver/keyboard.js";
export {
  textContent,
  innerText,
  inputValue,
  isChecked,
  isVisible,
  isHidden,
  isEnabled,
  isDisabled,
  isEditable,
  getAttribute,
  blur,
  boundingBox,
  count,
  allInnerTexts,
  allTextContents,
  innerHTML,
  evaluateLocator,
  evaluateAll,
} from "./driver/locator.js";
export {
  INTERNAL_URL_PREFIXES,
  pageInfo,
  listTabs,
  currentTab,
  switchTab,
  openTab,
  openOrReuseTab,
  closeTab,
  evaluateTab,
  goto,
  reload,
} from "./driver/nav.js";
export {
  snapshot,
  snapshotRaw,
  screenshot,
  saveScreenshot,
  elementCenter,
  drainEvents,
} from "./driver/observe.js";
export {
  waitForTimeout,
  waitForLoadState,
  waitForSelector,
  waitForFunction,
  waitForURL,
  waitForRequest,
  waitForResponse,
} from "./driver/waits.js";
export { setInputFiles } from "./driver/files.js";
export { startScreencast, stopScreencast } from "./driver/screencast.js";
export { browserFetch, serverFetch } from "./http.js";

/**
 * List all task spaces.
 * @returns {Promise<Array<{taskId:string,id:number,name:string,createdBy?:string,ownership?:string,recentTabTitles?:string[]}>>}
 */
export async function listTaskSpaces() {
  const ego = globalThis.ego;
  if (!ego || typeof ego.listTaskSpaces !== "function") {
    throw new Error("listTaskSpaces requires ego.listTaskSpaces");
  }
  return normalizeTaskSpaces(
    assertNoEgoError(await ego.listTaskSpaces(), "listTaskSpaces"),
  );
}

/*
 * Task space ownership policy (`ownership`: "agent" | "agentDelegatedToUser" | "user").
 * "agent" and "agentDelegatedToUser" are both agent-owned (see isAgentOwned) — the
 * latter is the agent's own space with control temporarily handed to the user
 * (handoff or GUI takeover). The user-control boundary is enforced at the native
 * bridge when real commands run, not here. The rows below describe what each helper
 * does when the target space is user-owned:
 *
 *   switchTaskSpace                     -> throws (agent-owned only)
 *   claimTaskSpace                      -> claims it (ownership transfers to the agent), then selects it
 *   handOffTaskSpace                    -> skipped, resolves { done: false, skipped: "user-owned" }
 *   completeTaskSpace { keep: true }    -> skipped, resolves { done: false, skipped: "user-owned" }
 *   completeTaskSpace { keep: false }   -> claims it, then closes it
 *   takeOverTaskSpace / waitForAgentControl -> no ownership check (operates as-is)
 *
 * Keep this table in sync with the one in skills/ego-browser/SKILL.md.
 */

/**
 * Whether the agent owns the space. "agentDelegatedToUser" is still agent-owned —
 * the agent created it but control is temporarily with the user (handoff / GUI
 * takeover). Selecting such a space is fine; the user-control boundary is enforced
 * separately at the native bridge when real commands run.
 * @param {string|undefined} ownership
 * @returns {boolean}
 */
function isAgentOwned(ownership) {
  return ownership === "agent" || ownership === "agentDelegatedToUser";
}

/**
 * Select an existing task space by id/name for the current Node invocation.
 * @param {string|number} nameOrId Task space id or name.
 * @returns {Promise<{taskId:string,id:number,name:string,createdBy?:string,ownership?:string,recentTabTitles?:string[]}>}
 */
export async function switchTaskSpace(nameOrId) {
  const ego = globalThis.ego;
  if (!ego || typeof ego.useTaskSpace !== "function") {
    throw new Error("switchTaskSpace requires ego.useTaskSpace");
  }
  const space = await findTaskSpace(nameOrId);
  if (!isAgentOwned(space.ownership)) {
    throw new Error(
      `switchTaskSpace requires an agent-owned task space, got ownership ${JSON.stringify(space.ownership)}`,
    );
  }
  return selectTaskSpace(ego, space, "switchTaskSpace");
}

/**
 * Create an agent-owned task space and select it for the current Node invocation.
 * @param {string} name Task space name.
 * @returns {Promise<{taskId:string,id:number,name:string,createdBy?:string,ownership?:string,recentTabTitles?:string[]}>}
 */
export async function newTaskSpace(name) {
  const ego = globalThis.ego;
  if (!ego || typeof ego.createTaskSpace !== "function") {
    throw new Error("newTaskSpace requires ego.createTaskSpace");
  }
  const created = normalizeTaskSpace(
    assertNoEgoError(await ego.createTaskSpace(name), "newTaskSpace"),
  );
  if (!created) {
    throw new Error("newTaskSpace returned an invalid task space");
  }
  taskSpaceNumericId(created, "newTaskSpace");
  return selectTaskSpace(ego, created, "newTaskSpace");
}

/**
 * Use an existing agent-owned task space, or create it when missing. User-owned
 * spaces are selected but not claimed (the EGO_TASK_SPACE_USER_IN_CONTROL error
 * surfaces) — call claimTaskSpace(nameOrId) to take ownership.
 * @param {string|number} nameOrId Task space name or numeric id.
 * @returns {Promise<{taskId:string,id:number,name:string,createdBy?:string,ownership?:string,recentTabTitles?:string[]}>}
 */
export async function useOrCreateTaskSpace(nameOrId) {
  const spaces = await listTaskSpaces();
  const existing = findMatchingTaskSpace(spaces, nameOrId);
  if (!existing) {
    if (typeof nameOrId === "number") {
      throw new Error(`task space not found: ${nameOrId}`);
    }
    return newTaskSpace(nameOrId);
  }
  if (isAgentOwned(existing.ownership)) {
    return selectTaskSpace(globalThis.ego, existing, "useOrCreateTaskSpace");
  }
  if (existing.ownership === "user") {
    // Don't claim user-owned spaces here. Select it as-is; the user stays in
    // control, so EGO_TASK_SPACE_USER_IN_CONTROL surfaces (as ego-browser's owned
    // guidance, not the raw native text). Call claimTaskSpace(nameOrId) to take
    // ownership.
    return selectTaskSpace(globalThis.ego, existing, "useOrCreateTaskSpace");
  }
  throw new Error(
    `useOrCreateTaskSpace cannot use task space ${JSON.stringify(nameOrId)} with ownership ${JSON.stringify(existing.ownership)}`,
  );
}

/**
 * Claim a user-owned task space (ownership transfers to the agent) and select it
 * for the current Node invocation. Resolves the space by id/name, claims it via
 * ego.claimTaskSpace, then selects it.
 * @param {string|number} nameOrId Task space id or name.
 * @returns {Promise<{taskId:string,id:number,name:string,createdBy?:string,ownership?:string,recentTabTitles?:string[]}>}
 */
export async function claimTaskSpace(nameOrId) {
  const space = await findTaskSpace(nameOrId);
  return claimResolvedTaskSpace(space, "claimTaskSpace");
}

async function claimResolvedTaskSpace(space, op = "claimTaskSpace") {
  const ego = globalThis.ego;
  if (!ego || typeof ego.claimTaskSpace !== "function") {
    throw new Error(`${op} requires ego.claimTaskSpace`);
  }
  const id = taskSpaceNumericId(space, op);
  const claimed = normalizeTaskSpace(
    assertNoEgoError(await ego.claimTaskSpace(id, space.name), op),
  );
  if (!claimed) {
    throw new Error(`${op} returned an invalid task space`);
  }
  taskSpaceNumericId(claimed, op);
  return selectTaskSpace(ego, claimed, op);
}

async function selectTaskSpace(ego, space, op: string) {
  if (!ego || typeof ego.useTaskSpace !== "function") {
    throw new Error(`${op} requires ego.useTaskSpace`);
  }
  assertNoEgoError(await ego.useTaskSpace(taskSpaceNumericId(space, op)), op);
  return space;
}

async function selectTaskSpaceIfProvided(
  ego,
  nameOrId?: string | number,
  op = "taskSpace",
) {
  if (nameOrId === undefined) return;
  const match = await findTaskSpace(nameOrId);
  await selectTaskSpace(ego, match, op);
}

/**
 * Finish working on a task space. With `{ keep: true }` the page stays open
 * with the agent overlay dismissed so the user can review the result; with
 * `{ keep: false }` the task space is closed entirely.
 * User-owned spaces: `keep:true` is skipped (the user already has the page) and
 * resolves `{ done: false, skipped: "user-owned" }`; `keep:false` claims the
 * space first, then closes it.
 * @param {string|number} nameOrId Task space id or name.
 * @param {{ keep: boolean }} options Required. `keep:true` hands the page to the user; `keep:false` closes the space.
 * @returns {Promise<{done: boolean, skipped?: "user-owned"}>} `{ done: true }` when the space was completed or closed; `{ done: false, skipped: "user-owned" }` when nothing was done.
 */
export async function completeTaskSpace(
  nameOrId: string | number,
  options: { keep: boolean },
) {
  if (
    (typeof nameOrId !== "string" && typeof nameOrId !== "number") ||
    nameOrId === ""
  ) {
    throw new Error("completeTaskSpace requires a task space name or id");
  }
  if (!options || typeof options.keep !== "boolean") {
    throw new Error("completeTaskSpace requires { keep: boolean }");
  }
  const ego = globalThis.ego;
  if (!ego) {
    throw new Error("completeTaskSpace requires ego runtime");
  }
  const spaces = await listTaskSpaces();
  const match = findMatchingTaskSpace(spaces, nameOrId);
  if (!match) {
    throw new Error(`task space not found: ${nameOrId}`);
  }
  if (options.keep) {
    if (match.ownership === "user") {
      return { done: false, skipped: "user-owned" as const };
    }
    await selectTaskSpace(ego, match, "completeTaskSpace");
    if (typeof ego.completeTaskSpace !== "function") {
      throw new Error("completeTaskSpace requires ego.completeTaskSpace");
    }
    assertNoEgoError(await ego.completeTaskSpace(), "completeTaskSpace");
  } else {
    if (match.ownership === "user") {
      await claimResolvedTaskSpace(match, "completeTaskSpace");
    } else {
      await selectTaskSpace(ego, match, "completeTaskSpace");
    }
    if (typeof ego.closeTaskSpace !== "function") {
      throw new Error("completeTaskSpace requires ego.closeTaskSpace");
    }
    assertNoEgoError(await ego.closeTaskSpace(), "completeTaskSpace");
  }
  return { done: true };
}

/**
 * Hand off a task space back to the user, hiding the agent overlay.
 * User-owned spaces are skipped (the user already controls them) and resolve
 * `{ done: false, skipped: "user-owned" }`.
 * @param {string|number} [nameOrId] Task space id or name. If provided, switches to that space first.
 * @returns {Promise<{done: boolean, skipped?: "user-owned"}>} `{ done: true }` when control was handed off; `{ done: false, skipped: "user-owned" }` when nothing was done.
 */
export async function handOffTaskSpace(nameOrId?: string | number) {
  const ego = globalThis.ego;
  if (!ego || typeof ego.handOffTaskSpace !== "function") {
    throw new Error("handOffTaskSpace requires ego.handOffTaskSpace");
  }
  if (nameOrId !== undefined) {
    const match = await findTaskSpace(nameOrId);
    if (match.ownership === "user") {
      return { done: false, skipped: "user-owned" as const };
    }
    await selectTaskSpace(ego, match, "handOffTaskSpace");
  }
  assertNoEgoError(await ego.handOffTaskSpace(), "handOffTaskSpace");
  return { done: true };
}

/**
 * Take over a task space, showing the agent overlay to indicate work has resumed.
 * @param {string|number} [nameOrId] Task space id or name. If provided, switches to that space first.
 * @returns {Promise<void>}
 */
export async function takeOverTaskSpace(nameOrId?: string | number) {
  const ego = globalThis.ego;
  if (!ego || typeof ego.takeOverTaskSpace !== "function") {
    throw new Error("takeOverTaskSpace requires ego.takeOverTaskSpace");
  }
  await selectTaskSpaceIfProvided(ego, nameOrId, "takeOverTaskSpace");
  assertNoEgoError(await ego.takeOverTaskSpace(), "takeOverTaskSpace");
}

/**
 * Probe whether the agent currently holds control of the active task space.
 * Module-private; used by waitForAgentControl. Uses ego.snapshot, which
 * rejects under user-control (per ego-bindings spec) — a reliable
 * synchronous-error signal that raw CDP sends can't provide. Other rejections
 * (task not found, internal errors) propagate so the caller fails fast instead
 * of busy-looping until timeout.
 */
async function probeAgentControl() {
  const ego = globalThis.ego;
  if (!ego || typeof ego.snapshot !== "function") return false;
  try {
    await ego.snapshot({ maxResultLength: 1 });
    return true;
  } catch (err) {
    if (isEgoUserControlError(err)) return false;
    throw err;
  }
}

/**
 * Block until the agent regains control of the named task space.
 * Polls a harmless probe until it succeeds, or throws when the timeout
 * elapses. Read-only — does not call takeOverTaskSpace.
 * @param {string|number} nameOrId Task space id or name.
 * @param {{ interval?: number, timeout?: number }} [options] interval & timeout in milliseconds (default 20,000ms / 600,000ms).
 * @returns {Promise<void>}
 */
export async function waitForAgentControl(
  nameOrId: string | number,
  options: { interval?: number; timeout?: number } = {},
) {
  if (
    (typeof nameOrId !== "string" && typeof nameOrId !== "number") ||
    nameOrId === ""
  ) {
    throw new Error("waitForAgentControl requires a task space name or id");
  }
  const ego = globalThis.ego;
  if (!ego) {
    throw new Error("waitForAgentControl requires ego runtime");
  }
  await selectTaskSpaceIfProvided(ego, nameOrId, "waitForAgentControl");
  const interval =
    typeof options.interval === "number" ? options.interval : 20_000;
  const timeout =
    typeof options.timeout === "number" ? options.timeout : 600_000;
  const deadline = Date.now() + timeout;
  while (true) {
    if (await probeAgentControl()) return;
    if (Date.now() >= deadline) {
      throw new Error(`waitForAgentControl timed out after ${timeout}ms`);
    }
    await waits.waitForTimeout(interval);
  }
}

function normalizeTaskSpaces(raw) {
  if (Array.isArray(raw?.taskSpaces)) {
    return raw.taskSpaces.map(normalizeTaskSpace).filter(Boolean);
  }
  throw new Error("listTaskSpaces expected { taskSpaces: [...] }");
}

function normalizeTaskSpace(space) {
  const taskId = space?.taskId ?? space?.name ?? space?.id;
  if (taskId === undefined || taskId === null || taskId === "") {
    return null;
  }
  return {
    ...space,
    taskId,
    id: space?.id ?? taskId,
    name: space?.name ?? taskId,
  };
}

function taskSpaceNumericId(space, op: string) {
  if (typeof space?.id !== "number" || !Number.isFinite(space.id)) {
    throw new Error(
      `${op} requires a numeric task space id, got ${JSON.stringify(space?.id)}`,
    );
  }
  return space.id;
}

async function findTaskSpace(nameOrId) {
  const spaces = await listTaskSpaces();
  const match = findMatchingTaskSpace(spaces, nameOrId);
  if (!match) throw new Error(`task space not found: ${nameOrId}`);
  return match;
}

function findMatchingTaskSpace(spaces, nameOrId) {
  if (typeof nameOrId === "number") {
    return spaces.find((space) => space.id === nameOrId);
  }
  const byName = spaces.find(
    (space) => space.name === nameOrId || space.taskId === nameOrId,
  );
  if (byName) return byName;
  if (/^\d+$/.test(nameOrId)) {
    const id = Number(nameOrId);
    if (Number.isFinite(id)) {
      return spaces.find((space) => space.id === id);
    }
  }
  return undefined;
}

export async function siteSkillsForUrl(url) {
  return siteSkillsForUrlCore(url, {
    agentWorkspace: state.agentWorkspace(),
  });
}

/**
 * Return site skills matching a URL, or the current page URL when omitted.
 * @param {string} [url] URL to inspect for site skills.
 * @returns {Promise<Array<object|string>>}
 */
export async function siteSkills(url = undefined) {
  const targetUrl = url ?? (await nav.pageInfo()).url ?? "";
  return siteSkillsForUrl(targetUrl);
}

/**
 * Run a learned Node site tool with the helper context.
 * @param {string} siteId Site identifier.
 * @param {string} toolName Tool name within the site.
 * @param {object} [args] Tool arguments.
 * @returns {Promise<any>} Tool result.
 */
export async function runSiteTool(siteId, toolName, args: any = {}) {
  return runNodeSiteTool(siteId, toolName, args, helperContext(), {
    agentWorkspace: state.agentWorkspace(),
  });
}

/**
 * Run a learned browser-side site tool in the current page.
 * @param {string} siteId Site identifier.
 * @param {string} toolName Tool name within the site.
 * @param {object} [args] Tool arguments.
 * @returns {Promise<any>} Browser tool result.
 */
export async function runSiteBrowserTool(siteId, toolName, args: any = {}) {
  const source = await loadBrowserToolSource(siteId, toolName, {
    agentWorkspace: state.agentWorkspace(),
  });
  return evaluate(wrapBrowserTool(source, args));
}

/**
 * Load learned context for the current page or a given URL.
 * Returns accumulated site knowledge: notes content, available tools, usage examples.
 * @param {string} [url] URL to inspect. Defaults to current page.
 * @returns {Promise<object>} Learned context with knowledge and tool signatures.
 */
export async function learnContext(url = undefined) {
  const targetUrl = url ?? (await nav.pageInfo()).url ?? "";
  return loadLearnedContext(targetUrl, {
    agentWorkspace: state.agentWorkspace(),
  });
}

function createLocator(selector, frameChain: string[] = []) {
  const target = locatorTarget(selector, frameChain);
  const facade = {
    first: () => createLocator(nthSelector(selector, 0), frameChain),
    last: () => createLocator(`internal:last;${selector}`, frameChain),
    nth: (index) => {
      const value = Number(index);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("locator.nth requires a non-negative integer");
      }
      return createLocator(nthSelector(selector, value), frameChain);
    },
    and: (other) =>
      createLocator(
        internalSelector("and", {
          left: selector,
          right: locatorSelector(other, frameChain),
        }),
        frameChain,
      ),
    or: (other) =>
      createLocator(
        internalSelector("or", {
          left: selector,
          right: locatorSelector(other, frameChain),
        }),
        frameChain,
      ),
    locator: (child, options: any = {}) => {
      const scoped = scopedSelector(
        selector,
        locatorSelector(child, frameChain),
      );
      return createLocator(
        locatorOptionsSelector(scoped, options, frameChain),
        frameChain,
      );
    },
    getByRole: (role, options: any = {}) =>
      createLocator(
        scopedSelector(selector, roleSelector(role, options)),
        frameChain,
      ),
    getByText: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("text", text, options)),
        frameChain,
      ),
    getByLabel: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("label", text, options)),
        frameChain,
      ),
    getByPlaceholder: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("placeholder", text, options)),
        frameChain,
      ),
    getByAltText: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("alt", text, options)),
        frameChain,
      ),
    getByTitle: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("title", text, options)),
        frameChain,
      ),
    getByTestId: (testId) =>
      createLocator(
        scopedSelector(selector, testIdSelector(testId)),
        frameChain,
      ),
    filter: (options: any = {}) =>
      createLocator(filterSelector(selector, options, frameChain), frameChain),
    click: (options = {}) => pointer.click(target, options),
    dblclick: (options = {}) => pointer.dblclick(target, options),
    hover: (options = {}) => pointer.hover(target, options),
    dragTo: (destination, options = {}) =>
      pointer.dragTo(
        locatorTarget(selector, frameChain),
        destination?.target || destination?.selector || destination,
        options,
      ),
    scrollIntoViewIfNeeded: (options = {}) =>
      pointer.scrollIntoViewIfNeeded(target, options),
    focus: (options = {}) => keyboard.focus(target, options),
    fill: (value, options = {}) => keyboard.fill(target, value, options),
    clear: (options = {}) => keyboard.fill(target, "", options),
    press: (key, options = {}) =>
      keyboard.pressOnSelector(target, key, options),
    pressSequentially: (text, options = {}) =>
      keyboard.pressSequentially(target, text, options),
    check: (options = {}) => keyboard.setChecked(target, true, options),
    uncheck: (options = {}) => keyboard.setChecked(target, false, options),
    setChecked: (checked, options = {}) =>
      keyboard.setChecked(target, checked, options),
    selectOption: (values, options = {}) =>
      keyboard.selectOption(target, values, options),
    setInputFiles: (filesValue, options = {}) =>
      files.setInputFiles(target, filesValue, options),
    dispatchEvent: (type, eventInit = {}, options = {}) =>
      keyboard.dispatchEvent(target, type, eventInit, options),
    blur: () => locator.blur(target),
    textContent: () => locator.textContent(target),
    innerText: () => locator.innerText(target),
    innerHTML: () => locator.innerHTML(target),
    inputValue: () => locator.inputValue(target),
    isChecked: (options = {}) => locator.isChecked(target, options),
    isVisible: () => locator.isVisible(target),
    isHidden: () => locator.isHidden(target),
    isEnabled: () => locator.isEnabled(target),
    isDisabled: () => locator.isDisabled(target),
    isEditable: () => locator.isEditable(target),
    getAttribute: (name) => locator.getAttribute(target, name),
    boundingBox: () => locator.boundingBox(target),
    screenshot: async (options: any = {}) => {
      await waitForActionableElement(target, {
        timeout: options.timeout,
        visible: true,
        stable: true,
      });
      const box = await locator.boundingBox(target);
      if (!box) {
        throw new Error(
          `locator.screenshot target has no bounding box: ${selector}`,
        );
      }
      const info = await nav.pageInfo();
      if ("dialog" in info) {
        throw new Error(
          `locator.screenshot cannot capture while a JavaScript dialog is open: ${selector}`,
        );
      }
      return observe.screenshot({
        ...options,
        clip: {
          x: box.x + info.sx,
          y: box.y + info.sy,
          width: box.width,
          height: box.height,
        },
      });
    },
    ariaSnapshot: (options = {}) =>
      aria.ariaSnapshot(target, options, "locator.ariaSnapshot"),
    count: () => locator.count(target),
    allInnerTexts: () => locator.allInnerTexts(target),
    allTextContents: () => locator.allTextContents(target),
    evaluate: (pageFunction, arg = undefined) =>
      locator.evaluateLocator(target, pageFunction, arg),
    evaluateAll: (pageFunction, arg = undefined) =>
      locator.evaluateAll(target, pageFunction, arg),
    waitFor: async (options = {}) => {
      await waits.waitForSelector(target, options);
    },
  };
  return defineInternalState(facade, {
    selector,
    frameChain: [...frameChain],
    target,
  });
}

function createFrameLocator(selector, parentFrameChain: string[] = []) {
  const frameChain = [...parentFrameChain, String(selector)];
  const facade = {
    first: () =>
      createFrameLocator(nthSelector(String(selector), 0), parentFrameChain),
    last: () =>
      createFrameLocator(`internal:last;${String(selector)}`, parentFrameChain),
    nth: (index) => {
      const value = Number(index);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("frameLocator.nth requires a non-negative integer");
      }
      return createFrameLocator(
        nthSelector(String(selector), value),
        parentFrameChain,
      );
    },
    frameLocator: (child) => createFrameLocator(child, frameChain),
    locator: (child, options: any = {}) => {
      const childSelector = locatorSelector(child, frameChain);
      return createLocator(
        locatorOptionsSelector(childSelector, options, frameChain),
        frameChain,
      );
    },
    getByRole: (role, options: any = {}) =>
      createLocator(roleSelector(role, options), frameChain),
    getByText: (text, options: any = {}) =>
      createLocator(textSelector("text", text, options), frameChain),
    getByLabel: (text, options: any = {}) =>
      createLocator(textSelector("label", text, options), frameChain),
    getByPlaceholder: (text, options: any = {}) =>
      createLocator(textSelector("placeholder", text, options), frameChain),
    getByAltText: (text, options: any = {}) =>
      createLocator(textSelector("alt", text, options), frameChain),
    getByTitle: (text, options: any = {}) =>
      createLocator(textSelector("title", text, options), frameChain),
    getByTestId: (testId) => createLocator(testIdSelector(testId), frameChain),
  };
  return defineInternalState(facade, {
    selector: String(selector),
    frameChain,
  });
}

function nthSelector(selector, index) {
  return `internal:nth=${index};${selector}`;
}

function internalSelector(kind, data) {
  return `internal:${kind}:${encodeURIComponent(JSON.stringify(data))}`;
}

function scopedSelector(base, child) {
  return internalSelector("scope", { base, child });
}

function defineInternalState(facade, values) {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(facade, name, {
      value,
      enumerable: false,
    });
  }
  return facade;
}

function locatorSelector(value, expectedFrameChain?: string[]) {
  if (
    value &&
    typeof value === "object" &&
    typeof value.selector === "string"
  ) {
    if (
      expectedFrameChain &&
      Array.isArray(value.frameChain) &&
      !sameFrameChain(expectedFrameChain, value.frameChain)
    ) {
      throw new Error(
        "locator composition requires locators from the same frame",
      );
    }
    return value.selector;
  }
  return String(value);
}

function sameFrameChain(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((selector, index) => selector === right[index])
  );
}

function textSelector(prefix, text, options: any = {}) {
  if (text instanceof RegExp) {
    const value = encodeURIComponent(
      JSON.stringify({ source: text.source, flags: text.flags }),
    );
    return `loc=${prefix}:regex:${value}`;
  }
  const value = `${options.exact ? "exact:" : ""}${JSON.stringify(String(text))}`;
  return `loc=${prefix}:${value}`;
}

function roleSelector(role, options: any = {}) {
  const nameMatcher =
    options && Object.prototype.hasOwnProperty.call(options, "name")
      ? roleNameMatcher(options.name, Boolean(options.exact))
      : undefined;
  const stateKeys = [
    "checked",
    "disabled",
    "expanded",
    "includeHidden",
    "level",
    "pressed",
    "selected",
  ];
  if (
    stateKeys.some((key) => Object.prototype.hasOwnProperty.call(options, key))
  ) {
    const data: any = { role: String(role) };
    if (nameMatcher !== undefined) data.name = nameMatcher;
    for (const key of stateKeys) {
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        data[key] = options[key];
      }
    }
    return internalSelector("role", data);
  }
  const name =
    nameMatcher === undefined ? "" : `[name=${JSON.stringify(nameMatcher)}]`;
  return `loc=role:${role}${name}`;
}

function testIdSelector(testId) {
  return textSelector("testid", testId, { exact: true });
}

function filterSelector(base, options: any = {}, frameChain?: string[]) {
  const data: any = { base };
  if (Object.prototype.hasOwnProperty.call(options, "hasText")) {
    data.hasText = textMatcher(options.hasText);
  }
  if (Object.prototype.hasOwnProperty.call(options, "hasNotText")) {
    data.hasNotText = textMatcher(options.hasNotText);
  }
  if (options.has !== undefined) {
    data.has = locatorSelector(options.has, frameChain);
  }
  if (options.hasNot !== undefined) {
    data.hasNot = locatorSelector(options.hasNot, frameChain);
  }
  return internalSelector("filter", data);
}

function locatorOptionsSelector(
  base,
  options: any = {},
  frameChain?: string[],
) {
  const keys = ["hasText", "hasNotText", "has", "hasNot"];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(options, key))
    ? filterSelector(base, options, frameChain)
    : base;
}

function textMatcher(value) {
  if (value instanceof RegExp) {
    return { regex: value.source, flags: value.flags };
  }
  return { text: String(value), exact: false };
}

function roleNameMatcher(value, exact = false) {
  if (value instanceof RegExp) {
    return { regex: value.source, flags: value.flags };
  }
  return { text: String(value), exact };
}

function createPageFacade() {
  return {
    setDefaultTimeout: (timeout) => {
      const value = Number(timeout);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          "page.setDefaultTimeout requires a non-negative number",
        );
      }
      state.defaultTimeout = value;
    },
    setDefaultNavigationTimeout: (timeout) => {
      const value = Number(timeout);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          "page.setDefaultNavigationTimeout requires a non-negative number",
        );
      }
      state.defaultNavigationTimeout = value;
    },
    goto: nav.goto,
    reload: nav.reload,
    info: nav.pageInfo,
    url: async () => (await nav.pageInfo()).url,
    title: async () => (await nav.pageInfo()).title,
    locator: (selector, options: any = {}) =>
      createLocator(locatorOptionsSelector(selector, options, [])),
    frameLocator: createFrameLocator,
    getByRole: (role, options: any = {}) => {
      return createLocator(roleSelector(role, options));
    },
    getByText: (text, options: any = {}) =>
      createLocator(textSelector("text", text, options)),
    getByLabel: (text, options: any = {}) =>
      createLocator(textSelector("label", text, options)),
    getByPlaceholder: (text, options: any = {}) =>
      createLocator(textSelector("placeholder", text, options)),
    getByAltText: (text, options: any = {}) =>
      createLocator(textSelector("alt", text, options)),
    getByTitle: (text, options: any = {}) =>
      createLocator(textSelector("title", text, options)),
    getByTestId: (testId) => createLocator(testIdSelector(testId)),
    waitForTimeout: waits.waitForTimeout,
    waitForLoadState: waits.waitForLoadState,
    waitForSelector: waits.waitForSelector,
    waitForFunction: waits.waitForFunction,
    waitForURL: waits.waitForURL,
    waitForRequest: waits.waitForRequest,
    waitForResponse: waits.waitForResponse,
    waitForEvent: downloads.waitForEvent,
    evaluate,
    screenshot: observe.screenshot,
    saveScreenshot: observe.saveScreenshot,
    snapshot: observe.snapshot,
    snapshotRaw: observe.snapshotRaw,
    ariaSnapshot: (options = {}) =>
      aria.ariaSnapshot("body", options, "page.ariaSnapshot"),
    elementCenter: observe.elementCenter,
    drainEvents: observe.drainEvents,
    screencast: {
      start: screencast.startScreencast,
      stop: screencast.stopScreencast,
    },
    keyboard: {
      press: keyboard.press,
      down: keyboard.down,
      up: keyboard.up,
      insertText: keyboard.insertText,
      type: keyboard.typeText,
    },
    mouse: {
      click: (x, y, options = {}) => {
        const [target, effectiveOptions] = mousePointArgs(x, y, options);
        return pointer.click(target, effectiveOptions);
      },
      dblclick: (x, y, options = {}) => {
        const [target, effectiveOptions] = mousePointArgs(x, y, options);
        return pointer.dblclick(target, effectiveOptions);
      },
      move: (x, y, options = {}) => pointer.move(x, y, options),
      down: pointer.down,
      up: pointer.up,
      wheel: pointer.wheel,
      drag: pointer.drag,
    },
  };
}

function mousePointArgs(x, y, options) {
  if (Array.isArray(x) || (x && typeof x === "object")) {
    return [x, y || {}];
  }
  return [[x, y], options || {}];
}

function createTabsFacade() {
  return {
    list: nav.listTabs,
    current: nav.currentTab,
    activate: nav.switchTab,
    open: nav.openTab,
    openOrReuse: nav.openOrReuseTab,
    close: nav.closeTab,
    evaluate: nav.evaluateTab,
  };
}

function createTaskSpacesFacade() {
  return {
    list: listTaskSpaces,
    switch: switchTaskSpace,
    new: newTaskSpace,
    useOrCreate: useOrCreateTaskSpace,
    claim: claimTaskSpace,
    complete: completeTaskSpace,
    handOff: handOffTaskSpace,
    takeOver: takeOverTaskSpace,
    waitForAgentControl,
  };
}

function createSiteFacade() {
  return {
    skills: siteSkills,
    skillsForUrl: siteSkillsForUrl,
    runTool: runSiteTool,
    runBrowserTool: runSiteBrowserTool,
    learnContext,
  };
}

const FACADE_HELP: Record<string, string> = {
  page: "page: Playwright-style page facade. page.url() asynchronously returns the current URL; always call await page.url(). page.goto() and page.reload() return a main-document Response or null. Use page.setDefaultTimeout(ms), page.setDefaultNavigationTimeout(ms), locators, Playwright-style waits and supported page events, page.evaluate(fnOrExpression, arg), page.ariaSnapshot(options), page.screenshot(options) for a Buffer, page.saveScreenshot(options) for a path, page.screencast, page.keyboard, and page.mouse. waitForEvent, waitForRequest, and waitForResponse predicates may be async; waitForEvent also accepts AbortSignal cancellation. waitForURL predicates receive URL objects and waitUntil defaults to load. Wait timeouts throw TimeoutError.",
  locator:
    "page.locator(selector): returns a strict locator facade with locator(), getByRole(), getByText(), filter(), and(), or(), first(), nth(index), last(), actionability-aware click(), hover(), dragTo(), fill(), focus(), check(), setChecked(), selectOption(), file upload, state/collection reads, evaluation, Buffer screenshots, and waitFor({ state: 'visible'|'attached'|'hidden'|'detached' }). Narrow multiple matches; use first()/nth() only for confirmed legitimate duplicates.",
  tabs: "tabs: ego-browser tab facade. list(), current(), open(), openOrReuse(), and activate() return { targetId, url, title, type: 'page' }. Use open(url, options) to always create a tab, or openOrReuse(url, options) to select a match when available. Use close(target) and evaluate(target, pageFunction, arg) for an explicit tab. Treat targetId as short-lived: obtain and validate it in the current script.",
  taskSpaces:
    "taskSpaces: task-space facade. Use taskSpaces.useOrCreate(nameOrId), taskSpaces.claim(nameOrId), taskSpaces.switch(nameOrId), taskSpaces.complete(nameOrId, options), taskSpaces.handOff(nameOrId), taskSpaces.takeOver(nameOrId), and taskSpaces.waitForAgentControl(nameOrId, options). waitForAgentControl interval and timeout use milliseconds.",
  site: "site: learned site-skill facade. Use site.skills(url), site.skillsForUrl(url), site.runTool(siteId, toolName, args), site.runBrowserTool(siteId, toolName, args), and site.learnContext(url).",
  fetch:
    "fetch: network facade. Use fetch.server(url, options) for Node-side fetch and fetch.browser(url, options) for browser-origin fetch. timeout uses milliseconds.",
  cdp: "cdp: direct Chrome DevTools Protocol access for capabilities not covered by the public facade.",
  help: "help(name?): runtime documentation for public facade namespaces and exact public paths.",
};

export function helperContext(extra: any = {}) {
  const all = {
    page: createPageFacade(),
    tabs: createTabsFacade(),
    taskSpaces: createTaskSpacesFacade(),
    site: createSiteFacade(),
    fetch: {
      server: serverFetch,
      browser: browserFetch,
    },
    cdp,
    ...extra,
  };
  return {
    ...all,
    help: (...names: string[]) => {
      if (names.length === 1 && FACADE_HELP[names[0]]) {
        const details = helpRuntime(all, names[0]);
        const rendered =
          typeof details === "string"
            ? details
            : Array.isArray(details)
              ? details
                  .map((item) =>
                    typeof item === "string" ? item : formatHelp(item),
                  )
                  .join("\n\n")
              : formatHelp(details);
        return `${FACADE_HELP[names[0]]}\n\n${rendered}`;
      }
      if (names.length === 0) {
        return Object.values(FACADE_HELP).join("\n\n");
      }
      const result = helpRuntime(all, ...names);
      if (typeof result === "string") return result;
      if (Array.isArray(result)) {
        return result
          .map((item) => (typeof item === "string" ? item : formatHelp(item)))
          .join("\n\n");
      }
      return formatHelp(result);
    },
  };
}

export async function loadAgentHelpers() {
  const path = join(state.agentWorkspace(), "agent_helpers.js");
  if (!existsSync(path)) {
    return {};
  }
  const module = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
  const out: Record<string, any> = {};
  for (const [name, value] of Object.entries(module)) {
    if (!name.startsWith("_")) {
      out[name] = value;
    }
  }
  return out;
}

export const __testing = { setOverrides, decodeUnserializableJsValue };
