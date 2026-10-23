import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  ask,
  askStream,
  formatTimestamp,
  speak,
  StreamUnsupportedError,
  type AskMode,
  type AskRequest,
  type Citation,
  type GuardInfo,
} from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface AskTabProps {
  sessionCode: string;
  titleId: string;
  positionMs: number;
}

type ListenState = 'idle' | 'loading' | 'playing' | 'unavailable';

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; state: 'loading' }
  | { id: string; role: 'assistant'; state: 'streaming'; text: string }
  | {
      id: string;
      role: 'assistant';
      state: 'done';
      answer: string;
      citations: Citation[];
      guard: GuardInfo;
      listen: ListenState;
    }
  | { id: string; role: 'assistant'; state: 'error'; message: string };

const CHIPS: { label: string; mode: AskMode; question: string }[] = [
  { label: 'Catch me up', mode: 'recap', question: 'Catch me up on what has happened so far.' },
  { label: "Who's who?", mode: 'who', question: "Who's who so far?" },
  { label: 'What just happened?', mode: 'scene', question: 'What just happened in the last scene?' },
];

const SHOW_ON_TV_KEY = 'contextcue.showOnTv';

function readShowOnTv(): boolean {
  try {
    return window.localStorage.getItem(SHOW_ON_TV_KEY) === '1';
  } catch {
    return false;
  }
}

