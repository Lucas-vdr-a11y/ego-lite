import { TEST_CASES } from "../../test-cases.mjs";

import { TestProgressSummary } from "./test-progress.jsx";

export default function AppHeader() {
  return (
    <header
      class="app-bar sticky-top border-bottom bg-body"
      data-testid="app-header"
    >
      <div class="container-fluid d-flex flex-wrap align-items-center gap-2 gap-lg-3">
        <a class="brand-mark me-auto" href="/">
          <span class="brand-icon" aria-hidden="true">
            E
          </span>
          <span>Ego Browser Lab</span>
        </a>
        <TestProgressSummary testCases={TEST_CASES} />
      </div>
    </header>
  );
}
