import { useState } from 'react';
import { normalizeSessionCode } from './api';
import { JoinScreen } from './components/JoinScreen';
import { WatchingScreen } from './components/WatchingScreen';

const STORAGE_KEY = 'contextcue.sessionCode';

function readInitialCode(): string {
  if (typeof window === 'undefined') return '';
  const fromQuery = new URLSearchParams(window.location.search).get('code');
  if (fromQuery) return normalizeSessionCode(fromQuery);
  try {
    return normalizeSessionCode(window.localStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

export function App() {
  const [sessionCode, setSessionCode] = useState<string | null>(() => {
    const initial = readInitialCode();
    return initial.length === 6 ? initial : null;
  });

  const handleJoin = (code: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Storage may be unavailable (private mode); joining still works this session.
    }
    setSessionCode(code);
  };

  const handleLeave = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setSessionCode(null);
  };

  return (
    <div className="app-shell">
      <div className="brand">
        <span className="brand__mark">
          Context<span>Cue</span>
        </span>
        <span className="brand__tag">companion</span>
      </div>
      {sessionCode ? (
        <WatchingScreen sessionCode={sessionCode} onLeave={handleLeave} />
      ) : (
        <JoinScreen initialValue={new URLSearchParams(window.location.search).get('code') ?? undefined} onJoin={handleJoin} />
      )}
    </div>
  );
}
