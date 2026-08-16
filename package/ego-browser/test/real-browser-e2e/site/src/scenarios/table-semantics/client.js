const transferTable = document.querySelector(
  '[data-testid="transfer-allocation"]',
);
const etaHeader = document.querySelector("#eta-header");
const etaSort = document.querySelector("[data-sort-eta]");
const selectedCases = document.querySelector('[data-testid="selected-cases"]');
const selectedValue = document.querySelector('[data-testid="selected-value"]');
const reviewReadiness = document.querySelector(
  '[data-testid="review-readiness"]',
);
const reviewStatus = document.querySelector(
  '[data-testid="transfer-review-status"]',
);

function formatValue(value) {
  return `S$${value.toLocaleString("en-SG")}`;
}

function restoreRowGroupHeader(body) {
  const firstRow = body.rows[0];
  const groupHeader = body.querySelector('th[scope="rowgroup"]');
  if (!firstRow || !groupHeader) return;

  const firstRouteHeader = firstRow.querySelector('th[scope="row"]');
  if (groupHeader.parentElement !== firstRow) {
    firstRow.insertBefore(groupHeader, firstRouteHeader);
  }
  groupHeader.rowSpan = body.rows.length;
}

function sortOriginGroup(body, direction) {
  const rows = Array.from(body.rows);
  rows.sort((left, right) => {
    const comparison = left.dataset.eta.localeCompare(right.dataset.eta);
    return direction === "ascending" ? comparison : -comparison;
  });
  for (const row of rows) body.append(row);
  restoreRowGroupHeader(body);
}

function updateSelectionSummary() {
  const checkedRoutes = Array.from(
    transferTable.querySelectorAll("tbody input[data-review-route]:checked"),
  );
  const totals = checkedRoutes.reduce(
    (summary, checkbox) => {
      const row = checkbox.closest("tr");
      summary.cases += Number(row.dataset.cases);
      summary.value += Number(row.dataset.value);
      return summary;
    },
    { cases: 0, value: 0 },
  );

  selectedCases.textContent = `${totals.cases} cases`;
  selectedValue.textContent = formatValue(totals.value);
  reviewReadiness.textContent =
    checkedRoutes.length === 0
      ? "No route selected"
      : `${checkedRoutes.length} route${checkedRoutes.length === 1 ? "" : "s"} ready for review`;
}

etaSort.addEventListener("click", () => {
  const direction =
    etaHeader.getAttribute("aria-sort") === "ascending"
      ? "descending"
      : "ascending";
  etaHeader.setAttribute("aria-sort", direction);
  for (const body of transferTable.tBodies) {
    sortOriginGroup(body, direction);
  }
  reviewStatus.textContent = `Transfers sorted by ETA ${direction}.`;
});

transferTable.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-review-route]");
  if (!checkbox) return;

  const row = checkbox.closest("tr");
  row.dataset.selected = String(checkbox.checked);
  updateSelectionSummary();
  reviewStatus.textContent = `${row.dataset.origin} to ${row.dataset.destination} transfer ${
    checkbox.checked ? "selected." : "removed."
  }`;
});

updateSelectionSummary();
