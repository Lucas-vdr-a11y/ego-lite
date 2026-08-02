import { TabulatorFull as Tabulator } from "tabulator-tables";
import tabulatorStyles from "tabulator-tables/dist/css/tabulator.min.css?inline";

const style = document.createElement("style");
style.dataset.library = "tabulator";
style.textContent = tabulatorStyles;
document.head.append(style);

const storageKey = "ego-browser:launch-budget:v2";
const initialRows = [
  { id: "research", workItem: "Research interviews", owner: "Mei Lin", quantity: 2, rate: 1200, amount: 2400 },
  { id: "prototype", workItem: "Prototype QA", owner: "Aisha Rahman", quantity: 3, rate: 900, amount: 2700 },
  { id: "legal", workItem: "Legal review", owner: "Daniel Wong", quantity: 1, rate: 1500, amount: 1500 },
];
const fields = ["workItem", "owner", "quantity", "rate", "amount"];
const editableFields = new Set(fields.slice(0, 4));
const total = document.querySelector('[data-testid="sheet-total"]');
const status = document.querySelector('[data-testid="sheet-status"]');
const error = document.querySelector('[data-testid="sheet-error"]');
const result = document.querySelector('[data-testid="sheet-result"]');
const activeCell = document.querySelector('[data-testid="active-cell"]');
const formulaBar = document.querySelector("#formula-bar");
const saveButton = document.querySelector("#save-workbook");
const deleteButton = document.querySelector("#delete-budget-row");
const undoButton = document.querySelector("#undo-workbook");
const redoButton = document.querySelector("#redo-workbook");
const currency = (value) => `S$ ${Number(value).toLocaleString("en-SG")}`;
const copyRows = (rows) => rows.map((row) => ({ ...row }));
const calculateRow = (row) => ({
  ...row,
  quantity: Number(row.quantity),
  rate: Number(row.rate),
  amount: Number(row.quantity) * Number(row.rate),
});

function readRows() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length) return saved.map(calculateRow);
  } catch {}
  return copyRows(initialRows);
}

let selectedCell = null;
let editingSnapshot = null;
let history = [];
let future = [];

function decorateRow(row) {
  const data = row.getData();
  row.getElement().dataset.testid = `budget-row-${data.id}`;
  for (const cell of row.getCells()) cell.getElement().dataset.column = cell.getField();
}

const table = new Tabulator("#budget-grid", {
  data: readRows(),
  index: "id",
  layout: "fitColumns",
  editTriggerEvent: "dblclick",
  selectableRows: 1,
  rowHeader: { formatter: "rownum", headerSort: false, width: 42, hozAlign: "center" },
  columnDefaults: { headerSort: false },
  columns: [
    { title: "Work item", field: "workItem", minWidth: 190, editor: "input" },
    { title: "Owner", field: "owner", minWidth: 150, editor: "input" },
    { title: "Qty", field: "quantity", width: 82, hozAlign: "right", editor: "number", editorParams: { min: 0, step: 1 } },
    { title: "Rate", field: "rate", width: 118, hozAlign: "right", editor: "number", formatter: (cell) => currency(cell.getValue()), editorParams: { min: 0, step: 50 } },
    { title: "Amount", field: "amount", width: 130, hozAlign: "right", formatter: (cell) => currency(cell.getValue()) },
  ],
});

function setDirty(dirty = true) {
  status.textContent = dirty ? "Unsaved changes" : "All changes saved";
  saveButton.disabled = !dirty;
}

function renderActions() {
  undoButton.disabled = history.length === 0;
  redoButton.disabled = future.length === 0;
  deleteButton.disabled = table.getSelectedRows().length === 0;
}

