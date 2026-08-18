import {
  browserCdp,
  browserEgo,
  ensureSession,
  invalidateSession,
  pendingDialog,
  setPreferredTarget,
} from "./browser-runtime.js";
import { runtimeValue } from "./cdp-eval.js";
import {
  captureScreenshotForSession,
  snapshotRaw,
  type CaptureScreenshotOptions,
} from "./driver/observe.js";
import {
  clickInPage,
  fillInPage,
  type PageClickOptions,
  type PageFillOptions,
} from "./driver/page-actions.js";
import { assertNoEgoError } from "./ego-errors.js";
import {
  withPage as defaultWithPage,
  withSpace as defaultWithSpace,
  type PageExecutionContext,
} from "./native-gate.js";
import {
  PageLedgerStore,
  type ManagedPage,
  type PageLedger,
  type PageOrigin,
} from "./page-ledger.js";
import { state } from "./state.js";

type TaskSpaceDescriptor = {
  id: number;
  name: string;
  ownership?: string;
};

type NewPageOptions = {
  as?: string;
  timeout?: number;
};

type AdoptPageOptions = {
  as?: string;
};

type PageGotoOptions = {
  timeout?: number;
};

type PageTarget = {
  spaceId: number;
  targetId: string;
};

type SpaceScope = {
  spaceId: number;
};

type OperationGate = {
  withSpace<T>(
    spaceId: number,
    operation: (scope: SpaceScope) => T | Promise<T>,
  ): Promise<T>;
  withPage<T>(
    page: PageTarget,
    operation: (context: PageExecutionContext) => T | Promise<T>,
  ): Promise<T>;
};

type LedgerPort = {
  addPage(
    spaceId: number,
    targetId: string,
    options?: { as?: string; openedBy?: PageOrigin },
  ): Promise<ManagedPage>;
  getPage(spaceId: number, label: string): Promise<ManagedPage>;
  closePage(spaceId: number, label: string): Promise<ManagedPage>;
  releasePage(spaceId: number, label: string): Promise<ManagedPage>;
  reconcile(
    spaceId: number,
    liveTargetIds: Iterable<string>,
  ): Promise<PageLedger>;
};

type RuntimeTab = {
  targetId: string;
  active?: boolean;
  title?: string;
  url?: string;
};

type PageModelServices = {
  ledger: LedgerPort;
  gate: OperationGate;
  createTab(url: string): Promise<string>;
  listTabs(): Promise<RuntimeTab[]>;
  cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  snapshot(options?: Record<string, unknown>): Promise<any>;
  screenshot(
    path: string | undefined,
    options: CaptureScreenshotOptions,
    sessionId: string,
  ): Promise<string>;
  pendingDialog(sessionId: string): Record<string, unknown> | null;
  ensureSession(targetId: string): Promise<string>;
  invalidateSession(targetId: string): void;
  setPreferredTarget(targetId: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  pageBudget: number;
};

export type PageInventoryItem = {
  targetId: string;
  label?: string;
  page: Page | UnmanagedPage;
  title: string;
  url: string;
  active: boolean;
  openedBy: PageOrigin;
};

export type PageActionReceipt = {
  popups?: Array<{ label: string; targetId: string }>;
};

export class PageBudgetError extends Error {
  readonly code = "EGO_PAGE_BUDGET_REACHED";
  readonly spaceId: number;
  readonly limit: number;

  constructor(spaceId: number, limit: number, message: string) {
    super(message);
    this.name = "PageBudgetError";
    this.spaceId = spaceId;
    this.limit = limit;
  }
}

let defaultLedger: PageLedgerStore | undefined;
const unmanagedPageConstructorToken = Symbol("UnmanagedPage");

const defaultGate: OperationGate = {
  withSpace: defaultWithSpace,
  withPage: defaultWithPage,
};

const baseDefaultServices: Omit<PageModelServices, "ledger" | "pageBudget"> = {
  gate: defaultGate,
  async createTab(url) {
    const result = assertNoEgoError(
      await browserEgo().createTab(url),
      "task.newPage",
    );
    const targetId = result?.targetId || result?.result?.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error("task.newPage returned no targetId");
    }
    return targetId;
  },
  async listTabs() {
    const result = assertNoEgoError(
      await browserEgo().listTabs(),
      "task.listTabs",
    );
    return result?.tabs || result?.targetInfos || [];
  },
  async cdp(method, params = {}, sessionId, timeoutMs) {
    const response = await browserCdp(method, params, sessionId, timeoutMs);
    return response?.result || {};
  },
  snapshot: snapshotRaw,
  screenshot: captureScreenshotForSession,
  pendingDialog,
  ensureSession,
  invalidateSession,
  setPreferredTarget,
  now: () => state.now(),
  async sleep(ms) {
    await state.sleep(ms);
  },
};

