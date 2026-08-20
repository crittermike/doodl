/**
 * React binding for the game socket.
 *
 * This hook deliberately ignores every drawing message. `stroke`, `fill`,
 * `undo`, `clear` and `replay` are consumed directly by the canvas component,
 * which forwards them to the imperative engine. Routing them through React
 * state would re-render the whole tree on every remote brush stroke.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatChannel,
  RoomSettings,
  RoomState,
  ScoreDelta,
  ServerMessage,
  Standing,
  SystemKind,
} from '@doodl/shared';
import { DoodlSocket, type ConnStatus } from './socket.js';
import { clearSeat, saveSeat, seatFor, setUrlForRoom } from '../lib/storage.js';

export interface ChatEntry {
  key: number;
  kind: 'chat' | 'system';
  name?: string;
  text: string;
  channel?: ChatChannel;
  systemKind?: SystemKind;
  mine?: boolean;
}

export interface TurnResult {
  word: string;
  deltas: ScoreDelta[];
}

export interface GameView {
  status: ConnStatus;
  statusDetail: string | null;
  you: string | null;
  room: RoomState | null;
  chat: ChatEntry[];
  /** Word choices — only ever populated when we are the drawer. */
  choices: string[] | null;
  /** The secret word — only ever populated when we are the drawer. */
  word: string | null;
  pattern: string | null;
  wordLength: number | null;
  turnResult: TurnResult | null;
  standings: Standing[] | null;
  toast: string | null;
  fatal: string | null;
}

const MAX_CHAT = 200;

const EMPTY: GameView = {
  status: 'idle',
  statusDetail: null,
  you: null,
  room: null,
  chat: [],
  choices: null,
  word: null,
  pattern: null,
  wordLength: null,
  turnResult: null,
  standings: null,
  toast: null,
  fatal: null,
};

let chatKey = 0;

export function useDoodl() {  const socket = useMemo(() => new DoodlSocket(), []);
  const [view, setView] = useState<GameView>(EMPTY);
  const toastTimer = useRef<number | null>(null);
  /** The name we joined with, needed to store a name-scoped seat token. */
  const nameRef = useRef('');

  const flashToast = useCallback((text: string) => {
    setView((v) => ({ ...v, toast: text }));
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setView((v) => ({ ...v, toast: null }));
    }, 3200);
  }, []);

  useEffect(() => {
    const offStatus = socket.onStatus((status, detail) => {
      setView((v) => ({ ...v, status, statusDetail: detail ?? null }));
    });

    const offMessage = socket.onMessage((msg: ServerMessage) => {
      setView((v) => reduce(v, msg));

      if (msg.t === 'joined') {
        saveSeat({ code: msg.room.code, session: msg.session, name: nameRef.current });
        setUrlForRoom(msg.room.code);
      }
      if (msg.t === 'error' && msg.fatal) {
        clearSeat();
        setUrlForRoom(null);
      }
      if (msg.t === 'error' && !msg.fatal) flashToast(msg.message);
      if (msg.t === 'close') flashToast("You're close!");
    });

    return () => {
      offStatus();
      offMessage();
    };
  }, [socket, flashToast]);

  // A backgrounded tab often has its socket killed silently. Retry as soon as
  // the user comes back rather than waiting out the backoff.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') socket.retryNow();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [socket]);

  useEffect(() => () => socket.close(), [socket]);

  const actions = useMemo(
    () => ({
      create(name: string, avatar: string) {
        nameRef.current = name;
        setView({ ...EMPTY, status: 'connecting' });
        socket.connect({ mode: 'create', name, avatar });
      },
      join(name: string, avatar: string, code: string) {
        nameRef.current = name;
        // Only reclaim a seat that was taken in this room under this name.
        const session = seatFor(code, name);
        setView({ ...EMPTY, status: 'connecting' });
        socket.connect({ mode: 'join', name, avatar, code, ...(session ? { session } : {}) });
      },
      leave() {
        socket.close();
        clearSeat();
        setUrlForRoom(null);
        setView(EMPTY);
      },
      chat: (text: string) => socket.send({ t: 'chat', text }),
      pick: (index: number) => socket.send({ t: 'pick', index }),
      start: () => socket.send({ t: 'start' }),
      playAgain: () => socket.send({ t: 'playAgain' }),
      kick: (playerId: string) => socket.send({ t: 'kick', playerId }),
      settings: (settings: Partial<RoomSettings>) => socket.send({ t: 'settings', settings }),
      dismissFatal: () => setView(EMPTY),
    }),
    [socket],
  );

  return { view, actions, socket };
}

export type DoodlActions = ReturnType<typeof useDoodl>['actions'];

function pushChat(chat: ChatEntry[], entry: Omit<ChatEntry, 'key'>): ChatEntry[] {
  const next = [...chat, { ...entry, key: chatKey++ }];
  return next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next;
}

function reduce(v: GameView, msg: ServerMessage): GameView {
  switch (msg.t) {
    case 'joined':
      return {
        ...v,
        you: msg.you,
        room: msg.room,
        pattern: msg.room.pattern,
        wordLength: msg.room.wordLength,
        fatal: null,
      };

    case 'room':
      return { ...v, room: msg.room, pattern: msg.room.pattern ?? v.pattern };

    case 'chat':
      return {
        ...v,
        chat: pushChat(v.chat, {
          kind: 'chat',
          name: msg.name,
          text: msg.text,
          channel: msg.channel,
          mine: msg.from === v.you,
        }),
      };

    case 'system':
      return {
        ...v,
        chat: pushChat(v.chat, { kind: 'system', text: msg.text, systemKind: msg.kind }),
      };

    case 'choosing':
      return {
        ...v,
        // `choices` is only present in the drawer's copy of this message.
        choices: msg.choices ?? null,
        word: null,
        pattern: null,
        wordLength: null,
        turnResult: null,
        standings: null,
      };

    case 'turnStart':
      return {
        ...v,
        choices: null,
        // Likewise, `word` is only present for the drawer.
        word: msg.word ?? null,
        pattern: msg.pattern,
        wordLength: msg.wordLength,
        turnResult: null,
      };

    case 'hint':
      return { ...v, pattern: msg.pattern };

    case 'turnEnd':
      return {
        ...v,
        turnResult: { word: msg.word, deltas: msg.deltas },
        choices: null,
        word: null,
        pattern: null,
      };

    case 'gameEnd':
      return { ...v, standings: msg.standings, turnResult: null, choices: null, word: null };

    case 'error':
      return msg.fatal ? { ...EMPTY, status: 'fatal', fatal: msg.message } : v;

    // Drawing messages are handled by the canvas, not by React state.
    default:
      return v;
  }
}
