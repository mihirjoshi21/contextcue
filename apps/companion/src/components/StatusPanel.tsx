interface StatusPanelProps {
  kind: 'loading' | 'error';
  title: string;
  detail?: string;
  onRetry?: () => void;
}

export function StatusPanel({ kind, title, detail, onRetry }: StatusPanelProps) {
  return (
    <div className="status-panel" role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' ? (
        <div className="spinner" aria-hidden="true" />
      ) : (
        <div aria-hidden="true" style={{ fontSize: '2rem' }}>
          ⚠️
        </div>
      )}
      <p className="status-panel__title">{title}</p>
      {detail ? <p>{detail}</p> : null}
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