/**
 * Create a TaskSpace object around a resolved native task-space descriptor.
 * The helper layer owns name/id resolution; this layer owns page identity and
 * routes every browser operation through the native operation gate.
 */
export function createTaskSpaceHandle(
  descriptor: TaskSpaceDescriptor,
  overrides: Partial<PageModelServices> = {},
): TaskSpace {
  if (!descriptor || !Number.isInteger(descriptor.id)) {
    throw new TypeError("TaskSpace requires a numeric id");
  }
  // Ego Lite imports the SDK before it evaluates the submitted script. Resolve
  // environment-backed settings lazily so SDK callers can configure a round
  // before their first taskSpace() call.
  defaultLedger ||= new PageLedgerStore();
  const services = {
    ...baseDefaultServices,
    ledger: defaultLedger,
    pageBudget: configuredPageBudget(),
    ...overrides,
  };
  if (!Number.isInteger(services.pageBudget) || services.pageBudget < 1) {
    throw new TypeError("pageBudget must be a positive integer");
  }
  return new TaskSpace(descriptor, services);
}

export class TaskSpace {
  readonly id: number;
  readonly name: string;
  readonly ownership?: string;
  readonly #services: PageModelServices;

  constructor(descriptor: TaskSpaceDescriptor, services: PageModelServices) {
    this.id = descriptor.id;
    this.name = descriptor.name;
    this.ownership = descriptor.ownership;
    this.#services = services;
  }

  page(label: string): Page {
    return new Page(this, label, this.#services);
  }

  async listPages(): Promise<PageInventoryItem[]> {
    return this.#services.gate.withSpace(this.id, async () => {
      const { ledger, tabs } = await this.#reconcilePages();
      return pageInventory(this, this.#services, ledger, tabs);
    });
  }

