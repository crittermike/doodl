import type { Phase, RoomState } from '@doodl/shared';
import { Countdown } from './Countdown.js';
import { Wordmark } from './ui.js';

interface Props {
  room: RoomState;
  /** Only set when we are the drawer. Everyone else sees the masked pattern. */
  word: string | null;
  pattern: string | null;
  wordLength: number | null;
  offset: number;
  onLeave(): void;
}

function phaseLabel(phase: Phase, drawerName: string | undefined, isDrawer: boolean): string {
  switch (phase) {
    case 'lobby':
      return 'Waiting to start';
    case 'choosing':
      return isDrawer ? 'Pick a word' : `${drawerName ?? 'Someone'} is picking a word`;
    case 'drawing':
      return isDrawer ? "You're drawing" : `${drawerName ?? 'Someone'} is drawing`;
    case 'turnEnd':
      return 'Turn over';
    case 'gameEnd':
      return 'Final scores';
  }
}

export function TopBar({ room, word, pattern, wordLength, offset, onLeave }: Props) {
  const drawer = room.players.find((p) => p.id === room.drawerId);
  // `word` is only ever populated in the drawer's own client.
  const isDrawer = word !== null;

  return (
    <header className="flex items-center gap-3 border-b border-ink-800 bg-ink-900/60 px-3 py-2">
      <Wordmark className="hidden text-2xl sm:inline" />

      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-500">
        {room.phase !== 'lobby' ? (
          <span className="rounded-md bg-ink-800 px-2 py-1">
            Round {room.round}/{room.settings.rounds}
          </span>
        ) : null}
        <span className="hidden md:inline">{phaseLabel(room.phase, drawer?.name, isDrawer)}</span>
      </div>

      {/* The word: plain text for the drawer, masked pattern for everyone else. */}
      <div className="flex min-w-0 flex-1 flex-col items-center">
        {word ? (
          <>
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Your word</span>
            <span className="truncate text-lg font-black tracking-wide text-brand-300">{word}</span>
          </>
        ) : pattern ? (
          <>
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
              {wordLength} letters
            </span>
            <span className="truncate font-mono text-lg font-black tracking-widest text-white">
              {pattern}
            </span>
          </>
        ) : null}
      </div>

      <Countdown
        deadline={room.deadline}
        offset={offset}
        totalMs={room.phase === 'drawing' ? room.settings.drawTime * 1000 : undefined}
      />

      <button
        onClick={onLeave}
        className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-bold text-ink-500 transition hover:bg-ink-800 hover:text-white"
      >
        Leave
      </button>
    </header>
  );
}
