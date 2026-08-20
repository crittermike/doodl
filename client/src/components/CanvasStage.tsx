import { useEffect, useRef } from 'react';
import { CANVAS_H, CANVAS_W } from '@doodl/shared';
import { DrawingEngine, type UITool } from '../canvas/DrawingEngine.js';
import type { DoodlSocket } from '../net/socket.js';

interface Props {
  socket: DoodlSocket;
  isDrawer: boolean;
  tool: UITool;
  color: string;
  width: number;
}

/**
 * React's only job here is to mount a canvas element and hand it to the engine.
 *
 * Everything after that is imperative. Pointer events never touch React state,
 * and remote draw messages are routed from the socket straight into the engine,
 * so a busy drawer does not re-render the chat, scoreboard or timer.
 */
export function CanvasStage({ socket, isDrawer, tool, color, width }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DrawingEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new DrawingEngine(canvas, {
      onStroke: (pts, strokeColor, strokeWidth, strokeTool, sid) => {
        socket.send({ t: 'stroke', pts, color: strokeColor, width: strokeWidth, tool: strokeTool, sid });
      },
      onFill: (pt, fillColor) => {
        socket.send({ t: 'fill', pt, color: fillColor });
      },
    });
    engineRef.current = engine;

    const off = socket.onMessage((msg) => {
      switch (msg.t) {
        case 'stroke':
          engine.applyStroke(msg.pts, msg.color, msg.width, msg.tool, msg.sid);
          break;
        case 'fill':
          engine.applyFill(msg.pt, msg.color);
          break;
        case 'undo':
          engine.applyUndo();
          break;
        case 'clear':
          engine.applyClear();
          break;
        case 'replay':
          engine.applyReplay(msg.ops);
          break;
        // A new turn always starts from a blank canvas.
        case 'choosing':
        case 'turnStart':
        case 'gameEnd':
          engine.applyClear();
          break;
        default:
          break;
      }
    });

    return () => {
      off();
      engine.destroy();
      engineRef.current = null;
    };
  }, [socket]);

  // Tool state is pushed in imperatively. These never cause a canvas re-render.
  useEffect(() => {
    engineRef.current?.setEnabled(isDrawer);
  }, [isDrawer]);
  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);
  useEffect(() => {
    engineRef.current?.setColor(color);
  }, [color]);
  useEffect(() => {
    engineRef.current?.setWidth(width);
  }, [width]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className="doodl-surface h-auto max-h-[42vh] w-full max-w-full rounded-xl bg-white shadow-2xl shadow-black/50 lg:max-h-full lg:w-auto"
      style={{ cursor: isDrawer ? (tool === 'fill' ? 'cell' : 'crosshair') : 'default' }}
    />
  );
}
