import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { setOverrides, state } from "./state.js";
import { assertNoEgoError, isEgoUserControlError } from "./ego-errors.js";
import { help as helpRuntime, formatHelp } from "./help-runtime.js";
import { cdp, decodeUnserializableJsValue, evaluate } from "./cdp-eval.js";
import { browserFetch, serverFetch } from "./http.js";
import {
  connectPlaywrightTaskSpace,
  disconnectPlaywrightTaskSpace,
  disconnectPlaywrightTaskSpaceForSelection,
  setPlaywrightTaskSpaceConnector,
} from "./playwright/taskspace.js";
import {
  acquireTaskSpaceLease,
  releaseTaskSpaceLease,
} from "./taskspace-lease.js";
import {
  loadBrowserToolSource,
  loadLearnedContext,
  runNodeSiteTool,
  siteSkillsForUrl as siteSkillsForUrlCore,
  wrapBrowserTool,
} from "./learning/index.js";

const nativeFetch = globalThis.fetch?.bind(globalThis);

export { NAME } from "./state.js";
export { cdp } from "./cdp-eval.js";
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

/**
 * List browser profiles available for new task spaces.
 * @returns {Promise<Array<{id:string,name:string,isDefault:boolean}>>}
 */
export async function listProfiles() {
  const ego = globalThis.ego;
  if (!ego || typeof ego.listProfiles !== "function") {
    throw new Error("listProfiles requires ego.listProfiles");
  }
  const result = assertNoEgoError(await ego.listProfiles(), "listProfiles");
  if (!Array.isArray(result?.profiles)) {
    throw new Error("listProfiles expected { profiles: [...] }");
  }
  return result.profiles;
}

/**
 * Show user-visible task progress for the current TaskSpace.
 * @param {string} state Concise action description.
 * @returns {Promise<unknown>} Native task-state update result.
 */
export async function showTaskState(state: string) {
  const ego = globalThis.ego;
  if (!ego || typeof ego.setAgentTaskState !== "function") {
    throw new Error("showTaskState requires ego.setAgentTaskState");
  }
  return assertNoEgoError(await ego.setAgentTaskState(state), "showTaskState");
}

export type SnapshotOptions = {
  scope?: "full_page" | "only_within_viewport";
  includeActionMarks?: boolean;
  interactiveOnly?: boolean;
  includeStableLocator?: boolean;
  maxResultLength?: number;
};

export type SnapshotResult = {
  content: string;
  refs: Array<{
    backendNodeId: number;
    role?: string;
    name?: string;
    loc?: string;
  }>;
};

/**
 * Capture a structured snapshot for the current TaskSpace.
 * @param {SnapshotOptions} [options] Native snapshot options. Defaults to the full page.
 * @returns {Promise<SnapshotResult>} Structured snapshot content and reference metadata.
 */
