const hostStatus = document.querySelector('[data-testid="host-frame-status"]');

document.querySelector("#load-frame").addEventListener("click", (event) => {
  const frame = document.createElement("iframe");
  frame.id = "test-frame";
  frame.title = "Browser test frame";
  frame.src = "/frames/content";
  document.querySelector("#frame-slot").replaceChildren(frame);
  hostStatus.textContent = "Partner checkout loaded";
  event.currentTarget.disabled = true;
});

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.data?.type !== "frame-payment-confirmed") return;
  hostStatus.textContent = `Partner confirmed payment for ${event.data.name}`;
});
