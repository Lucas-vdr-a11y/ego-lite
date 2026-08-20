import {
  browserCdp,
  browserEgo,
  drainPageEvents,
  ensureSession,
  invalidateSession,
  isNetworkDomainEnabled,
  isPageDialogOpenedError,
  pendingDialog,
  prepareFileChooser,
  setPreferredTarget,
  type FileChooserInterception,
  type FileChooserOpenedEvent,
} from "./browser-runtime.js";
import { runtimeValue } from "./cdp-eval.js";
import {
  captureScreenshotForSession,
  snapshotRaw,
  type CaptureScreenshotOptions,
  type SnapshotOptions,
} from "./driver/observe.js";
import {
  clickPointInPage,
  clickInPage,
  dragAndDropInPage,
  fillInPage,
  hoverInPage,
  mouseButtonInPage,
  mouseButtonMask,
  moveMouseInPage,
  wheelInPage,
  type MouseButton,
  type PageClickOptions,
  type PageDragAndDropOptions,
  type PageFillOptions,
  type PageHoverOptions,
  type PageMouseButtonOptions,
  type PageMouseClickOptions,
  type PageMouseMoveOptions,
} from "./driver/page-actions.js";
import {
  normalizeFilePaths,
  setFilesOnBackendNode,
  setInputFilesInPage,
} from "./driver/page-input.js";
import {
  PageKeyboardController,
  type PageKeyboardPressOptions,
  type PageKeyboardTypeOptions,
} from "./driver/page-keyboard.js";
import {
  waitForLoadStateInPage,
  waitForSelectorInPage,
  waitForURLInPage,
  type PageWaitForLoadStateOptions,
  type PageWaitForSelectorOptions,
  type PageWaitForURLOptions,
} from "./driver/page-waits.js";
import { assertNoEgoError, isEgoUserControlError } from "./ego-errors.js";
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
import { PageRefRegistry } from "./page-ref-registry.js";
import { validatePublicApiOptions } from "./public-api-schema.js";
import { parseRef, type RefMap } from "./ref-map.js";
import { state } from "./state.js";

type TaskSpaceDescriptor = {
  taskId?: string | number;
  id: number;
  name: string;
  createdBy?: string;
  ownership?: string;
  recentTabTitles?: string[];
};

type OpenPageOptions = {
  as?: string;
  timeout?: number;
};

type AdoptPageOptions = {
  as?: string;
};

type PageGotoOptions = {
  timeout?: number;
};

type PageSnapshotOptions = SnapshotOptions;

type PageScreenshotOptions = Omit<CaptureScreenshotOptions, "full"> & {
  path?: string;
  fullPage?: boolean;
};

type CdpOptions = {
  timeout?: number;
};

type WaitForControlOptions = {
  interval?: number;
  timeout?: number;
};

type PageWaitForFileChooserOptions = {
  timeout?: number;
};

export type PageFetchOptions = {
  timeout?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cache?:
    | "default"
    | "no-store"
    | "reload"
    | "no-cache"
    | "force-cache"
    | "only-if-cached";
  credentials?: "omit" | "same-origin" | "include";
  integrity?: string;
  keepalive?: boolean;
  mode?: "cors" | "no-cors" | "same-origin";
  redirect?: "follow" | "error" | "manual";
  referrer?: string;
  referrerPolicy?: string;
};

export type PageFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

