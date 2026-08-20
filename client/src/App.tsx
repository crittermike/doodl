import { useDoodl } from './net/useDoodl.js';
import { ConnectionOverlay } from './components/ConnectionOverlay.js';
import { Landing } from './components/Landing.js';
import { RoomView } from './components/RoomView.js';

export function App() {
  const { view, actions, socket } = useDoodl();

  if (view.room && view.you) {
    return <RoomView view={view} socket={socket} actions={actions} />;
  }

  // Connecting for the first time, before the room snapshot has arrived.
  const connecting = view.status === 'connecting' || view.status === 'waking' || view.status === 'reconnecting';

  return (
    <div className="relative h-full">
      <Landing
        onCreate={actions.create}
        onJoin={actions.join}
        error={view.fatal}
        onDismissError={actions.dismissFatal}
      />
      {connecting ? <ConnectionOverlay status={view.status} /> : null}
    </div>
  );
}
