import Sortable from "sortablejs";

const mouseSource = document.querySelector("#mouse-drag-source");
const mouseTarget = document.querySelector("#mouse-drag-target");
const htmlSource = document.querySelector("#html-drag-source");
const htmlTarget = document.querySelector("#html-drop-target");
const htmlOrigin = htmlSource.parentElement;
const htmlNext = htmlSource.nextElementSibling;
const lists = Array.from(document.querySelectorAll("[data-kanban-list]"));
const initialOrder = lists.map((list) => ({
  list,
  cards: Array.from(list.children),
}));

function updateCounts() {
  document.querySelector('[data-testid="progress-count"]').textContent = String(
    document.querySelectorAll('.task-card[data-column="progress"]').length,
  );
  document.querySelector('[data-testid="review-count"]').textContent = String(
    document.querySelectorAll('.task-card[data-column="review"]').length,
  );
  document.querySelector('[data-testid="done-count"]').textContent = String(
    document.querySelectorAll('[data-column="done"]').length,
  );
}

function moveMouseCard() {
  mouseTarget.append(mouseSource);
  mouseSource.dataset.column = "review";
  document.querySelector('[data-testid="mouse-drag-status"]').textContent =
    "Checkout reassurance moved to Review";
  updateCounts();
}

lists.forEach((list) => {
  Sortable.create(list, {
    group: "sprint-board",
    animation: 150,
    draggable: ".task-card",
    handle: "[data-drag-handle]",
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 4,
    ghostClass: "task-card-ghost",
    chosenClass: "task-card-chosen",
    dragClass: "task-card-dragging",
    onStart({ item }) {
      item.setAttribute("aria-grabbed", "true");
    },
    onEnd({ item, to }) {
      item.removeAttribute("aria-grabbed");
      item.dataset.column = to.dataset.column;
      const destination =
        to.dataset.column === "review" ? "Review" : "In progress";
      document.querySelector('[data-testid="mouse-drag-status"]').textContent =
        `${item.dataset.cardTitle} moved to ${destination}`;
      updateCounts();
    },
  });
});
document.querySelectorAll("[data-drag-handle]").forEach((handle) => {
  handle.disabled = false;
});
document.querySelector(".kanban-board").dataset.dragReady = "true";
document
  .querySelector("#move-copy-review")
  .addEventListener("click", moveMouseCard);
htmlSource.addEventListener("dragstart", (event) => {
  event.dataTransfer.setData("text/plain", "ego-payload");
});
htmlTarget.addEventListener("dragover", (event) => {
  event.preventDefault();
});
htmlTarget.addEventListener("drop", (event) => {
  event.preventDefault();
  document.querySelector('[data-testid="html-drop-status"]').textContent =
    event.dataTransfer.getData("text/plain");
  htmlTarget.insertAdjacentElement("afterend", htmlSource);
  htmlSource.dataset.column = "done";
  updateCounts();
});
document.querySelector("#reset-board").addEventListener("click", () => {
  for (const { list, cards } of initialOrder) {
    cards.forEach((card) => {
      list.append(card);
      card.dataset.column = list.dataset.column;
    });
  }
  htmlOrigin.insertBefore(htmlSource, htmlNext);
  htmlSource.dataset.column = "ready";
  document.querySelector('[data-testid="mouse-drag-status"]').textContent =
    "Drag a card here by its handle";
  document.querySelector('[data-testid="html-drop-status"]').textContent =
    "Awaiting release card";
  updateCounts();
});