type PageFetchPayload = {
  url: string;
  options: Record<string, unknown>;
  timeoutMs: number;
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
  read(spaceId: number): Promise<PageLedger>;
  discard(spaceId: number): Promise<void>;
  addPage(
    spaceId: number,
    targetId: string,
    options?: { as?: string; openedBy?: PageOrigin },
  ): Promise<ManagedPage>;
  getPage(spaceId: number, label: string): Promise<ManagedPage>;
  closePage(spaceId: number, label: string): Promise<ManagedPage>;
  releasePage(spaceId: number, label: string): Promise<ManagedPage>;
  keepUnmanaged(
    spaceId: number,
    targetId: string,
    openedBy?: PageOrigin,
  ): Promise<void>;
  beginUserControl(spaceId: number): Promise<void>;
  cancelUserControl(spaceId: number): Promise<void>;
  reconcile(
    spaceId: number,
    liveTargetIds: Iterable<string>,
    options?: { autoAdoptNew?: boolean; afterUserControl?: boolean },
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
  pageRefs: PageRefRegistry;
  gate: OperationGate;
  createTab(url: string): Promise<string>;
  listTabs(): Promise<RuntimeTab[]>;
  probeAgentControl(): Promise<boolean>;
  handOffTaskSpace(): Promise<void>;
  completeTaskSpace(): Promise<void>;
  closeTaskSpace(): Promise<void>;
  cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  showAgentMousePosition(x: number, y: number): Promise<void>;
  snapshot(options?: SnapshotOptions): Promise<any>;
  screenshot(
    path: string | undefined,
    options: CaptureScreenshotOptions,
    sessionId: string,
  ): Promise<string>;
  pendingDialog(sessionId: string): Record<string, unknown> | null;
  prepareFileChooser(
    sessionId: string,
    options: { timeoutMs: number; cancel: boolean },
  ): FileChooserInterception;
  drainEvents(sessionId: string): any[];
  isNetworkDomainEnabled(sessionId: string): boolean;
  ensureSession(targetId: string): Promise<string>;
  invalidateSession(targetId: string): void;
  setPreferredTarget(targetId: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  platform: string;
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
  dialog?: Record<string, unknown>;
};

const PAGE_CLOSE_CONFIRM_TIMEOUT_MS = 2_000;
const PAGE_CLOSE_CONFIRM_INTERVAL_MS = 50;
const CONTROL_POLL_INTERVAL_MS = 20_000;
const CONTROL_WAIT_TIMEOUT_MS = 600_000;

type RawActionRunner = (
  operation: (services: PageModelServices, sessionId: string) => Promise<void>,
) => Promise<void>;

type ObservedActionRunner = (
  operation: (services: PageModelServices, sessionId: string) => Promise<void>,
) => Promise<PageActionReceipt>;

/** Page-scoped mouse state and CDP Input primitives. */
class PageMouse {
  readonly #run: RawActionRunner;
  readonly #runObserved: ObservedActionRunner;
  readonly #modifierMask: () => number;
  #x = 0;
  #y = 0;
  #buttons = 0;
  #lastButton: MouseButton | "none" = "none";

  constructor(
    run: RawActionRunner,
    runObserved: ObservedActionRunner,
    modifierMask: () => number,
  ) {
    this.#run = run;
    this.#runObserved = runObserved;
    this.#modifierMask = modifierMask;
  }

  async click(
    x: number,
    y: number,
    options: PageMouseClickOptions = {},
  ): Promise<PageActionReceipt> {
    validatePublicApiOptions("Page.mouse.click", options);
    const receipt = await this.#runObserved((services, sessionId) =>
      clickPointInPage(
        services,
        sessionId,
        x,
        y,
        options,
        this.#modifierMask(),
        this.#buttons,
      ),
    );
    this.#x = x;
    this.#y = y;
    this.#lastButton = "none";
    return receipt;
  }

  async move(
    x: number,
    y: number,
    options: PageMouseMoveOptions = {},
  ): Promise<void> {
    validatePublicApiOptions("Page.mouse.move", options);
    await this.#run((services, sessionId) =>
      moveMouseInPage(services, sessionId, this.#x, this.#y, x, y, {
        ...options,
        button: this.#lastButton,
        buttons: this.#buttons,
        modifiers: this.#modifierMask(),
      }),
    );
    this.#x = x;
    this.#y = y;
  }

  async down(options: PageMouseButtonOptions = {}): Promise<void> {
    validatePublicApiOptions("Page.mouse.down", options);
    const button = options.button ?? "left";
    const nextButtons = this.#buttons | mouseButtonMask(button);
    await this.#run((services, sessionId) =>
      mouseButtonInPage(
        services,
        sessionId,
        "mousePressed",
        this.#x,
        this.#y,
        nextButtons,
        options,
        this.#modifierMask(),
      ).then(() => undefined),
    );
    this.#buttons = nextButtons;
    this.#lastButton = button;
  }

  async up(options: PageMouseButtonOptions = {}): Promise<void> {
    validatePublicApiOptions("Page.mouse.up", options);
    const button = options.button ?? "left";
    const nextButtons = this.#buttons & ~mouseButtonMask(button);
    await this.#run((services, sessionId) =>
      mouseButtonInPage(
        services,
        sessionId,
        "mouseReleased",
        this.#x,
        this.#y,
        nextButtons,
        options,
        this.#modifierMask(),
      ).then(() => undefined),
    );
    this.#buttons = nextButtons;
    this.#lastButton = "none";
  }

  async wheel(deltaX: number, deltaY: number): Promise<void> {
    return this.#run((services, sessionId) =>
      wheelInPage(
        services,
        sessionId,
        this.#x,
        this.#y,
        deltaX,
        deltaY,
        this.#modifierMask(),
      ),
    );
  }
}

/** Page-scoped keyboard input with Playwright-style key state. */
class PageKeyboard {
  readonly #controller: PageKeyboardController;

  constructor(
    services: PageModelServices,
    run: RawActionRunner,
    runObserved: ObservedActionRunner,
  ) {
    this.#controller = new PageKeyboardController(
      services,
      (operation) => run((_services, sessionId) => operation(sessionId)),
      (operation) =>
        runObserved((_services, sessionId) => operation(sessionId)),
    );
  }

  modifierMask(): number {
    return this.#controller.modifierMask();
  }

  async down(key: string): Promise<void> {
    await this.#controller.down(key);
  }

  async up(key: string): Promise<void> {
    await this.#controller.up(key);
  }

  async press(
    chord: string,
    options: PageKeyboardPressOptions = {},
  ): Promise<PageActionReceipt> {
    validatePublicApiOptions("Page.keyboard.press", options);
    return (await this.#controller.press(chord, options)) as PageActionReceipt;
  }

  async insertText(text: string): Promise<void> {
    await this.#controller.insertText(text);
  }

  async type(
    text: string,
    options: PageKeyboardTypeOptions = {},
  ): Promise<void> {
    validatePublicApiOptions("Page.keyboard.type", options);
    await this.#controller.type(text, options);
  }
}

