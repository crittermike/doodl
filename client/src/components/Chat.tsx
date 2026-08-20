import { useEffect, useRef, useState } from 'react';
import type { ChatEntry } from '../net/useDoodl.js';

interface Props {
  entries: ChatEntry[];
  onSend(text: string): void;
  /** True when we already know the word, which changes the placeholder. */
  knowsWord: boolean;
  disabled: boolean;
}

const SYSTEM_STYLE: Record<string, string> = {
  info: 'text-ink-400',
  join: 'text-emerald-400',
  leave: 'text-ink-500',
  correct: 'text-emerald-300 font-bold',
  close: 'text-amber-300',
  warn: 'text-amber-400',
};

export function Chat({ entries, onSend, knowsWord, disabled }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  // Follow new messages, but don't yank the view if they've scrolled up to read.
  useEffect(() => {
    const list = listRef.current;
    if (list && pinnedToBottom.current) list.scrollTop = list.scrollHeight;
  }, [entries]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    pinnedToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="thin-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-sm"
      >
        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-600">
            Guesses go here. Type the word to score.
          </p>
        ) : null}

        {entries.map((entry) =>
          entry.kind === 'system' ? (
            <p
              key={entry.key}
              className={`animate-rise py-0.5 text-center text-xs ${SYSTEM_STYLE[entry.systemKind ?? 'info'] ?? 'text-ink-400'}`}
            >
              {entry.text}
            </p>
          ) : (
            <p
              key={entry.key}
              className={`animate-rise break-words rounded-lg px-2 py-1 ${
                entry.channel === 'correct' ? 'bg-emerald-950/40 text-emerald-200' : ''
              }`}
            >
              <span className={`font-bold ${entry.mine ? 'text-brand-400' : 'text-ink-400'}`}>
                {entry.name}
              </span>
              <span className="text-ink-600">: </span>
              <span className="text-ink-200">{entry.text}</span>
            </p>
          ),
        )}
      </div>

      <form onSubmit={submit} className="border-t border-ink-800 p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          maxLength={160}
          autoComplete="off"
          placeholder={
            disabled ? 'Connecting…' : knowsWord ? 'Chat with the others who got it…' : 'Type your guess…'
          }
          className="w-full rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-2 text-sm text-white placeholder:text-ink-600 outline-none focus:border-brand-500 disabled:opacity-50"
        />
      </form>
    </div>
  );
}
