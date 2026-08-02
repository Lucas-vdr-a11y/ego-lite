const prepare = document.querySelector("#prepare-report");

prepare.addEventListener("click", () => {
  document.querySelector('[data-testid="report-status"]').textContent =
    "Prepared";
  document.querySelector('[data-testid="generated-report-count"]').textContent =
    "2";
  const link = document.createElement("a");
  link.className = "btn btn-sm btn-primary";
  link.href = "/api/download?report=fulfilment-exceptions";
  link.download = "";
  link.setAttribute("aria-label", "Download fulfilment exceptions");
  link.textContent = "Download";
  document.querySelector("#report-action").replaceChildren(link);
});

document.querySelector("#report-format").addEventListener("change", (event) => {
  const format = event.currentTarget.value;
  let visible = 0;
  document.querySelectorAll("[data-report-format]").forEach((row) => {
    row.hidden = format !== "all" && row.dataset.reportFormat !== format;
    if (!row.hidden) visible += 1;
  });
  document.querySelector('[data-testid="visible-report-count"]').textContent =
    String(visible);
});