class PageBudgetError extends Error {
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
const defaultPageRefs = new PageRefRegistry();
const unmanagedPageConstructorToken = Symbol("UnmanagedPage");
const captureUserBoundaryToken = Symbol("captureUserBoundary");

const defaultGate: OperationGate = {
  withSpace: defaultWithSpace,
  withPage: defaultWithPage,
};

const baseDefaultServices: Omit<PageModelServices, "ledger" | "pageBudget"> = {
  gate: defaultGate,
  pageRefs: defaultPageRefs,
  async createTab(url) {
    const result = assertNoEgoError(
      await browserEgo().createTab(url),
      "task.openPage",
    );
    const targetId = result?.targetId || result?.result?.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error("task.openPage returned no targetId");
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
  async probeAgentControl() {
    try {
      // Use the native probe directly. snapshotRaw turns user control into a
      // hard-stop output signal, while waiting for that state is intentional.
      await browserEgo().snapshot({ maxResultLength: 1 });
      return true;
    } catch (error) {
      if (isEgoUserControlError(error)) return false;
      throw error;
    }
  },
  async handOffTaskSpace() {
    const ego = browserEgo();
    if (typeof ego.handOffTaskSpace !== "function") {
      throw new Error("task.handOff requires ego.handOffTaskSpace");
    }
    assertNoEgoError(await ego.handOffTaskSpace(), "task.handOff");
  },
  async completeTaskSpace() {
    const ego = browserEgo();
    if (typeof ego.completeTaskSpace !== "function") {
      throw new Error("task.finish requires ego.completeTaskSpace");
    }
    assertNoEgoError(await ego.completeTaskSpace(), "task.finish");
  },
  async closeTaskSpace() {
    const ego = browserEgo();
    if (typeof ego.closeTaskSpace !== "function") {
      throw new Error("task.close requires ego.closeTaskSpace");
    }
    assertNoEgoError(await ego.closeTaskSpace(), "task.close");
  },
  async cdp(method, params = {}, sessionId, timeoutMs) {
    const response = await browserCdp(method, params, sessionId, timeoutMs);
    return response?.result || {};
  },
  async showAgentMousePosition(x, y) {
    const ego = browserEgo();
    if (typeof ego.animationHighlightMouseToPosition !== "function") return;
    await ego.animationHighlightMouseToPosition(x, y);
  },
  snapshot: snapshotRaw,
  screenshot: captureScreenshotForSession,
  pendingDialog,
  prepareFileChooser,
  drainEvents: drainPageEvents,
  isNetworkDomainEnabled,
  ensureSession,
  invalidateSession,
  setPreferredTarget,
  now: () => state.now(),
  async sleep(ms) {
    await state.sleep(ms);
  },
  get platform() {
    return state.platform;
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

/**
 * Capture the active tab at a claim/takeover boundary before Agent actions can
 * change it. This is called by the helper layer and is not injected directly.
 */
export async function captureTaskSpaceUserBoundary(
  task: TaskSpace,
): Promise<void> {
  await task.captureUserBoundary(captureUserBoundaryToken);
}

class TaskSpace {
  readonly taskId?: string | number;
  readonly id: number;
  readonly name: string;
  readonly createdBy?: string;
  readonly ownership?: string;
  readonly recentTabTitles?: string[];
  readonly #services: PageModelServices;
  #userPage?: Page | UnmanagedPage;

  constructor(descriptor: TaskSpaceDescriptor, services: PageModelServices) {
    this.taskId = descriptor.taskId;
    this.id = descriptor.id;
    this.name = descriptor.name;
    this.createdBy = descriptor.createdBy;
    this.ownership = descriptor.ownership;
    this.recentTabTitles = descriptor.recentTabTitles;
    this.#services = services;
  }

  /** Stable task-space identifier. `id` remains as a compatibility alias. */
  get spaceId(): number {
    return this.id;
  }

  page(label: string): Page {
    return new Page(this, label, this.#services);
  }

  /** The tab active at the most recent claim/takeover boundary, if any. */
  userPage(): Page | UnmanagedPage | undefined {
    return this.#userPage;
  }

  async captureUserBoundary(token: symbol): Promise<void> {
    if (token !== captureUserBoundaryToken) {
      throw new TypeError(
        "the user-page boundary is captured automatically by claim/takeover",
      );
    }
    await this.#services.gate.withSpace(this.id, async () => {
      const tabs = await this.#services.listTabs();
      if (tabs.length === 0) {
        this.#userPage = undefined;
        return;
      }
      const ledger = await this.#services.ledger.reconcile(
        this.id,
        tabs.map((tab) => tab.targetId),
        { autoAdoptNew: false, afterUserControl: true },
      );
      const active = tabs.find((tab) => tab.active);
      this.#userPage = active
        ? pageInventory(this, this.#services, ledger, tabs).find(
            (item) => item.targetId === active.targetId,
          )?.page
        : undefined;
    });
  }

  async listPages(): Promise<PageInventoryItem[]> {
    return this.#services.gate.withSpace(this.id, async () => {
      const { ledger, tabs } = await this.#reconcilePages();
      return pageInventory(this, this.#services, ledger, tabs);
    });
  }

  /** Wait until this space is controllable without taking control from the user. */
  async waitForControl(options: WaitForControlOptions = {}): Promise<void> {
    validatePublicApiOptions("TaskSpace.waitForControl", options);
    const intervalMs = options.interval ?? CONTROL_POLL_INTERVAL_MS;
    const timeoutMs = options.timeout ?? CONTROL_WAIT_TIMEOUT_MS;
    const deadline = this.#services.now() + timeoutMs;

    while (true) {
      const available = await this.#services.gate.withSpace(this.id, () =>
        this.#services.probeAgentControl(),
      );
      if (available) return;

      const remainingMs = deadline - this.#services.now();
      if (remainingMs <= 0) {
        throw new Error(`task.waitForControl timed out after ${timeoutMs}ms`);
      }
      await this.#services.sleep(Math.min(intervalMs, remainingMs));
    }
  }

