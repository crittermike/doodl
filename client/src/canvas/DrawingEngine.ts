/**
 * The drawing engine.
 *
 * This class owns the canvas outright and lives *outside* React. React never
 * re-renders in response to a pointer event, and never re-renders in response
 * to a remote stroke either — the socket feeds ops straight in here. React only
 * calls setters on this object when the toolbar changes.
 *
 * Send path for a gesture:
 *
 *   pointermove -> buffer (canvas px, rendered immediately for feel)
 *               -> every STROKE_FLUSH_MS:
 *                    thin  (drop points within POINT_MIN_DIST_PX)
 *                    RDP   (drop points within RDP_EPSILON_PX of the chord)
 *                    quantize to 12-bit
 *                    send one message
 *
 * Batching is the important part. `pointermove` fires at up to 120Hz on a
 * high-refresh display; sending each event individually floods the socket for
 * no visible gain whatsoever.
 */

import {
  CANVAS_H,
  CANVAS_W,
  FILL_TOLERANCE,
  POINT_MIN_DIST_PX,
  RDP_EPSILON_PX,
  STROKE_FLUSH_MS,
  fromWire,
  fromWireAll,
  prepareStroke,
  toWireAll,
  type DrawOp,
  type Point,
  type QPoint,
  type Tool,
} from '@doodl/shared';
import { floodFill } from './floodFill.js';

export const BACKGROUND = '#ffffff';

/**
 * Tools as the UI presents them. The wire protocol only knows `brush` and
 * `eraser`; a fill is its own message type, not a stroke.
 */
export type UITool = 'brush' | 'eraser' | 'fill';

export interface EngineEvents {
  onStroke(pts: QPoint[], color: string, width: number, tool: Tool, sid: number): void;
  onFill(pt: QPoint, color: string): void;
}

const TAU = Math.PI * 2;

