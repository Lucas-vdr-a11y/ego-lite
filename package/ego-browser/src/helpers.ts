import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { setOverrides, state } from "./state.js";
import { parseAriaRef } from "./aria-ref-map.js";
import { assertNoEgoError, isEgoUserControlError } from "./ego-errors.js";
import { help as helpRuntime, formatHelp } from "./help-runtime.js";
import { targetClosedError } from "./playwright-errors.js";
import { isBrowserRuntime, subscribeBrowserEvent } from "./browser-runtime.js";
import { cdp, decodeUnserializableJsValue, evaluate } from "./cdp-eval.js";
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
import { parseRef } from "./ref-map.js";
import { browserFetch, serverFetch } from "./http.js";
import { createPageNetworkController } from "./page-network.js";
import { createPageScriptController } from "./page-scripts.js";
import { createPageClock } from "./page-clock.js";
import { createPageEnvironmentController } from "./page-environment.js";
import { createPageHandleController } from "./page-handles.js";
import { createPageFrameController } from "./page-frames.js";
import {
  createTargetContext,
  runWithTarget,
  type TargetContext,
} from "./target-context.js";
import {
  loadBrowserToolSource,
  loadLearnedContext,
  runNodeSiteTool,
  siteSkillsForUrl as siteSkillsForUrlCore,
  wrapBrowserTool,
} from "./learning/index.js";

const pageByTargetContext = new WeakMap<TargetContext, any>();
const initializePageState = Symbol("initializePageState");
let globalPageFacade: any;

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
  selectText,
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
  goBack,
  goForward,
  content,
  setContent,
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

let selectedTaskSpaceId: number | null = null;

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
  const id = taskSpaceNumericId(space, op);
  assertNoEgoError(await ego.useTaskSpace(id), op);
  selectedTaskSpaceId = id;
  return space;
}

async function ensureTaskSpaceSelected(space) {
  const id = taskSpaceNumericId(space, "TaskSpace");
  if (selectedTaskSpaceId !== id) {
    await switchTaskSpace(id);
  }
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
  selectedTaskSpaceId = null;
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

function createLocator(
  selector,
  frameChain: string[] = [],
  targetContext?: TargetContext,
) {
  const target = locatorTarget(selector, frameChain);
  const facade = {
    all: async () => {
      const length = await locator.count(target);
      return Array.from({ length }, (_, index) =>
        createLocator(
          isDirectRefSelector(selector)
            ? selector
            : nthSelector(selector, index),
          frameChain,
          targetContext,
        ),
      );
    },
    first: () =>
      createLocator(nthSelector(selector, 0), frameChain, targetContext),
    last: () =>
      createLocator(`internal:last;${selector}`, frameChain, targetContext),
    nth: (index) => {
      const value = Number(index);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("locator.nth requires a non-negative integer");
      }
      return createLocator(
        nthSelector(selector, value),
        frameChain,
        targetContext,
      );
    },
    and: (other) =>
      createLocator(
        internalSelector("and", {
          left: selector,
          right: locatorSelector(other, frameChain),
        }),
        frameChain,
        targetContext,
      ),
    or: (other) =>
      createLocator(
        internalSelector("or", {
          left: selector,
          right: locatorSelector(other, frameChain),
        }),
        frameChain,
        targetContext,
      ),
    locator: (child, options: any = {}) => {
      const scoped = scopedSelector(
        selector,
        locatorSelector(child, frameChain),
      );
      return createLocator(
        locatorOptionsSelector(scoped, options, frameChain),
        frameChain,
        targetContext,
      );
    },
    contentFrame: () => createFrameLocator(selector, frameChain, targetContext),
    frameLocator: (child) =>
      createFrameLocator(
        scopedSelector(selector, String(child)),
        frameChain,
        targetContext,
      ),
    getByRole: (role, options: any = {}) =>
      createLocator(
        scopedSelector(selector, roleSelector(role, options)),
        frameChain,
        targetContext,
      ),
    getByText: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("text", text, options)),
        frameChain,
        targetContext,
      ),
    getByLabel: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("label", text, options)),
        frameChain,
        targetContext,
      ),
    getByPlaceholder: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("placeholder", text, options)),
        frameChain,
        targetContext,
      ),
    getByAltText: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("alt", text, options)),
        frameChain,
        targetContext,
      ),
    getByTitle: (text, options: any = {}) =>
      createLocator(
        scopedSelector(selector, textSelector("title", text, options)),
        frameChain,
        targetContext,
      ),
    getByTestId: (testId) =>
      createLocator(
        scopedSelector(selector, testIdSelector(testId)),
        frameChain,
        targetContext,
      ),
    filter: (options: any = {}) =>
      createLocator(
        filterSelector(selector, options, frameChain),
        frameChain,
        targetContext,
      ),
    click: (options = {}) =>
      pointer.click(target, {
        ...options,
        __apiName: "locator.click",
        __waitForNavigation: true,
      }),
    dblclick: (options = {}) =>
      pointer.dblclick(target, {
        ...options,
        __apiName: "locator.dblclick",
      }),
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
    check: (options = {}) => keyboard.check(target, options),
    uncheck: (options = {}) => keyboard.uncheck(target, options),
    setChecked: (checked, options = {}) =>
      keyboard.setChecked(target, checked, options),
    selectOption: (values, options = {}) =>
      keyboard.selectOption(target, values, options),
    setInputFiles: (filesValue, options = {}) =>
      files.setInputFiles(target, filesValue, options),
    dispatchEvent: (type, eventInit = {}, options = {}) =>
      keyboard.dispatchEvent(target, type, eventInit, options),
    blur: () => locator.blur(target),
    selectText: async (options: any = {}) => {
      await waitForActionableElement(target, {
        timeout: options.timeout,
        visible: true,
      });
      await locator.selectText(target, options);
    },
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
    evaluateHandle: (pageFunction, arg = undefined) =>
      locator.evaluateLocatorHandle(target, pageFunction, arg),
    page: () =>
      targetContext ? pageByTargetContext.get(targetContext) : globalPageFacade,
    waitFor: async (options = {}) => {
      await waits.waitForSelector(target, options);
    },
  };
  return bindFacadeToTarget(
    defineInternalState(facade, {
      selector,
      frameChain: [...frameChain],
      target,
    }),
    targetContext,
  );
}