  /** Give control of this task space to the user while keeping Page state. */
  async handOff(): Promise<void> {
    await this.#services.gate.withSpace(this.spaceId, async () => {
      await this.#reconcilePages();
      await this.#services.ledger.beginUserControl(this.spaceId);
      try {
        await this.#services.handOffTaskSpace();
      } catch (error) {
        await this.#services.ledger.cancelUserControl(this.spaceId);
        throw error;
      }
    });
  }

  /** Finish the task, keep its browser space for the user, and drop Page state. */
  async finish(): Promise<void> {
    await this.#services.gate.withSpace(this.spaceId, async () => {
      await this.#services.completeTaskSpace();
      await this.#services.ledger.discard(this.spaceId);
    });
  }

  /** Close the task space and drop its Page state. */
  async close(): Promise<void> {
    await this.#services.gate.withSpace(this.spaceId, async () => {
      await this.#services.closeTaskSpace();
      await this.#services.ledger.discard(this.spaceId);
    });
  }

  /** Send a Target or Browser domain command within this selected space. */
  async cdp(
    method: string,
    params: Record<string, unknown> = {},
    options: CdpOptions = {},
  ): Promise<any> {
    assertCdpCall("TaskSpace.cdp", method, params, options);
    if (!method.startsWith("Target.") && !method.startsWith("Browser.")) {
      throw new TypeError(
        "task.cdp only supports Target. and Browser. commands",
      );
    }
    return this.#services.gate.withSpace(this.id, () =>
      this.#services.cdp(method, params, undefined, options.timeout),
    );
  }

  /**
   * Bring an untracked browser tab under the durable Page lifecycle.
   * Untracked handles intentionally cannot operate on the tab before adoption.
   */
  async adopt(
    page: UnmanagedPage,
    options: AdoptPageOptions = {},
  ): Promise<Page> {
    validatePublicApiOptions("TaskSpace.adopt", options);
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
   * Stop managing an unknown-origin page without closing its browser tab.
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

  async openPage(
    url = "about:blank",
    options: OpenPageOptions = {},
  ): Promise<Page> {
    assertUrl(url);
    validatePublicApiOptions("TaskSpace.openPage", options);
    const timeoutMs = options.timeout ?? 15_000;
    return this.#services.gate.withSpace(this.id, async () => {
      const { ledger, tabs } = await this.#reconcilePages();
      const managedCount = Object.keys(ledger.pages).length;
      if (managedCount >= this.#services.pageBudget) {
        throw pageBudgetError(this, this.#services.pageBudget, ledger, tabs);
      }
      const creationStartedAtMs = this.#services.now();
      const targetId = await this.#services.createTab(url);
      this.#services.setPreferredTarget(targetId);
      const existingManaged = Object.entries(ledger.pages).find(
        ([, page]) => page.targetId === targetId,
      );
      if (existingManaged) {
        throw new Error(
          `task.openPage did not create a distinct tab; target ${targetId} is already page ${existingManaged[0]}`,
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
        await waitForCreatedDocument(
          this.#services,
          sessionId,
          url,
          creationStartedAtMs,
          timeoutMs,
        );
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
      { autoAdoptNew: this.ownership === "agent" },
    );
    return { ledger, tabs };
  }
}

/**
 * A read-only identity for a live tab that is not managed by the Page model.
 * Obtain one from TaskSpace.listPages(), then call TaskSpace.adopt() before
 * navigating, observing, or closing the tab.
 */
class UnmanagedPage {
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

type ArmedFileChooser = {
  page: PageTarget;
  interception: FileChooserInterception;
};

type PendingFileChooser = {
  arm: Promise<ArmedFileChooser>;
};

/** A file chooser intercepted before Chromium can open a native dialog. */
class FileChooser {
  readonly #services: PageModelServices;
  readonly #page: PageTarget;
  readonly #event: FileChooserOpenedEvent;
  readonly #interception: FileChooserInterception;
  #handled = false;

  constructor(
    services: PageModelServices,
    armed: ArmedFileChooser,
    event: FileChooserOpenedEvent,
  ) {
    this.#services = services;
    this.#page = armed.page;
    this.#interception = armed.interception;
    this.#event = event;
  }

  isMultiple(): boolean {
    return this.#event.mode === "selectMultiple";
  }

  async setFiles(path: string | string[]): Promise<void> {
    if (this.#handled) throw new Error("this file chooser was already handled");
    const files = normalizeFilePaths(path, "fileChooser.setFiles");
    this.#handled = true;
    try {
      await this.#services.gate.withPage(this.#page, async ({ sessionId }) => {
        await setFilesOnBackendNode(
          this.#services,
          sessionId,
          files,
          this.#event.backendNodeId,
        );
      });
    } finally {
      await this.#interception.dispose();
    }
  }
}

class Page {
  readonly label: string;
  readonly spaceId: number;
  readonly mouse: PageMouse;
  readonly keyboard: PageKeyboard;
  readonly #services: PageModelServices;
  readonly #spaceName: string;
  #targetId?: string;
  #openedBy?: PageOrigin;
  #pendingFileChooser?: PendingFileChooser;

  constructor(
    task: TaskSpace,
    label: string,
    services: PageModelServices,
    entry?: ManagedPage,
  ) {
    this.label = label;
    this.spaceId = task.id;
    this.#spaceName = task.name;
    this.#services = services;
    this.#targetId = entry?.targetId;
    this.#openedBy = entry?.openedBy;
    this.keyboard = new PageKeyboard(
      this.#services,
      (operation) =>
        this.#runRawAction((sessionId) => operation(this.#services, sessionId)),
      (operation) =>
        this.#runObservedAction((sessionId) =>
          operation(this.#services, sessionId),
        ),
    );
    this.mouse = new PageMouse(
      (operation) =>
        this.#runRawAction((sessionId) => operation(this.#services, sessionId)),
      (operation) =>
        this.#runObservedAction((sessionId) =>
          operation(this.#services, sessionId),
        ),
      () => this.keyboard.modifierMask(),
    );
  }

  get targetId(): string | undefined {
    return this.#targetId;
  }

  get openedBy(): PageOrigin | undefined {
    return this.#openedBy;
  }

  async goto(
    url: string,
    options: PageGotoOptions = {},
  ): Promise<PageActionReceipt> {
    assertUrl(url);
    validatePublicApiOptions("Page.goto", options);
    const timeoutMs = options.timeout ?? 15_000;
    const page = await this.#resolve();
    const { receipt } = await this.#runActionBoundary(
      page,
      async (sessionId) => {
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
      },
    );
    return receipt;
  }

  async snapshot(options: PageSnapshotOptions = {}): Promise<string> {
    validatePublicApiOptions("Page.snapshot", options);
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async () => {
      await this.#activate(page.targetId);
      const result = await this.#services.snapshot({
        scope: "full_page",
        includeActionMarks: true,
        includeStableLocator: true,
        ...options,
      });
      this.#services.pageRefs.replace(page.targetId, result?.refs || []);
      const content = result?.content || "";
      const header = await this.#snapshotHeader(page);
      return `${header}\n${content}`;
    });
  }

  async url(): Promise<string> {
    return this.#evaluate("location.href", false);
  }

  async waitForURL(
    expected: string | RegExp,
    options: PageWaitForURLOptions = {},
  ): Promise<void> {
    validatePublicApiOptions("Page.waitForURL", options);
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, ({ sessionId }) =>
      waitForURLInPage(this.#services, sessionId, expected, options),
    );
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
    expression: string | ((argument: any) => T | Promise<T>),
    argument?: unknown,
  ): Promise<T> {
    const hasArgument = arguments.length >= 2;
    return this.#evaluate(expression, hasArgument, argument, true);
  }

  /**
   * Run window.fetch inside this Page and return a CDP-serializable response.
   * Unlike a Node fetch, relative URLs, cookies, CORS, and service workers all
   * use the addressed document's browser context.
   */
  async fetch(
    url: string,
    options: PageFetchOptions = {},
  ): Promise<PageFetchResponse> {
    assertUrl(url);
    const payload = pageFetchPayload(url, options);
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      return evaluateInSession<PageFetchResponse>(
        this.#services,
        sessionId,
        fetchInPage,
        true,
        payload,
        payload.timeoutMs + 1_000,
      );
    });
  }

  /** Send one CDP command through this Page's target session. */
  async cdp(
    method: string,
    params: Record<string, unknown> = {},
    options: CdpOptions = {},
  ): Promise<any> {
    assertCdpCall("Page.cdp", method, params, options);
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      try {
        return await this.#services.cdp(
          method,
          params,
          sessionId,
          options.timeout,
        );
      } finally {
        // Raw CDP can navigate or mutate the document, so existing refs are no
        // longer safe even when the command looked observational.
        this.#services.pageRefs.clear(page.targetId);
      }
    });
  }

  async waitForSelector(
    selector: string,
    options: PageWaitForSelectorOptions = {},
  ): Promise<true> {
    validatePublicApiOptions("Page.waitForSelector", options);
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      const refMap = await this.#refMapForAction(page, selector);
      return waitForSelectorInPage(
        this.#services,
        sessionId,
        refMap,
        selector,
        options,
      );
    });
  }

  async waitForLoadState(
    state: "domcontentloaded" | "load" | "networkidle",
    options: PageWaitForLoadStateOptions = {},
  ): Promise<void> {
    validatePublicApiOptions("Page.waitForLoadState", options);
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      try {
        await waitForLoadStateInPage(this.#services, sessionId, state, options);
      } finally {
        this.#services.pageRefs.clear(page.targetId);
      }
    });
  }

  /** Drain only CDP events routed to this Page session. */
  async events(): Promise<any[]> {
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, ({ sessionId }) =>
      this.#services.drainEvents(sessionId),
    );
  }

  async screenshot(options: PageScreenshotOptions = {}): Promise<string> {
    validatePublicApiOptions("Page.screenshot", options);
    const { path, fullPage, ...captureOptions } = options;
    if (path !== undefined && (typeof path !== "string" || path.length === 0)) {
      throw new TypeError("page.screenshot path must be a non-empty string");
    }
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      return this.#services.screenshot(
        path,
        fullPage === undefined
          ? captureOptions
          : { ...captureOptions, full: fullPage },
        sessionId,
      );
    });
  }

  async click(
    selector: string,
    options: PageClickOptions = {},
  ): Promise<PageActionReceipt> {
    validatePublicApiOptions("Page.click", options);
    return this.#runAction(
      selector,
      (sessionId, refMap) =>
        clickInPage(
          this.#services,
          sessionId,
          refMap,
          selector,
          options,
          this.keyboard.modifierMask(),
        ),
      true,
    );
  }

  async dblclick(
    selector: string,
    options: Omit<PageClickOptions, "clickCount"> = {},
  ): Promise<PageActionReceipt> {
    validatePublicApiOptions("Page.dblclick", options);
    return this.#runAction(
      selector,
      (sessionId, refMap) =>
        clickInPage(
          this.#services,
          sessionId,
          refMap,
          selector,
          { ...options, clickCount: 2 },
          this.keyboard.modifierMask(),
        ),
      true,
    );
  }

  async hover(
    selector: string,
    options: PageHoverOptions = {},
  ): Promise<PageActionReceipt> {
    validatePublicApiOptions("Page.hover", options);
    return this.#runAction(selector, (sessionId, refMap) =>
      hoverInPage(
        this.#services,
        sessionId,
        refMap,
        selector,
        options,
        this.keyboard.modifierMask(),
      ),
    );
  }

  async dragAndDrop(
    sourceSelector: string,
    targetSelector: string,
    options: PageDragAndDropOptions = {},
  ): Promise<PageActionReceipt> {
    validatePublicApiOptions("Page.dragAndDrop", options);
    return this.#runAction(
      [sourceSelector, targetSelector],
      (sessionId, refMap) =>
        dragAndDropInPage(
          this.#services,
          sessionId,
          refMap,
          sourceSelector,
          targetSelector,
          options,
          this.keyboard.modifierMask(),
        ),
    );
  }

  async fill(
    selector: string,
    value: string,
    options: PageFillOptions = {},
  ): Promise<PageActionReceipt> {
    validatePublicApiOptions("Page.fill", options);
    return this.#runAction(selector, (sessionId, refMap) =>
      fillInPage(this.#services, sessionId, refMap, selector, value, options),
    );
  }

  async setInputFiles(
    selector: string,
    path: string | string[],
  ): Promise<PageActionReceipt> {
    return this.#runAction(selector, (sessionId, refMap) =>
      setInputFilesInPage(this.#services, sessionId, refMap, selector, path),
    );
  }

  waitForFileChooser(
    options: PageWaitForFileChooserOptions = {},
  ): Promise<FileChooser> {
    validatePublicApiOptions("Page.waitForFileChooser", options);
    const timeoutMs = options.timeout ?? 10_000;
    if (this.#pendingFileChooser) {
      throw new Error("this Page is already waiting for a file chooser");
    }

    const pending: PendingFileChooser = {
      arm: (async () => {
        const page = await this.#resolve();
        return this.#services.gate.withPage(page, async ({ sessionId }) => {
          await this.#activate(page.targetId);
          const interception = this.#services.prepareFileChooser(sessionId, {
            timeoutMs,
            cancel: false,
          });
          await interception.ready;
          return { page, interception };
        });
      })(),
    };
    this.#pendingFileChooser = pending;
    return (async () => {
      let armed: ArmedFileChooser | undefined;
      try {
        armed = await pending.arm;
        const event = await armed.interception.event;
        return new FileChooser(this.#services, armed, event);
      } catch (error) {
        if (armed) await armed.interception.dispose(asError(error));
        throw error;
      } finally {
        if (this.#pendingFileChooser === pending) {
          this.#pendingFileChooser = undefined;
        }
      }
    })();
  }

  async scrollBy(
    deltaY: number,
    options: { deltaX?: number; behavior?: ScrollBehavior } = {},
  ): Promise<{ x: number; y: number }> {
    validatePublicApiOptions("Page.scrollBy", options);
    if (!Number.isFinite(deltaY)) {
      throw new TypeError("page.scrollBy requires a finite deltaY");
    }
    return this.#runValueAction((sessionId) =>
      evaluateInSession<{ x: number; y: number }>(
        this.#services,
        sessionId,
        function (input) {
          window.scrollBy({
            left: input.deltaX,
            top: input.deltaY,
            behavior: input.behavior,
          });
          return { x: window.scrollX, y: window.scrollY };
        },
        true,
        {
          deltaX: options.deltaX ?? 0,
          deltaY,
          behavior: options.behavior ?? "auto",
        },
      ),
    );
  }

  async close(): Promise<void> {
    const page = await this.#resolve();
    await this.#services.gate.withSpace(this.spaceId, async () => {
      const tabs = await this.#services.listTabs();
      const live = tabs.some((tab) => tab.targetId === page.targetId);
      if (!live) {
        await this.#services.ledger.closePage(this.spaceId, this.label);
        this.#services.pageRefs.clear(page.targetId);
        throw new Error(`page ${this.label} was closed`);
      }
      if (tabs.length <= 1) {
        const anchorTargetId = await this.#services.createTab("about:blank");
        try {
          await this.#services.ledger.keepUnmanaged(
            this.spaceId,
            anchorTargetId,
            "unknown",
          );
        } catch (error) {
          // The original page is still live, so a failed anchor bookkeeping
          // write can safely roll the new anchor back before aborting close.
          await this.#services
            .cdp("Target.closeTarget", { targetId: anchorTargetId })
            .catch(() => {});
          throw error;
        }
      }
      const result = await this.#services.cdp("Target.closeTarget", {
        targetId: page.targetId,
      });
      if (result?.success !== true) {
        throw new Error(`failed to close page ${this.label}`);
      }
      const disappeared = await waitForTargetToDisappear(
        this.#services,
        page.targetId,
        PAGE_CLOSE_CONFIRM_TIMEOUT_MS,
      );
      if (!disappeared) {
        // Keep the durable label while the native tab still exists. The caller
        // can retry close safely instead of leaving an unmanaged orphan.
        throw new Error(
          `page ${this.label} did not close within ${PAGE_CLOSE_CONFIRM_TIMEOUT_MS}ms`,
        );
      }
      this.#services.invalidateSession(page.targetId);
      this.#services.pageRefs.clear(page.targetId);
      await this.#services.ledger.closePage(this.spaceId, this.label);
    });
  }

  async #resolve(): Promise<PageTarget> {
    const entry = await this.#services.ledger.getPage(this.spaceId, this.label);
    this.#targetId = entry.targetId;
    this.#openedBy = entry.openedBy;
    return { spaceId: this.spaceId, targetId: entry.targetId };
  }

  async #evaluate<T>(
    expression: string | ((argument: any) => T | Promise<T>),
    hasArgument: boolean,
    argument?: unknown,
    activate = false,
  ): Promise<T> {
    const serializedArgument = validateEvaluateInput(
      expression,
      hasArgument,
      argument,
    );
    const page = await this.#resolve();
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      if (activate) await this.#activate(page.targetId);
      try {
        return await evaluateInSession<T>(
          this.#services,
          sessionId,
          expression,
          hasArgument,
          serializedArgument,
        );
      } finally {
        if (activate) this.#services.pageRefs.clear(page.targetId);
      }
    });
  }

  async #runAction(
    selector: string | string[],
    operation: (sessionId: string, refMap: RefMap) => Promise<void>,
    guardFileChooser = false,
  ): Promise<PageActionReceipt> {
    const page = await this.#resolve();
    const selectors = Array.isArray(selector) ? selector : [selector];
    const { receipt } = await this.#runActionBoundary(
      page,
      async (sessionId) => {
        const refMap = await this.#refMapForAction(page, ...selectors);
        await operation(sessionId, refMap);
      },
      guardFileChooser,
    );
    return receipt;
  }

  async #runRawAction(
    operation: (sessionId: string) => Promise<void>,
  ): Promise<void> {
    const page = await this.#resolve();
    try {
      await this.#runInputBoundary(page, operation);
    } catch (error) {
      // A modal dialog is now the page's observable result. The interrupted
      // driver stack has already unwound, so no later click/key steps resume
      // unexpectedly after the caller handles the dialog.
      if (isPageDialogOpenedError(error)) return;
      throw error;
    }
  }

  async #runValueAction<T>(
    operation: (sessionId: string) => Promise<T>,
  ): Promise<T> {
    const page = await this.#resolve();
    return this.#runInputBoundary(page, operation);
  }

  async #runObservedAction(
    operation: (sessionId: string) => Promise<void>,
  ): Promise<PageActionReceipt> {
    const page = await this.#resolve();
    const { receipt } = await this.#runActionBoundary(page, operation, true);
    return receipt;
  }

  async #runInputBoundary<T>(
    page: PageTarget,
    operation: (sessionId: string) => Promise<T>,
  ): Promise<T> {
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      try {
        return await operation(sessionId);
      } finally {
        this.#services.pageRefs.clear(page.targetId);
      }
    });
  }

  async #runActionBoundary<T>(
    page: PageTarget,
    operation: (sessionId: string) => Promise<T>,
    guardFileChooser = false,
  ): Promise<{ value: T; receipt: PageActionReceipt }> {
    const explicitFileChooser = guardFileChooser
      ? this.#pendingFileChooser
      : undefined;
    if (explicitFileChooser) {
      const armed = await explicitFileChooser.arm;
      if (armed.page.targetId !== page.targetId) {
        throw new Error("file chooser waiter belongs to a different Page");
      }
    }
    return this.#services.gate.withPage(page, async ({ sessionId }) => {
      await this.#activate(page.targetId);
      const fileChooserGuard =
        guardFileChooser && !explicitFileChooser
          ? this.#services.prepareFileChooser(sessionId, {
              timeoutMs: 1_000,
              cancel: true,
            })
          : undefined;
      try {
        await fileChooserGuard?.ready;
        const before = new Set(
          (await this.#services.listTabs()).map((tab) => tab.targetId),
        );
        let actionError: unknown;
        let value: T | undefined;
        try {
          value = await operation(sessionId);
        } catch (error) {
          actionError = error;
        }

        if (isPageDialogOpenedError(actionError)) {
          const dialog =
            this.#services.pendingDialog(sessionId) || actionError.dialog;
          return {
            value: undefined as T,
            receipt: { dialog },
          };
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

        if (fileChooserGuard?.peek()) {
          throw unhandledFileChooserError();
        }

        if (actionError) throw actionError;
        if (popupError) throw popupError;
        return {
          value: value as T,
          receipt: popups.length > 0 ? { popups } : {},
        };
      } finally {
        await fileChooserGuard?.dispose();
        this.#services.pageRefs.clear(page.targetId);
      }
    });
  }

  async #refMapForAction(
    page: PageTarget,
    ...selectors: string[]
  ): Promise<RefMap> {
    let refs = this.#services.pageRefs.forTarget(page.targetId);
    const missingRef = selectors.some((selector) => {
      const refId = parseRef(selector);
      return Boolean(refId && !refs.get(refId));
    });
    if (!missingRef) return refs;

    const result = await this.#services.snapshot({
      scope: "full_page",
      includeActionMarks: true,
      includeStableLocator: true,
    });
    refs = this.#services.pageRefs.replace(page.targetId, result?.refs || []);
    return refs;
  }

  async #snapshotHeader(page: PageTarget): Promise<string> {
    try {
      const [tabs, ledger] = await Promise.all([
        this.#services.listTabs(),
        this.#services.ledger.read(this.spaceId),
      ]);
      return snapshotSourceHeader({
        currentLabel: this.label,
        currentTargetId: page.targetId,
        ledger,
        pageBudget: this.#services.pageBudget,
        spaceId: this.spaceId,
        spaceName: this.#spaceName,
        tabs,
      });
    } catch {
      return `[${this.label} | space ${JSON.stringify(this.#spaceName)}(${this.spaceId})]`;
    }
  }

  async #activate(targetId: string): Promise<void> {
    await this.#services.cdp("Target.activateTarget", { targetId });
    this.#services.setPreferredTarget(targetId);
  }
}

