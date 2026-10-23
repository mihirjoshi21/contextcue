import { useEffect, useState } from 'react';
import { getTitles, formatTimestamp, type SessionState } from '../api';
import { useSession } from '../hooks/useSession';
import { StatusPanel } from './StatusPanel';
import { AskTab } from './AskTab';
import { WhosWhoTab } from './WhosWhoTab';

interface WatchingScreenProps {
  sessionCode: string;
  onLeave: () => void;
}

type Tab = 'ask' | 'who';

/**
 * Session GET responses may or may not include a denormalized `title`. When absent we
 * fall back to GET /v1/titles and match on titleId, so "Now watching <title>" always
 * has something to show.
 */
function useTitleLookup(session: SessionState | null): string | null {
  const [titles, setTitles] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!session || session.title || !session.titleId || titles) return;
    let cancelled = false;
    getTitles()
      .then((all) => {
        if (cancelled) return;
        setTitles(Object.fromEntries(all.map((t) => [t.id, t.title])));
      })
      .catch(() => {
        // Non-fatal: we'll just show the raw titleId.
      });
    return () => {
      cancelled = true;
    };
  }, [session, titles]);

  if (!session) return null;
  if (!session.titleId) return null;
  return session.title ?? titles?.[session.titleId] ?? session.titleId;
}

export function WatchingScreen({ sessionCode, onLeave }: WatchingScreenProps) {
  const { status, session, retry } = useSession(sessionCode);
  const title = useTitleLookup(session);
  const [tab, setTab] = useState<Tab>('ask');

  if (status === 'not-found') {
    return (
      <StatusPanel
        kind="error"
        title="Session not found"
        detail="Double-check the code on your TV, or it may have ended."
        onRetry={onLeave}
      />
    );
  }

  if (status === 'error' && !session) {
    return (
      <StatusPanel
        kind="error"
        title="Can't reach the API"
        detail="Make sure your phone is on the same network as the TV, then retry."
        onRetry={retry}
      />
    );
  }

  if (!session) {
    return <StatusPanel kind="loading" title="Connecting to your TV…" />;
  }

  if (!session.titleId) {
    return (
      <StatusPanel
        kind="loading"
        title="Waiting for your TV to start playing…"
        detail="This screen updates automatically once playback begins."
      />
    );
  }

  const safeUntil = formatTimestamp(session.positionMs);

  return (
    <div className="watching" style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 'var(--space-4)', minHeight: 0 }}>
      <div className="now-watching">
        <div className="now-watching__row">
          <h2 className="now-watching__title">Now watching {title ?? '…'}</h2>
          <span className="now-watching__meta">
            <span className="play-state" aria-hidden="true">
              {session.playing ? '▶' : '⏸'}
            </span>
            <span>{formatTimestamp(session.positionMs)}</span>
          </span>
        </div>
        <span className="lock-badge">
          <span className="lock-badge__icon" aria-hidden="true">
            🔒
          </span>
          Spoiler-safe until {safeUntil}
        </span>
      </div>

      <div className="tabs" role="tablist" aria-label="Companion views">
        <button
          role="tab"
          id="tab-ask"
          aria-selected={tab === 'ask'}
          aria-controls="panel-ask"
          className="tab"
          onClick={() => setTab('ask')}
        >
          Ask
        </button>
        <button
          role="tab"
          id="tab-who"
          aria-selected={tab === 'who'}
          aria-controls="panel-who"
          className="tab"
          onClick={() => setTab('who')}
        >
          Who's who
        </button>
      </div>

      <div
        role="tabpanel"
        id="panel-ask"
        aria-labelledby="tab-ask"
        hidden={tab !== 'ask'}
        style={{ display: tab === 'ask' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <AskTab sessionCode={sessionCode} titleId={session.titleId} positionMs={session.positionMs} />
      </div>
      <div
        role="tabpanel"
        id="panel-who"
        aria-labelledby="tab-who"
        hidden={tab !== 'who'}
        style={{ flex: 1, minHeight: 0, display: tab === 'who' ? 'flex' : 'none', flexDirection: 'column' }}
      >
        <WhosWhoTab titleId={session.titleId} positionMs={session.positionMs} sessionCode={sessionCode} />
      </div>

      <button type="button" className="btn btn--ghost" onClick={onLeave}>
        Leave session
      </button>
    </div>
  );
}