function renderTotal(message) {
  const rows = table.getData();
  total.textContent = currency(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  result.textContent = message || `${rows.length} budget lines`;
  table.getRows().forEach(decorateRow);
  renderActions();
}

function selectCell(cell) {
  selectedCell = cell;
  cell.getRow().select();
  const row = table.getRows().indexOf(cell.getRow()) + 1;
  const column = fields.indexOf(cell.getField());
  activeCell.textContent = `${String.fromCharCode(65 + column)}${row}`;
  formulaBar.disabled = !editableFields.has(cell.getField());
  formulaBar.value = cell.getField() === "amount"
    ? `=${cell.getRow().getData().quantity}*${cell.getRow().getData().rate}`
    : String(cell.getValue());
  renderActions();
}

function validationMessage(field, value) {
  if ((field === "workItem" || field === "owner") && !String(value).trim()) {
    return `${field === "workItem" ? "Work item" : "Owner"} is required`;
  }
  if ((field === "quantity" || field === "rate") && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
    return `${field === "quantity" ? "Quantity" : "Rate"} must be zero or greater`;
  }
  return "";
}

function remember(snapshot) {
  history.push(copyRows(snapshot));
  future = [];
  setDirty();
  renderActions();
}

async function replaceRows(rows, message) {
  selectedCell = null;
  formulaBar.disabled = true;
  formulaBar.value = "Select a cell";
  activeCell.textContent = "A1";
  await table.replaceData(copyRows(rows).map(calculateRow));
  table.deselectRow();
  renderTotal(message);
}

table.on("tableBuilt", () => renderTotal());
table.on("renderComplete", () => table.getRows().forEach(decorateRow));
table.on("rowSelected", renderActions);
table.on("rowDeselected", renderActions);
table.on("rowClick", (_event, row) => row.select());
table.on("cellEditing", (cell) => {
  editingSnapshot = copyRows(table.getData());
  queueMicrotask(() => {
    const input = cell.getElement().querySelector("input");
    if (input) input.setAttribute("aria-label", `${cell.getColumn().getDefinition().title} for ${cell.getRow().getData().workItem}`);
  });
});
table.on("cellClick", (_event, cell) => selectCell(cell));
table.on("cellEdited", async (cell) => {
  const message = validationMessage(cell.getField(), cell.getValue());
  if (message) {
    error.textContent = message;
    await replaceRows(editingSnapshot || table.getData());
    editingSnapshot = null;
    return;
  }
  error.textContent = "";
  const value = cell.getField() === "quantity" || cell.getField() === "rate" ? Number(cell.getValue()) : String(cell.getValue()).trim();
  const data = { ...cell.getRow().getData(), [cell.getField()]: value };
  await cell.getRow().update(calculateRow(data));
  remember(editingSnapshot || table.getData());
  editingSnapshot = null;
  decorateRow(cell.getRow());
  selectCell(cell);
  renderTotal();
});

formulaBar.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" || !selectedCell || formulaBar.disabled) return;
  const field = selectedCell.getField();
  const message = validationMessage(field, formulaBar.value);
  if (message) {
    error.textContent = message;
    return;
  }
  const snapshot = copyRows(table.getData());
  const value = field === "quantity" || field === "rate" ? Number(formulaBar.value) : formulaBar.value.trim();
  const row = selectedCell.getRow();
  await row.update(calculateRow({ ...row.getData(), [field]: value }));
  remember(snapshot);
  error.textContent = "";
  decorateRow(row);
  selectCell(row.getCell(field));
  renderTotal();
});

document.querySelector("#add-budget-row").addEventListener("click", async () => {
  const snapshot = copyRows(table.getData());
  const next = table.getDataCount() + 1;
  const row = await table.addRow({ id: `new-${next}`, workItem: `New budget item ${next}`, owner: "Unassigned", quantity: 1, rate: 0, amount: 0 });
  remember(snapshot);
  decorateRow(row);
  row.select();
  selectCell(row.getCell("workItem"));
  renderTotal();
});

deleteButton.addEventListener("click", async () => {
  const [row] = table.getSelectedRows();
  if (!row) return;
  const snapshot = copyRows(table.getData());
  const label = row.getData().workItem;
  await row.delete();
  remember(snapshot);
  selectedCell = null;
  formulaBar.disabled = true;
  formulaBar.value = "Select a cell";
  renderTotal(`${label} removed`);
});

undoButton.addEventListener("click", async () => {
  if (!history.length) return;
  future.push(copyRows(table.getData()));
  await replaceRows(history.pop(), "Last change undone");
  setDirty();
});

redoButton.addEventListener("click", async () => {
  if (!future.length) return;
  history.push(copyRows(table.getData()));
  await replaceRows(future.pop(), "Change restored");
  setDirty();
});

document.querySelector("#reset-workbook").addEventListener("click", async () => {
  localStorage.removeItem(storageKey);
  history = [];
  future = [];
  await replaceRows(initialRows, "Workbook reset to 3 budget lines");
  error.textContent = "";
  setDirty(false);
});

saveButton.addEventListener("click", () => {
  localStorage.setItem(storageKey, JSON.stringify(table.getData()));
  setDirty(false);
  result.textContent = `Workbook saved with ${table.getDataCount()} budget lines`;
});
