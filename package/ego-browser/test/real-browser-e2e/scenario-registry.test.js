import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { scenarioCases } from "./suites/scenarios/index.mjs";
import { TEST_CASES } from "./site/test-cases.mjs";

const businessScenarios = [
  ["review-workflow", "/tests/review-workflow"],
  ["collaborative-docs", "/tests/collaborative-docs"],
  ["spreadsheet", "/tests/spreadsheet"],
  ["rich-text", "/tests/rich-text"],
];

function scenarioOperations(source) {
  const startMarker = "/* scenario operations */";
  const finishMarker =
    'await observedAction(page, page.getByTestId("finish-test"), "click");';
  const start = source.indexOf(startMarker);
  const finish = source.indexOf(finishMarker, start + startMarker.length);
  if (start < 0 || finish < 0) return "";
  return source.slice(start + startMarker.length, finish);
}

test("registers the native form controls standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "native-form-controls",
  );

  assert.equal(testCase?.route, "/tests/native-form-controls");
  assert.match(scenarioIndex, /["']native-form-controls["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: native-form-controls",
    ),
    "native-form-controls has a real-browser journey",
  );
});

test("uses every MDN native form control in a cross-border release review", async () => {
  const viewSource = await readFile(
    new URL(
      "./site/src/scenarios/native-form-controls/view.jsx",
      import.meta.url,
    ),
    "utf8",
  ).catch(() => "");
  const clientSource = await readFile(
    new URL(
      "./site/src/scenarios/native-form-controls/client.js",
      import.meta.url,
    ),
    "utf8",
  ).catch(() => "");

  for (const element of [
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
  ]) {
    assert.match(viewSource, new RegExp(`<${element}\\b`), element);
  }
  assert.match(
    viewSource,
    /<input\b(?=[^>]*id=["']release-reference["'])(?=[^>]*name=["']releaseReference["'])(?=[^>]*required)(?=[^>]*pattern=)[^>]*>/,
  );
  assert.match(
    viewSource,
    /<input\b(?=[^>]*id=["']launch-city["'])(?=[^>]*list=["']launch-city-list["'])[^>]*>/,
  );
  assert.match(
    viewSource,
    /<datalist\b[^>]*id=["']launch-city-list["'][\s\S]*<option\b[^>]*value=["']Shanghai["']/,
  );
  assert.match(viewSource, /<optgroup\b[^>]*label=["']Southeast Asia["']/);
  assert.match(viewSource, /<optgroup\b[^>]*label=["']Greater China["']/);
  assert.match(
    viewSource,
    /<select\b[^>]*id=["']release-template["'][\s\S]*<button\b[\s\S]*<selectedcontent\b/,
  );
  assert.match(
    viewSource,
    /<label\b[^>]*for=["']risk-buffer["'][^>]*>\s*Risk buffer utilization/,
  );
  assert.match(
    viewSource,
    /<label\b[^>]*for=["']review-progress["'][^>]*>\s*Review completion/,
  );
  assert.match(viewSource, /<meter\b[^>]*id=["']risk-buffer["']/);
  assert.match(viewSource, /<progress\b[^>]*id=["']review-progress["']/);
  assert.match(
    viewSource,
    /<textarea\b(?=[^>]*name=["']reviewNotes["'])(?=[^>]*minLength=)[^>]*>/,
  );
  assert.doesNotMatch(
    viewSource,
    /\b(?:role|novalidate|noValidate)=|onClick=|dangerouslySetInnerHTML/,
  );

  for (const eventName of ["invalid", "input", "change", "submit"]) {
    assert.match(
      clientSource,
      new RegExp(`addEventListener\\s*\\(\\s*["']${eventName}["']`),
      eventName,
    );
  }
  assert.match(clientSource, /new FormData\(form\)/);
  assert.match(clientSource, /event\.preventDefault\(\)/);
  assert.doesNotMatch(
    clientSource,
    /dispatchEvent\(|\.click\(\)|\.requestSubmit\(|\.submit\(|\.checked\s*=/,
  );
  assert.match(clientSource, /reviewProgress\.value\s*=/);
  assert.match(clientSource, /riskBuffer\.value\s*=/);
  assert.match(clientSource, /reviewProgress\.textContent\s*=/);
  assert.match(clientSource, /riskBuffer\.textContent\s*=/);
});

test("native form journey uses browser validation and genuine select interaction", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: native-form-controls",
  );
  const operations = scenarioOperations(testCase?.body() || "");

  assert.match(operations, /ariaSnapshot\(\{ ref: true \}\)/);
  assert(
    (operations.match(/observedAction\(page, releaseSubmit, "click"\)/g) || [])
      .length >= 3,
    "empty, pattern-invalid, and complete submissions all use the visible submit button",
  );
  assert.match(operations, /validationMessage/);
  assert.match(operations, /document\.activeElement/);
  assert.match(operations, /valueMissing/);
  assert.match(operations, /patternMismatch/);
  assert.match(
    operations,
    /observedPageKey\(\s*page,\s*'textbox "Release reference"',\s*"ControlOrMeta\+A",?\s*\)/,
  );
  assert.match(
    operations,
    /observedCurrentKeyboard\(\s*page,\s*'textbox "Release reference"',\s*"type",\s*"SG-2026-0815",?\s*\)/,
  );
  assert.match(
    operations,
    /observedPageKey\(page, 'combobox "Launch city"', "ArrowDown"\)/,
  );
  assert.match(operations, /observedAction\(page, primaryMarket, "click"\)/);
  assert.match(
    operations,
    /observedPageKey\(\s*page,\s*[^,]+,\s*"Escape",?\s*\)/,
  );
  assert.match(
    operations,
    /observedCurrentKeyboard\(\s*page,\s*'combobox "Primary release market"',\s*"type",\s*"Shanghai"/,
  );
  assert.match(operations, /HTMLSelectedContentElement/);
  assert.match(operations, /CSS\.supports\("appearance", "base-select"\)/);
  assert.match(operations, /observedAction\(page, releaseTemplate, "click"\)/);
  assert.match(operations, /observedAction\(page, shanghaiTemplate, "click"\)/);
  assert.match(operations, /selectedcontent/);
  assert.match(operations, /reviewNotes/);
  assert.match(operations, /reviewProgress/);
  assert.match(operations, /native-form-data/);
  assert.match(operations, /Accessibility\.getPartialAXTree/);
  assert.match(operations, /missingRangeControlNames/);
  assert.match(operations, /Risk buffer utilization/);
  assert.match(operations, /Review completion/);
  assert(
    operations.indexOf('observedAction(page, releaseSubmit, "click")') <
      operations.search(
        /observedCurrentKeyboard\(\s*page,\s*'textbox "Release reference"',\s*"type",\s*"SG-2026-0815"/,
      ),
    "native invalid submission happens before keyboard repair",
  );
  assert(
    operations.indexOf('observedAction(page, primaryMarket, "click")') <
      operations.indexOf(
        "observedCurrentKeyboard(\n      page,\n      'combobox \"Primary release market\"'",
      ),
    "mouse-open and Escape happen before classic select typeahead",
  );
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|selectOption\(|requestSubmit\(|\.submit\(|\.evaluate\([^)]*\.click|waitForTimeout/,
  );
});

test("registers the table content standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "table-semantics",
  );

  assert.equal(testCase?.route, "/tests/table-semantics");
  assert.match(scenarioIndex, /["']table-semantics["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: table-semantics",
    ),
    "table-semantics has a real-browser journey",
  );
});

test("uses every MDN table content element in an APAC transfer review", async () => {
  const viewSource = await readFile(
    new URL("./site/src/scenarios/table-semantics/view.jsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  const clientSource = await readFile(
    new URL("./site/src/scenarios/table-semantics/client.js", import.meta.url),
    "utf8",
  ).catch(() => "");

  for (const element of [
    "table",
    "caption",
    "col",
    "colgroup",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
  ]) {
    assert.match(viewSource, new RegExp(`<${element}\\b`), element);
  }
  assert.match(viewSource, /<col\b[^>]*span=\{2\}/);
  assert.match(viewSource, /<th\b[^>]*scope=["']colgroup["']/);
  assert.match(viewSource, /<th\b[^>]*scope=["']rowgroup["']/);
  assert.match(viewSource, /<th\b[^>]*scope=["']col["']/);
  assert.match(viewSource, /<th\b[^>]*scope=["']row["']/);
  assert.match(viewSource, /<td\b[^>]*headers=/);
  assert.match(viewSource, /aria-sort=["']none["']/);
  assert.match(viewSource, /Review Singapore to Shanghai transfer/);
  assert.doesNotMatch(
    viewSource,
    /role=["'](?:table|rowgroup|row|columnheader|rowheader|cell|checkbox)["']|onClick=|dangerouslySetInnerHTML/,
  );
  assert.match(clientSource, /addEventListener\(["']click["']/);
  assert.match(clientSource, /addEventListener\(["']change["']/);
  assert.match(clientSource, /setAttribute\(["']aria-sort["']/);
  assert.doesNotMatch(
    clientSource,
    /dispatchEvent\(|\.click\(\)|force\s*:\s*true/,
  );
});

test("table journey uses real sorting, keyboard selection, and AX comparison", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: table-semantics",
  );
  const operations = scenarioOperations(testCase?.body() || "");

  assert.match(operations, /ariaSnapshot\(\{ ref: true \}\)/);
  assert.equal(
    operations.match(/observedAction\(page, etaSort, "click"\)/g)?.length,
    2,
    "pointer sorting happens both before and after selection",
  );
  assert.match(operations, /observedPageKey\(page, 'button "ETA"', "Enter"\)/);
  assert.match(operations, /observedPageKey\(page, [^,]+, "Tab"\)/);
  assert.match(operations, /observedPageKey\(page, [^,]+, "Space"\)/);
  assert.match(operations, /getAttribute\("aria-sort"\)/);
  assert.match(operations, /allTextContents\(\)/);
  assert.match(operations, /document\.activeElement/);
  assert.match(operations, /isChecked\(\)/);
  assert.match(operations, /selected-cases/);
  assert.match(operations, /selected-value/);
  assert.match(operations, /Accessibility\.getPartialAXTree/);
  assert.match(operations, /missingGroupHeaderSemantics/);
  assert.match(operations, /columnheader/);
  assert.match(operations, /rowheader/);
  assert(
    operations.indexOf('observedAction(page, etaSort, "click")') <
      operations.indexOf('observedPageKey(page, \'button "ETA"\', "Enter")'),
    "pointer ascending sort happens before keyboard descending sort",
  );
  assert(
    operations.indexOf('observedPageKey(page, \'button "ETA"\', "Enter")') <
      operations.indexOf('"Tab"'),
    "keyboard sort happens before tabbing into the review queue",
  );
  assert(
    operations.indexOf('"Tab"') < operations.indexOf('"Space"'),
    "focus navigation happens before keyboard selection",
  );
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|\.evaluate\([^)]*\.click|waitForTimeout/,
  );
});

test("registers the media and embedded content standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "media-embeds",
  );

  assert.equal(testCase?.route, "/tests/media-embeds");
  assert.match(scenarioIndex, /["']media-embeds["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: media-embeds",
    ),
    "media-embeds has a real-browser journey",
  );
});

test("uses every MDN image, multimedia, and embedded content element", async () => {
  const viewSource = await readFile(
    new URL("./site/src/scenarios/media-embeds/view.jsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  const clientSource = await readFile(
    new URL("./site/src/scenarios/media-embeds/client.js", import.meta.url),
    "utf8",
  ).catch(() => "");

  for (const element of [
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
  ]) {
    assert.match(viewSource, new RegExp(`<${element}\\b`), element);
  }
  assert.match(viewSource, /<img\b[^>]*useMap=["']#venue-zones["']/);
  assert.match(viewSource, /<map\b[^>]*name=["']venue-zones["']/);
  assert.match(viewSource, /<area\b[^>]*href=["']#stage-zone["'][^>]*alt=/);
  assert.match(viewSource, /<video\b[^>]*controls/);
  assert.match(viewSource, /<audio\b[^>]*controls/);
  assert.match(viewSource, /<track\b[^>]*kind=["']captions["'][^>]*default/);
  assert.match(viewSource, /<picture\b[\s\S]*<source\b[^>]*(?:srcSet|srcset)=/);
  assert.match(viewSource, /<iframe\b[^>]*title=/);
  assert.match(viewSource, /<object\b[^>]*(?:data|type)=/);
  assert.match(viewSource, /<embed\b[^>]*(?:src|type)=/);
  assert.doesNotMatch(
    viewSource,
    /role=["'](?:button|link|img)["']|onClick=|dangerouslySetInnerHTML/,
  );
  assert.match(clientSource, /addEventListener\(["']hashchange["']/);
  assert.match(clientSource, /addEventListener\(["']message["']/);
  assert.doesNotMatch(clientSource, /dispatchEvent\(|\.click\(\)/);
});

test("media and embeds journey uses real pointer, keyboard, and frame actions", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: media-embeds",
  );
  const operations = scenarioOperations(testCase?.body() || "");

  assert.match(operations, /ariaSnapshot\(\{ ref: true \}\)/);
  assert.match(operations, /observedBoxGesture\(\s*page,\s*venuePlan/);
  assert.match(
    operations,
    /observedFocusedKeyboard\(page, loadingArea, "press", "Enter"\)/,
  );
  assert.match(operations, /observedBoxGesture\(\s*page,\s*briefingAudio/);
  assert.match(operations, /observedBoxGesture\(\s*page,\s*briefingVideo/);
  assert.match(
    operations,
    /observedPageKey\(page, "Audio briefing played", "Space"\)/,
  );
  assert.match(
    operations,
    /observedPageKey\(page, "Video briefing played", "Space"\)/,
  );
  assert.match(operations, /contentFrame\(\)/);
  assert.match(
    operations,
    /observedAction\(safetyFrame, frameChecklist, "click"\)/,
  );
  assert.match(operations, /document\.activeElement/);
  assert.match(operations, /currentTime/);
  assert.match(operations, /readyState/);
  assert.match(
    operations,
    /waitForFunction\(\(\) => \{[\s\S]*querySelector\(\"\[data-venue-plan\]\"\)[\s\S]*currentSrc[\s\S]*complete[\s\S]*naturalWidth/,
    "responsive picture selection waits for the newly selected image to load",
  );
  assert.match(operations, /Accessibility\.getPartialAXTree/);
  assert.match(operations, /missingSnapshotSemantics/);
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|\.evaluate\([^)]*\.click|waitForTimeout/,
  );
});

test("registers the inline text semantics standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "inline-semantics",
  );

  assert.equal(testCase?.route, "/tests/inline-semantics");
  assert.match(scenarioIndex, /["']inline-semantics["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: inline-semantics",
    ),
    "inline-semantics has a real-browser journey",
  );
});

test("uses every MDN inline text semantics element in localized release copy", async () => {
  const viewSource = await readFile(
    new URL("./site/src/scenarios/inline-semantics/view.jsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  const clientSource = await readFile(
    new URL("./site/src/scenarios/inline-semantics/client.js", import.meta.url),
    "utf8",
  ).catch(() => "");

  for (const element of [
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
  ]) {
    assert.match(viewSource, new RegExp(`<${element}\\b`), element);
  }
  assert.match(viewSource, /<ruby\b[\s\S]*<rp\b[\s\S]*<rt\b/);
  assert.match(viewSource, /<bdo\b[^>]*dir=["']rtl["']/);
  assert.match(viewSource, /<abbr\b[^>]*title=/);
  assert.match(viewSource, /<time\b[^>]*dateTime=/);
  assert.match(viewSource, /<data\b[^>]*value=/);
  assert.match(viewSource, /<q\b[^>]*cite=/);
  assert.match(viewSource, /href=["']#terminology["']/);
  assert.match(viewSource, /href=["']#pronunciation["']/);
  assert.doesNotMatch(
    viewSource,
    /role=["'](?:button|link)["']|onClick=|dangerouslySetInnerHTML/,
  );
  assert.match(clientSource, /addEventListener\(["']hashchange["']/);
  assert.match(clientSource, /addEventListener\(["']click["']/);
  assert.doesNotMatch(clientSource, /dispatchEvent\(|\.click\(\)/);
});

test("inline semantics journey uses pointer and keyboard review gates", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: inline-semantics",
  );
  const source = testCase?.body() || "";
  const operations = scenarioOperations(source);

  assert.match(operations, /ariaSnapshot\(\{ ref: true \}\)/);
  assert.match(operations, /observedAction\(page, terminologyLink, "click"\)/);
  assert.match(
    operations,
    /observedFocusedKeyboard\(page, pronunciationLink, "press", "Enter"\)/,
  );
  assert.match(
    operations,
    /observedFocusedKeyboard\(page, approveRelease, "press", "Enter"\)/,
  );
  assert.match(operations, /new URL\(page\.url\(\)\)\.hash/);
  assert.match(operations, /document\.activeElement/);
  assert.match(operations, /getAttribute\("datetime"\)/);
  assert.match(operations, /getAttribute\("value"\)/);
  assert.match(operations, /getAttribute\("dir"\)/);
  assert.match(operations, /boundingBox\(\)/);
  assert.match(operations, /Accessibility\.getPartialAXTree/);
  assert.match(operations, /abbrSnapshot/);
  assert.match(operations, /const abbreviationRef = abbrSnapshot\.match/);
  assert.match(operations, /"Abbr"/);
  assert.doesNotMatch(
    operations,
    /assertIncludes\(\s*abbrSnapshot,\s*"Singapore Standard Time"/,
  );
  assert(
    operations.indexOf('observedAction(page, terminologyLink, "click")') <
      operations.indexOf(
        'observedFocusedKeyboard(page, pronunciationLink, "press", "Enter")',
      ),
    "pointer terminology review happens before keyboard pronunciation review",
  );
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|\.evaluate\([^)]*\.click|waitForTimeout/,
  );
});

test("registers the text content standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "text-content",
  );

  assert.equal(testCase?.route, "/tests/text-content");
  assert.match(scenarioIndex, /["']text-content["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: text-content",
    ),
    "text-content has a real-browser journey",
  );
});

test("uses every MDN text content element in a real incident handoff", async () => {
  const viewSource = await readFile(
    new URL("./site/src/scenarios/text-content/view.jsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  const clientSource = await readFile(
    new URL("./site/src/scenarios/text-content/client.js", import.meta.url),
    "utf8",
  ).catch(() => "");

  for (const element of [
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
  ]) {
    assert.match(viewSource, new RegExp(`<${element}\\b`), element);
  }
  assert.match(viewSource, /<menu\b[\s\S]*<li\b[\s\S]*<button\b/);
  assert.match(viewSource, />\s*Confirm log evidence\s*</);
  assert.match(viewSource, />\s*Mark handoff reviewed\s*</);
  assert.doesNotMatch(
    viewSource,
    /role=["'](?:button|link)["']|onClick=|dangerouslySetInnerHTML/,
  );
  assert.match(clientSource, /addEventListener\(["']click["']/);
  assert.match(clientSource, /aria-pressed/);
  assert.doesNotMatch(clientSource, /dispatchEvent\(|\.click\(\)/);
});

test("text content journey requires pointer evidence before keyboard handoff", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: text-content",
  );
  const source = testCase?.body() || "";
  const operations = scenarioOperations(source);

  assert.match(operations, /ariaSnapshot\(\{ ref: true \}\)/);
  assert.match(operations, /observedAction\(page, confirmEvidence, "click"\)/);
  assert.match(
    operations,
    /observedPageKey\(page, "Mark handoff reviewed", "Enter"\)/,
  );
  assert.match(
    operations,
    /observedPageKey\(page, "Incident event log", "Shift\+Tab"\)/,
  );
  assert.match(operations, /textContent\(\)/);
  assert.match(operations, /boundingBox\(\)/);
  assert.match(operations, /observedBoxGesture\(page, incidentLog/);
  assert.match(operations, /pointer\.wheel\([1-9]\d*,\s*0\)/);
  assert.match(operations, /scrollLeft/);
  assert.match(operations, /document\.activeElement/);
  assert.match(operations, /scopedLogSnapshot/);
  assert.match(operations, /"PRE"/);
  assert(
    operations.indexOf('observedAction(page, confirmEvidence, "click")') <
      operations.indexOf(
        'observedPageKey(page, "Mark handoff reviewed", "Enter")',
      ),
    "pointer evidence review happens before keyboard handoff",
  );
  assert.equal(
    operations.match(/observedAction\(page, confirmEvidence, "click"\)/g)
      ?.length,
    2,
    "the journey retries evidence confirmation after completion",
  );
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|\.evaluate\([^)]*\.click|waitForTimeout/,
  );
});

test("registers the document outline standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "document-outline",
  );

  assert.equal(testCase?.route, "/tests/document-outline");
  assert.match(scenarioIndex, /["']document-outline["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: document-outline",
    ),
    "document-outline has a real-browser journey",
  );
});

test("uses native document landmarks and every heading level", async () => {
  const viewSource = await readFile(
    new URL("./site/src/scenarios/document-outline/view.jsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  const testPageSource = await readFile(
    new URL("./site/src/components/test-page.jsx", import.meta.url),
    "utf8",
  );
  for (const element of [
    "address",
    "article",
    "aside",
    "footer",
    "header",
    "hgroup",
    "nav",
    "search",
    "section",
  ]) {
    assert.match(viewSource, new RegExp(`<${element}\\b`), element);
  }
  assert.match(testPageSource, /<main\b/);
  assert.match(testPageSource, /<h1\b/);
  for (let level = 1; level <= 6; level += 1) {
    assert.match(viewSource, new RegExp(`<h${level}\\b`), `h${level}`);
  }
  assert.doesNotMatch(viewSource, /<main\b/);
  assert.match(viewSource, /href=["']#rollout["']/);
  assert.match(viewSource, /href=["']#support["']/);
  assert.doesNotMatch(
    viewSource,
    /role=["'](?:button|link)["']|onClick=|dangerouslySetInnerHTML/,
  );
});

test("document outline journey uses pointer and keyboard fragment navigation", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: document-outline",
  );
  const source = testCase?.body() || "";
  const operations = scenarioOperations(source);

  assert.match(operations, /ariaSnapshot\(\{ ref: true \}\)/);
  assert.match(operations, /observedAction\(page, rolloutLink, "click"\)/);
  assert.match(
    operations,
    /observedFocusedKeyboard\(page, supportLink, "press", "Enter"\)/,
  );
  assert(
    operations.indexOf('observedAction(page, rolloutLink, "click")') <
      operations.indexOf(
        'observedFocusedKeyboard(page, supportLink, "press", "Enter")',
      ),
    "pointer rollout navigation happens before keyboard support navigation",
  );
  assert.match(operations, /#rollout/);
  assert.match(operations, /#support/);
  assert.match(operations, /new URL\(page\.url\(\)\)\.hash/);
  assert.match(operations, /getByRole\("main"\)/);
  assert.match(operations, /heading \"Release briefing\" \[level=1\]/);
  assert.match(operations, /boundingBox\(\)/);
  assert.match(operations, /observedAction\(page, briefingQuery, "fill"/);
  assert.match(
    operations,
    /observedPageKey\(\s*page,\s*'searchbox "Find a release topic"',\s*"Enter"/,
  );
  assert.match(operations, /searchParams\.get\("q"\)/);
  assert.match(operations, /Accessibility\.getPartialAXTree/);
  assert.match(operations, /searchSnapshot/);
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|\.evaluate\([^)]*\.click|waitForTimeout/,
  );
});

test("registers the SVG and MathML standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "svg-mathml",
  );

  assert.equal(testCase?.route, "/tests/svg-mathml");
  assert.match(scenarioIndex, /["']svg-mathml["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: svg-mathml",
    ),
    "svg-mathml has a real-browser journey",
  );
});

test("uses native SVG and MathML markup for the capacity model", async () => {
  const viewSource = await readFile(
    new URL("./site/src/scenarios/svg-mathml/view.jsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  const clientSource = await readFile(
    new URL("./site/src/scenarios/svg-mathml/client.js", import.meta.url),
    "utf8",
  ).catch(() => "");

  assert.match(viewSource, /<svg\b[^>]*viewBox=/);
  assert.match(viewSource, /<circle\b[^>]*role=["']button["']/);
  assert.match(viewSource, /<foreignObject\b/);
  assert.match(viewSource, /<math\b/);
  assert.equal(viewSource.match(/<math\b/g)?.length, 1);
  assert.match(viewSource, /<mfrac\b/);
  assert.doesNotMatch(viewSource, /dangerouslySetInnerHTML|innerHTML/);

  assert.match(clientSource, /addEventListener\(["']click["']/);
  assert.match(clientSource, /addEventListener\(["']keydown["']/);
  assert.match(clientSource, /addEventListener\(["']submit["']/);
  assert.match(clientSource, /Math\.ceil\(/);
  assert.doesNotMatch(clientSource, /dispatchEvent\(|EGO_BROWSER|case-result/);
});

test("keeps the SVG and MathML journey on observable user behavior", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: svg-mathml",
  );
  const source = testCase?.body() || "";
  const operations = scenarioOperations(source);

  assert.match(operations, /element\.namespaceURI/);
  assert.match(operations, /formula\.ariaSnapshot\(\)/);
  assert.match(operations, /observedFocusedKeyboard\(page, weekFour/);
  assert.match(
    operations,
    /const weekThreeBox = await weekThree\.boundingBox\(\)/,
  );
  assert.match(operations, /observedAction\(page, weekThree, "click"/);
  assert.match(operations, /position:\s*\{/);
  assert.match(operations, /weekThreeBox\.width - 2/);
  assert.match(operations, /"51"/);
  assert.match(operations, /"12"/);
  assert(
    operations.indexOf("const updatedFormulaSnapshot") <
      operations.indexOf("const weekThree"),
    "MathML behavior is verified before the SVG ring-edge pointer action",
  );
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|\.evaluate\([^)]*\.click|assertRejects/,
  );
});

test("registers the four business collaboration scenarios", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  for (const [slug, route] of businessScenarios) {
    const testCase = TEST_CASES.find((candidate) => candidate.slug === slug);
    assert.equal(testCase?.route, route);
    const surfaceKey = slug.includes("-")
      ? `["']${slug}["']`
      : `(?:["']${slug}["']|${slug})`;
    assert.match(scenarioIndex, new RegExp(`${surfaceKey}\\s*:`));
  }
});

test("keeps one view and one browser client for every business scenario", async () => {
  for (const [slug] of businessScenarios) {
    await access(
      new URL(`./site/src/scenarios/${slug}/view.jsx`, import.meta.url),
    );
    await access(
      new URL(`./site/src/scenarios/${slug}/client.js`, import.meta.url),
    );
  }
});

test("declares focused editor, collaboration, and spreadsheet dependencies", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("./site/package.json", import.meta.url), "utf8"),
  );
  const expectedDependencies = [
    "@tiptap/core",
    "@tiptap/extension-collaboration",
    "@tiptap/pm",
    "@tiptap/starter-kit",
    "@tiptap/y-tiptap",
    "quill",
    "tabulator-tables",
    "yjs",
  ];
  for (const dependency of expectedDependencies) {
    assert.equal(typeof packageJson.dependencies[dependency], "string");
  }
  assert.equal(packageJson.dependencies.quill, "2.0.2");
});

test("covers every business scenario with a real-browser journey", () => {
  const names = new Set(scenarioCases.map((testCase) => testCase.name));
  for (const [slug] of businessScenarios) {
    assert(names.has(`web test: ${slug}`), `${slug} has a browser journey`);
  }
});
