document.querySelector("#file-input").addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  document.querySelector('[data-testid="file-count"]').textContent = String(
    files.length,
  );
  const list = document.querySelector('[data-testid="file-list"]');
  list.textContent = "";
  for (const file of files) {
    const row = document.createElement("p");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    name.textContent = file.name;
    meta.textContent = `${file.size} B · ${file.type || "unknown"}`;
    row.append(name, meta);
    list.append(row);
  }
});
