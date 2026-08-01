import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { raw } from "hono/html";

import styles from "./styles.css";
import { findTestCase, TEST_CASES } from "../test-cases.mjs";

function documentHtml(content) {
  return `<!doctype html>${content}`;
}

function Layout({ title, children, script = "" }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="description"
          content="Deterministic browser interaction fixtures for ego-browser."
        />
        <title>
          {title ? `${title} · Ego Browser Lab` : "Ego Browser Lab"}
        </title>
        <style>{raw(styles)}</style>
      </head>
      <body>
        {children}
        {script ? <script>{raw(script)}</script> : null}
      </body>
    </html>
  );
}

function HomePage() {
  return (
    <Layout>
      <main class="index-shell">
        <header class="index-intro">
          <p class="brand-mark">EGO / BROWSER LAB</p>
          <div class="intro-copy">
            <p class="kicker">Deterministic interaction fixtures</p>
            <h1>
              One browser behavior.
              <br />
              One clear signal.
            </h1>
            <p class="lede">
              A focused test surface for Playwright running through ego-lite
              TaskSpaces. Every route is isolated, inspectable, and designed to
              fail loudly.
            </p>
          </div>
          <div class="index-meta" aria-label="Test suite metadata">
            <span>{TEST_CASES.length} routes</span>
            <span>Native Playwright</span>
            <span>TaskSpace isolated</span>
          </div>
        </header>

        <nav class="route-index" aria-label="Browser test routes">
          {TEST_CASES.map((testCase) => (
            <a
              class="route-row"
              href={testCase.route}
              data-testid={`route-${testCase.slug}`}
            >
              <span class="route-number">{testCase.number}</span>
              <span class="route-name">
                <strong>{testCase.title}</strong>
                <small>{testCase.eyebrow}</small>
              </span>
              <span class="route-description">{testCase.description}</span>
              <span class="route-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ))}
        </nav>
      </main>
    </Layout>
  );
}

function TestPage({ testCase }) {
  const Surface = surfaces[testCase.slug];
  return (
    <Layout title={testCase.title} script={clientScripts[testCase.slug]}>
      <main class="test-shell" data-test-route={testCase.route}>
        <header class="test-header">
          <a class="brand-mark" href="/">
            EGO / BROWSER LAB
          </a>
          <span class="ready-mark">
            <i /> READY FOR INPUT
          </span>
        </header>

        <section class="test-heading">
          <div>
            <p class="kicker">{testCase.eyebrow}</p>
            <h1>{testCase.title}</h1>
          </div>
          <p>{testCase.description}</p>
          <span class="test-number">{testCase.number}</span>
        </section>

        <Surface />

        <footer class="test-footer">
          <a href="/">← All test routes</a>
          <code>{testCase.route}</code>
        </footer>
      </main>
    </Layout>
  );
}

function Stat({ label, value, testId }) {
  return (
    <div class="stat">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

function ClicksSurface() {
  return (
    <section class="surface operations-layout">
      <div class="queue-panel">
        <div class="scenario-toolbar">
          <div>
            <span>FULFILMENT / TODAY</span>
            <strong>5 orders need attention</strong>
          </div>
          <button class="quiet-action">Filter: Ready</button>
        </div>
        <div
          class="order-list"
          role="table"
          aria-label="Orders awaiting dispatch"
        >
          <div class="order-row muted-row" role="row">
            <span>EG-1839</span>
            <strong>Paper lamp</strong>
            <small>Singapore · Packed</small>
            <i>08:42</i>
          </div>
          <div class="order-row selected-row" role="row" aria-selected="true">
            <span>EG-1842</span>
            <strong>Arc desk set</strong>
            <small>Shanghai · Priority</small>
            <i>09:16</i>
          </div>
          <div class="order-row" role="row">
            <span>EG-1846</span>
            <strong>Field notebook × 3</strong>
            <small>Tokyo · Packed</small>
            <i>09:31</i>
          </div>
        </div>
        <div class="queue-actions">
          <p>
            <span class="selection-dot" /> Order EG-1842 selected
          </p>
          <button id="context-target" class="context-target">
            More actions
          </button>
          <button id="click-target" class="primary-action">
            Approve dispatch
          </button>
        </div>
      </div>
      <aside class="stat-stack activity-panel" aria-label="Dispatch activity">
        <div class="panel-heading">
          <span>LIVE ACTIVITY</span>
          <small>Browser event readback</small>
        </div>
        <Stat label="click events" value="0" testId="click-count" />
        <Stat
          label="double click events"
          value="0"
          testId="double-click-count"
        />
        <Stat
          label="context menu events"
          value="0"
          testId="right-click-count"
        />
        <p class="activity-note">
          Double-approve is accepted but tracked separately. Secondary click
          opens the order action context.
        </p>
      </aside>
    </section>
  );
}

function HoverSurface() {
  return (
    <section class="surface product-layout">
      <div class="product-browser">
        <div class="scenario-toolbar">
          <div>
            <span>MATERIAL LIBRARY / 04</span>
            <strong>Autumn surfaces</strong>
          </div>
          <button class="quiet-action">Sort by tone</button>
        </div>
        <div class="product-grid">
          <article id="hover-target" class="product-tile product-clay">
            <span class="product-code">M-042</span>
            <div class="swatch-mark">ARC</div>
            <div class="product-copy">
              <strong>Burnt clay</strong>
              <small>Powder-coated aluminium</small>
            </div>
            <div class="hover-reveal">
              <span>VIEW SPECIFICATION</span>
              <i>↗</i>
            </div>
          </article>
          <article class="product-tile product-moss">
            <span class="product-code">M-051</span>
            <div class="swatch-mark">FOLD</div>
            <div class="product-copy">
              <strong>Wet moss</strong>
              <small>Woven upholstery</small>
            </div>
          </article>
          <article class="product-tile product-oat">
            <span class="product-code">M-067</span>
            <div class="swatch-mark">LINE</div>
            <div class="product-copy">
              <strong>Warm oat</strong>
              <small>Recycled composite</small>
            </div>
          </article>
        </div>
      </div>
      <aside class="stat-stack product-inspector">
        <div class="panel-heading">
          <span>PREVIEW SIGNAL</span>
          <small>Burnt clay / M-042</small>
        </div>
        <Stat label="pointer state" value="outside" testId="hover-state" />
        <Stat label="entries" value="0" testId="hover-entries" />
        <Stat label="moves" value="0" testId="hover-moves" />
        <p class="activity-note">
          Move across the first material to reveal its specification shortcut.
        </p>
      </aside>
    </section>
  );
}

function DragDropSurface() {
  return (
    <section class="surface board-surface">
      <div class="board-toolbar">
        <div>
          <span>WEBSITE REFRESH</span>
          <strong>Sprint 24 · Design review</strong>
        </div>
        <div>
          <span class="avatar-stack">AM&nbsp;&nbsp;JW&nbsp;&nbsp;+2</span>
          <button class="quiet-action">Board settings</button>
        </div>
      </div>
      <div class="kanban-board">
        <section class="board-column">
          <header>
            <strong>IN PROGRESS</strong>
            <span>2</span>
          </header>
          <article id="mouse-drag-source" class="task-card">
            <span class="task-tag">COPY</span>
            <strong>Rewrite checkout reassurance</strong>
            <p>Clarify delivery dates at the final step.</p>
            <footer>
              <i>AM</i>
              <small>Today</small>
            </footer>
          </article>
          <article class="task-card quiet-card">
            <span class="task-tag">UI</span>
            <strong>Empty cart treatment</strong>
            <p>Prepare responsive states.</p>
          </article>
        </section>
        <section id="mouse-drag-target" class="board-column review-column">
          <header>
            <strong>REVIEW</strong>
            <span>1</span>
          </header>
          <article class="task-card">
            <span class="task-tag">A11Y</span>
            <strong>Keyboard order audit</strong>
            <p>Ready for product review.</p>
          </article>
          <output class="column-status" data-testid="mouse-drag-status">
            Drop pressed-pointer card here
          </output>
        </section>
        <section class="board-column">
          <header>
            <strong>READY</strong>
            <span>1</span>
          </header>
          <article
            id="html-drag-source"
            class="task-card priority-card"
            draggable="true"
          >
            <span class="task-tag">PRIORITY</span>
            <strong>Publish shipping matrix</strong>
            <p>Native draggable card with release payload.</p>
            <footer>
              <i>JW</i>
              <small>Drag me</small>
            </footer>
          </article>
          <div id="html-drop-target" class="native-drop-zone">
            Move ready work here
          </div>
          <output class="column-status" data-testid="html-drop-status">
            Awaiting release card
          </output>
        </section>
      </div>
    </section>
  );
}

function CanvasSurface() {
  return (
    <section class="surface review-canvas-layout">
      <div class="review-document">
        <div class="canvas-toolbar">
          <div>
            <button class="tool-button active-tool" aria-label="Coral pen">
              ●
            </button>
            <button class="tool-button" aria-label="Dark pen">
              ●
            </button>
            <button class="tool-button" aria-label="Highlighter">
              ▰
            </button>
          </div>
          <span>Homepage / revision 08</span>
          <button id="clear-canvas" class="quiet-action">
            Clear markup
          </button>
        </div>
        <div class="canvas-wrap">
          <div class="mock-layout" aria-hidden="true">
            <span>NEW COLLECTION / 2026</span>
            <strong>Objects for slower rooms.</strong>
            <i>Explore collection →</i>
            <div />
          </div>
          <canvas id="draw-canvas" width="960" height="480" />
          <span>ANNOTATION LAYER / 960 × 480</span>
        </div>
      </div>
      <aside class="canvas-sidebar">
        <div class="panel-heading">
          <span>REVIEW NOTES</span>
          <small>Revision 08 · Unsaved</small>
        </div>
        <Stat label="strokes" value="0" testId="canvas-strokes" />
        <Stat label="sampled points" value="0" testId="canvas-points" />
        <div class="review-comment">
          <i>JW</i>
          <p>
            <strong>Hero hierarchy</strong>
            <span>Mark the point where the headline should turn.</span>
          </p>
        </div>
        <div class="review-comment">
          <i>AM</i>
          <p>
            <strong>Primary action</strong>
            <span>Check contrast around the collection link.</span>
          </p>
        </div>
      </aside>
    </section>
  );
}

function FormsSurface() {
  return (
    <section class="surface request-layout">
      <div class="request-form">
        <div class="scenario-toolbar">
          <div>
            <span>NEW REQUEST / CREATIVE SERVICES</span>
            <strong>Launch support brief</strong>
          </div>
          <span class="draft-badge">DRAFT SAVED</span>
        </div>
        <div class="form-fields">
          <label>
            Project name
            <input id="text-input" placeholder="e.g. Autumn retail launch" />
          </label>
          <label>
            Priority
            <select id="priority-select">
              <option value="normal">Normal · 10 days</option>
              <option value="high">High · 5 days</option>
              <option value="urgent">Urgent · 48 hours</option>
            </select>
          </label>
          <label class="wide-field">
            What do you need?
            <textarea
              id="notes-input"
              placeholder="Give the team enough context to start well."
            />
          </label>
          <fieldset>
            <legend>Delivery plan</legend>
            <label class="check-row">
              <input type="radio" name="plan" value="basic" checked /> Focused
              deliverable
            </label>
            <label class="check-row">
              <input type="radio" name="plan" value="pro" /> Full campaign
              system
            </label>
          </fieldset>
          <label class="approval-box">
            <input id="approval-checkbox" type="checkbox" />
            <span>
              <strong>Budget owner approved</strong>
              <small>Required before scheduling</small>
            </span>
          </label>
          <button id="toggle-dynamic" class="secondary-action">
            Add stakeholder
          </button>
        </div>
      </div>
      <aside class="form-readback" aria-label="Request summary">
        <div class="panel-heading">
          <span>REQUEST SUMMARY</span>
          <small>Updates as you type</small>
        </div>
        <p>
          <span>text</span>
          <output data-testid="form-text">—</output>
        </p>
        <p>
          <span>notes</span>
          <output data-testid="form-notes">—</output>
        </p>
        <p>
          <span>priority</span>
          <output data-testid="form-priority">normal</output>
        </p>
        <p>
          <span>approved</span>
          <output data-testid="form-approved">false</output>
        </p>
        <p>
          <span>plan</span>
          <output data-testid="form-plan">basic</output>
        </p>
        <div id="dynamic-slot" />
        <button class="primary-action summary-submit">
          Submit for scheduling
        </button>
      </aside>
    </section>
  );
}

function KeyboardSurface() {
  return (
    <section class="surface editorial-layout">
      <div class="document-editor">
        <div class="editor-toolbar">
          <div>
            <button class="tool-button active-tool">B</button>
            <button class="tool-button">
              <i>I</i>
            </button>
            <button class="tool-button">↗</button>
          </div>
          <span>Saved locally · just now</span>
          <button class="quiet-action">Share draft</button>
        </div>
        <div class="editor-paper">
          <p class="surface-label">FIELD NOTES / ISSUE 12</p>
          <label class="editor-title-label">
            Story title
            <input id="keyboard-input" value="seed" aria-label="Story title" />
          </label>
          <div
            id="rich-editor"
            class="rich-editor"
            role="textbox"
            aria-label="Story body"
            contenteditable="true"
            data-placeholder="Start writing the opening paragraph…"
          />
        </div>
      </div>
      <aside class="key-readback">
        <div class="panel-heading">
          <span>DOCUMENT INSPECTOR</span>
          <small>Input and shortcut signals</small>
        </div>
        <Stat label="input value" value="seed" testId="keyboard-value" />
        <Stat label="rich text" value="—" testId="rich-value" />
        <p class="key-log">
          <span>KEY LOG</span>
          <output data-testid="key-log">waiting</output>
        </p>
        <div class="editor-tip">
          <strong>Editing tip</strong>
          <p>
            Use the system select-all shortcut to replace the title, then
            continue in the story body.
          </p>
        </div>
      </aside>
    </section>
  );
}

function UploadsSurface() {
  return (
    <section class="surface asset-layout">
      <div class="asset-delivery">
        <div class="scenario-toolbar">
          <div>
            <span>CAMPAIGN / AUTUMN OBJECTS</span>
            <strong>Final artwork delivery</strong>
          </div>
          <span class="draft-badge">DUE FRI 18:00</span>
        </div>
        <label class="upload-zone" for="file-input">
          <span>DROP OR SELECT</span>
          <strong>Deliver campaign assets</strong>
          <small>
            TXT fixtures in E2E; production accepts artwork up to 2 GB
          </small>
          <i>Choose files →</i>
        </label>
        <input id="file-input" type="file" multiple />
        <div class="delivery-notes">
          <p>
            <strong>Naming</strong>
            <span>campaign_surface_version.ext</span>
          </p>
          <p>
            <strong>Color</strong>
            <span>sRGB for digital delivery</span>
          </p>
          <p>
            <strong>Review</strong>
            <span>Every file receives a checksum</span>
          </p>
        </div>
      </div>
      <aside class="delivery-receipt">
        <div class="receipt-heading">
          <div>
            <span>DELIVERY RECEIPT</span>
            <strong>Ready for files</strong>
          </div>
          <output data-testid="file-count">0</output>
        </div>
        <div class="file-list" data-testid="file-list">
          <p>No files selected</p>
        </div>
        <p class="activity-note">
          File metadata shown here comes directly from the browser FileList.
        </p>
      </aside>
    </section>
  );
}

function ScrollSurface() {
  return (
    <section class="surface journal-layout">
      <article class="journal-article">
        <p class="surface-label">DESIGN FIELD JOURNAL / SINGAPORE</p>
        <h2>What shade teaches us about public space</h2>
        <p class="article-lede">
          A morning walk through five sheltered courtyards reveals how small
          decisions around airflow, sound, and material make a city feel
          generous.
        </p>
        <div class="article-figure">
          <span>07:40 / TIONG BAHRU</span>
          <strong>Light arrives indirectly.</strong>
        </div>
        <p>
          At the first courtyard, movement slows without a sign asking anyone to
          slow down. A line of deep columns frames the path and turns the
          ordinary act of crossing into a sequence of short rooms.
        </p>
        <p>
          The useful detail is not the column itself. It is the interval: enough
          room for two people to pass, enough shadow to make stopping
          comfortable, and enough visibility to keep the next space legible.
        </p>
        <blockquote>
          Comfort is often the result of relationships, not objects.
        </blockquote>
        <p>
          Further along, planted edges absorb the harder sounds from the street.
          Benches face across the path instead of toward it, creating accidental
          stages for everyday life.
        </p>
        <div id="document-marker" class="document-marker">
          <span>END NOTE / 05</span>
          <strong>Document marker reached</strong>
        </div>
      </article>
      <aside class="journal-rail">
        <div class="panel-heading">
          <span>FIELD ACTIVITY</span>
          <small>Independent scroll region</small>
        </div>
        <div id="nested-scroll" class="nested-scroll">
          <article>
            <span>07:40</span>
            <strong>Courtyard entry</strong>
            <p>Indirect light and deep threshold.</p>
          </article>
          <article>
            <span>08:05</span>
            <strong>Covered linkway</strong>
            <p>Cross breeze recorded at both ends.</p>
          </article>
          <article>
            <span>08:32</span>
            <strong>Market edge</strong>
            <p>Sound falls sharply behind planting.</p>
          </article>
          <article>
            <span>09:10</span>
            <strong>Community room</strong>
            <p>Doors remain fully open before noon.</p>
          </article>
          <article>
            <span>09:46</span>
            <strong>Final marker</strong>
            <p id="nested-marker">Nested marker reached</p>
          </article>
        </div>
        <p class="rail-position">
          TIMELINE POSITION <output data-testid="nested-scroll-top">0</output>{" "}
          PX
        </p>
      </aside>
    </section>
  );
}

function NavigationSurface() {
  return (
    <section class="surface knowledge-layout">
      <div class="knowledge-sidebar">
        <span>WORKSPACE / RETAIL LAUNCH</span>
        <strong>Research index</strong>
        <nav>
          <a class="active-doc" href="#">
            Overview <small>12</small>
          </a>
          <a href="#">
            Customer signals <small>08</small>
          </a>
          <a href="#">
            Market notes <small>17</small>
          </a>
          <a href="#">
            Decisions <small>05</small>
          </a>
        </nav>
        <p>Last indexed 4 minutes ago</p>
      </div>
      <div class="knowledge-content">
        <div class="scenario-toolbar">
          <div>
            <span>PINNED REFERENCES</span>
            <strong>Continue from the current context</strong>
          </div>
          <button class="quiet-action">+ New reference</button>
        </div>
        <div class="reference-list">
          <a
            id="same-page-link"
            class="reference-row"
            href="/tests/navigation/destination"
          >
            <span>01</span>
            <div>
              <small>INTERNAL NOTE · 6 MIN</small>
              <strong>Navigate to the launch decision record</strong>
              <p>
                Open this reference in the current workspace and preserve the
                reading trail.
              </p>
            </div>
            <i>→</i>
          </a>
          <a
            id="new-page-link"
            class="reference-row"
            href="/tests/navigation/destination?source=new-page"
            target="_blank"
            rel="noreferrer"
          >
            <span>02</span>
            <div>
              <small>INDEPENDENT RESEARCH · 9 MIN</small>
              <strong>Open the material benchmark separately</strong>
              <p>
                Keep the current index visible while reviewing a second source.
              </p>
            </div>
            <i>↗</i>
          </a>
        </div>
      </div>
    </section>
  );
}

function DialogsSurface() {
  return (
    <section class="surface release-layout">
      <div class="release-summary">
        <span class="release-state">
          <i /> READY TO PUBLISH
        </span>
        <h2>
          Release 1.3
          <br />
          Native TaskSpaces
        </h2>
        <p>
          13 checks passed in staging. The release includes the local CDP bridge
          and native Playwright page lifecycle.
        </p>
        <dl>
          <div>
            <dt>Commit</dt>
            <dd>80a9e0c</dd>
          </div>
          <div>
            <dt>Audience</dt>
            <dd>Internal beta</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>Today · 18:00</dd>
          </div>
        </dl>
      </div>
      <div class="release-actions">
        <article>
          <span>01 / NOTICE</span>
          <div>
            <strong>Notify observers</strong>
            <p>Send a non-blocking release notice before the window opens.</p>
          </div>
          <button id="alert-button">Preview notice</button>
        </article>
        <article>
          <span>02 / APPROVAL</span>
          <div>
            <strong>Confirm publication</strong>
            <p>
              Require an explicit confirmation before moving the release live.
            </p>
          </div>
          <button id="confirm-button">Request approval</button>
        </article>
        <article>
          <span>03 / LABEL</span>
          <div>
            <strong>Name the release</strong>
            <p>Capture the final human-readable label for the archive.</p>
          </div>
          <button id="prompt-button">Set release name</button>
        </article>
        <div class="dialog-result">
          <span>LAST WORKFLOW RESULT</span>
          <output data-testid="dialog-result">waiting</output>
        </div>
      </div>
    </section>
  );
}

function DownloadsSurface() {
  return (
    <section class="surface archive-layout">
      <div class="scenario-toolbar">
        <div>
          <span>OPERATIONS / EXPORTS</span>
          <strong>Generated reports</strong>
        </div>
        <div class="archive-range">01 JUL — 31 JUL</div>
      </div>
      <div class="report-table" role="table" aria-label="Generated reports">
        <div class="report-row report-header" role="row">
          <span>Report</span>
          <span>Owner</span>
          <span>Format</span>
          <span>Generated</span>
          <span></span>
        </div>
        <div class="report-row" role="row">
          <div>
            <i>CSV</i>
            <strong>Fulfilment exceptions</strong>
            <small>24 rows · APAC warehouses</small>
          </div>
          <span>Operations</span>
          <span>CSV · 18 KB</span>
          <span>Today, 10:22</span>
          <button class="quiet-action">Prepare</button>
        </div>
        <div class="report-row selected-report" role="row">
          <div>
            <i>TXT</i>
            <strong>Browser run summary</strong>
            <small>Deterministic E2E export</small>
          </div>
          <span>Engineering</span>
          <span>TXT · 29 B</span>
          <span>Today, 10:31</span>
          <a
            id="download-link"
            class="primary-action"
            href="/api/download"
            download
          >
            Download
          </a>
        </div>
        <div class="report-row" role="row">
          <div>
            <i>PDF</i>
            <strong>Weekly service review</strong>
            <small>Charts and incident notes</small>
          </div>
          <span>Reliability</span>
          <span>PDF · 1.2 MB</span>
          <span>Yesterday</span>
          <button class="quiet-action">Prepare</button>
        </div>
      </div>
    </section>
  );
}

function FramesSurface() {
  return (
    <section class="surface checkout-layout">
      <div class="order-summary">
        <span>ORDER / EG-1842</span>
        <h2>Arc desk set</h2>
        <div class="order-visual">
          <i>ARC</i>
        </div>
        <dl>
          <div>
            <dt>Finish</dt>
            <dd>Burnt clay</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>2–4 business days</dd>
          </div>
          <div>
            <dt>Subtotal</dt>
            <dd>S$ 248.00</dd>
          </div>
        </dl>
        <p>Secure partner checkout appears alongside the host order context.</p>
      </div>
      <div class="partner-checkout">
        <div class="partner-heading">
          <span>SECURE PARTNER</span>
          <strong>Complete checkout</strong>
          <i>Protected frame</i>
        </div>
        <iframe
          id="test-frame"
          title="Browser test frame"
          src="/frames/content"
        />
      </div>
    </section>
  );
}

function NetworkSurface() {
  return (
    <section class="surface tracker-layout">
      <div class="tracking-search">
        <span class="surface-label">INTERNATIONAL DELIVERY</span>
        <h2>Track a shipment</h2>
        <p>
          Enter a reference to request the newest carrier scan and estimated
          arrival.
        </p>
        <label>
          Tracking reference
          <div>
            <input value="EG-1842-SIN" aria-label="Tracking reference" />
            <button id="network-button" class="primary-action">
              Check status
            </button>
          </div>
        </label>
        <small>Updates may take up to five minutes after a carrier scan.</small>
      </div>
      <aside class="tracking-result">
        <div class="receipt-heading">
          <div>
            <span>SHIPMENT STATUS</span>
            <strong>EG-1842-SIN</strong>
          </div>
          <output data-testid="network-status">idle</output>
        </div>
        <div class="tracking-timeline">
          <article class="completed-scan">
            <i />
            <div>
              <strong>Order confirmed</strong>
              <span>Singapore · 08:20</span>
            </div>
          </article>
          <article class="current-scan">
            <i />
            <div>
              <strong data-testid="network-payload">Awaiting lookup</strong>
              <span>Live response appears here</span>
            </div>
          </article>
          <article>
            <i />
            <div>
              <strong>Out for delivery</strong>
              <span>Estimated tomorrow</span>
            </div>
          </article>
        </div>
      </aside>
    </section>
  );
}

const surfaces = {
  clicks: ClicksSurface,
  hover: HoverSurface,
  "drag-drop": DragDropSurface,
  canvas: CanvasSurface,
  forms: FormsSurface,
  keyboard: KeyboardSurface,
  uploads: UploadsSurface,
  scroll: ScrollSurface,
  navigation: NavigationSurface,
  dialogs: DialogsSurface,
  downloads: DownloadsSurface,
  frames: FramesSurface,
  network: NetworkSurface,
};

const clientScripts = {
  clicks: `
    const clickTarget = document.querySelector('#click-target');
    const contextTarget = document.querySelector('#context-target');
    let clicks = 0, doubles = 0, rightClicks = 0;
    clickTarget.addEventListener('click', () => { document.querySelector('[data-testid="click-count"]').textContent = String(++clicks); });
    clickTarget.addEventListener('dblclick', () => { document.querySelector('[data-testid="double-click-count"]').textContent = String(++doubles); });
    contextTarget.addEventListener('contextmenu', (event) => { event.preventDefault(); document.querySelector('[data-testid="right-click-count"]').textContent = String(++rightClicks); });
  `,
  hover: `
    const target = document.querySelector('#hover-target');
    const state = document.querySelector('[data-testid="hover-state"]');
    const entries = document.querySelector('[data-testid="hover-entries"]');
    const moves = document.querySelector('[data-testid="hover-moves"]');
    let entryCount = 0, moveCount = 0;
    target.addEventListener('mouseenter', () => { target.classList.add('is-hovered'); target.querySelector('.hover-reveal span').textContent = 'VIEWING SPECIFICATION'; state.textContent = 'inside'; entries.textContent = String(++entryCount); });
    target.addEventListener('mousemove', () => { moves.textContent = String(++moveCount); });
    target.addEventListener('mouseleave', () => { target.classList.remove('is-hovered'); target.querySelector('.hover-reveal span').textContent = 'VIEW SPECIFICATION'; state.textContent = 'outside'; });
  `,
  "drag-drop": `
    let mousePressed = false;
    const mouseSource = document.querySelector('#mouse-drag-source');
    mouseSource.addEventListener('mousedown', () => { mousePressed = true; });
    mouseSource.addEventListener('mouseup', () => { mousePressed = false; });
    document.querySelector('#mouse-drag-target').addEventListener('mouseup', () => { if (mousePressed) document.querySelector('[data-testid="mouse-drag-status"]').textContent = 'Card moved to review'; mousePressed = false; });
    const htmlSource = document.querySelector('#html-drag-source');
    const htmlTarget = document.querySelector('#html-drop-target');
    htmlSource.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', 'ego-payload'));
    htmlTarget.addEventListener('dragover', (event) => event.preventDefault());
    htmlTarget.addEventListener('drop', (event) => { event.preventDefault(); document.querySelector('[data-testid="html-drop-status"]').textContent = event.dataTransfer.getData('text/plain'); });
  `,
  canvas: `
    const canvas = document.querySelector('#draw-canvas');
    const context = canvas.getContext('2d');
    const strokeOutput = document.querySelector('[data-testid="canvas-strokes"]');
    const pointOutput = document.querySelector('[data-testid="canvas-points"]');
    let drawing = false, lastPoint, strokes = 0, points = 0;
    const pointFor = (event) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
    canvas.addEventListener('mousedown', (event) => { drawing = true; lastPoint = pointFor(event); strokeOutput.textContent = String(++strokes); pointOutput.textContent = String(++points); });
    canvas.addEventListener('mousemove', (event) => { if (!drawing) return; const next = pointFor(event); context.strokeStyle = '#ff5c35'; context.lineWidth = 8; context.lineCap = 'round'; context.beginPath(); context.moveTo(lastPoint.x, lastPoint.y); context.lineTo(next.x, next.y); context.stroke(); lastPoint = next; pointOutput.textContent = String(++points); });
    const stop = () => { drawing = false; lastPoint = undefined; };
    canvas.addEventListener('mouseup', stop); canvas.addEventListener('mouseleave', stop);
    document.querySelector('#clear-canvas').addEventListener('click', () => { context.clearRect(0, 0, canvas.width, canvas.height); strokes = 0; points = 0; strokeOutput.textContent = '0'; pointOutput.textContent = '0'; });
  `,
  forms: `
    const bind = (selector, output, event = 'input', value = (element) => element.value || '—') => document.querySelector(selector).addEventListener(event, ({ currentTarget }) => { document.querySelector('[data-testid="' + output + '"]').textContent = String(value(currentTarget)); });
    bind('#text-input', 'form-text'); bind('#notes-input', 'form-notes'); bind('#priority-select', 'form-priority', 'change'); bind('#approval-checkbox', 'form-approved', 'change', (element) => element.checked);
    document.querySelectorAll('input[name="plan"]').forEach((input) => input.addEventListener('change', (event) => { if (event.target.checked) document.querySelector('[data-testid="form-plan"]').textContent = event.target.value; }));
    document.querySelector('#toggle-dynamic').addEventListener('click', () => { const slot = document.querySelector('#dynamic-slot'); const existing = document.querySelector('#dynamic-node'); if (existing) existing.remove(); else { const node = document.createElement('strong'); node.id = 'dynamic-node'; node.textContent = 'Stakeholder: Mei Lin · Product'; slot.append(node); } });
  `,
  keyboard: `
    const input = document.querySelector('#keyboard-input');
    const rich = document.querySelector('#rich-editor');
    const valueOutput = document.querySelector('[data-testid="keyboard-value"]');
    const richOutput = document.querySelector('[data-testid="rich-value"]');
    const keyOutput = document.querySelector('[data-testid="key-log"]');
    const keys = [];
    input.addEventListener('input', () => { valueOutput.textContent = input.value; });
    input.addEventListener('keydown', (event) => { keys.push(event.key); keyOutput.textContent = keys.join(' · '); });
    rich.addEventListener('input', () => { richOutput.textContent = rich.textContent || '—'; });
  `,
  uploads: `
    document.querySelector('#file-input').addEventListener('change', (event) => {
      const files = Array.from(event.target.files || []);
      document.querySelector('[data-testid="file-count"]').textContent = String(files.length);
      const list = document.querySelector('[data-testid="file-list"]'); list.textContent = '';
      for (const file of files) { const row = document.createElement('p'); const name = document.createElement('strong'); const meta = document.createElement('span'); name.textContent = file.name; meta.textContent = file.size + ' B · ' + (file.type || 'unknown'); row.append(name, meta); list.append(row); }
    });
  `,
  scroll: `document.querySelector('#nested-scroll').addEventListener('scroll', (event) => { document.querySelector('[data-testid="nested-scroll-top"]').textContent = String(Math.round(event.currentTarget.scrollTop)); });`,
  dialogs: `
    const result = document.querySelector('[data-testid="dialog-result"]');
    document.querySelector('#alert-button').addEventListener('click', () => { alert('ego alert'); result.textContent = 'alert closed'; });
    document.querySelector('#confirm-button').addEventListener('click', () => { result.textContent = confirm('approve ego test?') ? 'confirmed' : 'dismissed'; });
    document.querySelector('#prompt-button').addEventListener('click', () => { result.textContent = prompt('name this run', 'ego') ?? 'cancelled'; });
  `,
  network: `
    document.querySelector('#network-button').addEventListener('click', async () => {
      const status = document.querySelector('[data-testid="network-status"]'); status.textContent = 'pending';
      const response = await fetch('/api/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'In transit · Tuas hub' }) });
      const body = await response.json(); status.textContent = String(response.status); document.querySelector('[data-testid="network-payload"]').textContent = body.echo;
    });
  `,
};

export function createTestSiteApp(taskName) {
  const app = new Hono();
  app.get("/healthz", (context) =>
    context.json({
      ok: true,
      taskName,
      fixture: "ego-browser-hono-test-site",
      now: Date.now(),
    }),
  );
  app.get("/", (context) => context.html(documentHtml(<HomePage />)));
  app.get("/tests/navigation/destination", (context) =>
    context.html(
      documentHtml(
        <Layout title="Launch decision record">
          <main class="destination-page">
            <p class="brand-mark">NORTHSTAR / KNOWLEDGE</p>
            <p class="kicker">Decision record · DR-024</p>
            <h1>Launch in two measured phases.</h1>
            <p id="destination-status">
              The workspace opened a complete decision record in this page.
            </p>
            <div class="decision-meta">
              <span>DECIDED 24 JUL</span>
              <span>OWNER / MEI LIN</span>
              <span>5 LINKED NOTES</span>
            </div>
            <a href="/tests/navigation">← Return to research index</a>
          </main>
        </Layout>,
      ),
    ),
  );
  app.get("/frames/content", (context) =>
    context.html(
      documentHtml(
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Secure partner checkout</title>
            <style>
              {raw(
                "*{box-sizing:border-box}body{margin:0;font-family:'Avenir Next','Trebuchet MS',sans-serif;background:#f4f0e8;color:#17201f;padding:30px}header{display:flex;justify-content:space-between;border-bottom:1px solid #c9c1b3;padding-bottom:18px}header span{font-size:11px;font-weight:800;letter-spacing:.12em}h2{font-family:Georgia,serif;font-size:30px;font-weight:400;margin:28px 0 18px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{border:1px solid #17201f;padding:13px}.field span{display:block;color:#66716d;font-size:10px;font-weight:800;letter-spacing:.08em}.field strong{display:block;margin-top:5px;font-weight:500}.wide{grid-column:1/-1}button{width:100%;margin-top:18px;background:#17201f;color:#f4f0e8;border:0;padding:15px;font-weight:800}output{display:block;margin-top:14px;padding:12px;background:#c8ef58;font-family:Georgia,serif;text-align:center}",
              )}
            </style>
          </head>
          <body>
            <header>
              <span>EMBER PAY</span>
              <span>TLS / SECURE</span>
            </header>
            <h2>Confirm payment details</h2>
            <div class="fields">
              <div class="field wide">
                <span>CARD</span>
                <strong>•••• •••• •••• 4242</strong>
              </div>
              <div class="field">
                <span>EXPIRY</span>
                <strong>08 / 29</strong>
              </div>
              <div class="field">
                <span>SECURITY</span>
                <strong>•••</strong>
              </div>
            </div>
            <button
              id="frame-button"
              onclick="document.querySelector('output').textContent='Payment details confirmed'"
            >
              Confirm S$ 248.00
            </button>
            <output>Awaiting confirmation</output>
          </body>
        </html>,
      ),
    ),
  );
  app.post("/api/echo", async (context) => {
    const payload = await context.req.json();
    return context.json({
      ok: true,
      echo: payload.message,
      source: "ego-browser-hono-test-site",
    });
  });
  app.get("/api/download", (context) => {
    context.header("content-type", "text/plain; charset=utf-8");
    context.header(
      "content-disposition",
      'attachment; filename="ego-browser-sample.txt"',
    );
    context.header("cache-control", "no-store");
    return context.body("ego-browser download fixture\n");
  });
  app.get("/tests/:slug", (context) => {
    const testCase = findTestCase(context.req.param("slug"));
    return testCase
      ? context.html(documentHtml(<TestPage testCase={testCase} />))
      : context.notFound();
  });
  return app;
}

export async function startTestSite(taskName) {
  const app = createTestSiteApp(taskName);
  let server;
  const info = await new Promise((resolve, reject) => {
    server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      resolve,
    );
    server.once("error", reject);
  });
  return { server, baseUrl: `http://127.0.0.1:${info.port}` };
}

export async function closeTestSite(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}
