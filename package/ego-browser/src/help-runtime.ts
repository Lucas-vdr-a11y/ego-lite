import { PUBLIC_API_DOCS, type FunctionDoc } from "./format.js";

type ParamInfo = {
  name: string;
  type: string | null;
  description: string | null;
  optional: boolean;
  rest: boolean;
  default: string | null;
};

type HelperDoc = {
  name: string;
  signature: string;
  description: string | null;
  params: ParamInfo[];
  returns: string | null;
  async: boolean;
  example?: string;
};

// Implementation docs are extracted from the bundle at build time and injected
// here as a compatibility fallback for exposed top-level extension helpers.
// Built-in facade paths use PUBLIC_API_DOCS above and document the names agents
// query through egoBrowser.helper().
// The runtime must never introspect its own source: the shipped browser loads
// the SDK from a compiled .pak resource with an unreadable import.meta.url. See
// GitHub issue #84.
const EMBEDDED_DOCS_JSON = "__EGO_EMBEDDED_HELP_DOCS__";

let cache: Map<string, HelperDoc> | null = null;

export function help(
  helpers: Record<string, unknown>,
  ...names: string[]
): HelperDoc | Array<HelperDoc | string> | string {
  const docs = getDocsMap();
  if (names.length === 0) {
    const namespaces = [
      ...new Set(
        Object.keys(PUBLIC_API_DOCS).map((path) => path.split(".")[0]),
      ),
    ].filter((name) => name in helpers);
    const embedded = [...docs.values()].filter((doc) => doc.name in helpers);
    return [
      ...namespaces.map((name) => resolveHelpName(helpers, docs, name)),
      ...embedded,
    ];
  }
  if (names.length === 1) {
    return resolveHelpName(helpers, docs, names[0]);
  }
  return names.map((name) => resolveHelpName(helpers, docs, name));
}

export function formatHelp(doc: HelperDoc): string {
  const lines: string[] = [];
  if (doc.description) {
    lines.push(doc.description);
  }
  for (const p of doc.params) {
    const opt = p.optional ? "?" : "";
    const type = p.type ? `: ${p.type}` : "";
    const desc = p.description ? ` — ${p.description}` : "";
    const def = p.default ? ` (default: ${p.default})` : "";
    lines.push(
      `@param ${p.rest ? "..." : ""}${p.name}${opt}${type}${desc}${def}`,
    );
  }
  if (doc.returns) {
    lines.push(`@returns ${doc.returns}`);
  }
  if (doc.example) {
    lines.push(`@example ${doc.example}`);
  }
  lines.push("");
  lines.push(doc.signature);
  return lines.join("\n");
}

function resolveHelpName(
  helpers: Record<string, unknown>,
  embeddedDocs: Map<string, HelperDoc>,
  requestedName: string,
): HelperDoc | string {
  const name = requestedName;
  const publicDoc = PUBLIC_API_DOCS[name];
  if (publicDoc) {
    return publicDocToHelperDoc(name, publicDoc);
  }

  const namespaceDocs = Object.entries(PUBLIC_API_DOCS)
    .filter(([path]) => path.startsWith(`${name}.`))
    .sort(([left], [right]) => left.localeCompare(right));
  if (namespaceDocs.length > 0) {
    return `${name}:\n${namespaceDocs
      .map(([, doc]) => `- ${doc.signature} — ${doc.description}`)
      .join("\n")}`;
  }

  if (typeof helpers[requestedName] === "function") {
    return (
      embeddedDocs.get(requestedName) || `Unknown helper: ${requestedName}`
    );
  }

  const suffixMatches = Object.entries(PUBLIC_API_DOCS)
    .filter(([path]) => path.endsWith(`.${requestedName}`))
    .sort(([left], [right]) => left.localeCompare(right));
  if (suffixMatches.length === 1) {
    const [path, doc] = suffixMatches[0];
    return `${requestedName} → ${path}\n${formatHelp(publicDocToHelperDoc(path, doc))}`;
  }
  if (suffixMatches.length > 1) {
    return `Ambiguous helper name ${JSON.stringify(requestedName)}. Query one public path:\n${suffixMatches
      .map(([path]) => `- ${path}`)
      .join("\n")}`;
  }

  const parentNamespace = nearestPublicNamespace(requestedName);
  if (parentNamespace) {
    return `Unknown helper: ${requestedName}. Use egoBrowser.helper('${parentNamespace}') to list its available methods.`;
  }
  return `Unknown helper: ${requestedName}`;
}

function publicDocToHelperDoc(name: string, doc: FunctionDoc): HelperDoc {
  return {
    name,
    signature: doc.signature,
    description: doc.description,
    params: (doc.params || []).map((param) => ({
      name: param.name,
      type: param.type,
      description: param.description || null,
      optional: param.required !== true,
      rest: false,
      default: null,
    })),
    returns: doc.returns || null,
    async: /(?:^|[<(])Promise(?:<|[>)]|$)/.test(doc.signature),
    ...(doc.example ? { example: doc.example } : {}),
  };
}

function nearestPublicNamespace(name: string) {
  const parts = name.split(".");
  while (parts.length > 0) {
    const candidate = parts.join(".");
    if (
      Object.keys(PUBLIC_API_DOCS).some((path) =>
        path.startsWith(`${candidate}.`),
      )
    ) {
      return candidate;
    }
    parts.pop();
  }
  return null;
}

function getDocsMap(): Map<string, HelperDoc> {
  if (cache) return cache;
  cache = new Map();
  for (const doc of parseEmbeddedDocs(EMBEDDED_DOCS_JSON)) {
    cache.set(doc.name, doc);
  }
  return cache;
}

function parseEmbeddedDocs(raw: string): HelperDoc[] {
  // If the build injection did not run (e.g. importing raw TypeScript), `raw`
  // is still the placeholder and JSON.parse throws; there are simply no docs.
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
