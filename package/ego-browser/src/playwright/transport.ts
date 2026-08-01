import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  createEgoCdpTransport,
  type EgoCdpRuntime,
  type EgoCdpTransport,
  type TransportOptions,
} from "./routing.js";

type WebSocketTransportClass = {
  connect: (
    progress: unknown,
    endpoint: string,
    options?: unknown,
  ) => Promise<unknown>;
};

type PlaywrightTransportOptions = TransportOptions & {
  WebSocketTransport?: WebSocketTransportClass;
};

type TransportRegistration = {
  runtime: EgoCdpRuntime;
  options: TransportOptions;
  transports: Set<EgoCdpTransport>;
  connected: boolean;
};

type TransportHook = {
  originalConnect: WebSocketTransportClass["connect"];
  patchedConnect: WebSocketTransportClass["connect"];
  registrations: Map<string, TransportRegistration>;
};

const transportHooks = new WeakMap<WebSocketTransportClass, TransportHook>();

// Playwright routes connectOverCDP through this private transport class. The
// ws+ego value is only an in-process lookup token; it is intercepted before any
// WebSocket client, socket, DNS lookup, or network request can be created.
export async function createEgoPlaywrightTransport(
  runtime: EgoCdpRuntime,
  options: PlaywrightTransportOptions = {},
) {
  const WebSocketTransport =
    options.WebSocketTransport || loadPlaywrightWebSocketTransport();
  const hook = installTransportHook(WebSocketTransport);
  const connectToken = `ws+ego://transport/${randomUUID()}`;
  const registration: TransportRegistration = {
    runtime,
    options,
    transports: new Set(),
    connected: false,
  };
  hook.registrations.set(connectToken, registration);

  return {
    connectToken,
    connected: () => {
      registration.connected = true;
      for (const transport of registration.transports) {
        transport.releaseConnectionKeepAlive();
      }
    },
    close: async () => {
      if (!hook.registrations.delete(connectToken)) return;
      for (const transport of registration.transports) {
        await transport.closeAndWait();
      }
      registration.transports.clear();
      if (
        hook.registrations.size === 0 &&
        WebSocketTransport.connect === hook.patchedConnect
      ) {
        WebSocketTransport.connect = hook.originalConnect;
        transportHooks.delete(WebSocketTransport);
      }
    },
  };
}

function installTransportHook(WebSocketTransport: WebSocketTransportClass) {
  const existing = transportHooks.get(WebSocketTransport);
  if (existing) return existing;

  const originalConnect = WebSocketTransport.connect;
  const hook: TransportHook = {
    originalConnect,
    registrations: new Map(),
    patchedConnect: async function (progress, endpoint, options) {
      const registration = hook.registrations.get(endpoint);
      if (!registration) {
        return originalConnect.call(this, progress, endpoint, options);
      }
      const selected = await selectedTargets(registration.runtime);
      const transport = createEgoCdpTransport(registration.runtime, {
        ...registration.options,
        ...selected,
      });
      if (registration.connected) transport.releaseConnectionKeepAlive();
      registration.transports.add(transport);
      return transport;
    },
  };
  WebSocketTransport.connect = hook.patchedConnect;
  transportHooks.set(WebSocketTransport, hook);
  return hook;
}

async function selectedTargets(runtime: EgoCdpRuntime) {
  if (typeof runtime.listTabs !== "function") return {};
  const listed = await runtime.listTabs();
  const tabs = listed?.tabs || listed?.targetInfos || [];
  const targetIds = tabs
    .map((tab) => tab.targetId)
    .filter((targetId): targetId is string => typeof targetId === "string");
  return { targetIds };
}

function loadPlaywrightWebSocketTransport(): WebSocketTransportClass {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("playwright-core/package.json");
  return require(join(dirname(packageJson), "lib/server/transport.js"))
    .WebSocketTransport;
}
