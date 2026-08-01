document
  .querySelector("#network-button")
  .addEventListener("click", async () => {
    const status = document.querySelector('[data-testid="network-status"]');
    status.textContent = "pending";
    const response = await fetch("/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "In transit · Tuas hub" }),
    });
    const body = await response.json();
    status.textContent = String(response.status);
    document.querySelector('[data-testid="network-payload"]').textContent =
      body.echo;
  });
