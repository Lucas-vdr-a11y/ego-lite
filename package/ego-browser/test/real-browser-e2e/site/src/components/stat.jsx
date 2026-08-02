export default function Stat({ label, value, testId }) {
  return (
    <div class="stat">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}
