import type { ReactNode } from 'react';

type Tone = 'error' | 'info' | 'success' | 'warning';

const ICONS: Record<Tone, string> = { error: '!', info: 'i', success: '✓', warning: '!' };

/**
 * Inline message. Errors use role="alert" (announced immediately), others role="status".
 * `live={false}` drops the role when the page already announces the text in its own live region
 * (otherwise screen readers read it twice).
 */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
  live = true,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
  live?: boolean;
}) {
  return (
    <div
      className={`alert alert-${tone} ${className ?? ''}`}
      role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}
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
