import type { ReactNode } from 'react';

export interface Stat {
  label: string;
  value: ReactNode;
}

/**
 * Numbers shown together, each with its label, separated by a pipe:
 * "Total: 12 L | Average a day: 1.7 L". A description list, so screen readers
 * announce each label with its value; the pipes are drawn by CSS and not read out.
 */
export function StatLine({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl className={`statline${className ? ` ${className}` : ''}`}>
      {stats.map((s) => (
        <div key={s.label} className="statline__item">
          <dt>{s.label}:</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
