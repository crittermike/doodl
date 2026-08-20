import { useEffect, useState } from 'react';
import {
  MAX_CUSTOM_WORDS,
  MAX_DRAW_TIME,
  MAX_HINTS,
  MAX_MAX_PLAYERS,
  MAX_ROUNDS,
  MAX_WORD_LEN,
  MIN_CUSTOM_WORDS,
  MIN_DRAW_TIME,
  MIN_MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  MIN_ROUNDS,
  parseWordList,
  type RoomState,
  type RoomSettings,
} from '@doodl/shared';
import { Button, Field } from './ui.js';
import { shareUrl } from '../lib/storage.js';

interface Props {
  room: RoomState;
  isHost: boolean;
  onSettings(patch: Partial<RoomSettings>): void;
  onStart(): void;
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled: boolean;
  onChange(next: number): void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-400">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - step))}
          className="h-9 w-9 rounded-lg bg-ink-800 text-lg font-bold text-ink-300 transition hover:bg-ink-700 disabled:opacity-30"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <span className="flex-1 text-center text-sm font-black tabular-nums text-white">
          {value}
          {suffix ? <span className="ml-0.5 text-xs font-bold text-ink-500">{suffix}</span> : null}
        </span>
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + step))}
          className="h-9 w-9 rounded-lg bg-ink-800 text-lg font-bold text-ink-300 transition hover:bg-ink-700 disabled:opacity-30"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Lobby({ room, isHost, onSettings, onStart }: Props) {
  const { settings } = room;
  const [copied, setCopied] = useState(false);
  const [wordsDraft, setWordsDraft] = useState(settings.customWords.join(', '));
  const [wordsOpen, setWordsOpen] = useState(settings.customWords.length > 0);

  // Keep the textarea in step with the host's edits when we aren't the host.
  useEffect(() => {
    if (!isHost) setWordsDraft(settings.customWords.join(', '));
  }, [isHost, settings.customWords]);

  const connected = room.players.filter((p) => p.connected).length;
  const ready = connected >= MIN_PLAYERS_TO_START;
  const parsedWords = parseWordList(wordsDraft, MAX_WORD_LEN, MAX_CUSTOM_WORDS);

  async function copyLink() {
    const url = shareUrl(room.code);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard needs a secure context; the link is on screen either way.
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function commitWords() {
    onSettings({ customWords: parsedWords });
  }

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-ink-950/90 p-4 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-lg space-y-4 py-2">
        {/* Invite */}
        <div className="rounded-2xl border border-ink-800 bg-ink-900 p-5 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Room code</p>
          <p className="my-1 font-mono text-4xl font-black tracking-[0.35em] text-white">{room.code}</p>
          <button
            onClick={copyLink}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs font-bold text-ink-300 transition hover:border-brand-500 hover:text-white"
          >
            {copied ? '✓ Link copied' : '🔗 Copy invite link'}
          </button>
        </div>

        {/* Settings */}
        <div className="rounded-2xl border border-ink-800 bg-ink-900 p-5">
          <h3 className="mb-4 text-sm font-black uppercase tracking-wider text-ink-400">
            {isHost ? 'Game settings' : 'Game settings (host only)'}
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <Stepper
              label="Rounds"
              value={settings.rounds}
              min={MIN_ROUNDS}
              max={MAX_ROUNDS}
              disabled={!isHost}
              onChange={(rounds) => onSettings({ rounds })}
            />
            <Stepper
              label="Draw time"
              value={settings.drawTime}
              min={MIN_DRAW_TIME}
              max={MAX_DRAW_TIME}
              step={10}
              suffix="s"
              disabled={!isHost}
              onChange={(drawTime) => onSettings({ drawTime })}
            />
            <Stepper
              label="Max players"
              value={settings.maxPlayers}
              min={MIN_MAX_PLAYERS}
              max={MAX_MAX_PLAYERS}
              disabled={!isHost}
              onChange={(maxPlayers) => onSettings({ maxPlayers })}
            />
            <Stepper
              label="Hint letters"
              value={settings.hints}
              min={0}
              max={MAX_HINTS}
              disabled={!isHost}
              onChange={(hints) => onSettings({ hints })}
            />
          </div>

          {/* Custom words */}
          <div className="mt-5 border-t border-ink-800 pt-4">
            <button
              type="button"
              onClick={() => setWordsOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-ink-400">
                Custom words{' '}
                {settings.customWords.length > 0 ? (
                  <span className="text-brand-400">({settings.customWords.length})</span>
                ) : null}
              </span>
              <span className="text-ink-500">{wordsOpen ? '▾' : '▸'}</span>
            </button>

            {wordsOpen ? (
              <div className="mt-3 space-y-3">
                <Field
                  label=""
                  hint={`Separate with commas or new lines. ${parsedWords.length}/${MAX_CUSTOM_WORDS} words.`}
                >
                  <textarea
                    value={wordsDraft}
                    disabled={!isHost}
                    onChange={(e) => setWordsDraft(e.target.value)}
                    onBlur={commitWords}
                    rows={3}
                    placeholder="pineapple, submarine, disco ball…"
                    className="w-full resize-y rounded-xl border border-ink-700 bg-ink-950/60 px-3 py-2 text-sm text-white placeholder:text-ink-600 outline-none focus:border-brand-500 disabled:opacity-50"
                  />
                </Field>

                <label className="flex items-center gap-2 text-sm text-ink-300">
                  <input
                    type="checkbox"
                    checked={settings.customWordsOnly}
                    disabled={!isHost}
                    onChange={(e) => onSettings({ customWordsOnly: e.target.checked })}
                    className="h-4 w-4 rounded accent-brand-500"
                  />
                  Use only my words
                  <span className="text-xs text-ink-600">
                    (needs {MIN_CUSTOM_WORDS}+, otherwise the built-in list is mixed in)
                  </span>
                </label>

                {isHost ? (
                  <Button variant="secondary" onClick={commitWords} className="w-full">
                    Save word list
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Start */}
        <div className="rounded-2xl border border-ink-800 bg-ink-900 p-5 text-center">
          {isHost ? (
            <>
              <Button onClick={onStart} disabled={!ready} className="w-full py-3 text-base">
                Start game
              </Button>
              {!ready ? (
                <p className="mt-3 text-xs text-ink-500">
                  Need at least {MIN_PLAYERS_TO_START} players — share the code above.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-400">
              Waiting for the host to start
              <span className="ml-1 inline-block animate-pulse">…</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