function snapshotSourceHeader(input: {
  currentLabel: string;
  currentTargetId: string;
  ledger: PageLedger;
  pageBudget: number;
  spaceId: number;
  spaceName: string;
  tabs: RuntimeTab[];
}): string {
  const tabsByTarget = new Map(input.tabs.map((tab) => [tab.targetId, tab]));
  const managedTargets = new Set(
    Object.values(input.ledger.pages).map((page) => page.targetId),
  );
  const current = tabsByTarget.get(input.currentTargetId);
  const currentTitle = compactPageTitle(
    current?.title || current?.url || "untitled",
  );
  const pages = Object.entries(input.ledger.pages).map(([label, page]) => {
    const tab = tabsByTarget.get(page.targetId);
    const title = compactPageTitle(tab?.title || tab?.url || "untitled");
    return `${label}${page.targetId === input.currentTargetId ? "*" : ""} ${JSON.stringify(title)}`;
  });
  const untracked = input.tabs.filter(
    (tab) => !managedTargets.has(tab.targetId),
  ).length;
  const managed = pages.length;
  const budget =
    managed >= input.pageBudget - 1
      ? ` | budget ${managed}/${input.pageBudget}`
      : "";
  const inventory = pages.length > 0 ? ` — ${pages.join(", ")}` : "";
  return `[${input.currentLabel} ${JSON.stringify(currentTitle)} | space ${JSON.stringify(input.spaceName)}(${input.spaceId}): ${managed} managed, ${untracked} untracked${inventory}${budget}]`;
}

