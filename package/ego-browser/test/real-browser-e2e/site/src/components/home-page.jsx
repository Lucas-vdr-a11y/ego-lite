import { TEST_CASES } from "../../test-cases.mjs";

import Layout from "./layout.jsx";

export default function HomePage() {
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
