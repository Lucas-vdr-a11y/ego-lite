import {
  ensureSession,
  isBrowserRuntime,
  pendingDialog,
} from "../browser-runtime.js";
import { js } from "../cdp-eval.js";

export type PageInfo =
  | {
      url: string;
      title: string;
      w: number;
      h: number;
      sx: number;
      sy: number;
      pw: number;
      ph: number;
    }
  | { dialog: object };

export async function readPageInfo(): Promise<PageInfo> {
  if (isBrowserRuntime()) {
    await ensureSession();
    const dialog = pendingDialog();
    if (dialog) {
      return { dialog };
    }
  }
  const expression =
    "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})";
  return JSON.parse(await js(expression));
}

export function hasDialog(info: PageInfo): info is { dialog: object } {
  return Object.hasOwn(info, "dialog");
}

export function hasValidViewport(info: PageInfo) {
  return !hasDialog(info) && info.w > 0 && info.h > 0;
}

export function invalidViewportError(info: PageInfo, context: string) {
  const details = hasDialog(info)
    ? "a native JavaScript dialog is pending"
    : `viewport=${info.w}x${info.h}, page=${info.pw}x${info.ph}, url=${info.url}`;
  const error: any = new Error(
    `EGO_INVALID_VIEWPORT: ${context} requires a non-zero viewport; ${details}`,
  );
  error.code = "EGO_INVALID_VIEWPORT";
  error.details = { context, pageInfo: info };
  return error;
}

export function assertValidViewport(info: PageInfo, context: string) {
  if (!hasValidViewport(info)) {
    throw invalidViewportError(info, context);
  }
}
