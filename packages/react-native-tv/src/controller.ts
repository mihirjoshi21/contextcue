import { createApiClient, ApiError, type ApiClient, type FetchLike } from './api.js';
import { ASK_CHIPS, HEARTBEAT_INTERVAL_MS, SHARED_ANSWER_POLL_INTERVAL_MS, chipToQuery, type AskChipDef } from './constants.js';
import { citationSeekMs, companionUrl as buildCompanionUrl, sanitizePositionMs } from './format.js';
import { HeartbeatThrottle } from './heartbeat.js';
import { initialPanelState, panelReducer, type PanelAction, type PanelState } from './machine.js';
import { SharedAnswerDeduper } from './sharedAnswer.js';
import type { AskMode, AskQuery, Citation } from './types.js';

/**
 * Plays base64 audio (Polly mp3). RN has no built-in audio, so the host supplies this
 * (expo-av, react-native-video, Vega W3C media...). Resolve when playback ENDS; a void
 * return is treated as "finished immediately".
 */
export type PlayAudio = (audioBase64: string, contentType: string) => Promise<void> | void;

export interface ContextCueOptions {
  apiBaseUrl: string;
  titleId: string;
  /** Current playhead in ms. Called every heartbeat and when the panel opens. */
  getPositionMs: () => number;
  isPlaying: boolean;
  /** Needed for Read aloud. Without it the button is hidden. */
  playAudio?: PlayAudio;
  /** Called when Read aloud is stopped / the panel closes during playback. */
  stopAudio?: () => void;
  audience?: 'adult' | 'kids';
  locale?: string;
  /** Override global fetch (tests, custom TLS...). */
  fetch?: FetchLike;
  /** Override companion URL shown in "Ask from your phone". */
  companionUrl?: (code: string) => string;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  /** Disable all networking timers (no session). Panel still works but asks go without sessionCode. */
  disableSession?: boolean;
}

export interface PlayerHandlers {
  onSeek?: (ms: number) => void;
  onRequestPause?: () => void;
  onRequestResume?: () => void;
}

export interface ContextCueViewState extends PanelState {
  canReadAloud: boolean;
  companionUrl: string | null;
}

const TICK_MS = 400;

/** Framework-free engine: session, heartbeat, polling, asking, TTS, panel state. */
export class ContextCueController {
  private opts: ContextCueOptions;
  private handlers: PlayerHandlers = {};
  private api: ApiClient;
  private apiKey: string;
  private panel: PanelState = initialPanelState;
  private snapshot: ContextCueViewState;
  private listeners = new Set<() => void>();
  private throttle = new HeartbeatThrottle(HEARTBEAT_INTERVAL_MS);
  private deduper = new SharedAnswerDeduper();
  private tvToken: string | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private creating = false;
  private heartbeatInFlight = false;
  private pollInFlight = false;
  private lastSessionAttemptAt = -Infinity;
  private wasPlayingAtOpen = false;
  private ttsToken = 0;

