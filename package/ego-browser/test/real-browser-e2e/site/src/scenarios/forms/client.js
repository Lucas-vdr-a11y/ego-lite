function bind(
  selector,
  output,
  event = "input",
  value = (element) => element.value || "—",
) {
  document
    .querySelector(selector)
    .addEventListener(event, ({ currentTarget }) => {
      document.querySelector(`[data-testid="${output}"]`).textContent = String(
        value(currentTarget),
      );
    });
}

bind("#text-input", "form-text");
bind("#notes-input", "form-notes");
bind("#priority-select", "form-priority", "change");
bind(
  "#approval-checkbox",
  "form-approved",
  "change",
  (element) => element.checked,
);

document.querySelectorAll('input[name="plan"]').forEach((input) => {
  input.addEventListener("change", (event) => {
    if (event.target.checked) {
      document.querySelector('[data-testid="form-plan"]').textContent =
        event.target.value;
    }
  });
});

const stakeholders = [];
const stakeholderList = document.querySelector(
  '[data-testid="stakeholder-list"]',
);
const stakeholderError = document.querySelector(
  '[data-testid="stakeholder-error"]',
);

function renderStakeholders() {
  stakeholderList.replaceChildren();
  if (stakeholders.length === 0) {
    stakeholderList.textContent = "No stakeholders added";
    return;
  }
  for (const [index, stakeholder] of stakeholders.entries()) {
    const row = document.createElement("div");
    row.className = "stakeholder-row";
    const details = document.createElement("span");
    details.textContent = `${stakeholder.name} · ${stakeholder.email} · ${stakeholder.role}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-sm btn-link";
    remove.setAttribute("aria-label", `Remove ${stakeholder.name}`);
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      stakeholders.splice(index, 1);
      renderStakeholders();
    });
    row.append(details, remove);
    stakeholderList.append(row);
  }
}

document.querySelector("#add-stakeholder").addEventListener("click", () => {
  const name = document.querySelector("#stakeholder-name");
  const email = document.querySelector("#stakeholder-email");
  const role = document.querySelector("#stakeholder-role");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
  if (!name.value.trim() || !validEmail) {
    stakeholderError.textContent = "Enter a stakeholder name and valid email";
    return;
  }
  stakeholders.push({
    name: name.value.trim(),
    email: email.value.trim(),
    role: role.value,
  });
  stakeholderError.textContent = "";
  name.value = "";
  email.value = "";
  renderStakeholders();
});

document.querySelector("#notes-input").addEventListener("input", (event) => {
  document.querySelector('[data-testid="brief-character-count"]').textContent =
    String(event.currentTarget.value.length);
});

document.querySelector("#request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#text-input");
  const approval = document.querySelector("#approval-checkbox");
  const notes = document.querySelector("#notes-input");
  const targetDate = document.querySelector("#target-date");
  const result = document.querySelector('[data-testid="form-result"]');
  name.setAttribute("aria-invalid", String(!name.value.trim()));
  notes.setAttribute("aria-invalid", String(notes.value.trim().length < 20));

  if (!name.value.trim()) {
    result.textContent = "Enter a project name to continue";
    return;
  }
  if (!notes.value.trim()) {
    result.textContent = "Describe the requested work to continue";
    return;
  }
  if (notes.value.trim().length < 20) {
    result.textContent = "Add at least 20 characters to the brief";
    return;
  }
  if (!approval.checked) {
    result.textContent = "Confirm budget approval to continue";
    return;
  }
  if (!targetDate.value) {
    result.textContent = "Choose a target date to continue";
    return;
  }
  if (stakeholders.length === 0) {
    result.textContent = "Add at least one stakeholder to continue";
    return;
  }
  result.textContent = `Scheduled: ${name.value.trim()}`;
  const [year, month, day] = targetDate.value.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  document.querySelector('[data-testid="form-schedule"]').textContent =
    `${day} ${months[month - 1]} ${year}`;
});

document.querySelector("#reset-request").addEventListener("click", () => {
  const form = document.querySelector("#request-form");
  form.reset();
  document.querySelector("#text-input").removeAttribute("aria-invalid");
  document.querySelector("#notes-input").removeAttribute("aria-invalid");
  document.querySelector('[data-testid="form-text"]').textContent = "—";
  document.querySelector('[data-testid="form-notes"]').textContent = "—";
  document.querySelector('[data-testid="form-priority"]').textContent =
    "normal";
  document.querySelector('[data-testid="form-approved"]').textContent = "false";
  document.querySelector('[data-testid="form-plan"]').textContent = "basic";
  document.querySelector('[data-testid="brief-character-count"]').textContent =
    "0";
  document.querySelector('[data-testid="form-result"]').textContent =
    "Ready to validate";
  document.querySelector('[data-testid="form-schedule"]').textContent =
    "Not scheduled";
  document.querySelector('[data-testid="stakeholder-error"]').textContent = "";
  stakeholders.splice(0);
  renderStakeholders();
});
