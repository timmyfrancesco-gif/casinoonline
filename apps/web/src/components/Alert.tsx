import type { ReactNode } from 'react';

type Tone = 'error' | 'info' | 'success' | 'warning';

const ICONS: Record<Tone, string> = { error: '!', info: 'i', success: '✓', warning: '!' };

/** Inline message. Errors use role="alert" (announced immediately), others role="status". */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`alert alert-${tone} ${className ?? ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="alert-icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className="alert-body">
        {title && <strong className="alert-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