function mid(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export class DrawingEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly events: EngineEvents;

  /** Mirror of the server's op log for this turn. Drives undo and redraw. */
  private ops: DrawOp[] = [];

  // Tool state, set imperatively from React.
  private tool: UITool = 'brush';
  private color = '#000000';
  private width = 10;
  private enabled = false;

  // Live gesture state.
  private gestureId = 0;
  private active = false;
  private pointerId: number | null = null;
  /** Raw points captured since the last flush. */
  private buffer: Point[] = [];
  /**
   * The last couple of points actually sent, prepended to the next flush.
   *
   * One point would be enough to avoid a *gap* between the segments of a
   * gesture, but two keeps the curve continuous across the boundary as well —
   * with only one, the next segment restarts with a straight run and a fast
   * stroke picks up a visible kink every 50ms.
   */
  private carry: Point[] = [];
  private flushTimer: number | null = null;

  // Incremental smoothing state.
  private liveLast: Point | null = null;
  private liveMid: Point | null = null;

  constructor(canvas: HTMLCanvasElement, events: EngineEvents) {
    this.canvas = canvas;
    this.events = events;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    this.clearCanvas();

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerUp);
    // Long-press on touch otherwise pops the OS callout while drawing.
    canvas.addEventListener('contextmenu', this.preventDefault);
  }

  destroy(): void {
    this.stopFlushTimer();
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerUp);
    canvas.removeEventListener('pointerleave', this.handlePointerUp);
    canvas.removeEventListener('contextmenu', this.preventDefault);
  }

  // -------------------------------------------------------------------------
  // Imperative setters (called from React; never read during render)
  // -------------------------------------------------------------------------

  setTool(tool: UITool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.abortGesture();
  }

  setColor(color: string): void {
    this.color = color;
  }

  setWidth(width: number): void {
    this.width = width;
  }

  /** Only the current drawer may interact. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.abortGesture();
  }

  get canUndo(): boolean {
    return this.ops.length > 0;
  }

  applyStroke(pts: QPoint[], color: string, width: number, tool: Tool, sid: number): void {    const op: DrawOp = { t: 'stroke', pts, color, width, tool, sid };
    this.ops.push(op);
    this.renderOp(op);
  }

  applyFill(pt: QPoint, color: string): void {
    const op: DrawOp = { t: 'fill', pt, color };
    this.ops.push(op);
    this.renderOp(op);
  }

  /**
   * Undo drops a whole gesture, not one flushed segment — the server does the
   * same, so both op logs stay identical.
   */
  applyUndo(): void {
    if (this.ops.length === 0) return;
    const last = this.ops[this.ops.length - 1]!;

    if (last.t === 'fill') {
      this.ops.pop();
    } else {
      const sid = last.sid;
      while (this.ops.length > 0) {
        const op = this.ops[this.ops.length - 1]!;
        if (op.t !== 'stroke' || op.sid !== sid) break;
        this.ops.pop();
      }
    }
    this.redrawAll();
  }

  applyClear(): void {
    this.ops = [];
    this.clearCanvas();
  }

  /** Full resync: used for late joins, reconnects, and server-side drops. */
  applyReplay(ops: DrawOp[]): void {
    this.abortGesture();
    this.ops = [...ops];
    this.redrawAll();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private clearCanvas(): void {
    this.ctx.fillStyle = BACKGROUND;
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  private redrawAll(): void {
    this.clearCanvas();
    for (const op of this.ops) this.renderOp(op);
  }

  private renderOp(op: DrawOp): void {
    if (op.t === 'fill') {
      const [x, y] = fromWire(op.pt);
      floodFill(this.ctx, CANVAS_W, CANVAS_H, x, y, op.color, FILL_TOLERANCE);
      return;
    }
    this.strokePath(fromWireAll(op.pts), this.inkFor(op.tool, op.color), op.width);
  }

  /**
   * The eraser paints the background colour rather than punching holes with
   * `destination-out`. Keeping the canvas fully opaque means a later flood fill
   * behaves the same on every client.
   */
  private inkFor(tool: Tool, color: string): string {
    return tool === 'eraser' ? BACKGROUND : color;
  }

  private applyBrush(ink: string, width: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  /**
   * Draw a polyline with quadratic smoothing: each original point becomes the
   * control point of a curve running between the midpoints of its neighbours.
   * Without this a fast stroke renders as a visible chain of straight segments.
   */
  private strokePath(pts: Point[], ink: string, width: number): void {
    if (pts.length === 0) return;
    const ctx = this.ctx;
    this.applyBrush(ink, width);

    if (pts.length === 1) {
      const [x, y] = pts[0]!;
      ctx.beginPath();
      ctx.arc(x, y, width / 2, 0, TAU);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    const first = mid(pts[0]!, pts[1]!);
    ctx.lineTo(first[0], first[1]);

    for (let i = 1; i < pts.length - 1; i++) {
      const m = mid(pts[i]!, pts[i + 1]!);
      ctx.quadraticCurveTo(pts[i]![0], pts[i]![1], m[0], m[1]);
    }

    const end = pts[pts.length - 1]!;
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
  }

  // -------------------------------------------------------------------------
  // Live gesture rendering
  //
  // The drawer sees their own stroke immediately, drawn from raw points, rather
  // than waiting up to 50ms for the flush. The same smoothing maths is applied
  // incrementally so the result matches what everyone else eventually renders.
  // -------------------------------------------------------------------------

  private beginLive(p: Point): void {
    const ctx = this.ctx;
    this.applyBrush(this.currentInk(), this.width);
    ctx.beginPath();
    ctx.arc(p[0], p[1], this.width / 2, 0, TAU);
    ctx.fill();
    this.liveLast = p;
    this.liveMid = null;
  }

  private currentInk(): string {
    return this.tool === 'eraser' ? BACKGROUND : this.color;
  }

  private extendLive(p: Point): void {
    const last = this.liveLast;
    if (!last) return this.beginLive(p);

    const ctx = this.ctx;
    const m = mid(last, p);
    this.applyBrush(this.currentInk(), this.width);

    ctx.beginPath();
    if (this.liveMid) {
      ctx.moveTo(this.liveMid[0], this.liveMid[1]);
      ctx.quadraticCurveTo(last[0], last[1], m[0], m[1]);
    } else {
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(m[0], m[1]);
    }
    ctx.stroke();

    this.liveMid = m;
    this.liveLast = p;
  }

  private finishLive(): void {
    if (this.liveMid && this.liveLast) {
      const ctx = this.ctx;
      this.applyBrush(this.currentInk(), this.width);
      ctx.beginPath();
      ctx.moveTo(this.liveMid[0], this.liveMid[1]);
      ctx.lineTo(this.liveLast[0], this.liveLast[1]);
      ctx.stroke();
    }
    this.liveLast = null;
    this.liveMid = null;
  }

  // -------------------------------------------------------------------------
  // Pointer input
  // -------------------------------------------------------------------------

  private preventDefault = (e: Event): void => {
    e.preventDefault();
  };

  /**
   * Map a pointer position into the fixed backing store. The element is
   * CSS-scaled to fit its container, so the ratio is whatever the layout
   * happened to give us.
   */
  private toCanvas(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [0, 0];
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    return [
      Math.max(0, Math.min(CANVAS_W, x)),
      Math.max(0, Math.min(CANVAS_H, y)),
    ];
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    // Ignore right/middle click so the browser's own gestures still work.
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    e.preventDefault();
    const p = this.toCanvas(e);

    if (this.tool === 'fill') {
      this.doFill(p);
      return;
    }

    this.active = true;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);

    this.gestureId = (this.gestureId + 1) & 0x7fffffff;
    this.buffer = [p];
    this.carry = [];
    this.beginLive(p);
    this.startFlushTimer();
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();

    // Coalesced events recover the samples the browser batched into one frame,
    // which makes fast strokes noticeably smoother on high-refresh displays.
    const events =
      typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
        ? e.getCoalescedEvents()
        : [e];

    for (const ev of events) {
      const p = this.toCanvas(ev);
      this.buffer.push(p);
      this.extendLive(p);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.endGesture();
  };

  private endGesture(): void {
    this.stopFlushTimer();
    this.flush();
    this.finishLive();
    if (this.pointerId !== null) {
      try {
        this.canvas.releasePointerCapture?.(this.pointerId);
      } catch {
        // Capture may already be gone; nothing to do.
      }
    }
    this.active = false;
    this.pointerId = null;
    this.buffer = [];
    this.carry = [];
  }

  /** Drop an in-flight gesture without sending it (turn ended, tool changed). */
  private abortGesture(): void {
    this.stopFlushTimer();
    this.active = false;
    this.pointerId = null;
    this.buffer = [];
    this.carry = [];
    this.liveLast = null;
    this.liveMid = null;
  }

  private startFlushTimer(): void {
    this.stopFlushTimer();
    this.flushTimer = window.setInterval(() => this.flush(), STROKE_FLUSH_MS);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private flush(): void {
    if (this.buffer.length === 0) return;

    // Re-attaching the tail of the previous segment makes consecutive segments
    // of one gesture join up smoothly instead of kinking at each boundary.
    const raw = this.carry.length > 0 ? [...this.carry, ...this.buffer] : this.buffer;
    this.buffer = [];

    const reduced = prepareStroke(raw, POINT_MIN_DIST_PX, RDP_EPSILON_PX);
    if (reduced.length === 0) return;

    // Nothing new happened — the pointer is parked.
    if (reduced.length === 1 && raw.length > 1) return;

    this.carry = reduced.slice(-2);

    const pts = toWireAll(reduced);
    const tool: Tool = this.tool === 'eraser' ? 'eraser' : 'brush';

    // Recorded locally: the server does not echo the drawer's own strokes back,
    // so this is what keeps our op log level with theirs.
    this.ops.push({ t: 'stroke', pts, color: this.color, width: this.width, tool, sid: this.gestureId });
    this.events.onStroke(pts, this.color, this.width, tool, this.gestureId);
  }

  // -------------------------------------------------------------------------
  // Fill
  // -------------------------------------------------------------------------

  /** Only the fill origin and colour go on the wire; each client fills itself. */
  private doFill(p: Point): void {
    const pt = toWireAll([p])[0]!;
    this.applyFill(pt, this.color);
    this.events.onFill(pt, this.color);
  }
}
