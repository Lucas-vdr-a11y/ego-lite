import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TEST_CASES } from "./site/test-cases.mjs";
import { e2eCases } from "./suites/index.mjs";

// Pinned to the physical tags in the MDN HTML elements reference as last
// modified on 2026-02-06. This is only a static coverage/wiring guard. The
// referenced real-browser cases remain the functional proof.
const MDN_MODERN_ELEMENTS = [
  "a",
  "abbr",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "base",
  "bdi",
  "bdo",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fencedframe",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "geolocation",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "map",
  "mark",
  "math",
  "menu",
  "meta",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "search",
  "section",
  "select",
  "selectedcontent",
  "slot",
  "small",
  "source",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
];

const MDN_OBSOLETE_ELEMENTS = [
  "acronym",
  "big",
  "center",
  "content",
  "dir",
  "font",
  "frame",
  "frameset",
  "image",
  "marquee",
  "menuitem",
  "nobr",
  "noembed",
  "noframes",
  "param",
  "plaintext",
  "rb",
  "rtc",
  "shadow",
  "strike",
  "tt",
  "xmp",
];

// These tags are present in a dedicated fixture and case, but the current
// journey intentionally does not claim complete user-behavior coverage.
const LIMITED_BEHAVIOR_COVERAGE = new Map([
  [
    "datalist",
    {
      level: "partial",
      missing:
        "native suggestion-popup selection is not observable in the current ego Chromium",
    },
  ],
  [
    "selectedcontent",
    {
      level: "conditional",
      missing:
        "the real customizable-select journey runs only when the browser exposes the feature",
    },
  ],
  [
    "geolocation",
    {
      level: "partial",
      missing:
        "permission activation hands control to the user and is not automated by this suite",
    },
  ],
  [
    "fencedframe",
    {
      level: "capability-only",
      missing: "content loading requires a browser-produced FencedFrameConfig",
    },
  ],
]);

const COVERAGE_GROUPS = [
  {
    name: "document startup",
    elements: [
      "html",
      "main",
      "base",
      "head",
      "link",
      "meta",
      "style",
      "title",
      "body",
      "noscript",
      "script",
    ],
    caseNames: ["HTML document startup and noscript fallback"],
    evidence: ["./site/src/server.jsx"],
  },
  {
    name: "document outline",
    elements: [
      "address",
      "article",
      "aside",
      "footer",
      "header",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hgroup",
      "nav",
      "section",
      "search",
    ],
    caseNames: ["web test: document-outline"],
    evidence: ["./site/src/scenarios/document-outline/view.jsx"],
  },
  {
    name: "text content",
    elements: [
      "blockquote",
      "dd",
      "div",
      "dl",
      "dt",
      "figcaption",
      "figure",
      "hr",
      "li",
      "menu",
      "ol",
      "p",
      "pre",
      "ul",
    ],
    caseNames: ["web test: text-content"],
    evidence: ["./site/src/scenarios/text-content/view.jsx"],
  },
  {
    name: "inline text semantics",
    elements: [
      "a",
      "abbr",
      "b",
      "bdi",
      "bdo",
      "br",
      "cite",
      "code",
      "data",
      "dfn",
      "em",
      "i",
      "kbd",
      "mark",
      "q",
      "rp",
      "rt",
      "ruby",
      "s",
      "samp",
      "small",
      "span",
      "strong",
      "sub",
      "sup",
      "time",
      "u",
      "var",
      "wbr",
    ],
    caseNames: ["web test: inline-semantics"],
    evidence: ["./site/src/scenarios/inline-semantics/view.jsx"],
  },
  {
    name: "media and embeds",
    elements: [
      "area",
      "audio",
      "img",
      "map",
      "track",
      "video",
      "embed",
      "fencedframe",
      "iframe",
      "object",
      "picture",
      "source",
    ],
    caseNames: ["web test: media-embeds"],
    evidence: ["./site/src/scenarios/media-embeds/view.jsx"],
  },
  {
    name: "SVG and MathML",
    elements: ["svg", "math"],
    caseNames: ["web test: svg-mathml"],
    evidence: ["./site/src/scenarios/svg-mathml/view.jsx"],
  },
  {
    name: "canvas",
    elements: ["canvas"],
    caseNames: ["web test: canvas", "Native canvas ARIA snapshot refs"],
    evidence: ["./site/src/scenarios/visual-path/view.jsx"],
  },
  {
    name: "demarcating edits",
    elements: ["del", "ins"],
    caseNames: ["web test: contract-amendment"],
    evidence: ["./site/src/scenarios/contract-amendment/view.jsx"],
  },
  {
    name: "table content",
    elements: [
      "caption",
      "col",
      "colgroup",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
    ],
    caseNames: ["web test: table-semantics"],
    evidence: ["./site/src/scenarios/table-semantics/view.jsx"],
  },
  {
    name: "native form controls",
    elements: [
      "button",
      "datalist",
      "fieldset",
      "form",
      "input",
      "label",
      "legend",
      "meter",
      "optgroup",
      "option",
      "output",
      "progress",
      "select",
      "selectedcontent",
      "textarea",
    ],
    caseNames: ["web test: native-form-controls"],
    evidence: ["./site/src/scenarios/native-form-controls/view.jsx"],
  },
  {
    name: "interactive elements",
    elements: ["details", "dialog", "geolocation", "summary"],
    caseNames: ["web test: interactive-elements"],
    evidence: ["./site/src/scenarios/interactive-elements/view.jsx"],
  },
  {
    name: "web components",
    elements: ["slot", "template"],
    caseNames: ["web test: web-components"],
    evidence: ["./site/src/scenarios/web-components/view.jsx"],
  },
  {
    name: "legacy compatibility surface",
    elements: [
      "acronym",
      "big",
      "center",
      "content",
      "dir",
      "font",
      "image",
      "marquee",
      "menuitem",
      "nobr",
      "noembed",
      "param",
      "rb",
      "rtc",
      "shadow",
      "strike",
      "tt",
      "xmp",
    ],
    caseNames: ["web test: legacy-elements"],
    evidence: ["./site/src/scenarios/legacy-elements/view.jsx"],
  },
  {
    name: "legacy raw documents",
    elements: ["frame", "frameset", "noframes", "plaintext"],
    caseNames: [
      "Legacy frameset target navigation",
      "Legacy frame owner ARIA snapshot refs",
      "Legacy plaintext raw parsing",
    ],
    evidence: ["./site/src/server.jsx"],
  },
];

