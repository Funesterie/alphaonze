export default function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="casino-loading-panel" role="status" aria-live="polite">
      <div className="casino-loading-ring" />
      <p>{label}</p>
    </div>
  );
}
