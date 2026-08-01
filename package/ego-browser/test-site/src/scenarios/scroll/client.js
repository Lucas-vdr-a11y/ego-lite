document.querySelector("#nested-scroll").addEventListener("scroll", (event) => {
  document.querySelector('[data-testid="nested-scroll-top"]').textContent =
    String(Math.round(event.currentTarget.scrollTop));
});
