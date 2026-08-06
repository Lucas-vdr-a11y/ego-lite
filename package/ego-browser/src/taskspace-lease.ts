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

type TakenOverFrom = {
  heartbeatAgeMs?: number;
  pid: number;
  threadId?: number;
  token: string;
};

type LeaseLostHandler = (lost: { id: number }) => void;

const DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;
const DEFAULT_STALE_AFTER_MS = 5000;
// A takeover normally needs exactly one reclaim round; more means another
// session is racing us for the same TaskSpace, and the last writer wins.
const MAX_TAKEOVER_ROUNDS = 5;
let heldLease: HeldLease | undefined;
let exitHookInstalled = false;
let leaseLostHandler: LeaseLostHandler | undefined;

/**
 * Register the handler invoked when a newer session takes over this session's
 * TaskSpace lease. The heartbeat detects the foreign owner within one
 * interval; the handler must stop this session from driving the TaskSpace.
 */
export function onTaskSpaceLeaseLost(handler?: LeaseLostHandler) {
  leaseLostHandler = handler;
}

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
  let takenOverFrom: TakenOverFrom | undefined;
  let reclaimRounds = 0;
  let incompleteWaitDeadline: number | undefined;
  while (true) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (reclaimRounds >= MAX_TAKEOVER_ROUNDS) {
        throw new Error(
          `TaskSpace ${id} lease takeover did not settle after ${MAX_TAKEOVER_ROUNDS} rounds`,
        );
      }
      const owner = readOwner(path);
      if (!owner) {
        // A directory without owner.json is another acquire caught between
        // mkdir and its owner publish. Give it staleAfterMs to finish before
        // treating it as abandoned — reclaiming mid-publish strands both
        // sessions: this one deletes the directory the other is writing into.
        const age = leaseDirAgeMs(path);
        incompleteWaitDeadline ??= Date.now() + staleAfterMs;
        if (
          age !== undefined &&
          age < staleAfterMs &&
          Date.now() < incompleteWaitDeadline
        ) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(50, heartbeatIntervalMs)),
          );
          continue;
        }
      }
      // Newest session wins: reclaim whatever is there, keeping the previous
      // owner as an audit trail. The previous session's heartbeat notices the
      // foreign token within one interval and stops itself through the
      // lease-lost handler.
      reclaimRounds += 1;
      const heartbeatAgeMs = ownerHeartbeatAgeMs(path, owner);
      if (reclaim(path) && owner) {
        takenOverFrom = {
          ...(heartbeatAgeMs === undefined ? {} : { heartbeatAgeMs }),
          pid: owner.pid,
          threadId: owner.threadId,
          token: owner.token,
        };
      }
      continue;
    }

    try {
      writeFileSync(
        join(path, "owner.json"),
        JSON.stringify({
          heartbeatIntervalMs,
          pid: process.pid,
          since: new Date().toISOString(),
          staleAfterMs,
          ...(takenOverFrom ? { takenOverFrom } : {}),
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
      // Clean up only if our own owner file made it in: a failed publish must
      // not delete a lease directory another session owns by now.
      if (readOwner(path)?.token === token) {
        rmSync(path, { recursive: true, force: true });
      }
      throw error;
    }

    if (takenOverFrom) {
      const age =
        takenOverFrom.heartbeatAgeMs === undefined
          ? ""
          : ` (heartbeat ${Math.round(takenOverFrom.heartbeatAgeMs / 1000)}s old)`;
      // console.log, not console.error: in SDK mode only console.log is routed
      // to the agent-visible output channel; stderr never leaves the runtime.
      console.log(
        `[ego-browser] TaskSpace ${id}: took over the lease from session ` +
          `${takenOverFrom.token.slice(0, 8)}${age}; if that session is still ` +
          "running it will stop shortly.",
      );
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

function ownerHeartbeatAgeMs(path: string, owner: LeaseOwner | undefined) {
  if (!owner) return undefined;
  try {
    const heartbeat = statSync(join(path, `heartbeat-${owner.token}`));
    return Math.max(0, Date.now() - heartbeat.mtimeMs);
  } catch {
    return undefined;
  }
}

function leaseDirAgeMs(path: string) {
  try {
    return Math.max(0, Date.now() - statSync(path).mtimeMs);
  } catch {
    return undefined;
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

function loseHeldLease(token: string) {
  if (heldLease?.token !== token) return;
  const { id } = heldLease;
  releaseHeldLease();
  try {
    leaseLostHandler?.({ id });
  } catch {}
}

function refreshHeartbeat(path: string, heartbeatPath: string, token: string) {
  if (readOwner(path)?.token !== token) {
    loseHeldLease(token);
    return;
  }
  try {
    const now = new Date();
    utimesSync(heartbeatPath, now, now);
  } catch {
    loseHeldLease(token);
  }
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", releaseHeldLease);
}