export async function snapshot(
  options?: SnapshotOptions,
): Promise<SnapshotResult> {
  const ego = globalThis.ego;
  if (!ego || typeof ego.snapshot !== "function") {
    throw new Error("snapshot requires ego.snapshot");
  }
  const result =
    options === undefined ? await ego.snapshot() : await ego.snapshot(options);
  return assertNoEgoError(result, "snapshot");
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

export type TaskSpaceActionResult =
  | { done: true }
  | { done: false; skipped: "user-owned" };

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
 * @param {string} [profileId] Profile id returned by listProfiles().
 * @returns {Promise<{taskId:string,id:number,name:string,createdBy?:string,ownership?:string,recentTabTitles?:string[]}>}
 */
export async function newTaskSpace(name, profileId?: string) {
  const ego = globalThis.ego;
  if (!ego || typeof ego.createTaskSpace !== "function") {
    throw new Error("newTaskSpace requires ego.createTaskSpace");
  }
  const existing = (await listTaskSpaces()).find(
    (space) => space.name === name,
  );
  if (existing) {
    const id = taskSpaceNumericId(existing, "newTaskSpace");
    if (isAgentOwned(existing.ownership)) {
      throw new Error(
        `newTaskSpace cannot create ${JSON.stringify(name)}: TaskSpace ${id} already uses this name and is agent-owned; use egoBrowser.switchTaskSpace(${id}) or choose a unique name`,
      );
    }
    if (existing.ownership === "user") {
      throw new Error(
        `newTaskSpace cannot create ${JSON.stringify(name)}: TaskSpace ${id} already uses this name and is user-owned; choose a unique name or close it with egoBrowser.closeTaskSpace(${id})`,
      );
    }
    throw new Error(
      `newTaskSpace cannot create ${JSON.stringify(name)}: TaskSpace ${id} already uses this name with ownership ${JSON.stringify(existing.ownership)}`,
    );
  }
  const result =
    profileId === undefined
      ? await ego.createTaskSpace(name)
      : await ego.createTaskSpace(name, profileId);
  const created = normalizeTaskSpace(assertNoEgoError(result, "newTaskSpace"));
  if (!created) {
    throw new Error("newTaskSpace returned an invalid task space");
  }
  taskSpaceNumericId(created, "newTaskSpace");
  return selectTaskSpace(ego, created, "newTaskSpace");
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
  await disconnectPlaywrightTaskSpaceForSelection(space);
  await acquireTaskSpaceLease(id);
  try {
    assertNoEgoError(await ego.useTaskSpace(id), op);
  } catch (error) {
    releaseTaskSpaceLease(id);
    throw error;
  }
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
): Promise<TaskSpaceActionResult> {
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
export async function handOffTaskSpace(
  nameOrId?: string | number,
): Promise<TaskSpaceActionResult> {
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
    await state.sleep(interval);
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
  const targetUrl = url ?? (await currentTaskSpaceUrl());
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
  const targetUrl = url ?? (await currentTaskSpaceUrl());
  return loadLearnedContext(targetUrl, {
    agentWorkspace: state.agentWorkspace(),
  });
}

async function currentTaskSpaceUrl() {
  const ego = globalThis.ego;
  if (!ego || typeof ego.listTabs !== "function") return "";
  const result = assertNoEgoError(await ego.listTabs(), "listTabs");
  const tabs = result?.tabs || result?.targetInfos || [];
  return tabs.find((tab) => tab.active)?.url || tabs.at(-1)?.url || "";
}

function createEgoBrowserFacade(site) {
  const wrapTaskSpace = async (space) => {
    const id = taskSpaceNumericId(space, "TaskSpace Playwright connection");
    let playwright;
    try {
      playwright = await connectPlaywrightTaskSpace(space);
    } catch (error) {
      releaseTaskSpaceLease(id);
      throw error;
    }
    const task = {
      ...space,
    };
    delete task.tabs;
    Object.defineProperties(task, {
      page: { value: playwright.page },
      context: { value: playwright.context },
    });
    return task;
  };
  return {
    helper: egoBrowserHelper,
    site,
    showTaskState,
    snapshot,
    listProfile: listProfiles,
    listTaskSpace: listTaskSpaces,
    newTaskSpace: async (name, profileId) =>
      wrapTaskSpace(await newTaskSpace(name, profileId)),
    switchTaskSpace: async (nameOrId) =>
      wrapTaskSpace(await switchTaskSpace(nameOrId)),
    claimTaskSpace: async (nameOrId) =>
      wrapTaskSpace(await claimTaskSpace(nameOrId)),
    handOffTaskSpace: async (nameOrId) => {
      await disconnectPlaywrightTaskSpace();
      return handOffTaskSpace(nameOrId);
    },
    takeOverTaskSpace: async (nameOrId) => {
      await takeOverTaskSpace(nameOrId);
      return { done: true as const };
    },
    waitForAgentControlTaskSpace: async (nameOrId, options) => {
      await waitForAgentControl(nameOrId, options);
      return { done: true as const };
    },
    completeTaskSpace: async (nameOrId) => {
      await disconnectPlaywrightTaskSpace();
      return completeTaskSpace(nameOrId, { keep: true });
    },
    closeTaskSpace: async (nameOrId) => {
      await disconnectPlaywrightTaskSpace();
      return completeTaskSpace(nameOrId, { keep: false });
    },
  };
}

function createSiteFacade() {
  return {
    discover: siteSkills,
    skills: siteSkills,
    skillsForUrl: siteSkillsForUrl,
    runTool: runSiteTool,
    runBrowserTool: runSiteBrowserTool,
    learnContext,
  };
}

function egoBrowserHelper(name = "egoBrowser") {
  const canonicalName =
    name === "site"
      ? "egoBrowser.site"
      : name.startsWith("site.")
        ? `egoBrowser.${name}`
        : name;
  const result = helpRuntime({}, canonicalName);
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((item) => (typeof item === "string" ? item : formatHelp(item)))
      .join("\n\n");
  }
  return formatHelp(result);
}

function createFetchFacade() {
  const fetch = nativeFetch || (() => Promise.reject(new Error("fetch is unavailable")));
  return Object.assign(fetch, {
    server: serverFetch,
    browser: browserFetch,
  });
}

export function helperContext(extra: any = {}) {
  const site = createSiteFacade();
  const all = {
    egoBrowser: createEgoBrowserFacade(site),
    site,
    fetch: createFetchFacade(),
    cdp,
    ...extra,
  };
  return all;
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

export const __testing = {
  setOverrides,
  decodeUnserializableJsValue,
  setPlaywrightTaskSpaceConnector,
};