  /**
   * Bring an untracked browser tab under the durable Page lifecycle.
   * Untracked handles intentionally cannot operate on the tab before adoption.
   */
  async adopt(
    page: UnmanagedPage,
    options: AdoptPageOptions = {},
  ): Promise<Page> {
    assertUnmanagedPage(page);
    if (page.spaceId !== this.id) {
      throw new Error(
        `untracked page ${page.targetId} belongs to space ${page.spaceId}, not space ${this.id}`,
      );
    }
    return this.#services.gate.withSpace(this.id, async () => {
      const { ledger, tabs } = await this.#reconcilePages();
      const live = tabs.some((tab) => tab.targetId === page.targetId);
      if (!live) {
        throw new Error(`untracked page ${page.targetId} is no longer open`);
      }
      const existing = Object.entries(ledger.pages).find(
        ([, entry]) => entry.targetId === page.targetId,
      );
      if (existing) {
        throw new Error(
          `target ${page.targetId} is already page ${existing[0]}`,
        );
      }
      if (Object.keys(ledger.pages).length >= this.#services.pageBudget) {
        throw pageBudgetError(this, this.#services.pageBudget, ledger, tabs);
      }
      const entry = await this.#services.ledger.addPage(
        this.id,
        page.targetId,
        {
          as: options.as,
          openedBy: page.openedBy,
        },
      );
      return new Page(this, entry.label, this.#services, entry);
    });
  }

  /**
   * Stop managing a user or unknown-origin page without closing its browser tab.
   * Agent-created pages must be closed so they cannot become untracked orphans.
   */
  async release(label: string): Promise<UnmanagedPage> {
    return this.#services.gate.withSpace(this.id, async () => {
      await this.#reconcilePages();
      const entry = await this.#services.ledger.getPage(this.id, label);
      if (entry.openedBy === "agent") {
        throw new Error(
          `page ${label} was created by the agent; close it instead of releasing it`,
        );
      }
      const released = await this.#services.ledger.releasePage(this.id, label);
      return new UnmanagedPage(
        this,
        released.targetId,
        released.openedBy,
        unmanagedPageConstructorToken,
      );
    });
  }

  async newPage(
    url = "about:blank",
    options: NewPageOptions = {},
  ): Promise<Page> {
    assertUrl(url);
    const timeoutMs = options.timeout ?? 15_000;
    assertTimeout(timeoutMs);
    return this.#services.gate.withSpace(this.id, async () => {
      const { ledger, tabs } = await this.#reconcilePages();
      const managedCount = Object.keys(ledger.pages).length;
      if (managedCount >= this.#services.pageBudget) {
        throw pageBudgetError(this, this.#services.pageBudget, ledger, tabs);
      }
      const targetId = await this.#services.createTab(url);
      this.#services.setPreferredTarget(targetId);
      const existingManaged = Object.entries(ledger.pages).find(
        ([, page]) => page.targetId === targetId,
      );
      if (existingManaged) {
        throw new Error(
          `task.newPage did not create a distinct tab; target ${targetId} is already page ${existingManaged[0]}`,
        );
      }
      const existedBeforeCreate = tabs.some((tab) => tab.targetId === targetId);
      let entry: ManagedPage;
      try {
        entry = await this.#services.ledger.addPage(this.id, targetId, {
          as: options.as,
          openedBy: "agent",
        });
      } catch (error) {
        // A tab without a committed label cannot be returned safely. Close it
        // only when createTab produced a new target. Ego Lite may reuse a blank
        // anchor tab; closing a pre-existing target on a ledger error could
        // destroy a page the runtime does not own.
        if (!existedBeforeCreate) {
          await this.#services
            .cdp("Target.closeTarget", { targetId })
            .catch(() => {});
          this.#services.invalidateSession(targetId);
        }
        throw error;
      }
      const page = new Page(this, entry.label, this.#services, entry);
      try {
        const sessionId = await this.#services.ensureSession(targetId);
        await waitForReadyState(this.#services, sessionId, timeoutMs);
      } catch (error) {
        throw new Error(
          `page ${entry.label} was created but did not finish loading; retrieve it with task.page('${entry.label}'): ${error?.message || error}`,
          { cause: error },
        );
      }
      return page;
    });
  }

  async #reconcilePages(): Promise<{
    ledger: PageLedger;
    tabs: RuntimeTab[];
  }> {
    const tabs = await this.#services.listTabs();
    const ledger = await this.#services.ledger.reconcile(
      this.id,
      tabs.map((tab) => tab.targetId),
    );
    return { ledger, tabs };
  }
}

/**
 * A read-only identity for a live tab that is not managed by the Page model.
 * Obtain one from TaskSpace.listPages(), then call TaskSpace.adopt() before
 * navigating, observing, or closing the tab.
 */
export class UnmanagedPage {
  readonly spaceId: number;
  readonly targetId: string;
  readonly openedBy: PageOrigin;

  constructor(
    task: TaskSpace,
    targetId: string,
    openedBy: PageOrigin,
    token: symbol,
  ) {
    if (token !== unmanagedPageConstructorToken) {
      throw new TypeError(
        "UnmanagedPage handles can only be obtained from task.listPages()",
      );
    }
    this.spaceId = task.id;
    this.targetId = targetId;
    this.openedBy = openedBy;
    Object.freeze(this);
  }
}

