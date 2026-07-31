import type { FrameOwnerContext } from "./frame-context.js";

export type AriaRefEntry = {
  backendNodeId: number;
  sessionId?: string;
  inputSessionId?: string;
  frameOffset?: { x: number; y: number };
  frameScale?: { x: number; y: number };
  frameVisible?: false;
  frameOwners?: FrameOwnerContext[];
  frameId?: string;
};

type AriaRefSnapshot = {
  generation: number;
  elements: Map<number, AriaRefEntry>;
};

export class AriaRefMap {
  private snapshots = new Map<string, AriaRefSnapshot>();

  replace(scope: string, elements: AriaRefEntry[]) {
    const generation = (this.snapshots.get(scope)?.generation || 0) + 1;
    this.snapshots.set(scope, {
      generation,
      elements: new Map(elements.map((entry, index) => [index + 1, entry])),
    });
    return generation;
  }

  get(scope: string, generation: number, elementId: number) {
    const snapshot = this.snapshots.get(scope);
    if (!snapshot || snapshot.generation !== generation) return undefined;
    return snapshot.elements.get(elementId);
  }

  generation(scope: string) {
    return this.snapshots.get(scope)?.generation;
  }
}

export function ariaRefScope(target: unknown) {
  if (
    target &&
    typeof target === "object" &&
    Array.isArray((target as any).frameChain)
  ) {
    return `frame:${JSON.stringify((target as any).frameChain)}`;
  }
  return "main";
}

export function parseAriaRef(input: unknown) {
  const match = /^aria-ref=s(\d+)e(\d+)$/.exec(String(input || "").trim());
  if (!match) return null;
  return {
    selector: match[0].slice("aria-ref=".length),
    generation: Number(match[1]),
    elementId: Number(match[2]),
  };
}

export function isAriaRefSelector(input: unknown) {
  return String(input || "")
    .trim()
    .startsWith("aria-ref=");
}
