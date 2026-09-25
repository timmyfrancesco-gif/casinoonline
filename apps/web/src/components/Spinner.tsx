export function Spinner({
  label = 'Caricamento…',
  inline = false,
}: {
  label?: string;
  inline?: boolean;
}) {
  return (
    <span className={inline ? 'spinner-wrap spinner-inline' : 'spinner-wrap'} role="status">
      <span className="spinner" aria-hidden="true" />
      <span className={inline ? 'visually-hidden' : 'spinner-label'}>{label}</span>
    </span>
  );
}

export function PageLoader({ label = 'Caricamento…' }: { label?: string }) {
  return (
    <div className="page-loader">
      <Spinner label={label} />
    </div>
  );
}
