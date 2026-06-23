import {
  stdin as processStdin,
  stdout as processStdout,
  stderr as processStderr,
} from "node:process";

import { parse } from "acorn";

import {
  isEgoHardStopError,
  resolveEgoError,
} from "./ego-errors.js";
import { formatCliLogValue } from "./format.js";
import * as helpers from "./helpers.js";

type WritableLike = {
  write(chunk: string): unknown;
};

type ReadableLike = {
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

type RunServices = {
  resetConnection(): Promise<void>;
  printUpdateBanner(stream: WritableLike): void;
  runDoctor(stream: WritableLike): Promise<number>;
};

export type RunMainOptions = {
  argv?: string[];
  stdout?: WritableLike;
  stderr?: WritableLike;
  stdin?: ReadableLike;
  stdinText?: string;
  env?: Record<string, string | undefined>;
  services?: Partial<RunServices>;
};

export const HELP = `ego-browser

Read the ego-browser skill for the default workflow and examples.

Typical usage:
  ego-browser <<'JS'
  await waitForLoad()
  cliLog(await pageInfo())
  JS

Helpers are pre-imported and the browser connection is prepared automatically.

Commands:
  ego-browser --doctor         inspect browser and connection state
  ego-browser --reload         reset the browser connection on next call
`;

export const USAGE = `Usage:
  ego-browser <<'JS'
  cliLog(await pageInfo())
  JS
`;

// EX_TEMPFAIL communicates a resumable pause rather than a script bug.
export const HARD_STOP_EXIT_CODE = 75;
const HARD_STOP_RETHROW_HELPER_PREFIX = "__egoBrowserRethrowHardStop";
const HARD_STOP_CATCH_PREFIX = "__egoBrowserCaughtError";
const HARD_STOP_PROMISE_CATCH_PREFIX = "__egoBrowserPromiseCatchError";

export async function runMain(options: RunMainOptions = {}) {
  const argv = options.argv || process.argv.slice(2);
  const stdout = options.stdout || processStdout;
  const stderr = options.stderr || processStderr;
  const env = options.env || process.env;
  const services = {
    resetConnection: async () => {},
    printUpdateBanner: () => {},
    runDoctor: async () => 0,
    ...options.services,
  };

  if (argv[0] === "-h" || argv[0] === "--help") {
    write(stdout, HELP);
    return 0;
  }
  if (argv[0] === "--doctor") {
    return services.runDoctor(stdout);
  }
  if (argv[0] === "--reload") {
    await services.resetConnection();
    write(stdout, "browser connection reset on next call\n");
    return 0;
  }
  if (argv[0] === "--debug-clicks") {
    env.EGO_BROWSER_DEBUG_CLICKS = "1";
    argv.shift();
  }
  if (argv.length > 0) {
    write(stderr, USAGE);
    return 2;
  }

  const code =
    options.stdinText !== undefined
      ? options.stdinText
      : await readAll(options.stdin || processStdin);
  if (!code.trim()) {
    write(stderr, USAGE);
    return 2;
  }

  services.printUpdateBanner(stderr);
  try {
    await execute(code, stdout);
    return 0;
  } catch (error) {
    if (isEgoHardStopError(error)) {
      write(stderr, formatHardStopError(error));
      return HARD_STOP_EXIT_CODE;
    }
    throw error;
  }
}

async function execute(code: string, stdout: WritableLike) {
  const context = await executionContext(stdout);
  Object.assign(globalThis, context);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const internalNames = new Set<string>();
  const rethrowHelperName = uniqueInternalName(
    HARD_STOP_RETHROW_HELPER_PREFIX,
    code,
    internalNames,
  );
  const names = [...Object.keys(context), rethrowHelperName];
  const values = [...Object.values(context), rethrowHardStop];
  const transformedCode = rewriteCatchClausesForHardStop(
    code,
    rethrowHelperName,
    internalNames,
  );
  const fn = new AsyncFunction(...names, `"use strict";\n${transformedCode}`);
  await fn(...values);
}

export async function executionContext(stdout: WritableLike = processStdout) {
  const agentHelpers = await helpers.loadAgentHelpers();
  // Single source of truth for the agent-facing surface: the same helperContext()
  // that installEgoSdk() exposes in the browser runtime, so the CLI and SDK paths
  // cannot drift apart (and `help` exists in both).
  const context: Record<string, any> = helpers.helperContext(agentHelpers);
  context.cliLog = (...args: unknown[]) => {
    write(stdout, `${args.map(formatCliLogValue).join(" ")}\n`);
  };
  return context;
}

function readAll(stream: ReadableLike) {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

function write(stream: WritableLike, text: string) {
  stream.write(text);
}

function rethrowHardStop(error: unknown) {
  if (isEgoHardStopError(error)) {
    throw error;
  }
}

function formatHardStopError(error: unknown) {
  const resolved = resolveEgoError(error);
  const message =
    resolved.code === "EGO_TASK_SPACE_INACTIVE"
      ? formatInactiveTaskSpaceHardStop(resolved.message)
      : error instanceof Error && error.message
        ? error.message
        : resolved.message;
  return message.endsWith("\n") ? message : `${message}\n`;
}

function formatInactiveTaskSpaceHardStop(message: string) {
  const taskSpaceId = taskSpaceIdFromErrorMessage(message);
  const subject = taskSpaceId
    ? `Task space ${taskSpaceId}`
    : "This task space";
  const resumeTarget = taskSpaceId ?? "<task-space-id>";
  return [
    `${subject} is not assigned to this agent. Browser commands are stopped.`,
    "",
    "This is a hard permission boundary. The agent must not claim, inspect, modify, close, organize, or otherwise operate on this task space automatically.",
    "",
    "Claiming it would give the agent control over tabs and pages that may belong to the user. The agent must stop now and ask for explicit user confirmation.",
    "",
    "Do not infer consent from prior instructions or from the original task request.",
    "",
    `After the user explicitly confirms they want the agent to take control of ${subject.toLowerCase()}, resume with:`,
    `  await useOrCreateTaskSpace(${resumeTarget})`,
  ].join("\n");
}

function taskSpaceIdFromErrorMessage(message: string) {
  return /\bTask space\s+(\d+)\b/i.exec(message)?.[1];
}

type TextEdit = {
  start: number;
  end: number;
  text: string;
};

function rewriteCatchClausesForHardStop(
  code: string,
  rethrowHelperName: string,
  internalNames: Set<string>,
) {
  const ast = parse(code, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  } as any) as any;
  const catches: any[] = [];
  const promiseCatchHandlers: any[] = [];
  walkAst(ast, (node) => {
    if (node.type === "CatchClause") {
      catches.push(node);
    }
    const promiseCatchHandler = promiseCatchHandlerForNode(node);
    if (promiseCatchHandler) {
      promiseCatchHandlers.push(promiseCatchHandler);
    }
  });
  if (catches.length === 0 && promiseCatchHandlers.length === 0) {
    return code;
  }

  const edits: TextEdit[] = [];
  catches.forEach((node, index) =>
    appendCatchClauseEdits(
      edits,
      node,
      index,
      code,
      rethrowHelperName,
      internalNames,
    ),
  );
  promiseCatchHandlers.forEach((node, index) =>
    appendPromiseCatchCallbackEdits(
      edits,
      node,
      index,
      code,
      rethrowHelperName,
      internalNames,
    ),
  );

  return applyTextEdits(code, edits);
}

function appendCatchClauseEdits(
  edits: TextEdit[],
  node: any,
  index: number,
  code: string,
  rethrowHelperName: string,
  internalNames: Set<string>,
) {
  const caughtErrorName = uniqueInternalName(
    `${HARD_STOP_CATCH_PREFIX}${index}`,
    code,
    internalNames,
  );
  const bodyStart = node.body.start + 1;
  if (!node.param) {
    edits.push({
      start: node.start + "catch".length,
      end: node.start + "catch".length,
      text: ` (${caughtErrorName})`,
    });
    edits.push({
      start: bodyStart,
      end: bodyStart,
      text: `\n${rethrowHelperName}(${caughtErrorName});`,
    });
    return;
  }

  if (node.param.type === "Identifier") {
    edits.push({
      start: bodyStart,
      end: bodyStart,
      text: `\n${rethrowHelperName}(${node.param.name});`,
    });
    return;
  }

  const originalBinding = code.slice(node.param.start, node.param.end);
  edits.push({
    start: node.param.start,
    end: node.param.end,
    text: caughtErrorName,
  });
  // Preserve destructuring catch bindings while still inspecting the original
  // thrown value before user code can turn a hard-stop into an ordinary error.
  edits.push({
    start: bodyStart,
    end: bodyStart,
    text: `\n${rethrowHelperName}(${caughtErrorName});\nlet ${originalBinding} = ${caughtErrorName};`,
  });
}

function appendPromiseCatchCallbackEdits(
  edits: TextEdit[],
  node: any,
  index: number,
  code: string,
  rethrowHelperName: string,
  internalNames: Set<string>,
) {
  if (
    node.type !== "ArrowFunctionExpression" &&
    node.type !== "FunctionExpression"
  ) {
    appendPromiseCatchHandlerWrapperEdits(
      edits,
      node,
      index,
      code,
      rethrowHelperName,
      internalNames,
    );
    return;
  }
  const caughtErrorName = uniqueInternalName(
    `${HARD_STOP_PROMISE_CATCH_PREFIX}${index}`,
    code,
    internalNames,
  );
  const binding = promiseCatchErrorBinding(node, caughtErrorName, code);
  if (!binding) {
    return;
  }
  edits.push(...binding.edits);

  const prelude = `\n${rethrowHelperName}(${binding.errorExpression});${binding.restoreBinding}`;
  if (node.body.type === "BlockStatement") {
    edits.push({
      start: node.body.start + 1,
      end: node.body.start + 1,
      text: prelude,
    });
    return;
  }

  const expression = code.slice(node.body.start, node.body.end);
  edits.push({
    start: node.body.start,
    end: node.body.end,
    text: `{\n${rethrowHelperName}(${binding.errorExpression});${binding.restoreBinding}\nreturn ${expression};\n}`,
  });
}

function appendPromiseCatchHandlerWrapperEdits(
  edits: TextEdit[],
  node: any,
  index: number,
  code: string,
  rethrowHelperName: string,
  internalNames: Set<string>,
) {
  const caughtErrorName = uniqueInternalName(
    `${HARD_STOP_PROMISE_CATCH_PREFIX}${index}`,
    code,
    internalNames,
  );
  const handlerName = uniqueInternalName(
    `__egoBrowserPromiseCatchHandler${index}`,
    code,
    internalNames,
  );
  const originalHandler = code.slice(node.start, node.end);
  edits.push({
    start: node.start,
    end: node.end,
    text:
      `((${handlerName}) => (${caughtErrorName}) => {\n` +
      `${rethrowHelperName}(${caughtErrorName});\n` +
      `return typeof ${handlerName} === "function" ? ${handlerName}(${caughtErrorName}) : Promise.reject(${caughtErrorName});\n` +
      `})(${originalHandler})`,
  });
}

function promiseCatchErrorBinding(node: any, errorName: string, code: string) {
  if (node.params.length === 0) {
    const insertPosition = emptyParameterInsertPosition(node, code);
    return {
      errorExpression: errorName,
      restoreBinding: "",
      edits: [
        {
          start: insertPosition,
          end: insertPosition,
          text: errorName,
        },
      ],
    };
  }

  const firstParam = node.params[0];
  if (firstParam.type === "Identifier") {
    return { errorExpression: firstParam.name, restoreBinding: "", edits: [] };
  }
  if (
    firstParam.type === "ObjectPattern" ||
    firstParam.type === "ArrayPattern"
  ) {
    const originalBinding = code.slice(firstParam.start, firstParam.end);
    return {
      errorExpression: errorName,
      restoreBinding: `\nlet ${originalBinding} = ${errorName};`,
      edits: [
        {
          start: firstParam.start,
          end: firstParam.end,
          text: errorName,
        },
      ],
    };
  }
  if (
    firstParam.type === "RestElement" &&
    firstParam.argument?.type === "Identifier"
  ) {
    return {
      errorExpression: errorName,
      restoreBinding: `\nlet ${firstParam.argument.name} = [${errorName}];`,
      edits: [
        {
          start: firstParam.start,
          end: firstParam.end,
          text: errorName,
        },
      ],
    };
  }
  return null;
}

function emptyParameterInsertPosition(node: any, code: string) {
  const beforeBody = code.slice(node.start, node.body.start);
  const closeParenOffset = beforeBody.lastIndexOf(")");
  if (closeParenOffset < 0) {
    throw new Error("expected empty callback parameters to use parentheses");
  }
  return node.start + closeParenOffset;
}

function promiseCatchHandlerForNode(node: any) {
  if (node.type !== "CallExpression") {
    return null;
  }
  if (!isCatchMemberExpression(node.callee)) {
    return null;
  }
  const firstArg = node.arguments?.[0];
  if (
    firstArg?.type === "ArrowFunctionExpression" ||
    firstArg?.type === "FunctionExpression" ||
    firstArg?.type === "Identifier" ||
    isSimpleMemberExpression(firstArg)
  ) {
    return firstArg;
  }
  return null;
}

function isSimpleMemberExpression(node: any) {
  if (node?.type !== "MemberExpression") {
    return false;
  }
  if (!node.computed) {
    return true;
  }
  return node.property?.type === "Literal";
}

function isCatchMemberExpression(node: any) {
  if (node.type !== "MemberExpression") {
    return false;
  }
  if (node.computed) {
    return (
      node.property?.type === "Literal" && node.property.value === "catch"
    );
  }
  return node.property?.type === "Identifier" && node.property.name === "catch";
}

function uniqueInternalName(
  baseName: string,
  code: string,
  reserved: Set<string>,
) {
  let candidate = baseName;
  let suffix = 0;
  while (reserved.has(candidate) || code.includes(candidate)) {
    suffix += 1;
    candidate = `${baseName}${suffix}`;
  }
  reserved.add(candidate);
  return candidate;
}

function walkAst(node: any, visit: (node: any) => void) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (typeof node.type === "string") {
    visit(node);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        walkAst(item, visit);
      }
    } else if (value && typeof value === "object") {
      walkAst(value, visit);
    }
  }
}

function applyTextEdits(code: string, edits: TextEdit[]) {
  let out = code;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
  }
  return out;
}
