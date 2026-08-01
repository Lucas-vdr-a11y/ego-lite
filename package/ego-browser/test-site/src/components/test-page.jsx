import { surfaces } from "../scenarios/index.jsx";

import Layout, { scenarioModulePath } from "./layout.jsx";

export default function TestPage({ testCase }) {
  const Surface = surfaces[testCase.slug];
  return (
    <Layout
      title={testCase.title}
      scriptSrc={scenarioModulePath(testCase.slug)}
    >
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
