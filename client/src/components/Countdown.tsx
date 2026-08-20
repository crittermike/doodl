import { useEffect, useState } from 'react';

interface Props {
  /** Server-clock epoch ms. Null hides the timer. */
  deadline: number | null;
  /** serverNow - clientNow, measured at join. */
  offset: number;
  /** Total duration, used to colour the bar. */
  totalMs?: number;
}

function remainingMs(deadline: number | null, offset: number): number {
  if (deadline === null) return 0;
  return Math.max(0, deadline - (Date.now() + offset));
}

/**
 * Isolated so the per-second tick re-renders a single number rather than the
 * whole game screen.
 */
export function Countdown({ deadline, offset, totalMs }: Props) {
  const [ms, setMs] = useState(() => remainingMs(deadline, offset));

  useEffect(() => {
    setMs(remainingMs(deadline, offset));
    if (deadline === null) return;
    const id = window.setInterval(() => setMs(remainingMs(deadline, offset)), 250);
    return () => window.clearInterval(id);
  }, [deadline, offset]);

  if (deadline === null) return null;

  const seconds = Math.ceil(ms / 1000);
  const urgent = ms <= 10_000;
  const fraction = totalMs && totalMs > 0 ? Math.max(0, Math.min(1, ms / totalMs)) : null;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-black tabular-nums transition-colors ${
          urgent ? 'border-rose-500 text-rose-400' : 'border-ink-700 text-ink-200'
        }`}
      >
        {seconds}
      </div>
      {fraction !== null ? (
        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-ink-800 sm:block">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ease-linear ${
              urgent ? 'bg-rose-500' : 'bg-brand-500'
            }`}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
