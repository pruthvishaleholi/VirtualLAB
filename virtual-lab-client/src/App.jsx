import { useState } from 'react';
import LobbyScreen from './components/LobbyScreen';
import PhysicsCanvas from './components/PhysicsCanvas';

function App() {
  const [session, setSession] = useState(null);

  if (!session) {
    return <LobbyScreen onJoin={(roomId, userName) => setSession({ roomId, userName })} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      <PhysicsCanvas
        roomId={session.roomId}
        userName={session.userName}
        onLeave={() => setSession(null)}
      />
    </div>
  );
}

export default App;