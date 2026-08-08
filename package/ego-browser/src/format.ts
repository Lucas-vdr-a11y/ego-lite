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
        description: "A concise description of 3-6 words.",
      },
    ],
    returns: "Promise<unknown>",
    example: "await egoBrowser.showTaskState('open account settings')",
  },
  "egoBrowser.snapshot": {
    signature: "egoBrowser.snapshot(options?) => Promise<SnapshotResult>",
    description:
      "Capture a structured snapshot of the current TaskSpace page. The native scope defaults to the full page; use locator.ariaSnapshot() for a known local accessible subtree.",
    params: [
      {
        name: "options",
        type: "object",
        description:
          "Native snapshot options: scope ('full_page' or 'only_within_viewport'), includeActionMarks, interactiveOnly, includeStableLocator, and maxResultLength.",
      },
    ],
    returns: "Promise<{ content: string, refs: SnapshotRef[] }>",
    example:
      "const snapshot = await egoBrowser.snapshot(); console.log(snapshot.content)",
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
      "Create and select an agent-owned TaskSpace, optionally using a profile id returned by listProfile(). Exact names must be unique: use switchTaskSpace(id) for an existing agent-owned TaskSpace, or choose a new name when the existing space is user-owned. The selected profile determines the TaskSpace browser identity, cookies, storage, and login state.",
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
  "egoBrowser.site.skills": {
    signature: "egoBrowser.site.skills(url?) => Promise<object[]>",
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
      "console.log(await egoBrowser.site.skills('https://www.google.com/search?q=test'))",
  },
  "egoBrowser.site.discover": {
    signature: "egoBrowser.site.discover(url?) => Promise<object[]>",
    description:
      "Discover site learning packs matching a URL, or the current page URL when omitted. This is the descriptive alias of egoBrowser.site.skills().",
    params: [
      {
        name: "url",
        type: "string",
        description: "URL to inspect. Defaults to current page URL.",
      },
    ],
    returns: "Promise<object[]>",
    example:
      "console.log(await egoBrowser.site.discover('https://youtube.com/'))",
  },
  "egoBrowser.site.skillsForUrl": {
    signature: "egoBrowser.site.skillsForUrl(url) => Promise<object[]>",
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
    example:
      "console.log(await egoBrowser.site.skillsForUrl('https://www.google.com/search?q=ego'))",
  },
  "egoBrowser.site.runTool": {
    signature:
      "egoBrowser.site.runTool(siteId, toolName, args?) => Promise<tool result>",
    description:
      "Run a Node-side learned site tool. Inspect egoBrowser.site.learnContext(url).tools[].args and tools[].returns for the exact schema before calling.",
    params: [
      {
        name: "siteId",
        type: "string",
        required: true,
        description: "Learning pack id, such as google or notion.",
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
      "Promise<tool result declared by manifest.json returns; inspect egoBrowser.site.learnContext(url).tools[].returns>",
    example:
      "const ctx = await egoBrowser.site.learnContext('https://www.google.com/search?q=test'); console.log(ctx.tools); const results = await egoBrowser.site.runTool('google', 'search_and_extract', { query: 'openai', maxResults: 5 })",
  },
  "egoBrowser.site.runBrowserTool": {
    signature:
      "egoBrowser.site.runBrowserTool(siteId, toolName, args?) => Promise<tool result>",
    description:
      "Run a browser-side learned tool in the current page context. Inspect egoBrowser.site.learnContext(url).tools[].args and tools[].returns for the exact schema before calling.",
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
      "Promise<tool result declared by manifest.json returns; inspect egoBrowser.site.learnContext(url).tools[].returns>",
    example:
      "const ctx = await egoBrowser.site.learnContext(); const tool = ctx.tools.find((item) => item.toolType === 'browser'); if (tool) console.log(await egoBrowser.site.runBrowserTool(tool.siteId, tool.toolName))",
  },
  "egoBrowser.site.learnContext": {
    signature: "egoBrowser.site.learnContext(url?) => Promise<object>",
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
      "console.log(await egoBrowser.site.learnContext('https://www.google.com/search?q=test'))",
  },
  "egoBrowser.site.google.docs.open": {
    signature:
      "egoBrowser.site.google.docs.open({ url }) => Promise<{ url, title }>",
    description:
      "Open an existing Google document in the active logged-in TaskSpace and wait for its editor.",
    params: [
      {
        name: "options",
        type: "{ url: string }",
        required: true,
        description: "Google Docs document URL.",
      },
    ],
    returns: "Promise<{ url: string, title: string }>",
    example:
      "await egoBrowser.site.google.docs.open({ url: 'https://docs.google.com/document/d/DOCUMENT_ID/edit' })",
  },
  "egoBrowser.site.google.docs.readText": {
    signature:
      "egoBrowser.site.google.docs.readText() => Promise<{ title, text }>",
    description:
      "Read the active Google document as plain text and restore the previous clipboard contents.",
    returns: "Promise<{ title: string, text: string }>",
    example: "const doc = await egoBrowser.site.google.docs.readText()",
  },
  "egoBrowser.site.google.docs.setTitle": {
    signature:
      "egoBrowser.site.google.docs.setTitle({ title }) => Promise<object>",
    description:
      "Set the active Google document title, wait for save, and skip an identical title.",
    params: [
      {
        name: "options",
        type: "{ title: string }",
        required: true,
        description: "Non-empty document title.",
      },
    ],
    returns: "Promise<{ previousTitle, title, changed, saved }>",
    example:
      "await egoBrowser.site.google.docs.setTitle({ title: 'Weekly report' })",
  },
  "egoBrowser.site.google.docs.appendText": {
    signature:
      "egoBrowser.site.google.docs.appendText({ text, separator? }) => Promise<object>",
    description:
      "Append plain text to the active Google document, wait for save, and verify the full text. An identical existing suffix is not appended twice.",
    params: [
      {
        name: "options",
        type: "{ text: string, separator?: string }",
        required: true,
        description:
          "Non-empty text and an optional separator; newline by default.",
      },
    ],
    returns: "Promise<{ title, text, appendedText, changed, saved }>",
    example:
      "await egoBrowser.site.google.docs.appendText({ text: 'Next action' })",
  },
  "egoBrowser.site.google.docs.replaceAll": {
    signature:
      "egoBrowser.site.google.docs.replaceAll({ find, replace, matchCase? }) => Promise<object>",
    description:
      "Replace every plain-text match in the active Google document and verify the resulting text.",
    params: [
      {
        name: "options",
        type: "{ find: string, replace: string, matchCase?: boolean }",
        required: true,
        description:
          "Non-empty find text, replacement text, and optional case sensitivity.",
      },
    ],
    returns: "Promise<{ title, text, find, replace, count, changed, saved }>",
    example:
      "await egoBrowser.site.google.docs.replaceAll({ find: 'old', replace: 'new' })",
  },
  "egoBrowser.site.google.sheets.open": {
    signature:
      "egoBrowser.site.google.sheets.open({ url }) => Promise<{ url, title }>",
    description:
      "Open an existing Google spreadsheet in the active logged-in TaskSpace and wait for its grid.",
    params: [
      {
        name: "options",
        type: "{ url: string }",
        required: true,
        description: "Google Sheets spreadsheet URL.",
      },
    ],
    returns: "Promise<{ url: string, title: string }>",
    example:
      "await egoBrowser.site.google.sheets.open({ url: 'https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit' })",
  },
  "egoBrowser.site.google.sheets.getSheetNames": {
    signature:
      "egoBrowser.site.google.sheets.getSheetNames() => Promise<string[]>",
    description:
      "Return the visible non-empty sheet names in the active spreadsheet.",
    returns: "Promise<string[]>",
    example:
      "const names = await egoBrowser.site.google.sheets.getSheetNames()",
  },
  "egoBrowser.site.google.sheets.readRange": {
    signature:
      "egoBrowser.site.google.sheets.readRange({ range }) => Promise<string[][]>",
    description:
      "Read displayed values from an A1 range as rows and columns, then restore the previous clipboard contents.",
    params: [
      {
        name: "options",
        type: "{ range: string }",
        required: true,
        description: "A1 range, optionally qualified by a sheet name.",
      },
    ],
    returns: "Promise<string[][]>",
    example:
      "const rows = await egoBrowser.site.google.sheets.readRange({ range: \"'Sales'!A1:C20\" })",
  },
  "egoBrowser.site.google.sheets.writeRange": {
    signature:
      "egoBrowser.site.google.sheets.writeRange({ range, values }) => Promise<object>",
    description:
      "Write a rectangular matrix to an A1 range and read it back; range dimensions must match values.",
    params: [
      {
        name: "options",
        type: "{ range: string, values: unknown[][] }",
        required: true,
        description: "A1 range and a non-empty rectangular value matrix.",
      },
    ],
    returns: "Promise<{ range, values, saved }>",
    example:
      "await egoBrowser.site.google.sheets.writeRange({ range: 'A1:B2', values: [['Name', 'Count'], ['Alpha', 2]] })",
  },
  "egoBrowser.site.google.sheets.appendRows": {
    signature:
      "egoBrowser.site.google.sheets.appendRows({ sheet, values }) => Promise<object>",
    description:
      "Append rows after the last non-empty cell in column A of a named sheet, then read the written range back.",
    params: [
      {
        name: "options",
        type: "{ sheet: string, values: unknown[][] }",
        required: true,
        description:
          "Target sheet name and a non-empty rectangular row matrix.",
      },
    ],
    returns: "Promise<{ sheet, range, values, saved }>",
    example:
      "await egoBrowser.site.google.sheets.appendRows({ sheet: 'Sales', values: [['Beta', 3]] })",
  },
  "egoBrowser.site.google.gmail.openInbox": {
    signature: "egoBrowser.site.google.gmail.openInbox() => Promise<{ url }>",
    description: "Open the active logged-in Gmail inbox.",
    returns: "Promise<{ url: string }>",
    example: "await egoBrowser.site.google.gmail.openInbox()",
  },
  "egoBrowser.site.google.gmail.listThreads": {
    signature:
      "egoBrowser.site.google.gmail.listThreads({ limit? }) => Promise<object[]>",
    description:
      "List structured summaries from the current Gmail thread list; limit defaults to 20 and accepts 1-100.",
    returns: "Promise<Array<{ id, sender, subject, snippet, date, unread }>>",
    example:
      "const threads = await egoBrowser.site.google.gmail.listThreads({ limit: 10 })",
  },
  "egoBrowser.site.google.gmail.search": {
    signature:
      "egoBrowser.site.google.gmail.search({ query, limit? }) => Promise<object[]>",
    description: "Run a Gmail search and return matching thread summaries.",
    returns: "Promise<Array<{ id, sender, subject, snippet, date, unread }>>",
    example:
      "const threads = await egoBrowser.site.google.gmail.search({ query: 'newer_than:7d', limit: 10 })",
  },
  "egoBrowser.site.google.gmail.readThread": {
    signature:
      "egoBrowser.site.google.gmail.readThread({ id }) => Promise<object>",
    description:
      "Open and read a thread id returned by the current listThreads or search result.",
    returns: "Promise<{ id, subject, messages }>",
    example:
      "const thread = await egoBrowser.site.google.gmail.readThread({ id: threads[0].id })",
  },
  "egoBrowser.site.google.gmail.createDraft": {
    signature:
      "egoBrowser.site.google.gmail.createDraft({ to, cc?, bcc?, subject, body }) => Promise<object>",
    description: "Save a Gmail draft and close its editor without sending it.",
    returns: "Promise<{ to, cc, bcc, subject, body, drafted }>",
    example:
      "await egoBrowser.site.google.gmail.createDraft({ to: 'owner@example.com', subject: 'Draft', body: 'Review me' })",
  },
  "egoBrowser.site.notion.pages.search": {
    signature:
      "egoBrowser.site.notion.pages.search({ query, limit? }) => Promise<object[]>",
    description: "Search the active Notion workspace for pages.",
    returns: "Promise<Array<{ title, url }>>",
    example:
      "const pages = await egoBrowser.site.notion.pages.search({ query: 'Weekly', limit: 10 })",
  },
  "egoBrowser.site.notion.pages.open": {
    signature:
      "egoBrowser.site.notion.pages.open({ url }) => Promise<{ url, title }>",
    description: "Open an existing Notion page and wait for its editor.",
    returns: "Promise<{ url: string, title: string }>",
    example:
      "await egoBrowser.site.notion.pages.open({ url: 'https://app.notion.com/p/PAGE_ID' })",
  },
  "egoBrowser.site.notion.pages.read": {
    signature:
      "egoBrowser.site.notion.pages.read() => Promise<{ url, title, text }>",
    description: "Read the active Notion page as plain text blocks.",
    returns: "Promise<{ url: string, title: string, text: string }>",
    example: "const page = await egoBrowser.site.notion.pages.read()",
  },
  "egoBrowser.site.notion.pages.create": {
    signature:
      "egoBrowser.site.notion.pages.create({ title, text?, parentUrl? }) => Promise<object>",
    description:
      "Create a Notion page with optional plain text and optional parent page URL.",
    returns: "Promise<{ url, title, text, parentUrl?, created }>",
    example:
      "await egoBrowser.site.notion.pages.create({ title: 'Weekly report', text: 'Draft' })",
  },
  "egoBrowser.site.notion.pages.setTitle": {
    signature:
      "egoBrowser.site.notion.pages.setTitle({ title }) => Promise<object>",
    description: "Set and verify the active Notion page title.",
    returns: "Promise<{ previousTitle, title, changed, saved }>",
    example:
      "await egoBrowser.site.notion.pages.setTitle({ title: 'Weekly report' })",
  },
  "egoBrowser.site.notion.pages.appendText": {
    signature:
      "egoBrowser.site.notion.pages.appendText({ text }) => Promise<object>",
    description:
      "Append one or more plain-text blocks to the active Notion page.",
    returns: "Promise<{ url, title, text, appendedText, changed, saved }>",
    example:
      "await egoBrowser.site.notion.pages.appendText({ text: 'Next action' })",
  },
  "egoBrowser.site.microsoft.outlook.openInbox": {
    signature:
      "egoBrowser.site.microsoft.outlook.openInbox() => Promise<{ url }>",
    description: "Open the active logged-in personal Outlook inbox.",
    returns: "Promise<{ url: string }>",
    example: "await egoBrowser.site.microsoft.outlook.openInbox()",
  },
  "egoBrowser.site.microsoft.outlook.listMessages": {
    signature:
      "egoBrowser.site.microsoft.outlook.listMessages({ limit? }) => Promise<object[]>",
    description:
      "List structured summaries from the current Outlook message list.",
    returns: "Promise<Array<{ id, sender, subject, preview, date, unread }>>",
    example:
      "const messages = await egoBrowser.site.microsoft.outlook.listMessages({ limit: 10 })",
  },
  "egoBrowser.site.microsoft.outlook.search": {
    signature:
      "egoBrowser.site.microsoft.outlook.search({ query, limit? }) => Promise<object[]>",
    description: "Search personal Outlook and return matching summaries.",
    returns: "Promise<Array<{ id, sender, subject, preview, date, unread }>>",
    example:
      "const messages = await egoBrowser.site.microsoft.outlook.search({ query: 'Weekly', limit: 10 })",
  },
  "egoBrowser.site.microsoft.outlook.readMessage": {
    signature:
      "egoBrowser.site.microsoft.outlook.readMessage({ id }) => Promise<object>",
    description:
      "Open and read a message id returned by the current Outlook list or search.",
    returns: "Promise<{ id, sender, subject, date, text }>",
    example:
      "const message = await egoBrowser.site.microsoft.outlook.readMessage({ id: messages[0].id })",
  },
  "egoBrowser.site.microsoft.outlook.createDraft": {
    signature:
      "egoBrowser.site.microsoft.outlook.createDraft({ to, cc?, bcc?, subject, body }) => Promise<object>",
    description:
      "Create and auto-save a personal Outlook draft without sending it.",
    returns: "Promise<{ to, cc, bcc, subject, body, drafted }>",
    example:
      "await egoBrowser.site.microsoft.outlook.createDraft({ to: 'owner@example.com', subject: 'Draft', body: 'Review me' })",
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
          "Exact public path, such as egoBrowser.listTaskSpace or egoBrowser.site.runTool. Defaults to the egoBrowser namespace.",
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
