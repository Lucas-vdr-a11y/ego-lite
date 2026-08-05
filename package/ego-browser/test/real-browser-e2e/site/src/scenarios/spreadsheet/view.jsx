export default function SpreadsheetSurface() {
  return (
    <section class="surface card business-workspace spreadsheet-workspace">
      <header class="business-heading compact-business-heading">
        <div>
          <p class="section-kicker">Launch budget / FY26</p>
          <h2>Singapore pilot workbook</h2>
        </div>
        <div class="sheet-total">
          <span>Planned spend</span>
          <strong data-testid="sheet-total">S$ 6,600</strong>
        </div>
      </header>

      <div class="sheet-toolbar" role="toolbar" aria-label="Workbook actions">
        <div
          class="cell-reference"
          data-testid="active-cell"
          aria-label="Active cell"
        >
          A1
        </div>
        <label class="formula-field">
          <span>Formula</span>
          <input
            id="formula-bar"
            aria-label="Formula bar"
            value="Select a cell"
            disabled
          />
        </label>
        <div class="toolbar-actions">
          <button id="add-budget-row" type="button" aria-label="Add budget row">
            Add row
          </button>
          <button
            id="delete-budget-row"
            type="button"
            aria-label="Delete selected row"
            disabled
          >
            Delete row
          </button>
          <button
            id="undo-workbook"
            type="button"
            aria-label="Undo workbook change"
            disabled
          >
            Undo
          </button>
          <button
            id="redo-workbook"
            type="button"
            aria-label="Redo workbook change"
            disabled
          >
            Redo
          </button>
          <button id="reset-workbook" type="button" aria-label="Reset workbook">
            Reset
          </button>
          <button
            id="save-workbook"
            type="button"
            class="btn btn-primary"
            disabled
          >
            Save workbook
          </button>
        </div>
      </div>

      <div
        id="budget-grid"
        class="budget-grid"
        aria-label="Editable launch budget"
      ></div>

      <footer class="sheet-footer">
        <div class="sheet-feedback">
          <span data-testid="sheet-status">All changes saved</span>
          <span data-testid="sheet-error" role="alert"></span>
        </div>
        <output data-testid="sheet-result" aria-live="polite">
          3 budget lines
        </output>
      </footer>
    </section>
  );
}