export class Page {
  readonly label: string;
  readonly spaceId: number;
  readonly #services: PageModelServices;
  #targetId?: string;
  #openedBy?: PageOrigin;
  #closed = false;

  constructor(
    task: TaskSpace,
    label: string,
    services: PageModelServices,
    entry?: ManagedPage,
  ) {
    this.label = label;
    this.spaceId = task.id;
    this.#services = services;
    this.#targetId = entry?.targetId;
    this.#openedBy = entry?.openedBy;
  }

  get targetId(): string | undefined {
    return this.#targetId;
  }

  get openedBy(): PageOrigin | undefined {
    return this.#openedBy;
  }

  async goto(url: string, options: PageGotoOptions = {}): Promise<any> {
    assertUrl(url);
    const timeoutMs = options.timeout ?? 15_000;
    assertTimeout(timeoutMs);
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      const navigation = await this.#services.cdp(
        "Page.navigate",
        { url },
        sessionId,
        timeoutMs,
      );
      if (navigation?.errorText) {
        throw new Error(`page.goto failed: ${navigation.errorText}`);
      }
      await waitForReadyState(this.#services, sessionId, timeoutMs);
      return navigation;
    });
  }

  async snapshot(options: Record<string, unknown> = {}): Promise<string> {
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async () => {
      await this.#activate(page.targetId);
      const result = await this.#services.snapshot({
        scope: "full_page",
        includeActionMarks: true,
        includeStableLocator: true,
        ...options,
      });
      return result?.content || "";
    });
  }

  async url(): Promise<string> {
    return this.#evaluate("location.href", false);
  }

  async title(): Promise<string> {
    return this.#evaluate("document.title", false);
  }

  async info(): Promise<Record<string, unknown>> {
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      const dialog = this.#services.pendingDialog(sessionId);
      if (dialog) return { dialog };
      return evaluateInSession(
        this.#services,
        sessionId,
        "({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})",
        false,
      );
    });
  }

  async evaluate<T = unknown>(
    expression: string | ((argument: any) => T),
    argument?: unknown,
  ): Promise<T> {
    const hasArgument = arguments.length >= 2;
    return this.#evaluate(expression, hasArgument, argument);
  }

  async screenshot(
    path?: string,
    options: CaptureScreenshotOptions = {},
  ): Promise<string> {
    if (path !== undefined && (typeof path !== "string" || path.length === 0)) {
      throw new TypeError("page.screenshot path must be a non-empty string");
    }
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      return this.#services.screenshot(path, options, sessionId);
    });
  }

  async click(
    selector: string,
    options: PageClickOptions = {},
  ): Promise<PageActionReceipt> {
    return this.#runAction((sessionId) =>
      clickInPage(this.#services, sessionId, selector, options),
    );
  }

  async fill(
    selector: string,
    value: string,
    options: PageFillOptions = {},
  ): Promise<PageActionReceipt> {
    return this.#runAction((sessionId) =>
      fillInPage(this.#services, sessionId, selector, value, options),
    );
  }

  async close(): Promise<void> {
    const page = await this.#resolve();
    await this.#services.gate.withSpace(this.spaceId, async () => {
      const tabs = await this.#services.listTabs();
      const live = tabs.some((tab) => tab.targetId === page.targetId);
      if (!live) {
        await this.#services.ledger.closePage(this.spaceId, this.label);
        this.#closed = true;
        throw new Error(`page ${this.label} was closed`);
      }
      if (tabs.length <= 1) {
        await this.#services.createTab("about:blank");
      }
      const result = await this.#services.cdp("Target.closeTarget", {
        targetId: page.targetId,
      });
      if (result?.success === false) {
        throw new Error(`failed to close page ${this.label}`);
      }
      this.#services.invalidateSession(page.targetId);
      await this.#services.ledger.closePage(this.spaceId, this.label);
      this.#closed = true;
    });
  }

  async #resolve(): Promise<PageTarget> {
    if (this.#closed) throw new Error(`page ${this.label} was closed`);
    const entry = await this.#services.ledger.getPage(this.spaceId, this.label);
    this.#targetId = entry.targetId;
    this.#openedBy = entry.openedBy;
    return { spaceId: this.spaceId, targetId: entry.targetId };
  }

  async #evaluate<T>(
    expression: string | ((argument: any) => T),
    hasArgument: boolean,
    argument?: unknown,
  ): Promise<T> {
    const serializedArgument = validateEvaluateInput(
      expression,
      hasArgument,
      argument,
    );
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, ({ sessionId }) =>
      evaluateInSession<T>(
        this.#services,
        sessionId,
        expression,
        hasArgument,
        serializedArgument,
      ),
    );
  }

  async #runAction(
    operation: (sessionId: string) => Promise<void>,
  ): Promise<PageActionReceipt> {
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      const before = new Set(
        (await this.#services.listTabs()).map((tab) => tab.targetId),
      );
      let actionError: unknown;
      try {
        await operation(sessionId);
      } catch (error) {
        actionError = error;
      }

      // A popup is normally created synchronously by the input event. A short
      // settle covers native tab-list propagation without turning this into a
      // navigation wait or silently changing the page's active state.
      await this.#services.sleep(50);
      let popupError: unknown;
      const popups: Array<{ label: string; targetId: string }> = [];
      try {
        const after = await this.#services.listTabs();
        for (const tab of after) {
          if (before.has(tab.targetId)) continue;
          const managed = await this.#services.ledger.addPage(
            this.spaceId,
            tab.targetId,
            { openedBy: "agent" },
          );
          popups.push({ label: managed.label, targetId: managed.targetId });
        }
      } catch (error) {
        popupError = error;
      }

      if (actionError) throw actionError;
      if (popupError) throw popupError;
      return popups.length > 0 ? { popups } : {};
    });
  }

  async #activate(targetId: string): Promise<void> {
    await this.#services.cdp("Target.activateTarget", { targetId });
    this.#services.setPreferredTarget(targetId);
  }
}

