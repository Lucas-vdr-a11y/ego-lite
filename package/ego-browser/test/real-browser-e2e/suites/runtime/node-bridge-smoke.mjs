export function createNodeBridgeSmokeSource(marker) {
  return `
    const profiles = await egoBrowser.listProfile();
    const taskSpaces = await egoBrowser.listTaskSpace();
    console.log(${JSON.stringify(marker)});
    console.log(JSON.stringify({
      egoType: typeof globalThis.ego,
      hasSendCDPMessage: typeof globalThis.ego?.sendCDPMessage,
      processVersion: process.version,
      egoBrowserType: typeof egoBrowser,
      hasListProfile: typeof egoBrowser?.listProfile,
      hasListTaskSpace: typeof egoBrowser?.listTaskSpace,
      useOrCreateTaskSpaceType: typeof egoBrowser?.useOrCreateTaskSpace,
      siteType: typeof site,
      fetchType: typeof fetch,
      cdpType: typeof cdp,
      helperType: typeof egoBrowser?.helper,
      profilesIsArray: Array.isArray(profiles),
      taskSpacesIsArray: Array.isArray(taskSpaces)
    }));
  `;
}

const outputChecks = ["marker", "runtimePayload"];
const probeChecks = [
  ["egoType", (probe) => probe?.egoType === "object"],
  ["hasSendCDPMessage", (probe) => probe?.hasSendCDPMessage === "function"],
  [
    "processVersion",
    (probe) => {
      const major = /^v(\d+)(?:\.|$)/.exec(probe?.processVersion)?.[1];
      return Number(major) >= 22;
    },
  ],
  ["egoBrowserType", (probe) => probe?.egoBrowserType === "object"],
  ["hasListProfile", (probe) => probe?.hasListProfile === "function"],
  ["hasListTaskSpace", (probe) => probe?.hasListTaskSpace === "function"],
  [
    "useOrCreateTaskSpaceType",
    (probe) => probe?.useOrCreateTaskSpaceType === "undefined",
  ],
  ["siteType", (probe) => probe?.siteType === "object"],
  ["fetchType", (probe) => probe?.fetchType === "function"],
  ["cdpType", (probe) => probe?.cdpType === "function"],
  ["helperType", (probe) => probe?.helperType === "function"],
  ["profilesIsArray", (probe) => probe?.profilesIsArray === true],
  ["taskSpacesIsArray", (probe) => probe?.taskSpacesIsArray === true],
];

export function parseNodeBridgeSmoke(stdout, marker) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const markerIndex = lines.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      "nodejs bridge did not print the console.log smoke marker; ego-browser nodejs may have exited without executing stdin",
    );
  }
  const payload = lines[markerIndex + 1];
  if (!payload) {
    throw new Error("nodejs bridge smoke did not print runtime probe data");
  }
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(
      `nodejs bridge smoke printed invalid runtime probe data: ${payload}`,
    );
  }
}

export function validateNodeBridgeProbe(probe) {
  const failures = probeChecks
    .filter(([, check]) => !check(probe))
    .map(([name]) => name);
  return { ok: failures.length === 0, failures };
}

export function nodeBridgeSmokeAssertionCount() {
  return outputChecks.length + probeChecks.length;
}
