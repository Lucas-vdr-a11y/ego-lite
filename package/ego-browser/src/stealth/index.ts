import { cdp } from "../cdp-eval.js";
import {
  browserEgo,
  browserCdp,
  subscribeBrowserEvent,
} from "../browser-runtime.js";
import { buildStealthScript } from "./script.js";
import { type Persona, listPersonaSummaries, pickPersona } from "./personas.js";

export type EnableStealthOptions = {
  /** Persona id, substring, or numeric index. Omit for a random pick. */
  persona?: string | number;
  /** Force a random persona even if EGO_STEALTH_PERSONA is set. */
  random?: boolean;
  /** Skip applying to already-open tabs (only future navigations). */
  currentTabOnly?: boolean;
};

let activeScriptId: string | null = null;
let activePersona: Persona | null = null;
let unsubscribe: (() => void) | null = null;

export function currentPersona(): Persona | null {
  return activePersona;
}

export function listPersonas() {
  return listPersonaSummaries();
}

function resolvePersona(options: EnableStealthOptions = {}): Persona {
  if (options.random) {
    return pickPersona(undefined);
  }
  const envSelector = process.env.EGO_STEALTH_PERSONA;
  if (options.persona !== undefined) {
    return pickPersona(options.persona);
  }
  if (envSelector) {
    return pickPersona(envSelector);
  }
  return pickPersona(undefined);
}

async function injectOnSession(
  sessionId: string | undefined,
  persona: Persona,
): Promise<string | null> {
  const result = await browserCdp(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: buildStealthScript(persona) },
    sessionId,
  );
  return result?.identifier || result?.result?.identifier || null;
}

/**
 * Enable anti-detection for the attached browser. Applies a consistent persona
 * (User-Agent + Client Hints, timezone, locale) and injects the fingerprint
 * spoofing payload into every current and future page target.
 */
export async function enableStealth(
  options: EnableStealthOptions = {},
): Promise<Persona> {
  const persona = resolvePersona(options);
  activePersona = persona;

  await cdp("Emulation.setUserAgentOverride", {
    userAgent: persona.userAgent,
    acceptLanguage: persona.acceptLanguage,
    platform: persona.platform,
    userAgentMetadata: persona.secChUa,
  });
  await cdp("Emulation.setTimezoneOverride", {
    timezoneId: persona.timezone,
  });

  const scriptId = await injectOnSession(undefined, persona);
  if (scriptId) {
    activeScriptId = scriptId;
  }

  if (!options.currentTabOnly) {
    await applyStealthToAllTabs();
  }
  installAutoApply();
  return persona;
}

/**
 * Rotate to a fresh identity: tear down the active persona (UA/timezone/
 * injected payload) and enable a new random one. Use on challenge failure — a
 * fresh proxy+persona tuple beats retrying the same fingerprint against the
 * same detector that already flagged it.
 */
export async function rotate(
  options: { random?: boolean } = {},
): Promise<Persona | null> {
  await disableStealth();
  return enableStealth({ random: options.random ?? true });
}

/**
 * Re-apply the active persona's payload to every currently open page target.
 * Useful after opening new tabs outside of enableStealth's auto-apply path.
 */
export async function applyStealthToAllTabs(): Promise<number> {
  if (!activePersona) {
    return 0;
  }
  const ego = browserEgo();
  if (!ego || typeof ego.listTabs !== "function") {
    return 0;
  }
  let raw: any;
  try {
    raw = await ego.listTabs();
  } catch {
    return 0;
  }
  const tabs: any[] = raw?.tabs || raw?.targetInfos || [];
  let applied = 0;
  for (const tab of tabs) {
    const url: string = tab?.url || "";
    const type: string = tab?.type || "";
    if (type && type !== "page") continue;
    if (!/^https?:/i.test(url)) continue;
    const targetId: string | undefined = tab?.targetId;
    if (!targetId) continue;
    try {
      const attached = await browserCdp("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const sessionId: string | undefined =
        attached?.sessionId || attached?.result?.sessionId;
      if (!sessionId) continue;
      await injectOnSession(sessionId, activePersona);
      applied += 1;
    } catch {
      // Skip targets we cannot attach to (e.g. the host's own UI surfaces).
    }
  }
  return applied;
}

function installAutoApply() {
  if (unsubscribe) return;
  unsubscribe = subscribeBrowserEvent(
    "Target.targetCreated",
    undefined,
    async (event: any) => {
      const info = event?.params?.targetInfo;
      if (!info || info.type !== "page") return;
      const url: string = info.url || "";
      if (!/^https?:/i.test(url)) return;
      if (!activePersona) return;
      const targetId: string | undefined = info.targetId;
      if (!targetId) return;
      try {
        const attached = await browserCdp("Target.attachToTarget", {
          targetId,
          flatten: true,
        });
        const sessionId: string | undefined =
          attached?.sessionId || attached?.result?.sessionId;
        if (sessionId) {
          await injectOnSession(sessionId, activePersona);
        }
      } catch {
        // best-effort for late-created targets
      }
    },
  );
}

/**
 * Disable anti-detection: remove the injected payload and restore the default
 * User-Agent and timezone.
 */
export async function disableStealth(): Promise<void> {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (activeScriptId) {
    try {
      await cdp("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: activeScriptId,
      });
    } catch {
      // ignore removal failures
    }
  }
  try {
    await cdp("Emulation.setUserAgentOverride", { userAgent: "" });
  } catch {
    // ignore
  }
  try {
    await cdp("Emulation.setTimezoneOverride", { timezoneId: "" });
  } catch {
    // ignore
  }
  activeScriptId = null;
  activePersona = null;
}

export { PERSONAS } from "./personas.js";
export { buildStealthScript } from "./script.js";
