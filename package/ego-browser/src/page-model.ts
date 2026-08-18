import {
  browserCdp,
  browserEgo,
  invalidateSession,
  setPreferredTarget,
} from "./browser-runtime.js";
import { snapshotRaw } from "./driver/observe.js";
import { assertNoEgoError } from "./ego-errors.js";
import {
  withPage as defaultWithPage,
  withSpace as defaultWithSpace,
  type PageExecutionContext,
} from "./native-gate.js";
import {
  PageLedgerStore,
  type ManagedPage,
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
  invalidateSession(targetId: string): void;
  setPreferredTarget(targetId: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
};

const defaultLedger = new PageLedgerStore();

const defaultGate: OperationGate = {
  withSpace: defaultWithSpace,
  withPage: defaultWithPage,
};

const defaultServices: PageModelServices = {
  ledger: defaultLedger,
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
  return new TaskSpace(descriptor, { ...defaultServices, ...overrides });
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

  async newPage(
    url = "about:blank",
    options: NewPageOptions = {},
  ): Promise<Page> {
    assertUrl(url);
    return this.#services.gate.withSpace(this.id, async () => {
      const targetId = await this.#services.createTab(url);
      this.#services.setPreferredTarget(targetId);
      let entry: ManagedPage;
      try {
        entry = await this.#services.ledger.addPage(this.id, targetId, {
          as: options.as,
          openedBy: "agent",
        });
      } catch (error) {
        // A tab without a committed label cannot be returned safely. Close it
        // while the same space is still selected, then surface the ledger error.
        await this.#services
          .cdp("Target.closeTarget", { targetId })
          .catch(() => {});
        this.#services.invalidateSession(targetId);
        throw error;
      }
      return new Page(this, entry.label, this.#services, entry);
    });
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
      await this.#services.cdp("Target.activateTarget", {
        targetId: page.targetId,
      });
      this.#services.setPreferredTarget(page.targetId);
      const result = await this.#services.snapshot({
        scope: "full_page",
        includeActionMarks: true,
        includeStableLocator: true,
        ...options,
      });
      return result?.content || "";
    });
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
