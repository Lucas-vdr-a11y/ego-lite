import {
  stdin as processStdin,
  stdout as processStdout,
  stderr as processStderr,
} from "node:process";

import { parse } from "acorn";

import { isEgoHardStopError, resolveEgoError } from "./ego-errors.js";
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

// EX_TEMPFAIL communicates a resumable permission pause rather than a script bug.
export const HARD_STOP_EXIT_CODE = 75;
const HARD_STOP_RETHROW_HELPER_PREFIX = "__egoBrowserRethrowHardStop";
const HARD_STOP_CATCH_PREFIX = "__egoBrowserCaughtError";
const HARD_STOP_PROMISE_CATCH_PREFIX = "__egoBrowserPromiseCatchError";
const HARD_STOP_PROMISE_HANDLER_PREFIX = "__egoBrowserPromiseCatchHandler";

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
  const message = resolveEgoError(error).message;
  return message.endsWith("\n") ? message : `${message}\n`;
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
  const edits: TextEdit[] = [];
  let catchIndex = 0;
  let promiseCatchIndex = 0;

  walkAst(ast, (node) => {
    if (node.type === "CatchClause") {
      appendCatchClauseEdits(
        edits,
        node,
        catchIndex,
        code,
        rethrowHelperName,
        internalNames,
      );
      catchIndex += 1;
    }
    if (isPromiseCatchCall(node)) {
      appendPromiseCatchWrapperEdit(
        edits,
        node,
        promiseCatchIndex,
        code,
        rethrowHelperName,
        internalNames,
      );
      promiseCatchIndex += 1;
    }
  });

  if (edits.length === 0) {
    return code;
  }
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
  // Preserve destructuring catch bindings while inspecting the original thrown
  // value before user code can downgrade a hard-stop into an ordinary error.
  edits.push({
    start: bodyStart,
    end: bodyStart,
    text: `\n${rethrowHelperName}(${caughtErrorName});\nlet ${originalBinding} = ${caughtErrorName};`,
  });
}

function appendPromiseCatchWrapperEdit(
  edits: TextEdit[],
  node: any,
  index: number,
  code: string,
  rethrowHelperName: string,
  internalNames: Set<string>,
) {
  const firstArg = node.arguments?.[0];
  if (!firstArg || firstArg.type === "SpreadElement") {
    return;
  }
  const caughtErrorName = uniqueInternalName(
    `${HARD_STOP_PROMISE_CATCH_PREFIX}${index}`,
    code,
    internalNames,
  );
  const handlerName = uniqueInternalName(
    `${HARD_STOP_PROMISE_HANDLER_PREFIX}${index}`,
    code,
    internalNames,
  );
  const originalHandler = code.slice(firstArg.start, firstArg.end);
  edits.push({
    start: firstArg.start,
    end: firstArg.end,
    text:
      `((${handlerName}) => (${caughtErrorName}) => {\n` +
      `${rethrowHelperName}(${caughtErrorName});\n` +
      `return typeof ${handlerName} === "function" ? ${handlerName}(${caughtErrorName}) : Promise.reject(${caughtErrorName});\n` +
      `})(${originalHandler})`,
  });
}

function isPromiseCatchCall(node: any) {
  return (
    node?.type === "CallExpression" && isCatchMemberExpression(node.callee)
  );
}

function isCatchMemberExpression(node: any) {
  if (node?.type === "ChainExpression") {
    return isCatchMemberExpression(node.expression);
  }
  if (node?.type !== "MemberExpression") {
    return false;
  }
  if (node.computed) {
    return node.property?.type === "Literal" && node.property.value === "catch";
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
