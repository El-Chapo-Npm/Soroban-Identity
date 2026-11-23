export default function LoadingFallback() {
  return (
    <div className="loading-fallback" role="status" aria-live="polite">
      <span className="loading-fallback__spinner" aria-hidden="true" />
      <span>Loading section…</span>
    </div>
  );
}