function isDirectRefSelector(selector) {
  return Boolean(parseRef(selector) || parseAriaRef(selector));
}

function createFrameLocator(
  selector,
  parentFrameChain: string[] = [],
  targetContext?: TargetContext,
) {
  const frameChain = [...parentFrameChain, String(selector)];
  const facade = {
    owner: () =>
      createLocator(String(selector), parentFrameChain, targetContext),
    first: () =>
      createFrameLocator(
        nthSelector(String(selector), 0),
        parentFrameChain,
        targetContext,
      ),
    last: () =>
      createFrameLocator(
        `internal:last;${String(selector)}`,
        parentFrameChain,
        targetContext,
      ),
    nth: (index) => {
      const value = Number(index);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("frameLocator.nth requires a non-negative integer");
      }
      return createFrameLocator(
        nthSelector(String(selector), value),
        parentFrameChain,
        targetContext,
      );
    },
    frameLocator: (child) =>
      createFrameLocator(child, frameChain, targetContext),
    locator: (child, options: any = {}) => {
      const childSelector = locatorSelector(child, frameChain);
      return createLocator(
        locatorOptionsSelector(childSelector, options, frameChain),
        frameChain,
        targetContext,
      );
    },
    getByRole: (role, options: any = {}) =>
      createLocator(roleSelector(role, options), frameChain, targetContext),
    getByText: (text, options: any = {}) =>
      createLocator(
        textSelector("text", text, options),
        frameChain,
        targetContext,
      ),
    getByLabel: (text, options: any = {}) =>
      createLocator(
        textSelector("label", text, options),
        frameChain,
        targetContext,
      ),
    getByPlaceholder: (text, options: any = {}) =>
      createLocator(
        textSelector("placeholder", text, options),
        frameChain,
        targetContext,
      ),
    getByAltText: (text, options: any = {}) =>
      createLocator(
        textSelector("alt", text, options),
        frameChain,
        targetContext,
      ),
    getByTitle: (text, options: any = {}) =>
      createLocator(
        textSelector("title", text, options),
        frameChain,
        targetContext,
      ),
    getByTestId: (testId) =>
      createLocator(testIdSelector(testId), frameChain, targetContext),
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

function createPageFacade(target?: {
  targetId: string;
  url?: string;
  beforeOperation?: () => Promise<void>;
  openerId?: string;
}) {
  const targetContext = target
    ? createTargetContext(
        target.targetId,
        target.beforeOperation,
        target.openerId,
      )
    : undefined;
  const targetId = targetContext?.targetId;
  let currentUrl = target?.url || "";
  let frameController: ReturnType<typeof createPageFrameController> | undefined;
  let environmentController:
    | ReturnType<typeof createPageEnvironmentController>
    | undefined;
  const updateBasicState = (info) => {
    if (typeof info?.url === "string") currentUrl = info.url;
    environmentController?.updateViewportSize(info);
    return info;
  };
  const readPageInfo = async () => updateBasicState(await nav.pageInfo());
  const boundSnapshotRaw = targetContext
    ? (options = {}) =>
        captureTargetSnapshot(targetContext, () => observe.snapshotRaw(options))
    : observe.snapshotRaw;
  const boundSnapshot = targetContext
    ? (options = {}) =>
        captureTargetSnapshot(targetContext, () => observe.snapshot(options))
    : observe.snapshot;
  if (targetContext) {
    targetContext.snapshotForRefRefresh = () => boundSnapshotRaw();
  }
  let removeClosedListener: (() => void) | undefined;
  if (targetContext) {
    removeClosedListener = subscribeBrowserEvent(
      "Target.targetDestroyed",
      undefined,
      (event) => {
        if (event.params?.targetId !== targetContext.targetId) return;
        targetContext.closed = true;
        removeClosedListener?.();
        removeClosedListener = undefined;
      },
    );
  }
  const facade: any = {
    ...(targetId ? { targetId } : {}),
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
    goBack: nav.goBack,
    goForward: nav.goForward,
    content: nav.content,
    setContent: nav.setContent,
    info: readPageInfo,
    url: () => frameController?.url() || currentUrl,
    title: async () => (await readPageInfo()).title,
    locator: (selector, options: any = {}) =>
      createLocator(
        locatorOptionsSelector(selector, options, []),
        [],
        targetContext,
      ),
    frameLocator: (selector) => createFrameLocator(selector, [], targetContext),
    getByRole: (role, options: any = {}) => {
      return createLocator(roleSelector(role, options), [], targetContext);
    },
    getByText: (text, options: any = {}) =>
      createLocator(textSelector("text", text, options), [], targetContext),
    getByLabel: (text, options: any = {}) =>
      createLocator(textSelector("label", text, options), [], targetContext),
    getByPlaceholder: (text, options: any = {}) =>
      createLocator(
        textSelector("placeholder", text, options),
        [],
        targetContext,
      ),
    getByAltText: (text, options: any = {}) =>
      createLocator(textSelector("alt", text, options), [], targetContext),
    getByTitle: (text, options: any = {}) =>
      createLocator(textSelector("title", text, options), [], targetContext),
    getByTestId: (testId) =>
      createLocator(testIdSelector(testId), [], targetContext),
    waitForTimeout: waits.waitForTimeout,
    waitForLoadState: waits.waitForLoadState,
    waitForSelector: waits.waitForSelector,
    waitForFunction: waits.waitForFunction,
    waitForURL: waits.waitForURL,
    waitForRequest: waits.waitForRequest,
    waitForResponse: waits.waitForResponse,
    waitForEvent: (eventName, optionsOrPredicate = {}) =>
      downloads.waitForEvent(eventName, optionsOrPredicate, {
        createPopup: async (targetInfo) => {
          const popup = createPageFacade({
            targetId: targetInfo.targetId,
            url: targetInfo.url,
            beforeOperation: target?.beforeOperation,
            openerId: targetInfo.openerId,
          });
          if (isBrowserRuntime()) await initializePageFacade(popup);
          return popup;
        },
        page: facade,
      }),
    evaluate,
    screenshot: observe.screenshot,
    saveScreenshot: observe.saveScreenshot,
    snapshot: boundSnapshot,
    snapshotRaw: boundSnapshotRaw,
    ariaSnapshot: (options = {}) =>
      aria.ariaSnapshot("body", options, "page.ariaSnapshot"),
    elementCenter: observe.elementCenter,
    drainEvents: targetId
      ? () => activeGlobalPageOnly("page.drainEvents")
      : observe.drainEvents,
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
        return pointer.click(target, {
          ...effectiveOptions,
          __apiName: "mouse.click",
        });
      },
      dblclick: (x, y, options = {}) => {
        const [target, effectiveOptions] = mousePointArgs(x, y, options);
        return pointer.dblclick(target, {
          ...effectiveOptions,
          __apiName: "mouse.dblclick",
        });
      },
      move: (x, y, options = {}) => pointer.move(x, y, options),
      down: pointer.down,
      up: pointer.up,
      wheel: pointer.wheel,
      drag: pointer.drag,
    },
    close: async (options: any = {}) => {
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("page.close options must be an object");
      }
      if (options.runBeforeUnload) {
        await cdp("Page.close");
      } else {
        await nav.closeTab(targetId ? { targetId } : undefined);
      }
      if (targetContext) targetContext.closed = true;
      removeClosedListener?.();
      removeClosedListener = undefined;
    },
    bringToFront: async () => {
      if (targetContext) {
        await activateTargetPage(targetContext);
        return;
      }
      await nav.switchTab(await nav.currentTab());
    },
    isClosed: () => Boolean(targetContext?.closed),
    opener: async () => {
      const pageTargetId = targetId || (await nav.currentTab()).targetId;
      const openerId =
        targetContext?.openerId ||
        (
          await cdp("Target.getTargetInfo", {
            targetId: pageTargetId,
          })
        ).targetInfo?.openerId;
      if (!openerId) return null;
      const opener = createPageFacade({
        targetId: openerId,
        beforeOperation: target?.beforeOperation,
      });
      if (isBrowserRuntime()) await initializePageFacade(opener);
      return opener;
    },
  };
  const scripts = createPageScriptController(facade);
  const network = createPageNetworkController(facade, scripts);
  const frames = createPageFrameController(facade, {
    initialUrl: currentUrl,
    sessionId: () => targetContext?.sessionId || state.sessionId || undefined,
    onMainFrameUrl: (url) => {
      currentUrl = url;
    },
  });
  const environment = createPageEnvironmentController();
  frameController = frames;
  environmentController = environment;
  const handles = createPageHandleController();
  if (targetContext) pageByTargetContext.set(targetContext, facade);
  else globalPageFacade = facade;
  Object.assign(facade, {
    route: network.route,
    unroute: network.unroute,
    unrouteAll: network.unrouteAll,
    routeFromHAR: network.routeFromHAR,
    routeWebSocket: network.routeWebSocket,
    setExtraHTTPHeaders: async (headers) => {
      if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
        throw new TypeError(
          "page.setExtraHTTPHeaders expects a headers object",
        );
      }
      const normalized = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [
          String(name),
          String(value),
        ]),
      );
      await cdp("Network.enable");
      await cdp("Network.setExtraHTTPHeaders", { headers: normalized });
    },
    addInitScript: scripts.addInitScript,
    exposeFunction: scripts.exposeFunction,
    exposeBinding: scripts.exposeBinding,
    frames: frames.frames,
    frame: frames.frame,
    mainFrame: frames.mainFrame,
    setViewportSize: environment.setViewportSize,
    viewportSize: environment.viewportSize,
    emulateMedia: environment.emulateMedia,
    requestGC: () => cdp("HeapProfiler.collectGarbage"),
    clock: createPageClock(),
    evaluateHandle: handles.evaluateHandle,
    addScriptTag: handles.addScriptTag,
    addStyleTag: handles.addStyleTag,
  });
  Object.defineProperty(facade, initializePageState, {
    value: () =>
      targetContext
        ? runWithTarget(targetContext, async () => {
            await Promise.allSettled([frames.initialize(), readPageInfo()]);
          })
        : Promise.allSettled([frames.initialize(), readPageInfo()]).then(
            () => undefined,
          ),
  });
  installPageEventEmitter(facade, targetContext, target);
  return bindFacadeToTarget(facade, targetContext);
}

