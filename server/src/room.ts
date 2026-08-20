/**
 * A single game room and its state machine.
 *
 * Everything lives in memory. A room is ephemeral by design: if the process
 * restarts, in-flight games are lost, which is an acceptable trade for having
 * no database, no serialization and no cache invalidation anywhere.
 *
 * The room is authoritative for *everything* that matters:
 *   - the secret word, which only ever reaches the drawer;
 *   - whether a guess is correct;
 *   - who is allowed to draw;
 *   - the canvas op log, replayed to anyone who joins late.
 */

import { WebSocket } from 'ws';
import {
  ACTION_RATE,
  CHAT_RATE,
  DEFAULT_DRAW_TIME,
  DEFAULT_HINTS,
  DEFAULT_MAX_PLAYERS,
  DEFAULT_ROUNDS,
  DRAW_RATE,
  GAME_END_SECONDS,
  MAX_OPS_PER_TURN,
  MIN_CUSTOM_WORDS,
  MIN_PLAYERS_TO_START,
  RECONNECT_GRACE_MS,
  TURN_END_SECONDS,
  WORD_CHOICES,
  WORD_PICK_SECONDS,
  checkGuess,
  drawerPoints,
  guesserPoints,
  maskWord,
  pickHintIndices,
  rankPlayers,
  resolveWordPool,
  type ChatChannel,
  type ClientMessage,
  type DrawOp,
  type ErrorCode,
  type Phase,
  type PublicPlayer,
  type RoomSettings,
  type RoomState,
  type ScoreDelta,
  type ServerMessage,
  type Standing,
  type SystemKind,
} from '@doodl/shared';
import { makePlayerId, makeSessionToken } from './ids.js';
import { TokenBucket } from './rateLimit.js';

export interface Player {
  id: string;
  /** Secret token used to reclaim this seat after a disconnect. */
  session: string;
  name: string;
  avatar: string;
  score: number;
  /** Points earned this turn. Reset when a turn begins. */
  turnScore: number;
  socket: WebSocket | null;
  connected: boolean;
  disconnectedAt: number | null;
  hasGuessed: boolean;
  /** 1-based order in which they guessed this turn. */
  guessPlace: number | null;
  chatBucket: TokenBucket;
  drawBucket: TokenBucket;
  actionBucket: TokenBucket;
}

function defaultSettings(): RoomSettings {
  return {
    rounds: DEFAULT_ROUNDS,
    drawTime: DEFAULT_DRAW_TIME,
    maxPlayers: DEFAULT_MAX_PLAYERS,
    hints: DEFAULT_HINTS,
    customWords: [],
    customWordsOnly: false,
  };
}

export class Room {
  readonly code: string;

  /** Insertion-ordered: a Map preserves join order, which drives turn order. */
  private readonly players = new Map<string, Player>();
  private readonly bySession = new Map<string, string>();

  private hostId = '';
  private phase: Phase = 'lobby';
  private settings: RoomSettings = defaultSettings();

  private round = 0;
  /** Player ids drawing this round, in order. Rebuilt at the start of a round. */
  private order: string[] = [];
  private turnIndex = 0;
  private drawerId: string | null = null;

  /** The secret. Never leaves this object except to the drawer. */
  private word: string | null = null;
  private wordChoices: string[] = [];
  private revealed = new Set<number>();
  private pendingHints: number[] = [];
  private usedWords = new Set<string>();

  /** Ordered canvas ops for the current turn, replayed to late joiners. */
  private ops: DrawOp[] = [];
  private opsCapped = false;

  private deadline: number | null = null;
  private turnTotalMs = 0;
  private correctCount = 0;

  private timers: NodeJS.Timeout[] = [];
  private emptySince: number | null = null;

