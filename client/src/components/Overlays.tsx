import type { PublicPlayer, ScoreDelta, Standing } from '@doodl/shared';
import { Button } from './ui.js';

/** Backdrop shared by every over-canvas overlay. */
function Scrim({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-950/85 p-4 backdrop-blur-sm">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function WordChoiceOverlay({
  choices,
  onPick,
}: {
  choices: string[];
  onPick(index: number): void;
}) {
  return (
    <Scrim>
      <div className="animate-pop w-full max-w-lg text-center">
        <h2 className="mb-1 text-2xl font-black text-white">Pick a word</h2>
        <p className="mb-6 text-sm text-ink-400">You'll draw it. Nobody else can see these.</p>
        <div className="flex flex-wrap justify-center gap-3">
          {choices.map((word, i) => (
            <button
              key={word}
              onClick={() => onPick(i)}
              className="rounded-xl border border-ink-700 bg-ink-800 px-5 py-3 text-lg font-bold text-white transition hover:-translate-y-0.5 hover:border-brand-500 hover:bg-brand-500/20"
            >
              {word}
            </button>
          ))}
        </div>
        <p className="mt-6 text-xs text-ink-600">One is picked for you if you take too long.</p>
      </div>
    </Scrim>
  );
}

// ---------------------------------------------------------------------------

export function WaitingOverlay({ drawerName }: { drawerName: string }) {
  return (
    <Scrim>
      <div className="animate-pop text-center">
        <div className="mb-3 text-5xl">🤔</div>
        <h2 className="text-xl font-black text-white">{drawerName} is picking a word</h2>
        <p className="mt-2 text-sm text-ink-400">Get ready to guess.</p>
      </div>
    </Scrim>
  );
}

// ---------------------------------------------------------------------------

export function TurnEndOverlay({
  word,
  deltas,
  players,
}: {
  word: string;
  deltas: ScoreDelta[];
  players: PublicPlayer[];
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  // Scorers first, then everyone else, so the interesting rows are on top.
  const rows = [...deltas]
    .filter((d) => byId.has(d.playerId))
    .sort((a, b) => b.delta - a.delta || a.playerId.localeCompare(b.playerId));

  return (
    <Scrim>
      <div className="animate-pop w-full max-w-sm">
        <div className="mb-5 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">The word was</p>
          <p className="text-3xl font-black text-brand-300">{word}</p>
        </div>

        <ul className="space-y-1">
          {rows.map((d) => {
            const player = byId.get(d.playerId)!;
            return (
              <li
                key={d.playerId}
                className="flex items-center gap-2 rounded-lg bg-ink-900/80 px-3 py-2 text-sm"
              >
                <span className="text-lg">{player.avatar}</span>
                <span className="min-w-0 flex-1 truncate font-bold text-ink-200">{player.name}</span>
                {d.place ? (
                  <span className="text-xs text-ink-500">#{d.place}</span>
                ) : null}
                <span
                  className={`w-14 text-right font-black tabular-nums ${
                    d.delta > 0 ? 'text-emerald-400' : 'text-ink-600'
                  }`}
                >
                  {d.delta > 0 ? `+${d.delta}` : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Scrim>
  );
}

// ---------------------------------------------------------------------------

const MEDALS = ['🥇', '🥈', '🥉'];

export function PodiumOverlay({
  standings,
  isHost,
  onPlayAgain,
}: {
  standings: Standing[];
  isHost: boolean;
  onPlayAgain(): void;
}) {
  return (
    <Scrim>
      <div className="animate-pop w-full max-w-sm text-center">
        <h2 className="mb-1 text-3xl font-black text-white">Final scores</h2>
        <p className="mb-6 text-sm text-ink-400">Good game.</p>

        <ul className="mb-6 space-y-1.5 text-left">
          {standings.map((s) => (
            <li
              key={s.playerId}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                s.rank === 1
                  ? 'bg-amber-400/15 ring-1 ring-amber-400/40'
                  : 'bg-ink-900/80'
              }`}
            >
              <span className="w-7 text-center text-lg">{MEDALS[s.rank - 1] ?? s.rank}</span>
              <span className="text-2xl">{s.avatar}</span>
              <span className="min-w-0 flex-1 truncate font-bold text-white">{s.name}</span>
              <span className="font-black tabular-nums text-brand-300">{s.score}</span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <Button onClick={onPlayAgain} className="w-full">
            Play again
          </Button>
        ) : (
          <p className="text-sm text-ink-500">Waiting for the host to start another game…</p>
        )}
      </div>
    </Scrim>
  );
}
