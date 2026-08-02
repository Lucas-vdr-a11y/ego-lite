import { TEST_CASES } from "../../test-cases.mjs";

import AppHeader from "./app-header.jsx";
import Layout from "./layout.jsx";

export default function HomePage() {
  return (
    <Layout>
      <AppHeader />

      <main class="index-shell container-xl">
        <section class="route-panel">
          <div class="route-panel-heading">
            <div>
              <h1>Test routes</h1>
              <p>Select a focused surface to inspect or automate.</p>
            </div>
            <span class="badge text-bg-light border">Local fixture</span>
          </div>
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
                  →
                </span>
              </a>
            ))}
          </nav>
        </section>
      </main>
    </Layout>
  );
}