  constructor(code: string) {
    this.code = code;
    this.emptySince = Date.now();
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  get size(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= this.settings.maxPlayers;
  }

  hasName(name: string): boolean {
    const key = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === key) return true;
    }
    return false;
  }

  findBySession(session: string): Player | undefined {
    const id = this.bySession.get(session);
    return id ? this.players.get(id) : undefined;
  }

  private connected(): Player[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  /** Players eligible to guess this turn: connected, and not the drawer. */
  private guessers(): Player[] {
    return this.connected().filter((p) => p.id !== this.drawerId);
  }

  addPlayer(socket: WebSocket, name: string, avatar: string): Player {
    const player: Player = {
      id: makePlayerId(),
      session: makeSessionToken(),
      name,
      avatar,
      score: 0,
      turnScore: 0,
      socket,
      connected: true,
      disconnectedAt: null,
      hasGuessed: false,
      guessPlace: null,
      chatBucket: new TokenBucket(CHAT_RATE),
      drawBucket: new TokenBucket(DRAW_RATE),
      actionBucket: new TokenBucket(ACTION_RATE),
    };

    this.players.set(player.id, player);
    this.bySession.set(player.session, player.id);
    this.emptySince = null;
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = player.id;

    this.sendJoined(player);
    this.system(`${player.name} joined`, 'join');
    this.broadcastRoom();
    this.sendCatchUp(player);
    return player;
  }

  /** Restore a seat held by a previously disconnected player. */
  reattach(player: Player, socket: WebSocket, name: string, avatar: string): Player {
    if (player.socket && player.socket !== socket) {
      // A second tab claiming the same seat: the newest connection wins.
      this.closeSocket(player.socket, 'NOT_IN_ROOM', 'Seat claimed by another connection.');
    }

    player.socket = socket;
    player.connected = true;
    player.disconnectedAt = null;
    player.name = name || player.name;
    player.avatar = avatar || player.avatar;
    this.emptySince = null;
    if (!this.players.has(this.hostId)) this.hostId = player.id;

    this.sendJoined(player);
    this.system(`${player.name} reconnected`, 'join');
    this.broadcastRoom();
    this.sendCatchUp(player);
    return player;
  }

  /**
   * A socket dropped. The seat is kept for `RECONNECT_GRACE_MS` so a refresh or
   * a flaky network doesn't cost the player their score.
   */
  handleDisconnect(player: Player): void {
    if (!this.players.has(player.id)) return;
    player.connected = false;
    player.socket = null;
    player.disconnectedAt = Date.now();

    this.system(`${player.name} left`, 'leave');
    if (this.connected().length === 0) this.emptySince = Date.now();
    if (player.id === this.hostId) this.promoteHost();

    this.afterPlayerGone(player);
  }

  /** Host-initiated removal. The seat is destroyed immediately. */
  kick(actor: Player, targetId: string): void {
    if (actor.id !== this.hostId) return this.fail(actor, 'NOT_HOST', 'Only the host can remove players.');
    const target = this.players.get(targetId);
    if (!target || target.id === actor.id) return;

    this.removePlayer(target);
    if (target.socket) {
      this.closeSocket(target.socket, 'KICKED', 'You were removed from the room.');
    }
    this.system(`${target.name} was removed`, 'leave');
    this.afterPlayerGone(target);
  }

  private removePlayer(player: Player): void {
    this.players.delete(player.id);
    this.bySession.delete(player.session);
    if (this.connected().length === 0) this.emptySince = Date.now();
    if (player.id === this.hostId) this.promoteHost();
  }

  /**
   * Re-evaluate the game after somebody became unavailable. Extracted because
   * disconnects, kicks and grace-period expiry all need the same checks.
   */
  private afterPlayerGone(player: Player): void {
    const inPlay = this.phase === 'choosing' || this.phase === 'drawing';

    if (inPlay && this.connected().length < MIN_PLAYERS_TO_START) {
      this.system('Not enough players left — ending the game.', 'warn');
      this.endGame();
      return;
    }

    if (inPlay && player.id === this.drawerId) {
      this.system('The drawer left. Ending this turn.', 'warn');
      // No word means the drawer never picked one; there is nothing to reveal.
      this.endTurn(this.word ? 'drawer-left' : 'aborted');
      return;
    }

    if (this.phase === 'drawing' && this.everyoneGuessed()) {
      this.endTurn('all-guessed');
      return;
    }

    this.broadcastRoom();
  }

  private promoteHost(): void {
    const next = this.connected()[0] ?? [...this.players.values()][0];
    if (!next) {
      this.hostId = '';
      return;
    }
    if (next.id === this.hostId) return;
    this.hostId = next.id;
    this.system(`${next.name} is now the host`, 'info');
  }

  /**
   * Drop seats whose grace period expired, and report whether the room itself
   * should be torn down. Called on a timer by the registry.
   */
  sweep(now: number): boolean {
    for (const player of [...this.players.values()]) {
      if (player.connected || player.disconnectedAt === null) continue;
      if (now - player.disconnectedAt < RECONNECT_GRACE_MS) continue;
      this.removePlayer(player);
      this.afterPlayerGone(player);
    }

    if (this.connected().length > 0) {
      this.emptySince = null;
      return false;
    }

    if (this.emptySince === null) this.emptySince = now;
    return now - this.emptySince >= RECONNECT_GRACE_MS;
  }

  /** Tear down timers and sockets. The registry calls this before dropping us. */
  destroy(): void {
    this.clearTimers();
    for (const player of this.players.values()) {
      if (player.socket) this.closeSocket(player.socket, 'ROOM_NOT_FOUND', 'This room has closed.');
    }
    this.players.clear();
    this.bySession.clear();
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  private send(player: Player, msg: ServerMessage): void {
    const socket = player.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage, predicate?: (p: Player) => boolean): void {
    const payload = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (predicate && !predicate(player)) continue;
      const socket = player.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) continue;
      socket.send(payload);
    }
  }

  private system(text: string, kind: SystemKind): void {
    this.broadcast({ t: 'system', text, kind });
  }

  private fail(player: Player, code: ErrorCode, message: string): void {
    this.send(player, { t: 'error', code, message });
  }

  private closeSocket(socket: WebSocket, code: ErrorCode, message: string): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: 'error', code, message, fatal: true } satisfies ServerMessage));
      socket.close(4000, code);
    }
  }

  private sendJoined(player: Player): void {
    this.send(player, {
      t: 'joined',
      you: player.id,
      session: player.session,
      room: this.snapshot(),
      now: Date.now(),
    });
  }

  /**
   * Bring a joining or reconnecting player up to date with the turn already in
   * progress: the phase message they missed, plus the full canvas replay.
   */
  private sendCatchUp(player: Player): void {
    if (this.phase === 'choosing' && this.drawerId) {
      const isDrawer = player.id === this.drawerId;
      this.send(player, {
        t: 'choosing',
        drawerId: this.drawerId,
        deadline: this.deadline ?? Date.now(),
        ...(isDrawer ? { choices: this.wordChoices } : {}),
      });
      return;
    }

    if (this.phase === 'drawing' && this.word && this.drawerId) {
      const isDrawer = player.id === this.drawerId;
      this.send(player, {
        t: 'turnStart',
        drawerId: this.drawerId,
        round: this.round,
        deadline: this.deadline ?? Date.now(),
        wordLength: this.word.length,
        pattern: maskWord(this.word, this.revealed),
        ...(isDrawer ? { word: this.word } : {}),
      });
      this.send(player, { t: 'replay', ops: this.ops });
    }
  }

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  private publicPlayer(p: Player): PublicPlayer {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      turnScore: p.turnScore,
      connected: p.connected,
      isHost: p.id === this.hostId,
      hasGuessed: p.hasGuessed,
      isDrawer: p.id === this.drawerId,
    };
  }

  snapshot(): RoomState {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: { ...this.settings, customWords: [...this.settings.customWords] },
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
      round: this.round,
      drawerId: this.drawerId,
      deadline: this.deadline,
      // The masked pattern is safe to broadcast; the word itself is not.
      pattern: this.word ? maskWord(this.word, this.revealed) : null,
      wordLength: this.word ? this.word.length : null,
    };
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.snapshot() });
  }

  // -------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== timer);
      try {
        fn();
      } catch (err) {
        console.error(`[room ${this.code}] timer failed`, err);
      }
    }, Math.max(0, ms));
    // Don't hold the process open just because a room has a pending timer.
    timer.unref?.();
    this.timers.push(timer);
  }

  // -------------------------------------------------------------------------
  // Message dispatch
  // -------------------------------------------------------------------------

  handleMessage(player: Player, msg: ClientMessage): void {
    switch (msg.t) {
      case 'settings':
        return this.updateSettings(player, msg.settings);
      case 'start':
        return this.startGame(player);
      case 'playAgain':
        return this.playAgain(player);
      case 'kick':
        return this.kick(player, msg.playerId);
      case 'pick':
        return this.pickWord(player, msg.index);
      case 'stroke':
        return this.handleStroke(player, msg);
      case 'fill':
        return this.handleFill(player, msg);
      case 'undo':
        return this.handleUndo(player);
      case 'clear':
        return this.handleClear(player);
      case 'chat':
        return this.handleChat(player, msg.text);
      default:
        // `create` and `join` are handled during the handshake, not here.
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  private updateSettings(player: Player, patch: Partial<RoomSettings>): void {
    if (player.id !== this.hostId) {
      return this.fail(player, 'NOT_HOST', 'Only the host can change settings.');
    }
    if (this.phase !== 'lobby') {
      return this.fail(player, 'INVALID_SETTINGS', 'Settings can only change in the lobby.');
    }
    if (!player.actionBucket.take()) {
      return this.fail(player, 'RATE_LIMITED', 'Slow down.');
    }

    this.settings = { ...this.settings, ...patch };
    this.broadcastRoom();
  }

  private startGame(player: Player): void {
    if (player.id !== this.hostId) {
      return this.fail(player, 'NOT_HOST', 'Only the host can start the game.');
    }
    if (this.phase !== 'lobby') return;
    if (!player.actionBucket.take()) return this.fail(player, 'RATE_LIMITED', 'Slow down.');
    if (this.connected().length < MIN_PLAYERS_TO_START) {
      return this.fail(
        player,
        'NOT_ENOUGH_PLAYERS',
        `You need at least ${MIN_PLAYERS_TO_START} players to start.`,
      );
    }

    for (const p of this.players.values()) {
      p.score = 0;
      p.turnScore = 0;
    }
    this.usedWords.clear();
    this.round = 0;
    this.order = [];
    this.turnIndex = 0;
    this.system('Game starting!', 'info');
    this.schedule();
  }

  private playAgain(player: Player): void {
    if (player.id !== this.hostId) {
      return this.fail(player, 'NOT_HOST', 'Only the host can restart.');
    }
    if (this.phase !== 'gameEnd') return;
    if (!player.actionBucket.take()) return this.fail(player, 'RATE_LIMITED', 'Slow down.');
    this.returnToLobby();
  }

  private returnToLobby(): void {
    this.clearTimers();
    this.phase = 'lobby';
    this.round = 0;
    this.turnIndex = 0;
    this.order = [];
    this.drawerId = null;
    this.word = null;
    this.wordChoices = [];
    this.revealed.clear();
    this.pendingHints = [];
    this.ops = [];
    this.opsCapped = false;
    this.deadline = null;
    this.correctCount = 0;
    for (const p of this.players.values()) {
      p.hasGuessed = false;
      p.guessPlace = null;
      p.turnScore = 0;
      // Reset here too, not just in startGame, so the lobby scoreboard is
      // clean the moment a game ends rather than showing last game's totals.
      p.score = 0;
    }
    this.broadcastRoom();
  }

  // -------------------------------------------------------------------------
  // Turn scheduling
  // -------------------------------------------------------------------------

  /**
   * Advance to whatever should happen next: the next drawer, the next round, or
   * the end of the game. Skips players who have gone away.
   */
  private schedule(): void {
    // Bounded so a pathological state can never spin forever.
    for (let guard = 0; guard < 512; guard++) {
      if (this.connected().length < MIN_PLAYERS_TO_START) {
        this.endGame();
        return;
      }

      if (this.turnIndex >= this.order.length) {
        this.round += 1;
        if (this.round > this.settings.rounds) {
          this.endGame();
          return;
        }
        // Rebuild each round so players who joined mid-game get a turn, and
        // players who left stop holding a slot.
        this.order = this.connected().map((p) => p.id);
        this.turnIndex = 0;
        this.system(`Round ${this.round} of ${this.settings.rounds}`, 'info');
        continue;
      }

      const id = this.order[this.turnIndex];
      const drawer = id ? this.players.get(id) : undefined;
      if (!drawer || !drawer.connected) {
        this.turnIndex += 1;
        continue;
      }

      this.beginChoosing(drawer);
      return;
    }

    this.endGame();
  }

  private nextTurn(): void {
    this.turnIndex += 1;
    this.schedule();
  }

  private beginChoosing(drawer: Player): void {
    this.clearTimers();
    this.phase = 'choosing';
    this.drawerId = drawer.id;
    this.word = null;
    this.revealed.clear();
    this.pendingHints = [];
    this.ops = [];
    this.opsCapped = false;
    this.correctCount = 0;

    for (const p of this.players.values()) {
      p.hasGuessed = false;
      p.guessPlace = null;
      p.turnScore = 0;
    }

    this.wordChoices = this.drawWords(WORD_CHOICES);
    this.deadline = Date.now() + WORD_PICK_SECONDS * 1000;

    this.broadcastRoom();
    this.broadcast(
      { t: 'choosing', drawerId: drawer.id, deadline: this.deadline },
      (p) => p.id !== drawer.id,
    );
    this.send(drawer, {
      t: 'choosing',
      drawerId: drawer.id,
      deadline: this.deadline,
      choices: this.wordChoices,
    });

    // Auto-pick so one idle player can't stall the whole room.
    this.later(WORD_PICK_SECONDS * 1000, () => {
      if (this.phase !== 'choosing') return;
      const index = Math.floor(Math.random() * this.wordChoices.length);
      this.system(`${drawer.name} took too long — picking a word for them.`, 'info');
      this.beginDrawing(index);
    });
  }

  private pickWord(player: Player, index: number): void {
    if (this.phase !== 'choosing') return;
    if (player.id !== this.drawerId) {
      return this.fail(player, 'NOT_DRAWER', 'Only the drawer picks the word.');
    }
    if (index < 0 || index >= this.wordChoices.length) return;
    this.beginDrawing(index);
  }

  private beginDrawing(index: number): void {
    const word = this.wordChoices[index];
    const drawer = this.drawerId ? this.players.get(this.drawerId) : undefined;
    if (!word || !drawer) {
      this.nextTurn();
      return;
    }

    this.clearTimers();
    this.phase = 'drawing';
    this.word = word;
    this.usedWords.add(word.toLowerCase());
    this.revealed.clear();
    this.pendingHints = pickHintIndices(word, this.settings.hints);
    this.ops = [];
    this.opsCapped = false;
    this.correctCount = 0;

    this.turnTotalMs = this.settings.drawTime * 1000;
    this.deadline = Date.now() + this.turnTotalMs;

    const pattern = maskWord(word, this.revealed);
    this.broadcast(
      {
        t: 'turnStart',
        drawerId: drawer.id,
        round: this.round,
        deadline: this.deadline,
        wordLength: word.length,
        pattern,
      },
      (p) => p.id !== drawer.id,
    );
    this.send(drawer, {
      t: 'turnStart',
      drawerId: drawer.id,
      round: this.round,
      deadline: this.deadline,
      wordLength: word.length,
      pattern,
      word,
    });
    this.broadcastRoom();

    this.scheduleHints();
    this.later(this.turnTotalMs, () => {
      if (this.phase === 'drawing') this.endTurn('time');
    });
  }

  /**
   * Reveal hint letters at even intervals through the turn, so late guessers
   * get help without the word being readable early.
   */
  private scheduleHints(): void {
    const count = this.pendingHints.length;
    if (count === 0) return;
    const step = this.turnTotalMs / (count + 1);

    this.pendingHints.forEach((letterIndex, i) => {
      this.later(step * (i + 1), () => {
        if (this.phase !== 'drawing' || !this.word) return;
        this.revealed.add(letterIndex);
        this.broadcast({ t: 'hint', pattern: maskWord(this.word, this.revealed) }, (p) => !p.hasGuessed);
      });
    });
  }

  private everyoneGuessed(): boolean {
    const guessers = this.guessers();
    return guessers.length > 0 && guessers.every((p) => p.hasGuessed);
  }

  private endTurn(reason: 'time' | 'all-guessed' | 'drawer-left' | 'aborted'): void {
    this.clearTimers();

    const word = this.word;
    if (reason === 'aborted' || !word) {
      // The drawer vanished before picking; nothing to score or reveal.
      this.phase = 'turnEnd';
      this.deadline = Date.now() + 1500;
      this.broadcastRoom();
      this.later(1500, () => this.nextTurn());
      return;
    }

    const drawer = this.drawerId ? this.players.get(this.drawerId) : undefined;
    if (drawer) {
      // Someone who guessed and then disconnected still counts, so the divisor
      // is never smaller than the number of correct guesses.
      const eligible = Math.max(this.guessers().length, this.correctCount);
      const award = drawerPoints(this.correctCount, eligible);
      drawer.score += award;
      drawer.turnScore += award;
    }

    const deltas: ScoreDelta[] = [...this.players.values()].map((p) => ({
      playerId: p.id,
      delta: p.turnScore,
      total: p.score,
      place: p.guessPlace,
    }));

    this.phase = 'turnEnd';
    this.word = null;
    this.drawerId = null;
    this.deadline = Date.now() + TURN_END_SECONDS * 1000;

    this.broadcast({ t: 'turnEnd', word, deltas, deadline: this.deadline });
    this.broadcastRoom();
    this.later(TURN_END_SECONDS * 1000, () => this.nextTurn());
  }

  private endGame(): void {
    this.clearTimers();

    const standings: Standing[] = rankPlayers(
      [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
      })),
    ).map(({ player, rank }) => ({
      playerId: player.id,
      name: player.name,
      avatar: player.avatar,
      score: player.score,
      rank,
    }));

    this.phase = 'gameEnd';
    this.word = null;
    this.drawerId = null;
    this.ops = [];
    this.deadline = Date.now() + GAME_END_SECONDS * 1000;

    this.broadcast({ t: 'gameEnd', standings, deadline: this.deadline });
    this.broadcastRoom();
    this.later(GAME_END_SECONDS * 1000, () => this.returnToLobby());
  }

  // -------------------------------------------------------------------------
  // Words
  // -------------------------------------------------------------------------

  private drawWords(count: number): string[] {
    const pool = resolveWordPool(this.settings.customWords, this.settings.customWordsOnly, MIN_CUSTOM_WORDS);

    let available = pool.filter((w) => !this.usedWords.has(w.toLowerCase()));
    if (available.length < count) {
      // Pool exhausted for this game; start recycling rather than repeating the
      // same handful of leftovers.
      this.usedWords.clear();
      available = [...pool];
    }

    const picks: string[] = [];
    const taken = new Set<number>();
    while (picks.length < count && taken.size < available.length) {
      const i = Math.floor(Math.random() * available.length);
      if (taken.has(i)) continue;
      taken.add(i);
      picks.push(available[i]!);
    }
    return picks;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /**
   * Every draw event is checked against the current drawer. Without this, any
   * connected client could scribble on the canvas at any time.
   */
  private canDraw(player: Player): boolean {
    if (this.phase !== 'drawing') return false;
    if (player.id !== this.drawerId) {
      this.fail(player, 'NOT_DRAWER', 'Only the current drawer can draw.');
      return false;
    }
    if (!player.drawBucket.take()) {
      this.fail(player, 'RATE_LIMITED', 'Too many draw events.');
      // The client's local canvas is now ahead of ours; resync it.
      this.send(player, { t: 'replay', ops: this.ops });
      return false;
    }
    return true;
  }

  /** Enforce the per-turn op ceiling. Returns false if the op must be dropped. */
  private acceptOp(player: Player, op: DrawOp): boolean {
    if (this.ops.length >= MAX_OPS_PER_TURN) {
      if (!this.opsCapped) {
        this.opsCapped = true;
        this.fail(player, 'RATE_LIMITED', 'Canvas complexity limit reached for this turn.');
      }
      return false;
    }
    this.ops.push(op);
    return true;
  }

  private handleStroke(
    player: Player,
    msg: Extract<ClientMessage, { t: 'stroke' }>,
  ): void {
    if (!this.canDraw(player)) return;

    const op: DrawOp = {
      t: 'stroke',
      pts: msg.pts,
      color: msg.color,
      width: msg.width,
      tool: msg.tool,
      sid: msg.sid,
    };
    if (!this.acceptOp(player, op)) return;

    // The drawer already rendered this locally; echoing it back would double
    // up its op log and desynchronise undo.
    this.broadcast(
      { t: 'stroke', pts: msg.pts, color: msg.color, width: msg.width, tool: msg.tool, sid: msg.sid },
      (p) => p.id !== player.id,
    );
  }

  private handleFill(player: Player, msg: Extract<ClientMessage, { t: 'fill' }>): void {
    if (!this.canDraw(player)) return;

    const op: DrawOp = { t: 'fill', pt: msg.pt, color: msg.color };
    if (!this.acceptOp(player, op)) return;

    this.broadcast({ t: 'fill', pt: msg.pt, color: msg.color }, (p) => p.id !== player.id);
  }

  /**
   * Undo removes a whole gesture, not one flushed segment. A single pen stroke
   * arrives as several messages sharing an `sid`, so all trailing ops with that
   * id go together.
   */
  private handleUndo(player: Player): void {
    if (this.phase !== 'drawing') return;
    if (player.id !== this.drawerId) {
      return this.fail(player, 'NOT_DRAWER', 'Only the current drawer can undo.');
    }
    if (!player.actionBucket.take()) return this.fail(player, 'RATE_LIMITED', 'Slow down.');
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

    this.opsCapped = false;
    // Echoed to everyone including the drawer, so all op logs stay in lockstep.
    this.broadcast({ t: 'undo' });
  }

  private handleClear(player: Player): void {
    if (this.phase !== 'drawing') return;
    if (player.id !== this.drawerId) {
      return this.fail(player, 'NOT_DRAWER', 'Only the current drawer can clear the canvas.');
    }
    if (!player.actionBucket.take()) return this.fail(player, 'RATE_LIMITED', 'Slow down.');

    this.ops = [];
    this.opsCapped = false;
    this.broadcast({ t: 'clear' });
  }

  // -------------------------------------------------------------------------
  // Chat and guessing
  // -------------------------------------------------------------------------

  /**
   * Players who already know the word — the drawer, and anyone who has guessed
   * — are moved to a private channel. Otherwise they could simply type the
   * answer, or hint at it, to the players still guessing.
   */
  private isRestricted(player: Player): boolean {
    if (this.phase !== 'drawing' && this.phase !== 'choosing') return false;
    return player.id === this.drawerId || player.hasGuessed;
  }

  private handleChat(player: Player, text: string): void {
    if (!player.chatBucket.take()) {
      return this.fail(player, 'RATE_LIMITED', 'You are sending messages too quickly.');
    }

    if (this.isRestricted(player)) {
      return this.emitChat(player, text, 'correct');
    }

    if (this.phase === 'drawing' && this.word) {
      const verdict = checkGuess(text, this.word);

      if (verdict === 'correct') {
        // Never echoed. Broadcasting the raw text would hand the answer to
        // every player still guessing.
        this.awardGuess(player);
        return;
      }

      if (verdict === 'close') {
        this.send(player, { t: 'close' });
      }
    }

    this.emitChat(player, text, 'all');
  }

  private emitChat(player: Player, text: string, channel: ChatChannel): void {
    const msg: ServerMessage = {
      t: 'chat',
      from: player.id,
      name: player.name,
      text,
      channel,
    };

    if (channel === 'all') {
      this.broadcast(msg);
      return;
    }
    this.broadcast(msg, (p) => p.id === this.drawerId || p.hasGuessed);
  }

  private awardGuess(player: Player): void {
    if (player.hasGuessed) return;

    this.correctCount += 1;
    player.hasGuessed = true;
    player.guessPlace = this.correctCount;

    const remaining = Math.max(0, (this.deadline ?? Date.now()) - Date.now());
    const points = guesserPoints(remaining, this.turnTotalMs);
    player.score += points;
    player.turnScore += points;

    this.broadcast({ t: 'guessed', playerId: player.id, place: this.correctCount });
    this.system(`${player.name} guessed the word!`, 'correct');
    this.broadcastRoom();

    if (this.everyoneGuessed()) {
      this.system('Everyone guessed it!', 'info');
      this.endTurn('all-guessed');
    }
  }
}
