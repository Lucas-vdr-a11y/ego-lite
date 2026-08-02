const lookupButton = document.querySelector("#network-button");
const referenceInput = document.querySelector("#tracking-reference");
const responseMode = document.querySelector("#response-mode");
const status = document.querySelector('[data-testid="network-status"]');
const payload = document.querySelector('[data-testid="network-payload"]');
const referenceOutput = document.querySelector(
  '[data-testid="network-reference"]',
);
const attemptsOutput = document.querySelector('[data-testid="network-attempts"]');
const historyOutput = document.querySelector('[data-testid="network-history"]');
const history = [];

function recordAttempt(reference, result) {
  history.push({ reference, result });
  attemptsOutput.textContent = String(history.length);
  historyOutput.replaceChildren();
  for (const attempt of history) {
    const row = document.createElement("p");
    row.textContent = `${attempt.reference} · ${attempt.result}`;
    historyOutput.append(row);
  }
}

lookupButton.addEventListener("click", async () => {
  const reference = referenceInput.value.trim();
  if (!reference) {
    status.textContent = "invalid";
    payload.textContent = "Enter a tracking reference";
    return;
  }
  status.textContent = "pending";
  payload.textContent = "Checking carrier service…";
  lookupButton.disabled = true;
  try {
    const response = await fetch(
      `/api/echo?mode=${encodeURIComponent(responseMode.value)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: `In transit · ${reference}` }),
      },
    );
    const body = await response.json();
    status.textContent = String(response.status);
    payload.textContent = response.ok
      ? body.echo
      : "Carrier service unavailable. Try again.";
    if (response.ok) referenceOutput.textContent = reference;
    recordAttempt(reference, String(response.status));
  } catch {
    status.textContent = "offline";
    payload.textContent = "Carrier service could not be reached. Try again.";
    recordAttempt(reference, "offline");
  } finally {
    lookupButton.disabled = false;
  }
});

document.querySelector("#reset-network").addEventListener("click", () => {
  referenceInput.value = "EG-1842-SIN";
  responseMode.value = "success";
  referenceOutput.textContent = "EG-1842-SIN";
  status.textContent = "idle";
  payload.textContent = "Awaiting lookup";
  history.splice(0);
  attemptsOutput.textContent = "0";
  historyOutput.textContent = "No lookups yet";
  lookupButton.disabled = false;
});