  constructor(options: ContextCueOptions) {
    this.opts = options;
    this.apiKey = this.keyOf(options);
    this.api = createApiClient({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
    this.throttle = new HeartbeatThrottle(options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
    this.snapshot = this.computeSnapshot();
  }

  // ---- subscription (compatible with React useSyncExternalStore) ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): ContextCueViewState => this.snapshot;

  setOptions(options: ContextCueOptions): void {
    const key = this.keyOf(options);
    this.opts = options;
    if (key !== this.apiKey) {
      this.apiKey = key;
      this.api = createApiClient({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
    }
    this.refresh();
  }

  setHandlers(h: PlayerHandlers): void {
    this.handlers = h;
  }

  // ---- lifecycle ----
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.opts.disableSession) return;
    void this.ensureSession();
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
    this.pollTimer = setInterval(() => void this.poll(), this.opts.pollIntervalMs ?? SHARED_ANSWER_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.started = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.tickTimer = this.pollTimer = null;
    this.ttsToken++;
    if (this.panel.ttsPlaying) this.opts.stopAudio?.();
  }

  // ---- panel actions ----
  open = (): void => {
    if (this.panel.open) return;
    this.wasPlayingAtOpen = this.opts.isPlaying;
    this.dispatch({ type: 'open', positionMs: sanitizePositionMs(this.opts.getPositionMs()) });
    if (this.wasPlayingAtOpen) this.handlers.onRequestPause?.();
  };

  close = (opts: { resume?: boolean } = {}): void => {
    if (!this.panel.open) return;
    this.stopReadAloud();
    this.dispatch({ type: 'close' });
    if (opts.resume !== false && this.wasPlayingAtOpen) this.handlers.onRequestResume?.();
    this.wasPlayingAtOpen = false;
  };

  /** Back button. Returns true if it was consumed (panel was open). */
  back = (): boolean => {
    if (!this.panel.open) return false;
    const before = this.panel;
    this.dispatch({ type: 'back' });
    if (before.ttsPlaying && !this.panel.ttsPlaying) this.opts.stopAudio?.();
    if (!this.panel.open) {
      if (this.wasPlayingAtOpen) this.handlers.onRequestResume?.();
      this.wasPlayingAtOpen = false;
    }
    return true;
  };

  showPhone = (): void => this.dispatch({ type: 'showPhone' });
  showTyping = (): void => this.dispatch({ type: 'showTyping' });
  askAnother = (): void => {
    this.back();
  };

  askChip = (chip: AskChipDef | string): void => {
    const def = typeof chip === 'string' ? ASK_CHIPS.find((c) => c.id === chip) : chip;
    if (def) void this.ask(chipToQuery(def));
  };

  askQuestion = (text: string): void => {
    const q = text.trim().slice(0, 500);
    if (!q) return;
    void this.ask({ label: q, mode: 'ask', question: q, source: 'tv' });
  };

  retry = (): void => {
    const a = this.panel.ask;
    if (a.status === 'error' || a.status === 'loading') void this.ask(a.query);
  };

  /** Select a citation: seek to startMs-2s and resume playback. */
  selectCitation = (c: Citation): void => {
    this.handlers.onSeek?.(citationSeekMs(c.startMs));
    this.close({ resume: true });
  };

  readAloud = async (): Promise<void> => {
    const a = this.panel.ask;
    const play = this.opts.playAudio;
    if (a.status !== 'loaded' || !play) return;
    const token = ++this.ttsToken;
    this.dispatch({ type: 'ttsStart' });
    try {
      const res = await this.api.speak(a.response.answer);
      if (token !== this.ttsToken) return;
      if (!res.audioBase64 || res.error) {
        this.dispatch({ type: 'ttsEnd' });
        return;
      }
      await play(res.audioBase64, res.contentType || 'audio/mpeg');
    } catch {
      // fall through to ttsEnd
    }
    if (token === this.ttsToken) this.dispatch({ type: 'ttsEnd' });
  };

  stopReadAloud = (): void => {
    if (!this.panel.ttsPlaying) return;
    this.ttsToken++;
    this.opts.stopAudio?.();
    this.dispatch({ type: 'ttsEnd' });
  };

  // ---- internals ----
  private async ask(query: AskQuery): Promise<void> {
    if (!this.panel.open) return;
    this.dispatch({ type: 'askStart', query });
    const requestId = this.panel.requestId;
    try {
      const res = await this.api.ask({
        titleId: this.opts.titleId,
        positionMs: this.panel.positionMs,
        question: query.question,
        mode: query.mode,
        sessionCode: this.panel.sessionCode ?? undefined,
        audience: this.opts.audience,
        locale: this.opts.locale,
      });
      this.dispatch({ type: 'askSuccess', requestId, response: { answer: res.answer, citations: res.citations ?? [] } });
    } catch (e) {
      this.dispatch({ type: 'askError', requestId, message: e instanceof Error ? e.message : 'Something went wrong.' });
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.creating || this.tvToken) return;
    this.creating = true;
    try {
      const s = await this.api.createSession();
      this.tvToken = s.tvToken;
      this.throttle.reset();
      this.dispatch({ type: 'session', code: s.code });
    } catch {
      // retried by tick (rate limited)
    } finally {
      this.creating = false;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    if (!this.tvToken) {
      if (now - this.lastSessionAttemptAt >= 3000) {
        this.lastSessionAttemptAt = now;
        void this.ensureSession();
      }
      return;
    }
    const code = this.panel.sessionCode;
    const playing = this.opts.isPlaying;
    if (!code || this.heartbeatInFlight || !this.throttle.shouldSend(now, playing)) return;
    this.throttle.markSent(now, playing);
    this.heartbeatInFlight = true;
    try {
      await this.api.updateSession(code, this.tvToken, {
        titleId: this.opts.titleId,
        positionMs: sanitizePositionMs(this.opts.getPositionMs()),
        playing,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Session/token no longer valid (server restart, TTL): recreate once.
        this.tvToken = null;
        this.dispatch({ type: 'session', code: null });
        this.deduper.reset();
        void this.ensureSession();
      }
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private async poll(): Promise<void> {
    const code = this.panel.sessionCode;
    if (!code || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const s = await this.api.getSession(code);
      const shared = s.sharedAnswer;
      if (shared && this.deduper.shouldHandle(shared.id)) {
        const wasOpen = this.panel.open;
        if (!wasOpen) this.wasPlayingAtOpen = this.opts.isPlaying;
        this.dispatch({
          type: 'sharedAnswer',
          query: { label: shared.question, mode: (shared.mode as AskMode) ?? 'ask', question: shared.question, source: 'phone' },
          response: { answer: shared.answer, citations: shared.citations ?? [] },
          positionMs: sanitizePositionMs(this.opts.getPositionMs()),
        });
        if (!wasOpen && this.wasPlayingAtOpen) this.handlers.onRequestPause?.();
      }
    } catch {
      // transient; next poll retries
    } finally {
      this.pollInFlight = false;
    }
  }

  private dispatch(action: PanelAction): void {
    const next = panelReducer(this.panel, action);
    if (next === this.panel) return;
    this.panel = next;
    this.refresh();
  }

  private refresh(): void {
    const next = this.computeSnapshot();
    if (next === this.snapshot) return; // unchanged: don't notify (setOptions runs during render)
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  private computeSnapshot(): ContextCueViewState {
    const code = this.panel.sessionCode;
    const url = code ? (this.opts.companionUrl ? this.opts.companionUrl(code) : buildCompanionUrl(this.opts.apiBaseUrl, code)) : null;
    const prev = this.snapshot;
    if (prev && prev.canReadAloud === !!this.opts.playAudio && prev.companionUrl === url && sameShallow(prev, this.panel)) return prev;
    return { ...this.panel, canReadAloud: !!this.opts.playAudio, companionUrl: url };
  }

  private keyOf(o: ContextCueOptions): string {
    return `${o.apiBaseUrl}|${o.fetch ? 'f' : ''}`;
  }
}

function sameShallow(prev: ContextCueViewState, panel: PanelState): boolean {
  return (Object.keys(panel) as (keyof PanelState)[]).every((k) => prev[k] === panel[k]);
}
