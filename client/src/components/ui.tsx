import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-400 active:bg-brand-600 shadow-lg shadow-brand-500/20 disabled:shadow-none',
  secondary: 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-white border border-ink-700',
  ghost: 'bg-transparent text-ink-400 hover:text-white hover:bg-ink-800',
  danger: 'bg-rose-600/90 text-white hover:bg-rose-500',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-ink-800 bg-ink-900/80 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-black tracking-tight ${className}`}>
      <span className="text-white">doo</span>
      <span className="text-brand-400">d</span>
      <span className="text-pop-400">l</span>
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-600">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-ink-700 bg-ink-950/60 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-600 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30';
