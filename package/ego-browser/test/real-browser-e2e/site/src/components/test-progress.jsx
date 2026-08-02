export function TestProgressSummary({ testCases }) {
  return (
    <div class="test-progress-summary" data-testid="test-progress-summary">
      <strong class="progress-count" aria-live="polite">
        <output data-progress-completed>0</output>/
        <span data-progress-total>{testCases.length}</span>
      </strong>
      <div
        class="progress-dots"
        role="progressbar"
        aria-label="Scenario test progress"
        aria-valuemin="0"
        aria-valuemax={testCases.length}
        aria-valuenow="0"
      >
        {testCases.map((testCase) => (
          <span
            class="progress-dot"
            data-progress-dot
            data-progress-slug={testCase.slug}
            data-state="not-started"
            title={`${testCase.title}: Not started`}
          >
            <span class="visually-hidden" data-dot-label>
              {testCase.title}: Not started
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function TestProgressControls({ slug }) {
  return (
    <div
      class="test-progress-controls"
      data-test-progress-controls
      data-test-slug={slug}
      data-testid="scenario-test-controls"
      aria-label="Current scenario test controls"
    >
      <span class="test-status">
        <i aria-hidden="true" />
        <output data-testid="test-status">Not started</output>
      </span>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        data-testid="start-test"
      >
        Start test
      </button>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="finish-test"
        disabled
      >
        Finish test
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-danger"
        data-testid="fail-test"
        disabled
      >
        Fail test
      </button>
    </div>
  );
}
