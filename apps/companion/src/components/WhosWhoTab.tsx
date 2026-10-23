import { useEffect, useState } from 'react';
import { formatTimestamp, getCharacters, type CharacterInfo } from '../api';
import { StatusPanel } from './StatusPanel';

interface WhosWhoTabProps {
  titleId: string;
  positionMs: number;
  /** Passed through so the server can clamp to the TV's live position, same as /v1/ask. */
  sessionCode?: string;
}

type Status = 'loading' | 'ready' | 'error';

export function WhosWhoTab({ titleId, positionMs, sessionCode }: WhosWhoTabProps) {
  const [status, setStatus] = useState<Status>('loading');
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getCharacters(titleId, positionMs, sessionCode)
      .then((result) => {
        if (cancelled) return;
        setCharacters([...result].sort((a, b) => a.firstSeenMs - b.firstSeenMs));
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // positionMs changes as the TV plays; refetch so newly-introduced characters appear.
  }, [titleId, positionMs, sessionCode, nonce]);

  if (status === 'loading' && characters.length === 0) {
    return <StatusPanel kind="loading" title="Reading only what you've already seen…" />;
  }

  if (status === 'error') {
    return (
      <StatusPanel
        kind="error"
        title="Couldn't load who's who"
        detail="The API may be unreachable. Check your connection and try again."
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }

  if (characters.length === 0) {
    return <p className="thread__empty">No one's been introduced yet — check back after a bit more plays.</p>;
  }

  return (
    <ul className="character-list" aria-label="Characters seen so far">
      {characters.map((c) => (
        <li key={c.name} className="character-card">
          <span className="character-card__name">{c.name}</span>
          <span className="character-card__meta">
            first seen {formatTimestamp(c.firstSeenMs)}
            <br />
            {c.mentions} mention{c.mentions === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  );
}