export async function initializePageFacade(page) {
  await page?.[initializePageState]?.();
  return page;
}

function installPageEventEmitter(
  page,
  targetContext?: TargetContext,
  target?: { beforeOperation?: () => Promise<void> },
) {
  type ListenerRecord = {
    eventName: string;
    listener: (...args: any[]) => any;
    once: boolean;
    controller: AbortController;
    active: boolean;
    task?: Promise<void>;
  };
  const records = new Set<ListenerRecord>();

  const remove = (record: ListenerRecord) => {
    if (!record.active) return;
    record.active = false;
    records.delete(record);
    record.controller.abort();
  };

  const arm = (record: ListenerRecord) => {
    if (!record.active) return;
    record.task = downloads
      .waitForEvent(
        record.eventName,
        { timeout: 0, signal: record.controller.signal },
        {
          createPopup: async (targetInfo) => {
            const popup = createPageFacade({
              targetId: targetInfo.targetId,
              url: targetInfo.url,
              beforeOperation: target?.beforeOperation,
              openerId: targetInfo.openerId,
            });
            if (isBrowserRuntime()) await initializePageFacade(popup);
            return popup;
          },
          page,
        },
      )
      .then((value) => {
        if (!record.active) return;
        if (record.once) remove(record);
        else arm(record);
        return record.listener(value);
      })
      .catch((error) => {
        if (!record.controller.signal.aborted) {
          queueMicrotask(() => {
            throw error;
          });
        }
      });
  };

  const add = (eventName, listener, once) => {
    if (typeof listener !== "function") {
      throw new TypeError("page event listener must be a function");
    }
    const record: ListenerRecord = {
      eventName: String(eventName),
      listener,
      once,
      controller: new AbortController(),
      active: true,
    };
    records.add(record);
    queueMicrotask(() => {
      if (targetContext) {
        runWithTarget(targetContext, () => arm(record));
      } else {
        arm(record);
      }
    });
    return page;
  };

  page.on = (eventName, listener) => add(eventName, listener, false);
  page.once = (eventName, listener) => add(eventName, listener, true);
  page.off = (eventName, listener) => {
    for (const record of records) {
      if (
        record.eventName === String(eventName) &&
        record.listener === listener
      ) {
        remove(record);
      }
    }
    return page;
  };
  page.removeAllListeners = (eventName = undefined, options = undefined) => {
    const selected = [...records].filter(
      (record) =>
        eventName === undefined || record.eventName === String(eventName),
    );
    for (const record of selected) remove(record);
    if (options?.behavior === "wait") {
      return Promise.allSettled(
        selected.map((record) => record.task).filter(Boolean),
      ).then(() => undefined);
    }
    return page;
  };
}

