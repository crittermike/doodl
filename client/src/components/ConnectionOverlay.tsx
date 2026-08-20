import type { ConnStatus } from '../net/socket.js';
import { Spinner, Wordmark } from './ui.js';

interface Props {
  status: ConnStatus;
}

/**
 * Fly machines are configured to stop when idle and wake on the first
 * connection, so a first visit can genuinely take a few seconds. Saying that
 * out loud is the difference between "it's booting" and "it's broken".
 */
export function ConnectionOverlay({ status }: Props) {
  if (status === 'open' || status === 'idle' || status === 'fatal') return null;

  const waking = status === 'waking';
  const reconnecting = status === 'reconnecting' || status === 'closed';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950/90 p-6 backdrop-blur-sm">
      <div className="text-center">
        <Wordmark className="mb-6 block text-4xl" />
        <div className="mb-4 flex justify-center text-brand-400">
          <Spinner className="h-8 w-8" />
        </div>

        {waking ? (
          <>
            <p className="text-lg font-bold text-white">Waking up the server…</p>
            <p className="mt-2 max-w-xs text-sm text-ink-400">
              doodl shuts itself off when nobody's playing, so the first connection takes a few
              seconds. Nothing is broken.
            </p>
          </>
        ) : reconnecting ? (
          <>
            <p className="text-lg font-bold text-white">Reconnecting…</p>
            <p className="mt-2 max-w-xs text-sm text-ink-400">
              Hold tight — your seat and score are kept for a minute.
            </p>
          </>
        ) : (
          <p className="text-lg font-bold text-white">Connecting…</p>
        )}
      </div>
    </div>
  );
}