async function evaluateInSession<T>(
  services: PageModelServices,
  sessionId: string,
  expression: string | ((argument: any) => T),
  hasArgument: boolean,
  serializedArgument?: unknown,
): Promise<T> {
  if (typeof expression === "string") {
    const response = await services.cdp(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
    );
    return runtimeValue(response, expression) as T;
  }

  const source = expression.toString();
  const owner = await services.cdp(
    "Runtime.evaluate",
    {
      expression: "globalThis",
      returnByValue: false,
    },
    sessionId,
  );
  const objectId = owner?.result?.objectId;
  if (typeof objectId !== "string" || objectId.length === 0) {
    throw new Error("page.evaluate could not resolve the page global object");
  }
  try {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: hasArgument
          ? `function(argument) { return (${source})(argument); }`
          : `function() { return (${source})(); }`,
        arguments: hasArgument ? [{ value: serializedArgument }] : [],
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
    );
    return runtimeValue(response, source) as T;
  } finally {
    await services
      .cdp("Runtime.releaseObject", { objectId }, sessionId)
      .catch(() => {});
  }
}

function validateEvaluateInput(
  expression: unknown,
  hasArgument: boolean,
  argument: unknown,
): unknown {
  if (typeof expression !== "string" && typeof expression !== "function") {
    throw new TypeError(
      "page.evaluate expects a function or string expression",
    );
  }
  if (typeof expression === "string") {
    if (expression.length === 0) {
      throw new TypeError("page.evaluate expression must not be empty");
    }
    if (hasArgument) {
      throw new TypeError(
        "page.evaluate string expression does not accept an argument",
      );
    }
    return undefined;
  }
  return hasArgument ? serializeEvaluateArgument(argument) : undefined;
}

