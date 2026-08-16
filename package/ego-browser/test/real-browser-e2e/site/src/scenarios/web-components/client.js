const template = document.querySelector("#shipment-card-template");
const reviewedShipments = new Set();
const reviewedCount = document.querySelector(
  '[data-testid="shadow-reviewed-count"]',
);
const clickPathOutput = document.querySelector(
  '[data-testid="shadow-click-path"]',
);
const customEventPathOutput = document.querySelector(
  '[data-testid="shadow-custom-event-path"]',
);

function describeComposedPath(event) {
  return event
    .composedPath()
    .map((node) => {
      if (node instanceof ShadowRoot) return "#shadow-root";
      if (node === document) return "#document";
      if (node === window) return "window";
      if (!(node instanceof HTMLElement)) return undefined;
      const id = node.id ? `#${node.id}` : "";
      const action = node.dataset.action ? `[${node.dataset.action}]` : "";
      return `${node.tagName.toLowerCase()}${id}${action}`;
    })
    .filter(Boolean)
    .join(" > ");
}

function assignSlot(element, slotName) {
  if (slotName === null) element.removeAttribute("slot");
  else element.setAttribute("slot", slotName);
}

class ShipmentCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;

    const shadow = this.attachShadow({ mode: "open" });
    shadow.append(template.content.cloneNode(true));
    const status = shadow.querySelector("[data-shadow-status]");
    const slotSummary = shadow.querySelector("[data-slot-summary]");
    const reviewButton = shadow.querySelector('[data-action="review"]');
    const swapButton = shadow.querySelector('[data-action="swap"]');

    const renderSlotSummary = () => {
      slotSummary.textContent = Array.from(shadow.querySelectorAll("slot"))
        .map((slot) => {
          const name = slot.name || "notes";
          return `${name}:${slot.assignedElements({ flatten: true }).length}`;
        })
        .join(" · ");
    };

    shadow.querySelectorAll("slot").forEach((slot) => {
      slot.addEventListener("slotchange", renderSlotSummary);
    });
    renderSlotSummary();

    reviewButton.addEventListener("click", (event) => {
      const reference =
        this.querySelector('[slot="reference"]')?.textContent.trim() ||
        "Unassigned shipment";
      this.dataset.reviewed = "true";
      status.textContent = `Reviewed ${reference}`;
      event.currentTarget.dispatchEvent(
        new CustomEvent("shipment-reviewed", {
          bubbles: true,
          composed: true,
          detail: { shipmentId: this.dataset.shipmentId },
        }),
      );
    });

    swapButton.addEventListener("click", () => {
      const routeContent = this.querySelector("[data-route-content]");
      const noteContent = this.querySelector("[data-note-content]");
      if (!routeContent || !noteContent) {
        status.textContent = "No assigned route and notes to swap";
        return;
      }
      const routeSlot = routeContent.getAttribute("slot");
      const noteSlot = noteContent.getAttribute("slot");
      assignSlot(routeContent, noteSlot);
      assignSlot(noteContent, routeSlot);
      status.textContent = this.dataset.reviewed
        ? `Reviewed ${this.dataset.shipmentId}; route and notes swapped`
        : "Route and notes swapped";
      renderSlotSummary();
    });
  }
}

customElements.define("shipment-card", ShipmentCard);

document.addEventListener("click", (event) => {
  const card = event
    .composedPath()
    .find((node) => node instanceof ShipmentCard);
  if (!card) return;
  clickPathOutput.textContent = `composed=${event.composed}; trusted=${event.isTrusted}; ${describeComposedPath(event)}`;
});

document.addEventListener("shipment-reviewed", (event) => {
  reviewedShipments.add(event.detail.shipmentId);
  reviewedCount.textContent = `${reviewedShipments.size} of 2 shipments reviewed`;
  customEventPathOutput.textContent = `composed=${event.composed}; shipment=${event.detail.shipmentId}; ${describeComposedPath(event)}`;
});
