import { useState } from 'react';
import { BRUSH_SIZES, PALETTE } from '@doodl/shared';
import type { UITool } from '../canvas/DrawingEngine.js';
import type { DoodlSocket } from '../net/socket.js';
import type { DoodlActions, GameView } from '../net/useDoodl.js';
import { CanvasStage } from './CanvasStage.js';
import { Chat } from './Chat.js';
import { ConnectionOverlay } from './ConnectionOverlay.js';
import { Lobby } from './Lobby.js';
import { PodiumOverlay, TurnEndOverlay, WaitingOverlay, WordChoiceOverlay } from './Overlays.js';
import { PlayerList } from './PlayerList.js';
import { Toolbar } from './Toolbar.js';
import { TopBar } from './TopBar.js';

interface Props {
  view: GameView;
  socket: DoodlSocket;
  actions: DoodlActions;
}

export function RoomView({ view, socket, actions }: Props) {
  const [tool, setTool] = useState<UITool>('brush');
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [width, setWidth] = useState<number>(BRUSH_SIZES[1]);

  const room = view.room;
  if (!room) return null;

  const you = room.players.find((p) => p.id === view.you);
  const isDrawer = Boolean(you?.isDrawer) && room.phase === 'drawing';
  const isHost = room.hostId === view.you;
  const drawer = room.players.find((p) => p.id === room.drawerId);
  // The drawer and anyone who already guessed share a private chat channel.
  const knowsWord = Boolean(you?.hasGuessed) || Boolean(you?.isDrawer);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <TopBar
        room={room}
        word={view.word}
        pattern={view.pattern}
        wordLength={view.wordLength}
        offset={socket.clockOffset}
        onLeave={actions.leave}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2 lg:flex-row">
        {/* Players. Below the canvas on a phone, a fixed column on desktop. */}
        <aside className="order-2 flex max-h-36 shrink-0 flex-col rounded-2xl border border-ink-800 bg-ink-900/60 lg:order-1 lg:max-h-none lg:w-56">
          <h2 className="border-b border-ink-800 px-3 py-2 text-xs font-black uppercase tracking-wider text-ink-500">
            Players ({room.players.filter((p) => p.connected).length}/{room.settings.maxPlayers})
          </h2>
          <PlayerList
            players={room.players}
            youId={view.you}
            hostId={room.hostId}
            canKick={isHost}
            onKick={actions.kick}
          />
        </aside>

        {/* Canvas. Sized by its own aspect ratio on a phone so it doesn't leave
            a band of dead space; centred in the remaining room on desktop. */}
        <section className="relative order-1 flex shrink-0 flex-col items-center gap-2 lg:order-2 lg:min-h-0 lg:flex-1 lg:justify-center">
          <div className="flex w-full min-h-0 items-center justify-center lg:flex-1">
            <CanvasStage socket={socket} isDrawer={isDrawer} tool={tool} color={color} width={width} />
          </div>

          {isDrawer ? (
            <Toolbar
              tool={tool}
              color={color}
              width={width}
              onTool={setTool}
              onColor={setColor}
              onWidth={setWidth}
              onUndo={() => socket.send({ t: 'undo' })}
              onClear={() => socket.send({ t: 'clear' })}
            />
          ) : null}

          {/* Overlays sit over the canvas so it stays mounted and never misses
              a replay or a stroke while another view is showing. */}
          {room.phase === 'lobby' ? (
            <Lobby room={room} isHost={isHost} onSettings={actions.settings} onStart={actions.start} />
          ) : null}

          {room.phase === 'choosing' && view.choices ? (
            <WordChoiceOverlay choices={view.choices} onPick={actions.pick} />
          ) : null}

          {room.phase === 'choosing' && !view.choices ? (
            <WaitingOverlay drawerName={drawer?.name ?? 'Someone'} />
          ) : null}

          {room.phase === 'turnEnd' && view.turnResult ? (
            <TurnEndOverlay
              word={view.turnResult.word}
              deltas={view.turnResult.deltas}
              players={room.players}
            />
          ) : null}

          {room.phase === 'gameEnd' && view.standings ? (
            <PodiumOverlay standings={view.standings} isHost={isHost} onPlayAgain={actions.playAgain} />
          ) : null}
        </section>

        {/* Chat */}
        <aside className="order-3 flex min-h-0 flex-1 flex-col rounded-2xl border border-ink-800 bg-ink-900/60 lg:h-auto lg:w-72 lg:flex-none">
          <h2 className="border-b border-ink-800 px-3 py-2 text-xs font-black uppercase tracking-wider text-ink-500">
            {knowsWord && room.phase === 'drawing' ? 'Chat · players who got it' : 'Guesses'}
          </h2>
          <Chat
            entries={view.chat}
            onSend={actions.chat}
            knowsWord={knowsWord}
            disabled={view.status !== 'open'}
          />
        </aside>
      </main>

      {view.toast ? (
        <div className="animate-pop pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-ink-800 px-4 py-2 text-sm font-bold text-white shadow-xl ring-1 ring-ink-700">
          {view.toast}
        </div>
      ) : null}

      <ConnectionOverlay status={view.status} />
    </div>
  );
}