function writeShowOnTv(value: boolean): void {
  try {
    window.localStorage.setItem(SHOW_ON_TV_KEY, value ? '1' : '0');
  } catch {
    // Private mode / storage disabled — the toggle still works for this session.
  }
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m${idCounter}`;
}

function errorMessageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'network') return "Can't reach the API right now. Check your connection and try again.";
    if (err.kind === 'not-found') return 'This session has ended.';
    return 'Something went wrong answering that. Try again.';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong answering that. Try again.';
}

export function AskTab({ sessionCode, titleId, positionMs }: AskTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [showOnTv, setShowOnTv] = useState<boolean>(() => readShowOnTv());
  const positionRef = useRef(positionMs);
  positionRef.current = positionMs;
  const showOnTvRef = useRef(showOnTv);
  showOnTvRef.current = showOnTv;
  const threadRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speech = useSpeechRecognition((transcript) => {
    setDraft(transcript);
  });

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
    });
  };

  const toggleShowOnTv = () => {
    setShowOnTv((prev) => {
      const next = !prev;
      writeShowOnTv(next);
      return next;
    });
  };

  const patchMessage = (id: string, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  };

  const submit = async (question: string, mode: AskMode) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = { id: nextId(), role: 'user', text: trimmed };
    const loadingId = nextId();
    setMessages((prev) => [...prev, userMsg, { id: loadingId, role: 'assistant', state: 'loading' }]);
    setDraft('');
    scrollToEnd();

    const requestBody: AskRequest = {
      titleId,
      positionMs: positionRef.current,
      question: trimmed,
      mode,
      sessionCode,
      showOnTv: showOnTvRef.current,
    };

    try {
      let streamedText = '';
      let gotDone = false;

      try {
        for await (const evt of askStream(requestBody)) {
          if (evt.type === 'sentence') {
            streamedText = streamedText ? `${streamedText} ${evt.text}` : evt.text;
            patchMessage(loadingId, () => ({ id: loadingId, role: 'assistant', state: 'streaming', text: streamedText }));
            scrollToEnd();
          } else if (evt.type === 'done') {
            gotDone = true;
            patchMessage(loadingId, () => ({
              id: loadingId,
              role: 'assistant',
              state: 'done',
              answer: evt.answer || streamedText,
              citations: evt.citations,
              guard: evt.guard,
              listen: 'idle',
            }));
          } else if (evt.type === 'error') {
            throw new Error(evt.message);
          }
        }
        if (!gotDone) {
          patchMessage(loadingId, () => ({
            id: loadingId,
            role: 'assistant',
            state: 'done',
            answer: streamedText || "Sorry, I didn't catch an answer for that.",
            citations: [],
            guard: { passed: true, flags: [] },
            listen: 'idle',
          }));
        }
      } catch (streamErr) {
        if (streamErr instanceof StreamUnsupportedError) {
          const response = await ask(requestBody);
          patchMessage(loadingId, () => ({
            id: loadingId,
            role: 'assistant',
            state: 'done',
            answer: response.answer,
            citations: response.citations,
            guard: response.guard,
            listen: 'idle',
          }));
        } else {
          throw streamErr;
        }
      }
    } catch (err) {
      const message = errorMessageFor(err);
      patchMessage(loadingId, () => ({ id: loadingId, role: 'assistant', state: 'error', message }));
    } finally {
      scrollToEnd();
    }
  };

  // Dev-only convenience for screenshotting/QA: `?demo=1` auto-asks the first quick
  // chip once so a thread with a real answer can be captured headlessly (no way to
  // type/click in a one-shot headless-Chrome screenshot). Harmless in every other
  // way — it's a no-op without the query flag, and even with it, it only ever fires
  // once per mount and only ever sends a canned, spoiler-safe chip question.
  const demoRanRef = useRef(false);
  useEffect(() => {
    if (demoRanRef.current) return;
    if (new URLSearchParams(window.location.search).get('demo') !== '1') return;
    demoRanRef.current = true;
    const chip = CHIPS[0];
    void submit(chip.question, chip.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleListen = async (id: string, text: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    patchMessage(id, (m) => (m.role === 'assistant' && m.state === 'done' ? { ...m, listen: 'loading' } : m));
    try {
      const result = await speak({ text });
      if (!result.audioBase64 || result.mock || result.error) {
        patchMessage(id, (m) => (m.role === 'assistant' && m.state === 'done' ? { ...m, listen: 'unavailable' } : m));
        return;
      }
      const audio = new Audio(`data:${result.contentType};base64,${result.audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => {
        patchMessage(id, (m) => (m.role === 'assistant' && m.state === 'done' ? { ...m, listen: 'idle' } : m));
      };
      patchMessage(id, (m) => (m.role === 'assistant' && m.state === 'done' ? { ...m, listen: 'playing' } : m));
      await audio.play();
    } catch {
      patchMessage(id, (m) => (m.role === 'assistant' && m.state === 'done' ? { ...m, listen: 'unavailable' } : m));
    }
  };

  return (
    <div
      className="ask-tab"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 'var(--space-3)', minHeight: 0 }}
    >
      <div className="chips" role="group" aria-label="Quick questions">
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="chip"
            onClick={() => void submit(chip.question, chip.mode)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="thread" ref={threadRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="thread__empty">
            Ask anything about what you've watched so far — nothing ahead of the playhead ever
            gets used.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} onListen={handleListen} />)
        )}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft, 'ask');
        }}
      >
        <label htmlFor="ask-input" className="visually-hidden">
          Ask a question
        </label>
        <textarea
          id="ask-input"
          className="composer__input"
          rows={1}
          placeholder="Ask a question…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit(draft, 'ask');
            }
          }}
        />
        {speech.supported ? (
          <button
            type="button"
            className="icon-btn"
            aria-pressed={speech.listening}
            aria-label={speech.listening ? 'Stop voice input' : 'Ask by voice'}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
          >
            {speech.listening ? '⏹' : '🎤'}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn icon-btn--toggle"
          aria-pressed={showOnTv}
          aria-label={showOnTv ? 'Showing answers on TV: on' : 'Show answers on TV: off'}
          title="Show answers on TV"
          onClick={toggleShowOnTv}
        >
          📺
        </button>
        <button type="submit" className="icon-btn icon-btn--send" aria-label="Send" disabled={!draft.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  onListen,
}: {
  message: ChatMessage;
  onListen: (id: string, text: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="msg msg--user">
        <div className="msg__bubble">{message.text}</div>
      </div>
    );
  }

  if (message.state === 'loading') {
    return (
      <div className="msg msg--assistant msg--loading">
        <div className="msg__bubble">Reading only what you've already seen…</div>
      </div>
    );
  }

  if (message.state === 'streaming') {
    return (
      <div className="msg msg--assistant">
        <div className="msg__bubble">{message.text || 'Reading only what you\'ve already seen…'}</div>
      </div>
    );
  }

  if (message.state === 'error') {
    return (
      <div className="msg msg--assistant msg--error">
        <div className="msg__bubble">{message.message}</div>
      </div>
    );
  }

  return (
    <div className="msg msg--assistant">
      <div className="msg__bubble">{message.answer}</div>
      {message.citations.length > 0 ? (
        <div className="msg__citations">
          {message.citations.map((c, i) => (
            <span className="citation-pill" key={`${c.startMs}-${i}`}>
              {formatTimestamp(c.startMs)}
            </span>
          ))}
        </div>
      ) : null}
      {!message.guard.passed ? (
        <p className="guard-note">
          <span aria-hidden="true">🛡️</span>
          {message.guard.flags.length > 0
            ? `${message.guard.flags.length} possible spoiler removed`
            : 'A possible spoiler was removed'}
        </p>
      ) : null}
      {message.listen !== 'unavailable' ? (
        <button
          type="button"
          className="chip"
          disabled={message.listen === 'loading'}
          aria-pressed={message.listen === 'playing'}
          onClick={() => onListen(message.id, message.answer)}
        >
          {message.listen === 'loading' ? 'Loading audio…' : message.listen === 'playing' ? '⏸ Stop' : '🔊 Listen'}
        </button>
      ) : null}
    </div>
  );
}
