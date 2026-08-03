export type FunctionParamDoc = {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
};

export type FunctionDoc = {
  signature: string;
  description: string;
  params?: FunctionParamDoc[];
  returns?: string;
  example?: string;
};

export const PUBLIC_API_DOCS: Record<string, FunctionDoc> = {
  "egoBrowser.showTaskState": {
    signature: "egoBrowser.showTaskState(state) => Promise<unknown>",
    description:
      "Show concise user-visible progress text for the current TaskSpace. Call it immediately before a semantic pointer action such as clicking, double-clicking, hovering, dragging, or scrolling.",
    params: [
      {
        name: "state",
        type: "string",
        required: true,
        description:
          "A concise description of 3-6 words or 3-6 Chinese characters.",
      },
    ],
    returns: "Promise<unknown>",
    example: "await egoBrowser.showTaskState('open account settings')",
  },
  "egoBrowser.listProfile": {
    signature: "egoBrowser.listProfile() => Promise<ProfileInfo[]>",
    description:
      "List browser profiles available when creating a TaskSpace. Pass profile.id, not its potentially duplicated display name, to newTaskSpace().",
    returns: "Promise<ProfileInfo[]>",
    example: "console.log(await egoBrowser.listProfile())",
  },
  "egoBrowser.listTaskSpace": {
    signature: "egoBrowser.listTaskSpace() => Promise<TaskSpaceInfo[]>",
    description:
      "List lightweight information for all browser TaskSpaces without selecting one. Use switchTaskSpace() to obtain an operational TaskSpace.",
    returns: "Promise<TaskSpaceInfo[]>",
    example: "console.log(await egoBrowser.listTaskSpace())",
  },
  "egoBrowser.newTaskSpace": {
    signature:
      "egoBrowser.newTaskSpace(name, profileId?) => Promise<TaskSpace>",
    description:
      "Create and select an agent-owned TaskSpace, optionally using a profile id returned by listProfile(). The selected profile determines the TaskSpace browser identity, cookies, storage, and login state.",
    params: [
      {
        name: "name",
        type: "string",
        required: true,
        description: "TaskSpace name.",
      },
      {
        name: "profileId",
        type: "string",
        description:
          "Optional profile.id returned by listProfile(). Omit it to use the current default regular profile.",
      },
    ],
    returns: "Promise<TaskSpace>",
    example:
      "const space = await egoBrowser.newTaskSpace('inspect products', profile.id)",
  },
  "egoBrowser.switchTaskSpace": {
    signature: "egoBrowser.switchTaskSpace(nameOrId) => Promise<TaskSpace>",
    description:
      "Select an existing agent-owned TaskSpace and return it with native Playwright page and context objects.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        required: true,
        description: "TaskSpace name or numeric id.",
      },
    ],
    returns: "Promise<TaskSpace>",
    example: "const space = await egoBrowser.switchTaskSpace(taskSpaceId)",
  },
  "egoBrowser.completeTaskSpace": {
    signature:
      "egoBrowser.completeTaskSpace(nameOrId) => Promise<TaskSpaceActionResult>",
    description:
      "Complete a TaskSpace while preserving its tabs and final result for the user. Returns a structured completion result; runtime failures throw with their reason.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        required: true,
        description: "TaskSpace name or numeric id.",
      },
    ],
    returns: 'Promise<{ done: true } | { done: false, skipped: "user-owned" }>',
    example: "console.log(await egoBrowser.completeTaskSpace(space.id))",
  },
  "egoBrowser.closeTaskSpace": {
    signature:
      "egoBrowser.closeTaskSpace(nameOrId) => Promise<TaskSpaceActionResult>",
    description:
      "Destructively close a TaskSpace and all of its tabs. Use completeTaskSpace when the result should remain visible. Returns a structured completion result; runtime failures throw with their reason.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        required: true,
        description: "TaskSpace name or numeric id.",
      },
    ],
    returns: 'Promise<{ done: true } | { done: false, skipped: "user-owned" }>',
    example: "console.log(await egoBrowser.closeTaskSpace(space.id))",
  },
  "egoBrowser.useOrCreateTaskSpace": {
    signature:
      "egoBrowser.useOrCreateTaskSpace(nameOrId) => Promise<TaskSpace>",
    description:
      "Select an existing TaskSpace or create one by name, returning native Playwright page and context objects. A user-owned match remains user-owned and is not claimed.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        required: true,
        description: "Task space name, taskId, or numeric id.",
      },
    ],
    returns: "Promise<TaskSpace>",
    example:
      "const task = await egoBrowser.useOrCreateTaskSpace('google sheets task')",
  },
  "egoBrowser.claimTaskSpace": {
    signature: "egoBrowser.claimTaskSpace(nameOrId) => Promise<TaskSpace>",
    description:
      "Claim a user-owned TaskSpace, select it, and return native Playwright page and context objects.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        required: true,
        description: "Task space name, taskId, or numeric id.",
      },
    ],
    returns: "Promise<TaskSpace>",
    example: "const task = await egoBrowser.claimTaskSpace(3)",
  },
  "egoBrowser.handOffTaskSpace": {
    signature:
      "egoBrowser.handOffTaskSpace(nameOrId?) => Promise<TaskSpaceActionResult>",
    description: "Hand control of a task space to the user for manual action.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        description:
          "Task space name, taskId, or numeric id. Defaults to current task space.",
      },
    ],
    returns: 'Promise<{ done: true } | { done: false, skipped: "user-owned" }>',
    example: "console.log(await egoBrowser.handOffTaskSpace(task.id))",
  },
  "egoBrowser.takeOverTaskSpace": {
    signature:
      "egoBrowser.takeOverTaskSpace(nameOrId?) => Promise<TaskSpaceActionResult>",
    description:
      "Take control back after the user explicitly confirms continuation.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        description:
          "Task space name, taskId, or numeric id. Defaults to current task space.",
      },
    ],
    returns: "Promise<{ done: true }>",
    example: "console.log(await egoBrowser.takeOverTaskSpace(task.id))",
  },
  "egoBrowser.waitForAgentControlTaskSpace": {
    signature:
      "egoBrowser.waitForAgentControlTaskSpace(nameOrId, options?) => Promise<TaskSpaceActionResult>",
    description: "Poll until agent control is restored without taking control.",
    params: [
      {
        name: "nameOrId",
        type: "string | number",
        required: true,
        description: "Task space name, taskId, or numeric id.",
      },
      {
        name: "options",
        type: "{ interval?: number, timeout?: number }",
        description: "Polling interval and timeout in milliseconds.",
      },
    ],
    returns: "Promise<{ done: true }>",
    example:
      "console.log(await egoBrowser.waitForAgentControlTaskSpace(task.id))",
  },
  "site.skills": {
    signature: "site.skills(url?) => Promise<object[]>",
    description:
      "List site learning packs matching a URL, or the current page URL when omitted.",
    params: [
      {
        name: "url",
        type: "string",
        description: "URL to inspect. Defaults to current page URL.",
      },
    ],
    returns: "Promise<object[]>",
    example:
      "console.log(await site.skills('https://www.google.com/search?q=test'))",
  },
  "site.skillsForUrl": {
    signature: "site.skillsForUrl(url) => Promise<object[]>",
    description:
      "List site learning packs whose manifest domains match the URL.",
    params: [
      {
        name: "url",
        type: "string",
        required: true,
        description: "URL or domain to inspect.",
      },
    ],
    returns: "Promise<object[]>",
    example: "console.log(await site.skillsForUrl('https://x.com/home'))",
  },
  "site.runTool": {
    signature: "site.runTool(siteId, toolName, args?) => Promise<tool result>",
    description:
      "Run a Node-side learned site tool. Inspect site.learnContext(url).tools[].args and tools[].returns for the exact schema before calling.",
    params: [
      {
        name: "siteId",
        type: "string",
        required: true,
        description: "Learning pack id, such as google or x-com.",
      },
      {
        name: "toolName",
        type: "string",
        required: true,
        description: "Tool name declared in manifest.json nodeTools.",
      },
      {
        name: "args",
        type: "object",
        description: "Tool arguments matching the manifest schema.",
      },
    ],
    returns:
      "Promise<tool result declared by manifest.json returns; inspect site.learnContext(url).tools[].returns>",
    example:
      "const ctx = await site.learnContext('https://www.google.com/search?q=test'); console.log(ctx.tools); const results = await site.runTool('google', 'search_and_extract', { query: 'openai', maxResults: 5 })",
  },
  "site.runBrowserTool": {
    signature:
      "site.runBrowserTool(siteId, toolName, args?) => Promise<tool result>",
    description:
      "Run a browser-side learned tool in the current page context. Inspect site.learnContext(url).tools[].args and tools[].returns for the exact schema before calling.",
    params: [
      {
        name: "siteId",
        type: "string",
        required: true,
        description: "Learning pack id.",
      },
      {
        name: "toolName",
        type: "string",
        required: true,
        description: "Tool name declared in manifest.json browserTools.",
      },
      {
        name: "args",
        type: "object",
        description: "Tool arguments matching the manifest schema.",
      },
    ],
    returns:
      "Promise<tool result declared by manifest.json returns; inspect site.learnContext(url).tools[].returns>",
    example:
      "const ctx = await site.learnContext('https://x.com/home'); console.log(ctx.tools); const post = await site.runBrowserTool('x-com', 'post_from_active_element')",
  },
  "site.learnContext": {
    signature: "site.learnContext(url?) => Promise<object>",
    description:
      "Load matching learning notes and exact tool schemas, including args and returns, for a URL or the current page URL.",
    params: [
      {
        name: "url",
        type: "string",
        description: "URL to inspect. Defaults to current page URL.",
      },
    ],
    returns:
      "Promise<{ exists, siteId, siteName, knowledge, tools: Array<{ siteId, toolName, toolType, description, args, returns, example }> }>",
    example:
      "console.log(await site.learnContext('https://www.google.com/search?q=test'))",
  },
  "fetch.server": {
    signature: "fetch.server(url, options?) => Promise<string>",
    description: "Fetch text from Node with a browser-like User-Agent.",
    params: [
      {
        name: "url",
        type: "string",
        required: true,
        description: "URL to fetch.",
      },
      {
        name: "options",
        type: "object",
        description:
          "Fetch options including method, headers, body, and timeout in milliseconds.",
      },
    ],
    returns: "Promise<string>",
    example: "const html = await fetch.server('https://example.com')",
  },
  "fetch.browser": {
    signature: "fetch.browser(url, options?) => Promise<string>",
    description: "Fetch text inside the current browser page context.",
    params: [
      {
        name: "url",
        type: "string",
        required: true,
        description:
          "URL to fetch. Relative URLs resolve against current page.",
      },
      {
        name: "options",
        type: "object",
        description:
          "Fetch options including method, headers, body, and timeout in milliseconds.",
      },
    ],
    returns: "Promise<string>",
    example: "const body = await fetch.browser('/api/data')",
  },
  cdp: {
    signature:
      "cdp(method, params?, sessionId?, timeoutMs?) => Promise<object>",
    description:
      "Send a supported raw Chrome DevTools Protocol command to the current target. Browser.grantPermissions and Browser.setPermission are not exposed by the task-space bridge.",
    params: [
      {
        name: "method",
        type: "string",
        required: true,
        description: "CDP method, such as Runtime.evaluate.",
      },
      {
        name: "params",
        type: "object",
        description: "CDP command parameters.",
      },
      {
        name: "sessionId",
        type: "string",
        description: "Optional attached target session id.",
      },
      {
        name: "timeoutMs",
        type: "number",
        description: "Command timeout in milliseconds; 0 disables it.",
      },
    ],
    returns: "Promise<object>",
    example:
      "console.log(await cdp('Runtime.evaluate', { expression: 'document.title' }))",
  },
  "egoBrowser.helper": {
    signature: "egoBrowser.helper(name?) => string",
    description:
      "List egoBrowser methods when called without a name, or return runtime documentation for an exact ego-browser-specific public path. Native Playwright APIs use Playwright's own documentation.",
    params: [
      {
        name: "name",
        type: "string",
        description:
          "Exact public path, such as egoBrowser.listTaskSpace or site.runTool. Defaults to the egoBrowser namespace.",
      },
    ],
    returns: "string",
    example: "console.log(egoBrowser.helper('egoBrowser.newTaskSpace'))",
  },
};

export function formatCliLogValue(
  value: unknown,
  options: { nativeInspect?: boolean } = {},
) {
  if (options.nativeInspect) {
    return inspect(value, { colors: false });
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(toLoggable(value, new WeakSet<object>()), null, 2);
}

function toLoggable(value: unknown, stack: WeakSet<object>): unknown {
  if (typeof value === "function") {
    return undefined;
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (value === undefined) {
    return "undefined";
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (stack.has(value)) {
    return "[Circular]";
  }

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => toLoggable(item, stack));
    }

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = toLoggable(child, stack);
    }
    return out;
  } finally {
    stack.delete(value);
  }
}
import { inspect } from "node:util";
