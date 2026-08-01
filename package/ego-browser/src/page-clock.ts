import { cdp } from "./cdp-eval.js";

export function createPageClock() {
  let installed = false;
  const call = async (method, value = undefined) => {
    if (!installed && method !== "install" && method !== "setFixedTime") {
      throw new Error(
        "page.clock.install() must be called before controlling time",
      );
    }
    const expression = `globalThis.__egoClock.${method}(${value === undefined ? "" : JSON.stringify(value)})`;
    await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
  };
  return {
    install: async (options: any = {}) => {
      const source = clockBootstrap();
      await cdp("Page.addScriptToEvaluateOnNewDocument", { source });
      await cdp("Runtime.evaluate", {
        expression: source,
        returnByValue: true,
        awaitPromise: false,
      });
      await call("install", timeValue(options.time ?? Date.now()));
      installed = true;
    },
    fastForward: (ticks) => call("fastForward", ticksValue(ticks)),
    pauseAt: (time) => call("pauseAt", timeValue(time)),
    resume: () => call("resume"),
    runFor: (ticks) => call("runFor", ticksValue(ticks)),
    setFixedTime: async (time) => {
      if (!installed) {
        const source = clockBootstrap();
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source });
        await cdp("Runtime.evaluate", {
          expression: source,
          returnByValue: true,
          awaitPromise: false,
        });
        installed = true;
      }
      await call("setFixedTime", timeValue(time));
    },
    setSystemTime: (time) => call("setSystemTime", timeValue(time)),
  };
}

function timeValue(value) {
  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) throw new TypeError("Clock time is invalid");
  return time;
}

function ticksValue(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("Clock ticks must be a non-negative number");
    }
    return value;
  }
  if (!/^\d+(?::\d{2}){0,2}$/.test(String(value))) {
    throw new TypeError("Clock ticks string must use SS, MM:SS, or HH:MM:SS");
  }
  return (
    String(value)
      .split(":")
      .reduce((total, part) => total * 60 + Number(part), 0) * 1000
  );
}

function clockBootstrap() {
  return `(() => {
    if (globalThis.__egoClock) return;
    const NativeDate = Date;
    const nativeSetTimeout = setTimeout.bind(globalThis);
    const nativeClearTimeout = clearTimeout.bind(globalThis);
    let now = NativeDate.now();
    let realBase = NativeDate.now();
    let paused = false;
    let fixed = false;
    let nextId = 1;
    const timers = new Map();
    const current = () => fixed || paused ? now : now + NativeDate.now() - realBase;
    const clearNative = timer => { if (timer.nativeId !== undefined) nativeClearTimeout(timer.nativeId); timer.nativeId = undefined; };
    const invoke = timer => {
      if (!timers.has(timer.id)) return;
      if (timer.interval > 0) timer.at = current() + timer.interval;
      else timers.delete(timer.id);
      timer.callback(...timer.args);
      if (timer.interval > 0 && timers.has(timer.id) && !paused) scheduleNative(timer);
    };
    const scheduleNative = timer => {
      clearNative(timer);
      timer.nativeId = nativeSetTimeout(() => invoke(timer), Math.max(0, timer.at - current()));
    };
    const schedule = (callback, delay, interval, args) => {
      const id = nextId++;
      const timer = { id, callback, args, interval, at: current() + Math.max(0, Number(delay) || 0), nativeId: undefined };
      timers.set(id, timer);
      if (!paused) scheduleNative(timer);
      return id;
    };
    const pause = () => {
      if (paused) return;
      now = current(); paused = true; fixed = false;
      for (const timer of timers.values()) clearNative(timer);
    };
    const advance = (milliseconds, repeat) => {
      pause();
      const target = now + milliseconds;
      const fired = new Set();
      for (let guard = 0; guard < 100000; guard += 1) {
        const due = [...timers.values()].filter(timer => timer.at <= target && (repeat || !fired.has(timer.id))).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at; fired.add(due.id);
        if (due.interval > 0) due.at += due.interval; else timers.delete(due.id);
        due.callback(...due.args);
      }
      now = target;
    };
    class FakeDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [current()])); }
      static now() { return current(); }
    }
    globalThis.Date = FakeDate;
    globalThis.setTimeout = (callback, delay, ...args) => schedule(callback, delay, 0, args);
    globalThis.clearTimeout = id => { const timer = timers.get(id); if (timer) clearNative(timer); timers.delete(id); };
    globalThis.setInterval = (callback, delay, ...args) => schedule(callback, delay, Math.max(1, Number(delay) || 0), args);
    globalThis.clearInterval = globalThis.clearTimeout;
    globalThis.requestAnimationFrame = callback => schedule(() => callback(current()), 16, 0, []);
    globalThis.cancelAnimationFrame = globalThis.clearTimeout;
    globalThis.requestIdleCallback = callback => schedule(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0, 0, []);
    globalThis.cancelIdleCallback = globalThis.clearTimeout;
    globalThis.__egoClock = {
      install(time) { now = Number(time); realBase = NativeDate.now(); paused = false; fixed = false; },
      fastForward(ticks) { advance(Number(ticks), false); },
      pauseAt(time) { const target = Number(time); advance(Math.max(0, target - current()), false); now = target; },
      resume() { if (!paused) return; paused = false; fixed = false; realBase = NativeDate.now(); for (const timer of timers.values()) scheduleNative(timer); },
      runFor(ticks) { advance(Number(ticks), true); },
      setFixedTime(time) { pause(); now = Number(time); fixed = true; },
      setSystemTime(time) { const running = !paused; now = Number(time); realBase = NativeDate.now(); if (running) { paused = false; for (const timer of timers.values()) scheduleNative(timer); } },
    };
  })()`;
}
