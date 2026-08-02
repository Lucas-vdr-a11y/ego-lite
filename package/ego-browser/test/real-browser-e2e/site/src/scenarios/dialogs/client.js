const result = document.querySelector('[data-testid="dialog-result"]');

document.querySelector("#alert-button").addEventListener("click", () => {
  alert("ego alert");
  result.textContent = "alert closed";
});
document.querySelector("#confirm-button").addEventListener("click", () => {
  result.textContent = confirm("approve ego test?") ? "confirmed" : "dismissed";
});
document.querySelector("#prompt-button").addEventListener("click", () => {
  result.textContent = prompt("name this run", "ego") ?? "cancelled";
});
