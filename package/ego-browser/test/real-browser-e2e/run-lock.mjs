// The real-browser suite drives one shared ego lite browser. Two concurrent
// runs do not fail loudly: the second run's TaskSpaces tear down the first
// run's, and both report cases that never really ran ("ego lite browser
// crashed, restarted, or disconnected before case-result.json was written").
// Those look exactly like product defects, so the cost of the missing guard is
// paid in debugging time, not in a visible error. This lock makes the second
// run refuse to start instead.

import { open, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";

export const E2E_LOCK_BUSY_EXIT_CODE = 2;

/** Serialises the holder record. Kept separate so tests can build fixtures. */
export function serializeLockHolder(holder) {
  return `${JSON.stringify(holder, null, 2)}\n`;
}

/**
 * A lock file written by a killed process can be truncated or empty, so an
 * unreadable record is treated as "no identifiable holder" rather than as a
 * reason to abort — otherwise a crash would wedge every later run.
 */
export function parseLockHolder(text) {
  try {
    const holder = JSON.parse(text);
    if (!holder || typeof holder !== "object") return null;
    if (!Number.isInteger(holder.pid) || holder.pid <= 0) return null;
    return holder;
  } catch {
    return null;
  }
}

/**
 * `process.kill(pid, 0)` sends no signal; it only asks whether the process
 * exists. EPERM means it exists under another user, which still counts as
 * alive. Only ESRCH proves the holder is gone.
 */
export function isHolderAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** A lock is only honoured on the machine that wrote it. */
export function isForeignHost(holder, host = hostname()) {
  return Boolean(holder?.host) && holder.host !== host;
}

export function formatLockConflict(holder, lockPath) {
  const startedAt = holder?.startedAt ? new Date(holder.startedAt) : null;
  const clock =
    startedAt && !Number.isNaN(startedAt.getTime())
      ? startedAt.toTimeString().slice(0, 8)
      : "unknown time";
  const pid = holder?.pid ?? "unknown";
  return [
    `real-browser e2e already running (PID ${pid}, started ${clock})`,
    "  The suite drives one shared ego lite browser; a second run would tear",
    "  down the first run's TaskSpaces and both would report false failures.",
    `  Wait for that run to finish, or stop it and delete ${lockPath}`,
  ].join("\n");
}

/**
 * Acquires the run lock, reclaiming it when the recorded holder is gone.
 *
 * Returns `{ ok: true, release }` on success, or `{ ok: false, message }` when
 * a live holder owns it. Never throws for the contended case — the caller
 * turns the message into a clean non-zero exit rather than a stack trace.
 */
export async function acquireE2eLock(lockPath, options = {}) {
  const {
    pid = process.pid,
    host = hostname(),
    now = () => new Date(),
    kill = process.kill.bind(process),
  } = options;

  // One retry only: the first EEXIST is resolved by either honouring a live
  // holder or clearing a dead one. A second EEXIST means another run won the
  // race for the freed lock, and it is now the legitimate holder.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const holder = parseLockHolder(
        await readFile(lockPath, "utf8").catch(() => ""),
      );
      if (
        holder &&
        !isForeignHost(holder, host) &&
        isHolderAlive(holder.pid, kill)
      ) {
        return {
          ok: false,
          holder,
          message: formatLockConflict(holder, lockPath),
        };
      }

      // Stale (crashed run, truncated file, or a lock copied from another
      // machine): clear it and try once more.
      await rm(lockPath, { force: true });
      continue;
    }

    const holder = { pid, host, startedAt: now().toISOString() };
    try {
      await handle.writeFile(serializeLockHolder(holder));
    } finally {
      await handle.close();
    }

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      // Only remove a lock we still own, so a run that reclaimed ours as stale
      // does not get its lock deleted out from under it.
      const current = parseLockHolder(
        await readFile(lockPath, "utf8").catch(() => ""),
      );
      if (current && current.pid !== pid) return;
      await rm(lockPath, { force: true });
    };
    return { ok: true, holder, release };
  }

  const holder = parseLockHolder(
    await readFile(lockPath, "utf8").catch(() => ""),
  );
  return {
    ok: false,
    holder,
    message: formatLockConflict(holder, lockPath),
  };
}
