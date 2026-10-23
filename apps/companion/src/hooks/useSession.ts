import { useEffect, useRef, useState } from 'react';
import { ApiError, getSession, type SessionState } from '../api';

export type SessionStatus = 'loading' | 'ready' | 'not-found' | 'error';

export interface UseSessionResult {
  status: SessionStatus;
  session: SessionState | null;
  /** Manually re-fetch immediately (e.g. after the user taps Retry). */
  retry: () => void;
}

const POLL_MS = 2000;

/** Polls GET /v1/sessions/:code every 2s so the phone tracks the TV's playhead. */
export function useSession(code: string | null): UseSessionResult {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<SessionState | null>(null);
  const [nonce, setNonce] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!code) {
      setStatus('loading');
      setSession(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const next = await getSession(code);
        if (cancelled) return;
        setSession(next);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.kind === 'not-found') {
          setStatus('not-found');
        } else {
          setStatus('error');
        }
      } finally {
        inFlight.current = false;
        if (!cancelled) {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };

    setStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [code, nonce]);

  return {
    status,
    session,
    retry: () => setNonce((n) => n + 1),
  };
}
