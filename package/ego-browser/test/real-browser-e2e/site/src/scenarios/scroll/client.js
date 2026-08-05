const timeline = document.querySelector("#nested-scroll");
const activities = Array.from(
  timeline.querySelectorAll("[data-activity-name]"),
);
const previous = document.querySelector("#previous-activity");
const next = document.querySelector("#next-activity");
const activeActivity = document.querySelector(
  '[data-testid="active-activity"]',
);
let activeIndex = 0;
const reviewed = new Set();
const activityDetail = document.querySelector(
  '[data-testid="activity-detail"]',
);
const reviewedCount = document.querySelector(
  '[data-testid="reviewed-activity-count"]',
);
const reviewButton = document.querySelector("#review-activity");

function renderActivity() {
  activeActivity.textContent = activities[activeIndex].dataset.activityName;
  previous.disabled = activeIndex === 0;
  next.disabled = activeIndex === activities.length - 1;
  activities[activeIndex].scrollIntoView({ block: "nearest" });
  activityDetail.textContent = activities[activeIndex].dataset.activityDetail;
  activities.forEach((activity, index) => {
    activity.classList.toggle("active-activity", index === activeIndex);
    activity.setAttribute(
      "aria-current",
      index === activeIndex ? "true" : "false",
    );
  });
  reviewButton.textContent = reviewed.has(activeIndex)
    ? "Mark activity unreviewed"
    : "Mark activity reviewed";
}

activities.forEach((activity, index) => {
  const activate = () => {
    activeIndex = index;
    renderActivity();
  };
  activity.addEventListener("click", activate);
  activity.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
});

reviewButton.addEventListener("click", () => {
  if (reviewed.has(activeIndex)) reviewed.delete(activeIndex);
  else reviewed.add(activeIndex);
  reviewedCount.textContent = String(reviewed.size);
  renderActivity();
});

timeline.addEventListener("scroll", (event) => {
  document.querySelector('[data-testid="nested-scroll-top"]').textContent =
    String(Math.round(event.currentTarget.scrollTop));
});
previous.addEventListener("click", () => {
  activeIndex = Math.max(0, activeIndex - 1);
  renderActivity();
});
next.addEventListener("click", () => {
  activeIndex = Math.min(activities.length - 1, activeIndex + 1);
  renderActivity();
});
document.querySelector("#reset-timeline").addEventListener("click", () => {
  timeline.scrollTo({ top: 0, behavior: "instant" });
  activeIndex = 0;
  reviewed.clear();
  reviewedCount.textContent = "0";
  renderActivity();
  document.querySelector('[data-testid="nested-scroll-top"]').textContent = "0";
});
renderActivity();
window.addEventListener("scroll", () => {
  const available = document.documentElement.scrollHeight - innerHeight;
  const progress =
    available > 0 ? Math.round((scrollY / available) * 100) : 100;
  document.querySelector('[data-testid="reading-progress"]').textContent =
    String(Math.max(0, Math.min(100, progress)));
});