async function evaluateInSession<T>(
  services: PageModelServices,
  sessionId: string,
  expression: string | ((argument: any) => T | Promise<T>),
  hasArgument: boolean,
  serializedArgument?: unknown,
  timeoutMs?: number,
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
      timeoutMs,
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
    timeoutMs,
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
      timeoutMs,
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
  return serializeJsonValue(
    argument,
    "page.evaluate argument must be JSON-serializable",
  );
}

function serializeJsonValue(value: unknown, message: string): unknown {
  try {
    const json = JSON.stringify(value, (_key, item) => {
      if (
        typeof item === "undefined" ||
        typeof item === "function" ||
        typeof item === "symbol" ||
        typeof item === "bigint" ||
        (typeof item === "number" && !Number.isFinite(item))
      ) {
        throw new TypeError("unsupported value");
      }
      return item;
    });
    if (json === undefined) throw new TypeError("unsupported value");
    return JSON.parse(json);
  } catch (error) {
    throw new TypeError(message, { cause: error });
  }
}

function pageFetchPayload(
  url: string,
  options: PageFetchOptions,
): PageFetchPayload {
  validatePublicApiOptions("Page.fetch", options);
  const { timeout = 20_000, ...requestOptions } = options;
  return {
    url,
    options: serializeJsonValue(
      requestOptions,
      "page.fetch options must be JSON-serializable",
    ) as Record<string, unknown>,
    timeoutMs: timeout,
  };
}

