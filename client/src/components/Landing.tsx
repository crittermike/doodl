import { useEffect, useState } from 'react';
import { AVATARS } from '@doodl/shared';
import { Button, Field, Panel, Wordmark, inputClass } from './ui.js';
import { codeFromUrl, loadIdentity, saveIdentity } from '../lib/storage.js';

interface Props {
  onCreate(name: string, avatar: string): void;
  onJoin(name: string, avatar: string, code: string): void;
  error: string | null;
  onDismissError(): void;
}

export function Landing({ onCreate, onJoin, error, onDismissError }: Props) {
  const saved = loadIdentity();
  const [name, setName] = useState(saved?.name ?? '');
  const [avatar, setAvatar] = useState(saved?.avatar ?? AVATARS[0]);
  const [code, setCode] = useState(codeFromUrl());

  // Landing on a /r/CODE link should feel like an invitation, not a form.
  const invited = codeFromUrl().length > 0;

  useEffect(() => {
    if (name.trim()) saveIdentity({ name: name.trim(), avatar });
  }, [name, avatar]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;
  const canJoin = canSubmit && code.trim().length >= 4;

  function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!canJoin) return;
    onDismissError();
    onJoin(trimmed, avatar, code.trim().toUpperCase());
  }

  return (
    <div className="flex min-h-full items-center justify-center overflow-y-auto p-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Wordmark className="text-6xl" />
          <p className="mt-3 text-sm text-ink-400">
            Draw, guess, repeat. No ads, no accounts, no nonsense.
          </p>
        </div>

        {error ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-800/60 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
            <span className="mt-0.5">⚠</span>
            <span className="flex-1">{error}</span>
            <button onClick={onDismissError} className="text-rose-400 hover:text-rose-200" aria-label="Dismiss">
              ✕
            </button>
          </div>
        ) : null}

        <Panel className="p-6">
          <form onSubmit={submitJoin} className="space-y-5">
            <Field label="Your name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who are you?"
                maxLength={20}
                autoFocus={!invited}
                autoComplete="nickname"
              />
            </Field>

            <Field label="Pick an avatar">
              <div className="grid grid-cols-8 gap-1.5">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAvatar(a)}
                    aria-label={`Avatar ${a}`}
                    aria-pressed={avatar === a}
                    className={`flex aspect-square items-center justify-center rounded-lg text-xl transition ${
                      avatar === a
                        ? 'bg-brand-500/20 ring-2 ring-brand-400'
                        : 'bg-ink-950/60 hover:bg-ink-800'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Field>

            <div className="h-px bg-ink-800" />

            <Field label="Room code" hint={invited ? "You've been invited to this room." : undefined}>
              <div className="flex gap-2">
                <input
                  className={`${inputClass} font-mono uppercase tracking-[0.3em]`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                  placeholder="ABCDE"
                  autoFocus={invited}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" disabled={!canJoin} className="shrink-0">
                  Join
                </Button>
              </div>
            </Field>

            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-ink-600">
              <div className="h-px flex-1 bg-ink-800" />
              or
              <div className="h-px flex-1 bg-ink-800" />
            </div>

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={!canSubmit}
              onClick={() => {
                onDismissError();
                onCreate(trimmed, avatar);
              }}
            >
              Create a new room
            </Button>
          </form>
        </Panel>

        <p className="mt-6 text-center text-xs text-ink-600">
          Free and open source ·{' '}
          <a
            href="https://github.com/crittermike/doodl"
            className="underline decoration-ink-700 underline-offset-2 hover:text-ink-400"
          >
            source on GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
