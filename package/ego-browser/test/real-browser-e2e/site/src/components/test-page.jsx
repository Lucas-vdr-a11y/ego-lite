import { surfaces } from "../scenarios/index.jsx";
import { TEST_CASES } from "../../test-cases.mjs";

import AppHeader from "./app-header.jsx";
import Layout, { scenarioModulePath } from "./layout.jsx";
import { TestProgressControls } from "./test-progress.jsx";

export default function TestPage({ testCase }) {
  const Surface = surfaces[testCase.slug];
  return (
    <Layout
      title={testCase.title}
      scriptSrc={scenarioModulePath(testCase.slug)}
    >
      <AppHeader />

      <main class="test-shell container-fluid" data-test-route={testCase.route}>
        <header class="test-header">
          <div class="test-heading">
            <div>
              <nav class="scenario-navigation" aria-label="Scenario navigation">
                <a href="/">← All fixtures</a>
              </nav>
              <p class="eyebrow">{testCase.eyebrow}</p>
              <h1>{testCase.title}</h1>
              <p>{testCase.description}</p>
            </div>
            <div class="test-meta">
              <code>{testCase.route}</code>
              <TestProgressControls slug={testCase.slug} />
            </div>
          </div>
        </header>

        <Surface />

        <footer class="test-footer">
          <span>
            Fixture {testCase.number} of {TEST_CASES.length}
          </span>
          <a href="/">Return to all fixtures</a>
        </footer>
      </main>
    </Layout>
  );
}
