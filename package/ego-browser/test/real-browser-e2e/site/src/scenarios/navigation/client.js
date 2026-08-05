const sections = document.querySelectorAll("[data-section]");
const activeSection = document.querySelector(
  '[data-testid="navigation-section"]',
);
const sectionHeading = document.querySelector(
  '[data-testid="section-heading"]',
);
const sectionRecords = document.querySelector(
  '[data-testid="section-records"]',
);
const sectionResultCount = document.querySelector(
  '[data-testid="section-result-count"]',
);
const search = document.querySelector("#knowledge-search");
const records = {
  Overview: [
    ["Launch brief", "Scope, audience, and success measures"],
    ["Open questions", "Three decisions still need owners"],
    ["Reading trail", "Seven recently viewed references"],
  ],
  "Customer signals": [
    ["Repeat buyers", "Service speed matters more than promotions"],
    ["Store interviews", "Material confidence increases in person"],
    ["Support themes", "Delivery visibility reduces repeat contacts"],
  ],
  "Market notes": [
    ["Regional pricing", "Comparable bundles across four markets"],
    ["Material benchmark", "Durability claims and finish samples"],
    ["Channel watch", "Launch cadence from adjacent categories"],
  ],
  Decisions: [
    ["DR-024", "Launch in two measured phases"],
    ["DR-019", "Keep service messaging above promotions"],
    ["DR-011", "Use one material vocabulary across channels"],
  ],
};

function renderRecords() {
  const query = search.value.trim().toLowerCase();
  const visible = records[activeSection.textContent].filter((record) =>
    record.join(" ").toLowerCase().includes(query),
  );
  sectionRecords.replaceChildren();
  for (const [title, detail] of visible) {
    const article = document.createElement("article");
    const strong = document.createElement("strong");
    const paragraph = document.createElement("p");
    strong.textContent = title;
    paragraph.textContent = detail;
    article.append(strong, paragraph);
    sectionRecords.append(article);
  }
  sectionResultCount.textContent = String(visible.length);
}

sections.forEach((button) => {
  button.addEventListener("click", () => {
    sections.forEach((candidate) => {
      const selected = candidate === button;
      candidate.classList.toggle("active-doc", selected);
      candidate.setAttribute("aria-selected", String(selected));
    });
    activeSection.textContent = button.dataset.section;
    sectionHeading.textContent = button.dataset.section;
    search.value = "";
    renderRecords();
  });
});

search.addEventListener("input", renderRecords);
document
  .querySelector("#clear-knowledge-search")
  .addEventListener("click", () => {
    search.value = "";
    renderRecords();
    search.focus();
  });
renderRecords();
