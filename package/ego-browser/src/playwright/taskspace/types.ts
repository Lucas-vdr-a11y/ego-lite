import type { Browser, BrowserContext, Page } from "playwright-core";

export type PlaywrightTaskSpaceSession = {
  page: Page;
  context: BrowserContext;
  close: () => Promise<void>;
};

export type PlaywrightTaskSpaceConnector = (
  space: Record<string, unknown>,
) => Promise<PlaywrightTaskSpaceSession>;

export type EgoPlaywrightRuntime = {
  listTabs?: () => Promise<{
    tabs?: EgoTab[];
    targetInfos?: EgoTab[];
  }>;
  createTab?: (
    url?: string,
  ) => Promise<
    | { targetId?: string; result?: { targetId?: string }; error?: unknown }
    | unknown
  >;
  sendCDPMessage?: (payload: string) => unknown;
  onCDPMessage?: (payload: string) => void;
  onSendCDPMessageError?: (message: unknown, errorCode?: string) => void;
};

export type EgoTab = {
  targetId?: string;
  active?: boolean;
  type?: string;
  title?: string;
  url?: string;
};

export type PlaywrightConnectorDependencies = {
  runtime: () => EgoPlaywrightRuntime;
  transport: (
    runtime: EgoPlaywrightRuntime,
    space: Record<string, unknown>,
  ) => Promise<PlaywrightTransportLease>;
  connectOverCDP: (connectToken: string) => Promise<Browser>;
  prepareSession?: (session: PlaywrightTaskSpaceSession) => Promise<void>;
  bringUpTimeoutMs?: number;
};

export type PlaywrightTransportLease = {
  connectToken: string;
  connected?: () => void;
  close?: () => Promise<void>;
};
