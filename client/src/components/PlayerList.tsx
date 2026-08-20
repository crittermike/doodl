import type { PublicPlayer } from '@doodl/shared';

interface Props {
  players: PublicPlayer[];
  youId: string | null;
  hostId: string;
  canKick: boolean;
  onKick(playerId: string): void;
}

export function PlayerList({ players, youId, hostId, canKick, onKick }: Props) {
  // Ranked for display; the server keeps the array in join order.
  const ranked = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return (
    <ul className="thin-scroll min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
      {ranked.map((player, i) => (
        <li
          key={player.id}
          className={`group flex items-center gap-2 rounded-xl px-2 py-1.5 transition ${
            player.isDrawer
              ? 'bg-brand-500/15 ring-1 ring-brand-500/40'
              : player.hasGuessed
                ? 'bg-emerald-500/10'
                : 'bg-ink-950/40'
          } ${player.connected ? '' : 'opacity-40'}`}
        >
          <span className="w-4 shrink-0 text-center text-xs font-bold text-ink-600">{i + 1}</span>
          <span className="text-xl leading-none">{player.avatar}</span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span
                className={`truncate text-sm font-bold ${
                  player.id === youId ? 'text-brand-400' : 'text-ink-200'
                }`}
              >
                {player.name}
              </span>
              {player.id === hostId ? <span title="Host">👑</span> : null}
              {player.isDrawer ? <span title="Drawing">✏️</span> : null}
              {player.hasGuessed ? <span title="Guessed it">✅</span> : null}
            </span>
            <span className="block text-xs text-ink-500">
              {player.score} pts
              {player.turnScore > 0 ? <span className="ml-1 text-emerald-400">+{player.turnScore}</span> : null}
            </span>
          </span>

          {canKick && player.id !== youId ? (
            <button
              onClick={() => onKick(player.id)}
              title={`Remove ${player.name}`}
              aria-label={`Remove ${player.name}`}
              className="shrink-0 rounded px-1 text-xs text-ink-600 opacity-0 transition hover:text-rose-400 focus:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
