import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { threadId } from "node:worker_threads";

type LeaseOptions = {
  heartbeatIntervalMs?: number;
  lockRoot?: string;
  staleAfterMs?: number;
};

type HeldLease = {
  heartbeatPath: string;
  id: number;
  path: string;
  timer: NodeJS.Timeout;
  token: string;
};

type LeaseOwner = {
  heartbeatIntervalMs?: number;
  pid: number;
  staleAfterMs?: number;
  threadId?: number;
  token: string;
};

const INCOMPLETE_LEASE_GRACE_MS = 5000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;
const DEFAULT_STALE_AFTER_MS = 5000;
let heldLease: HeldLease | undefined;
let exitHookInstalled = false;

export async function acquireTaskSpaceLease(
  id: number,
  options: LeaseOptions = {},
) {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error(`invalid TaskSpace id: ${JSON.stringify(id)}`);
  }

  const root = options.lockRoot || defaultLockRoot();
  const path = join(root, String(id));
  if (heldLease?.path === path) return false;

  mkdirSync(root, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (
    !Number.isFinite(heartbeatIntervalMs) ||
    heartbeatIntervalMs <= 0 ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= heartbeatIntervalMs
  ) {
    throw new Error(
      "TaskSpace lease requires staleAfterMs greater than heartbeatIntervalMs",
    );
  }
  while (true) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readOwner(path);
      if (!(await isStale(path, owner)) || !reclaim(path)) {
        const ownerLabel = owner?.pid ? ` (pid ${owner.pid})` : "";
        throw new Error(
          `TaskSpace ${id} is already controlled by another ego-browser process${ownerLabel}`,
        );
      }
      continue;
    }

    try {
      writeFileSync(
        join(path, "owner.json"),
        JSON.stringify({
          heartbeatIntervalMs,
          pid: process.pid,
          staleAfterMs,
          threadId,
          token,
        }),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      const heartbeatPath = join(path, `heartbeat-${token}`);
      writeFileSync(heartbeatPath, token, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const timer = setInterval(
        () => refreshHeartbeat(path, heartbeatPath, token),
        heartbeatIntervalMs,
      );
      timer.unref();
      releaseHeldLease();
      heldLease = { heartbeatPath, id, path, timer, token };
    } catch (error) {
      rmSync(path, { recursive: true, force: true });
      throw error;
    }

    installExitHook();
    return true;
  }
}

export function releaseTaskSpaceLease(id?: number) {
  if (!heldLease || (id !== undefined && heldLease.id !== id)) return;
  releaseHeldLease();
}

function defaultLockRoot() {
  const user = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(tmpdir(), `ego-browser-taskspace-leases-${user}`);
}

function readOwner(path: string): LeaseOwner | undefined {
  try {
    const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
    if (
      Number.isInteger(owner?.pid) &&
      owner.pid > 0 &&
      (owner.threadId === undefined ||
        (Number.isInteger(owner.threadId) && owner.threadId >= 0)) &&
      typeof owner.token === "string" &&
      (owner.heartbeatIntervalMs === undefined ||
        (Number.isFinite(owner.heartbeatIntervalMs) &&
          owner.heartbeatIntervalMs > 0)) &&
      (owner.staleAfterMs === undefined ||
        (Number.isFinite(owner.staleAfterMs) && owner.staleAfterMs > 0))
    ) {
      return owner;
    }
  } catch {}
  return undefined;
}

async function isStale(path: string, owner: LeaseOwner | undefined) {
  if (owner) {
    if (!isProcessAlive(owner.pid)) return true;
    if (
      owner.heartbeatIntervalMs === undefined ||
      owner.staleAfterMs === undefined
    ) {
      return false;
    }
    const staleAfterMs = owner.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    try {
      const heartbeat = statSync(join(path, `heartbeat-${owner.token}`));
      return Date.now() - heartbeat.mtimeMs > staleAfterMs;
    } catch {
      try {
        return Date.now() - statSync(path).mtimeMs > staleAfterMs;
      } catch {
        return true;
      }
    }
  }
  try {
    return Date.now() - statSync(path).mtimeMs > INCOMPLETE_LEASE_GRACE_MS;
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function reclaim(path: string) {
  const stalePath = `${path}.stale-${process.pid}-${randomUUID()}`;
  try {
    renameSync(path, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
  rmSync(stalePath, { recursive: true, force: true });
  return true;
}

function releaseHeldLease() {
  const lease = heldLease;
  heldLease = undefined;
  if (!lease) return;
  clearInterval(lease.timer);
  if (readOwner(lease.path)?.token !== lease.token) return;
  rmSync(lease.path, { recursive: true, force: true });
}

function refreshHeartbeat(path: string, heartbeatPath: string, token: string) {
  if (readOwner(path)?.token !== token) {
    if (heldLease?.token === token) releaseHeldLease();
    return;
  }
  try {
    const now = new Date();
    utimesSync(heartbeatPath, now, now);
  } catch {
    if (heldLease?.token === token) releaseHeldLease();
  }
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", releaseHeldLease);
}