function serializeEvaluateArgument(argument: unknown): unknown {
  try {
    const json = JSON.stringify(argument, (_key, value) => {
      if (
        typeof value === "undefined" ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        typeof value === "bigint" ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        throw new TypeError("unsupported value");
      }
      return value;
    });
    if (json === undefined) throw new TypeError("unsupported value");
    return JSON.parse(json);
  } catch (error) {
    throw new TypeError("page.evaluate argument must be JSON-serializable", {
      cause: error,
    });
  }
}

async function waitForReadyState(
  services: PageModelServices,
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = services.now() + timeoutMs;
  while (services.now() <= deadline) {
    const remaining = Math.max(1, deadline - services.now());
    const response = await services.cdp(
      "Runtime.evaluate",
      {
        expression: "document.readyState",
        returnByValue: true,
      },
      sessionId,
      Math.min(1_000, remaining),
    );
    if (response?.result?.value === "complete") return;
    await services.sleep(Math.min(100, remaining));
  }
  throw new Error(`page.goto timed out after ${timeoutMs}ms`);
}

function assertUrl(url: string): void {
  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError("page URL must be a non-empty string");
  }
}

function assertTimeout(timeout: number | undefined): void {
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new TypeError("timeout must be a positive number of milliseconds");
  }
}

function pageInventory(
  task: TaskSpace,
  services: PageModelServices,
  ledger: PageLedger,
  tabs: RuntimeTab[],
): PageInventoryItem[] {
  const managedByTarget = new Map(
    Object.entries(ledger.pages).map(([label, entry]) => [
      entry.targetId,
      { label, entry },
    ]),
  );
  return tabs.map((tab) => {
    const managed = managedByTarget.get(tab.targetId);
    if (!managed) {
      return {
        targetId: tab.targetId,
        page: new UnmanagedPage(
          task,
          tab.targetId,
          "unknown",
          unmanagedPageConstructorToken,
        ),
        title: tab.title || "",
        url: tab.url || "",
        active: Boolean(tab.active),
        openedBy: "unknown",
      };
    }
    const entry = { label: managed.label, ...managed.entry };
    return {
      targetId: tab.targetId,
      label: managed.label,
      page: new Page(task, managed.label, services, entry),
      title: tab.title || "",
      url: tab.url || "",
      active: Boolean(tab.active),
      openedBy: entry.openedBy,
    };
  });
}

function assertUnmanagedPage(page: unknown): asserts page is UnmanagedPage {
  if (!(page instanceof UnmanagedPage)) {
    throw new TypeError(
      "task.adopt requires an untracked page returned by task.listPages()",
    );
  }
}

function pageBudgetError(
  task: TaskSpace,
  limit: number,
  ledger: PageLedger,
  tabs: RuntimeTab[],
): PageBudgetError {
  const tabsByTarget = new Map(tabs.map((tab) => [tab.targetId, tab]));
  const entries = Object.entries(ledger.pages);
  const lines = entries.map(([label, page]) => {
    const tab = tabsByTarget.get(page.targetId);
    const title = compactPageTitle(tab?.title || tab?.url || "untitled");
    return `  ${label.padEnd(6)} ${JSON.stringify(title)}${tab?.active ? " active" : ""}`;
  });
  const suggestion = entries[0]?.[0] || "p1";
  return new PageBudgetError(
    task.id,
    limit,
    [
      `Page budget reached (${entries.length}/${limit}) in space ${JSON.stringify(task.name)}.`,
      "",
      ...lines,
      "",
      `Close: await task.page('${suggestion}').close()`,
      `Reuse: await task.page('${suggestion}').goto(url)`,
    ].join("\n"),
  );
}

function compactPageTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function configuredPageBudget(): number {
  const configured = Number(process.env.EGO_BROWSER_PAGE_BUDGET || 8);
  return Number.isInteger(configured) && configured > 0 ? configured : 8;
}
