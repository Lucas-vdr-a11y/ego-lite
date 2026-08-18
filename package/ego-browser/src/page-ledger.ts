import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type PageOrigin = "agent" | "user" | "unknown";

export type PageLedgerEntry = {
  targetId: string;
  openedBy: PageOrigin;
  openedAt: number;
  lastUsedAt: number;
};

export type ManagedPage = PageLedgerEntry & {
  label: string;
};

export type PageLedger = {
  spaceId: number;
  version: number;
  writerRound: string;
  nextLabel: number;
  usedLabels: string[];
  pages: Record<string, PageLedgerEntry>;
  touchedAt: number;
};

type PageLedgerStoreOptions = {
  rootDir?: string;
  roundId?: string;
  now?: () => number;
};

type AddPageOptions = {
  as?: string;
  openedBy?: PageOrigin;
};

export class PageLedgerConflictError extends Error {
  readonly spaceId: number;
  readonly expectedVersion: number;
  readonly actualVersion: number;
  readonly writerRound: string;

  constructor(
    spaceId: number,
    expectedVersion: number,
    actualVersion: number,
    writerRound: string,
  ) {
    super(
      `another process changed page state for space ${spaceId} ` +
        `(expected version ${expectedVersion}, found ${actualVersion})`,
    );
    this.name = "PageLedgerConflictError";
    this.spaceId = spaceId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    this.writerRound = writerRound;
  }
}

/**
 * Stores durable page labels in one JSON document per task space. Each update
 * replaces the complete document with an atomic rename so readers never see a
 * partially written ledger.
 */
export class PageLedgerStore {
  readonly rootDir: string;
  readonly roundId: string;
  readonly #now: () => number;
  readonly #expectedVersions = new Map<number, number>();
  #temporarySequence = 0;

  constructor(options: PageLedgerStoreOptions = {}) {
    this.rootDir =
      options.rootDir ||
      process.env.EGO_BROWSER_STATE_DIR ||
      join(homedir(), ".ego-browser", "state");
    this.roundId = options.roundId || randomUUID();
    this.#now = options.now || (() => Date.now());
  }

  async read(spaceId: number): Promise<PageLedger> {
    assertSpaceId(spaceId);
    const ledger = await this.#readCurrent(spaceId);
    if (!this.#expectedVersions.has(spaceId)) {
      this.#expectedVersions.set(spaceId, ledger.version);
    }
    return cloneLedger(ledger);
  }

  async getPage(spaceId: number, label: string): Promise<ManagedPage> {
    assertLabel(label);
    const ledger = await this.read(spaceId);
    const entry = ledger.pages[label];
    if (entry) return { label, ...entry };
    if (ledger.usedLabels.includes(label)) {
      throw new Error(`page ${label} was closed`);
    }
    throw new Error(`page label not found: ${label}`);
  }