let targetSnapshotQueue = Promise.resolve();

function captureTargetSnapshot<T>(
  targetContext: TargetContext,
  capture: () => Promise<T>,
): Promise<T> {
  const result = targetSnapshotQueue.then(() =>
    runWithTarget(targetContext, async () => {
      await activateTargetPage(targetContext);
      return capture();
    }),
  );
  targetSnapshotQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function activateTargetPage(targetContext: TargetContext) {
  await targetContext.beforeOperation?.();
  try {
    await nav.switchTab(targetContext.targetId);
  } catch (error) {
    if (/^tabs\.activate target not found:/.test(error?.message || "")) {
      throw targetClosedError(targetContext.targetId);
    }
    throw error;
  }
}

function activeGlobalPageOnly(apiName: string): never {
  throw new Error(`${apiName} is available only on the active global page`);
}

function bindFacadeToTarget<T extends object>(
  facade: T,
  targetContext?: TargetContext,
): T {
  if (!targetContext) return facade;
  for (const [name, value] of Object.entries(facade)) {
    if (typeof value === "function") {
      facade[name] = (...args) =>
        runWithTarget(targetContext, () => value(...args));
    } else if (value && typeof value === "object") {
      bindFacadeToTarget(value, targetContext);
    }
  }
  return facade;
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

function createEgoBrowserFacade() {
  const wrapTaskSpace = (space) => ({
    ...space,
    tabs: createTaskSpaceTabsFacade(space),
  });
  return {
    listTaskSpaces,
    newTaskSpace: async (name) => wrapTaskSpace(await newTaskSpace(name)),
    switchTaskSpace: async (nameOrId) =>
      wrapTaskSpace(await switchTaskSpace(nameOrId)),
    useOrCreateTaskSpace: async (nameOrId) =>
      wrapTaskSpace(await useOrCreateTaskSpace(nameOrId)),
    claimTaskSpace: async (nameOrId) =>
      wrapTaskSpace(await claimTaskSpace(nameOrId)),
    handOffTaskSpace,
    takeOverTaskSpace,
    waitForAgentControlTaskSpace: waitForAgentControl,
    completeTaskSpace: async (nameOrId) => {
      const result = await completeTaskSpace(nameOrId, { keep: true });
      if (!result.done) {
        throw new Error(
          `egoBrowser.completeTaskSpace did not complete TaskSpace ${String(nameOrId)}: ${result.skipped || "unknown reason"}`,
        );
      }
    },
    closeTaskSpace: async (nameOrId) => {
      const result = await completeTaskSpace(nameOrId, { keep: false });
      if (!result.done) {
        throw new Error(
          `egoBrowser.closeTaskSpace did not close TaskSpace ${String(nameOrId)}: ${result.skipped || "unknown reason"}`,
        );
      }
    },
  };
}

function createTaskSpaceTabsFacade(space) {
  const inTaskSpace = async (operation) => {
    await ensureTaskSpaceSelected(space);
    return operation();
  };
  const wrapTab = async (tab) => {
    const page = createPageFacade({
      targetId: tab.targetId,
      url: tab.url,
      beforeOperation: () => ensureTaskSpaceSelected(space),
    });
    if (isBrowserRuntime()) await initializePageFacade(page);
    const facade = { ...tab };
    Object.defineProperties(facade, {
      page: { value: page },
      activate: {
        value: async () =>
          wrapTab(await inTaskSpace(() => nav.switchTab(tab.targetId))),
      },
      close: {
        value: () => inTaskSpace(() => nav.closeTab(tab.targetId)),
      },
    });
    return facade;
  };
  return {
    list: async (options = {}) =>
      Promise.all(
        (await inTaskSpace(() => nav.listTabs(options))).map(wrapTab),
      ),
    current: async () => wrapTab(await inTaskSpace(() => nav.currentTab())),
    activate: async (target) =>
      wrapTab(await inTaskSpace(() => nav.switchTab(target))),
    open: async (url = "about:blank", options = {}) =>
      wrapTab(await inTaskSpace(() => nav.openTab(url, options))),
    openOrReuse: async (url, options = {}) =>
      wrapTab(await inTaskSpace(() => nav.openOrReuseTab(url, options))),
    close: (target = undefined) => inTaskSpace(() => nav.closeTab(target)),
    evaluate: (target, pageFunction, arg = undefined) =>
      inTaskSpace(() => nav.evaluateTab(target, pageFunction, arg)),
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
  page: "page: Playwright-style page facade. Navigation returns a main-document Response or null. Use locators, waits, on/once/off events, route/unroute, init scripts and bindings, evaluate/evaluateHandle, requestGC, screenshots, ARIA/snapshot, viewport/media emulation, page.clock, keyboard, and mouse. A popup returns a target-bound Page with close(), isClosed(), opener(), and bringToFront(). waitForEvent and event listeners support close, load, domcontentloaded, request, response, requestfailed, requestfinished, console, dialog, download, filechooser, pageerror, and popup. Predicates may be async; waitForEvent also accepts AbortSignal cancellation. Wait timeouts throw TimeoutError.",
  locator:
    "page.locator(selector): returns a strict locator facade with locator(), all(), frameLocator(), contentFrame(), getByRole(), getByText(), filter(), and(), or(), first(), nth(index), last(), actionability-aware actions, state/collection reads, evaluate/evaluateAll/evaluateHandle, page(), Buffer screenshots, and waitFor(). FrameLocator.owner() returns its iframe element. Narrow multiple matches; use first()/nth() only for confirmed legitimate duplicates.",
  tabs: "tabs: ego-browser tab facade. list(), current(), open(), openOrReuse(), and activate() return { targetId, url, title, type: 'page' }. Use open(url, options) to always create a tab, or openOrReuse(url, options) to select a match when available. open/openOrReuse accept waitUntil: 'load' (default), 'domcontentloaded', or 'commit'; wait: false is the legacy spelling for commit. Use close(target) and evaluate(target, pageFunction, arg) for an explicit tab. Treat targetId as short-lived: obtain and validate it in the current script.",
  egoBrowser:
    "egoBrowser: ego-specific TaskSpace controller, not a Playwright Browser. listTaskSpaces() returns lightweight TaskSpace information without selecting a space. newTaskSpace(name), switchTaskSpace(nameOrId), useOrCreateTaskSpace(nameOrId), and claimTaskSpace(nameOrId) return a TaskSpace whose space.tabs methods return Tab objects with target-bound tab.page facades. handOffTaskSpace(), takeOverTaskSpace(), and waitForAgentControlTaskSpace() manage manual control. waitForAgentControlTaskSpace interval and timeout use milliseconds. completeTaskSpace(nameOrId) and closeTaskSpace(nameOrId) return Promise<void> and throw on failure; complete preserves the final result while close destroys the space.",
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
    egoBrowser: createEgoBrowserFacade(),
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
