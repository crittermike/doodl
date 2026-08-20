import { BRUSH_SIZES, PALETTE } from '@doodl/shared';
import type { UITool } from '../canvas/DrawingEngine.js';

interface Props {
  tool: UITool;
  color: string;
  width: number;
  onTool(tool: UITool): void;
  onColor(color: string): void;
  onWidth(width: number): void;
  onUndo(): void;
  onClear(): void;
}

const TOOLS: Array<{ id: UITool; label: string; icon: string }> = [
  { id: 'brush', label: 'Brush', icon: '🖌️' },
  { id: 'eraser', label: 'Eraser', icon: '🧽' },
  { id: 'fill', label: 'Fill', icon: '🪣' },
];

export function Toolbar({ tool, color, width, onTool, onColor, onWidth, onUndo, onClear }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ink-800 bg-ink-900/80 p-2.5">
      {/* Colours */}
      <div className="grid grid-flow-col grid-rows-2 gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColor(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            style={{ backgroundColor: c }}
            className={`h-6 w-6 rounded-md border transition ${
              color === c
                ? 'border-white ring-2 ring-brand-400 ring-offset-1 ring-offset-ink-900'
                : 'border-black/30 hover:scale-110'
            }`}
          />
        ))}
      </div>

      <div className="h-10 w-px bg-ink-800" />

      {/* Brush sizes */}
      <div className="flex items-center gap-1">
        {BRUSH_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => onWidth(size)}
            aria-label={`Brush size ${size}`}
            aria-pressed={width === size}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
              width === size ? 'bg-brand-500/20 ring-2 ring-brand-400' : 'hover:bg-ink-800'
            }`}
          >
            <span
              className="rounded-full bg-ink-300"
              style={{ width: Math.min(size, 22), height: Math.min(size, 22) }}
            />
          </button>
        ))}
      </div>

      <div className="h-10 w-px bg-ink-800" />

      {/* Tools */}
      <div className="flex items-center gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTool(t.id)}
            title={t.label}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg transition ${
              tool === t.id ? 'bg-brand-500/20 ring-2 ring-brand-400' : 'hover:bg-ink-800'
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="h-10 w-px bg-ink-800" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUndo}
          title="Undo"
          aria-label="Undo"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition hover:bg-ink-800"
        >
          ↩️
        </button>
        <button
          type="button"
          onClick={onClear}
          title="Clear canvas"
          aria-label="Clear canvas"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition hover:bg-ink-800"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