  async addPage(
    spaceId: number,
    targetId: string,
    options: AddPageOptions = {},
  ): Promise<ManagedPage> {
    assertTargetId(targetId);
    if (options.as !== undefined) assertLabel(options.as);
    const now = this.#now();
    let added: ManagedPage;
    await this.#update(spaceId, (ledger) => {
      const existing = Object.entries(ledger.pages).find(
        ([, page]) => page.targetId === targetId,
      );
      if (existing) {
        throw new Error(`target ${targetId} is already page ${existing[0]}`);
      }

      const used = new Set(ledger.usedLabels);
      const label = options.as || nextAutomaticLabel(ledger, used);
      if (used.has(label)) {
        throw new Error(`page label already used: ${label}`);
      }
      const entry: PageLedgerEntry = {
        targetId,
        openedBy: options.openedBy || "agent",
        openedAt: now,
        lastUsedAt: now,
      };
      ledger.usedLabels.push(label);
      ledger.pages[label] = entry;
      added = { label, ...entry };
    });
    return added!;
  }

  async closePage(spaceId: number, label: string): Promise<ManagedPage> {
    assertLabel(label);
    let removed: ManagedPage;
    await this.#update(spaceId, (ledger) => {
      const entry = ledger.pages[label];
      if (!entry) {
        if (ledger.usedLabels.includes(label)) {
          throw new Error(`page ${label} was closed`);
        }
        throw new Error(`page label not found: ${label}`);
      }
      removed = { label, ...entry };
      delete ledger.pages[label];
    });
    return removed!;
  }

  async #update(
    spaceId: number,
    mutate: (ledger: PageLedger) => void,
  ): Promise<PageLedger> {
    assertSpaceId(spaceId);
    const current = await this.#readCurrent(spaceId);
    const expected = this.#expectedVersions.get(spaceId);
    if (expected !== undefined && current.version !== expected) {
      throw new PageLedgerConflictError(
        spaceId,
        expected,
        current.version,
        current.writerRound,
      );
    }
    if (expected === undefined) {
      this.#expectedVersions.set(spaceId, current.version);
    }

    const next = cloneLedger(current);
    mutate(next);
    next.version = current.version + 1;
    next.writerRound = this.roundId;
    next.touchedAt = this.#now();
    await this.#writeAtomic(spaceId, next);
    this.#expectedVersions.set(spaceId, next.version);
    return cloneLedger(next);
  }

  async #readCurrent(spaceId: number): Promise<PageLedger> {
    const path = this.#path(spaceId);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return emptyLedger(spaceId);
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`invalid page ledger ${path}: ${error.message}`);
    }
    return validateLedger(parsed, spaceId, path);
  }

  async #writeAtomic(spaceId: number, ledger: PageLedger): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const path = this.#path(spaceId);
    const temporary = `${path}.${process.pid}.${this.roundId}.${++this.#temporarySequence}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  #path(spaceId: number): string {
    return join(this.rootDir, `space-${spaceId}.json`);
  }
}

function emptyLedger(spaceId: number): PageLedger {
  return {
    spaceId,
    version: 0,
    writerRound: "",
    nextLabel: 1,
    usedLabels: [],
    pages: {},
    touchedAt: 0,
  };
}

function nextAutomaticLabel(ledger: PageLedger, used: Set<string>): string {
  let sequence = ledger.nextLabel;
  let label = `p${sequence}`;
  while (used.has(label)) {
    sequence += 1;
    label = `p${sequence}`;
  }
  ledger.nextLabel = sequence + 1;
  return label;
}

function validateLedger(
  value: unknown,
  expectedSpaceId: number,
  path: string,
): PageLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid page ledger ${path}: expected an object`);
  }
  const ledger = value as PageLedger;
  if (
    ledger.spaceId !== expectedSpaceId ||
    !Number.isInteger(ledger.version) ||
    ledger.version < 0 ||
    typeof ledger.writerRound !== "string" ||
    !Number.isInteger(ledger.nextLabel) ||
    ledger.nextLabel < 1 ||
    !Array.isArray(ledger.usedLabels) ||
    ledger.usedLabels.some((label) => typeof label !== "string") ||
    !ledger.pages ||
    typeof ledger.pages !== "object" ||
    Array.isArray(ledger.pages) ||
    typeof ledger.touchedAt !== "number"
  ) {
    throw new Error(`invalid page ledger ${path}: schema mismatch`);
  }
  for (const [label, page] of Object.entries(ledger.pages)) {
    if (
      !ledger.usedLabels.includes(label) ||
      !page ||
      typeof page.targetId !== "string" ||
      !["agent", "user", "unknown"].includes(page.openedBy) ||
      typeof page.openedAt !== "number" ||
      typeof page.lastUsedAt !== "number"
    ) {
      throw new Error(`invalid page ledger ${path}: invalid page ${label}`);
    }
  }
  return cloneLedger(ledger);
}

function cloneLedger(ledger: PageLedger): PageLedger {
  return structuredClone(ledger);
}

function assertSpaceId(spaceId: number): void {
  if (!Number.isInteger(spaceId) || spaceId < 0) {
    throw new TypeError("spaceId must be a non-negative integer");
  }
}

function assertTargetId(targetId: string): void {
  if (typeof targetId !== "string" || targetId.length === 0) {
    throw new TypeError("targetId must be a non-empty string");
  }
}

function assertLabel(label: string): void {
  if (
    typeof label !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(label)
  ) {
    throw new TypeError(
      "page label must start with a letter and contain only letters, numbers, _ or -",
    );
  }
}
