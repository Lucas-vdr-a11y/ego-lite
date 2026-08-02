const clickTarget = document.querySelector("#click-target");
const eventProbe = document.querySelector("#event-probe");
const contextTarget = document.querySelector("#context-target");
const clickCount = document.querySelector('[data-testid="click-count"]');
const doubleClickCount = document.querySelector(
  '[data-testid="double-click-count"]',
);
const rightClickCount = document.querySelector(
  '[data-testid="right-click-count"]',
);
const filterOrders = document.querySelector("#filter-orders");
const heldOrder = document.querySelector('[data-testid="held-order"]');
const visibleOrderCount = document.querySelector(
  '[data-testid="visible-order-count"]',
);

let clicks = 0;
let doubles = 0;
let rightClicks = 0;
const initialStatuses = new Map();
let selectedOrder = "EG-1842";
let showAll = false;

const rows = Array.from(document.querySelectorAll("[data-order-id]"));
const selectedOrderOutput = document.querySelector(
  '[data-testid="selected-order"]',
);
const orderResult = document.querySelector('[data-testid="order-result"]');
const selectedOrderStatus = document.querySelector(
  '[data-testid="selected-order-status"]',
);
const menu = document.querySelector('[data-testid="order-menu"]');

for (const row of rows) {
  initialStatuses.set(row.dataset.orderId, row.dataset.orderStatus);
}

function selectedRow() {
  return rows.find((row) => row.dataset.orderId === selectedOrder);
}

function renderRows() {
  let visible = 0;
  for (const row of rows) {
    const status = row.dataset.orderStatus;
    row.querySelector("small").textContent =
      `${row.dataset.orderLocation} · ${status}`;
    row.hidden = !showAll && status !== "Ready";
    if (!row.hidden) visible += 1;
  }
  visibleOrderCount.textContent = String(visible);
  filterOrders.textContent = showAll ? "Show ready orders" : "Show all orders";
  filterOrders.setAttribute("aria-pressed", String(showAll));
}

function renderSelection() {
  const row = selectedRow();
  selectedOrderOutput.textContent = selectedOrder;
  selectedOrderStatus.textContent = row.dataset.orderStatus;
  clickTarget.disabled = row.dataset.orderStatus !== "Ready";
}

function selectOrder(orderId) {
  selectedOrder = orderId;
  for (const row of rows) {
    const selected = row.dataset.orderId === orderId;
    row.classList.toggle("selected-row", selected);
    row.setAttribute("aria-selected", String(selected));
  }
  renderSelection();
}

function closeMenu() {
  menu.classList.remove("show");
  menu.hidden = true;
  contextTarget.setAttribute("aria-expanded", "false");
}

function openMenu() {
  menu.hidden = false;
  menu.classList.add("show");
  contextTarget.setAttribute("aria-expanded", "true");
}

rows.forEach((row) =>
  row.addEventListener("click", () => selectOrder(row.dataset.orderId)),
);

eventProbe.addEventListener("click", () => {
  clickCount.textContent = String(++clicks);
});
eventProbe.addEventListener("dblclick", () => {
  doubleClickCount.textContent = String(++doubles);
});
clickTarget.addEventListener("click", () => {
  const row = selectedRow();
  if (row.dataset.orderStatus !== "Ready") return;
  row.dataset.orderStatus = "Dispatched";
  orderResult.textContent = `${selectedOrder} dispatched`;
  renderRows();
  renderSelection();
});
contextTarget.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  rightClickCount.textContent = String(++rightClicks);
  openMenu();
});
contextTarget.addEventListener("click", openMenu);
document.querySelector("#hold-order").addEventListener("click", () => {
  selectedRow().dataset.orderStatus = "On hold";
  orderResult.textContent = `${selectedOrder} placed on hold`;
  renderRows();
  renderSelection();
  closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
filterOrders.addEventListener("click", () => {
  showAll = !showAll;
  renderRows();
});
document.querySelector("#reset-clicks").addEventListener("click", () => {
  clicks = 0;
  doubles = 0;
  rightClicks = 0;
  clickCount.textContent = "0";
  doubleClickCount.textContent = "0";
  rightClickCount.textContent = "0";
  orderResult.textContent = "No action yet";
  showAll = false;
  for (const row of rows) {
    row.dataset.orderStatus = initialStatuses.get(row.dataset.orderId);
  }
  renderRows();
  selectOrder("EG-1842");
  closeMenu();
});

renderRows();
renderSelection();