async function fetchInPage({
  url,
  options,
  timeoutMs,
}: PageFetchPayload): Promise<PageFetchResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await window.fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers,
      body: await response.text(),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`page.fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function waitForCreatedDocument(
  services: PageModelServices,
  sessionId: string,
  requestedUrl: string,
  creationStartedAtMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = services.now() + timeoutMs;
  while (services.now() <= deadline) {
    const remaining = Math.max(1, deadline - services.now());
    const response = await services.cdp(
      "Runtime.evaluate",
      {
        // createTab() can return while the target still exposes an already
        // complete Chrome placeholder document. Read all three values in one
        // evaluation so openPage resolves only after the requested navigation
        // has committed a document created during this call.
        expression:
          "({readyState:document.readyState,url:location.href,timeOrigin:performance.timeOrigin})",
        returnByValue: true,
      },
      sessionId,
      Math.min(1_000, remaining),
    );
    const observation = response?.result?.value;
    if (
      isCreatedDocumentReady(observation, requestedUrl, creationStartedAtMs)
    ) {
      return;
    }
    await services.sleep(Math.min(100, remaining));
  }
  throw new Error(`task.openPage timed out after ${timeoutMs}ms`);
}

function isCreatedDocumentReady(
  observation: any,
  requestedUrl: string,
  creationStartedAtMs: number,
): boolean {
  if (
    observation?.readyState !== "complete" ||
    typeof observation?.url !== "string" ||
    typeof observation?.timeOrigin !== "number" ||
    observation.timeOrigin < creationStartedAtMs
  ) {
    return false;
  }

  if (isBrowserPlaceholderUrl(requestedUrl)) {
    return observation.url === requestedUrl;
  }
  return !isBrowserPlaceholderUrl(observation.url);
}

function isBrowserPlaceholderUrl(url: string): boolean {
  return (
    url === "" ||
    url === ":" ||
    url === "about:blank" ||
    url === "chrome://newtab/" ||
    url === "chrome://new-tab-page/"
  );
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

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function unhandledFileChooserError(): Error & { code: string } {
  const error = new Error(
    "This action opened a file chooser, which was cancelled before the system dialog appeared. " +
      "Use page.setInputFiles() for an existing file input, or call " +
      "page.waitForFileChooser() before the action when the input is created dynamically.",
  ) as Error & { code: string };
  error.code = "EGO_FILE_CHOOSER_OPENED";
  return error;
}

function assertCdpCall(
  apiName: "Page.cdp" | "TaskSpace.cdp",
  method: string,
  params: Record<string, unknown>,
  options: CdpOptions,
): void {
  if (typeof method !== "string" || method.length === 0) {
    throw new TypeError("cdp method must be a non-empty string");
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("cdp params must be an object");
  }
  validatePublicApiOptions(apiName, options);
}

async function waitForTargetToDisappear(
  services: PageModelServices,
  targetId: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = services.now() + timeoutMs;
  while (true) {
    const tabs = await services.listTabs();
    if (!tabs.some((tab) => tab.targetId === targetId)) return true;
    const remaining = deadline - services.now();
    if (remaining <= 0) return false;
    await services.sleep(Math.min(PAGE_CLOSE_CONFIRM_INTERVAL_MS, remaining));
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
      const openedBy = ledger.unmanagedTargets[tab.targetId] || "unknown";
      return {
        targetId: tab.targetId,
        page: new UnmanagedPage(
          task,
          tab.targetId,
          openedBy,
          unmanagedPageConstructorToken,
        ),
        title: tab.title || "",
        url: tab.url || "",
        active: Boolean(tab.active),
        openedBy,
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