function sorted(values) {
  return [...values].sort();
}

function elementEvidencePattern(element) {
  return new RegExp(
    `(?:<${element}(?:\\s|/?>)|createElement\\(\\s*["']${element}["']\\s*\\))`,
    "iu",
  );
}

test("pins all physical tags in the current MDN HTML elements reference", () => {
  assert.equal(MDN_MODERN_ELEMENTS.length, 117);
  assert.equal(new Set(MDN_MODERN_ELEMENTS).size, 117);
  assert.equal(MDN_OBSOLETE_ELEMENTS.length, 22);
  assert.equal(new Set(MDN_OBSOLETE_ELEMENTS).size, 22);
  assert.equal(
    new Set([...MDN_MODERN_ELEMENTS, ...MDN_OBSOLETE_ELEMENTS]).size,
    139,
  );
});

test("maps every MDN HTML element exactly once to a fixture and case owner", () => {
  const mapped = COVERAGE_GROUPS.flatMap((group) => group.elements);

  assert.equal(mapped.length, 139, "the coverage map has one row per tag");
  assert.equal(
    new Set(mapped).size,
    139,
    "no tag is credited to more than one coverage group",
  );
  assert.deepEqual(
    sorted(mapped),
    sorted([...MDN_MODERN_ELEMENTS, ...MDN_OBSOLETE_ELEMENTS]),
  );
});

test("keeps every mapped fixture source and real-browser case wired", async () => {
  const registeredCases = new Map(
    e2eCases.map((e2eCase) => [e2eCase.name, e2eCase]),
  );
  const registeredRoutes = new Map(
    TEST_CASES.map((testCase) => [testCase.slug, testCase.route]),
  );

  for (const group of COVERAGE_GROUPS) {
    const sources = await Promise.all(
      group.evidence.map((relativePath) =>
        readFile(new URL(relativePath, import.meta.url), "utf8"),
      ),
    );
    const combinedSource = sources.join("\n");

    for (const element of group.elements) {
      assert.match(
        combinedSource,
        elementEvidencePattern(element),
        `${group.name} authors <${element}> in its dedicated fixture evidence`,
      );
    }

    for (const caseName of group.caseNames) {
      const e2eCase = registeredCases.get(caseName);
      assert.ok(e2eCase, `${group.name} registers ${caseName}`);
      assert.equal(
        typeof e2eCase.body,
        "function",
        `${caseName} is executable`,
      );

      if (caseName.startsWith("web test: ")) {
        const slug = caseName.slice("web test: ".length);
        assert.equal(
          registeredRoutes.get(slug),
          `/tests/${slug}`,
          `${group.name} serves its dedicated scenario route`,
        );
      }
    }
  }
});

test("reports elements whose current browser journey is partial or capability-only", () => {
  assert.deepEqual(
    [...LIMITED_BEHAVIOR_COVERAGE.entries()],
    [
      [
        "datalist",
        {
          level: "partial",
          missing:
            "native suggestion-popup selection is not observable in the current ego Chromium",
        },
      ],
      [
        "selectedcontent",
        {
          level: "conditional",
          missing:
            "the real customizable-select journey runs only when the browser exposes the feature",
        },
      ],
      [
        "geolocation",
        {
          level: "partial",
          missing:
            "permission activation hands control to the user and is not automated by this suite",
        },
      ],
      [
        "fencedframe",
        {
          level: "capability-only",
          missing:
            "content loading requires a browser-produced FencedFrameConfig",
        },
      ],
    ],
  );

  const inventory = new Set([...MDN_MODERN_ELEMENTS, ...MDN_OBSOLETE_ELEMENTS]);
  for (const [element, limitation] of LIMITED_BEHAVIOR_COVERAGE) {
    assert(
      inventory.has(element),
      `<${element}> belongs to the pinned inventory`,
    );
    assert.match(limitation.missing, /\S/);
  }
});
