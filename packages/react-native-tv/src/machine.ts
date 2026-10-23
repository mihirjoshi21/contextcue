import type { AskQuery, AskResponse } from './types.js';

/** Pure state machine for the Ask panel. No timers, no IO. */

export type PanelView = 'chips' | 'typing' | 'phone';

export type AskState =
  | { status: 'idle' }
  | { status: 'loading'; query: AskQuery }
  | { status: 'loaded'; query: AskQuery; response: Pick<AskResponse, 'answer' | 'citations'> }
  | { status: 'error'; query: AskQuery; message: string };

export interface PanelState {
  open: boolean;
  view: PanelView;
  ask: AskState;
  /** Playhead frozen when the panel opened: the spoiler ceiling shown in the badge. */
  positionMs: number;
  /** Bumped per ask / close so late responses from abandoned asks are dropped. */
  requestId: number;
  ttsPlaying: boolean;
  sessionCode: string | null;
}

export const initialPanelState: PanelState = {
  open: false,
  view: 'chips',
  ask: { status: 'idle' },
  positionMs: 0,
  requestId: 0,
  ttsPlaying: false,
  sessionCode: null,
};

export type PanelAction =
  | { type: 'open'; positionMs: number }
  | { type: 'close' }
  | { type: 'back' }
  | { type: 'showPhone' }
  | { type: 'showTyping' }
  | { type: 'askStart'; query: AskQuery }
  | { type: 'askSuccess'; requestId: number; response: Pick<AskResponse, 'answer' | 'citations'> }
  | { type: 'askError'; requestId: number; message: string }
  | { type: 'sharedAnswer'; query: AskQuery; response: Pick<AskResponse, 'answer' | 'citations'>; positionMs: number }
  | { type: 'ttsStart' }
  | { type: 'ttsEnd' }
  | { type: 'session'; code: string | null };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'open':
      if (state.open) return state;
      return { ...state, open: true, view: 'chips', ask: { status: 'idle' }, positionMs: action.positionMs };
    case 'close':
      if (!state.open) return state;
      return { ...state, open: false, view: 'chips', ask: { status: 'idle' }, requestId: state.requestId + 1, ttsPlaying: false };
    case 'back': {
      if (!state.open) return state;
      if (state.view !== 'chips') return { ...state, view: 'chips' };
      if (state.ask.status !== 'idle') return { ...state, ask: { status: 'idle' }, requestId: state.requestId + 1, ttsPlaying: false };
      return panelReducer(state, { type: 'close' });
    }
    case 'showPhone':
      return state.open ? { ...state, view: 'phone' } : state;
    case 'showTyping':
      return state.open ? { ...state, view: 'typing' } : state;
    case 'askStart':
      if (!state.open) return state;
      return { ...state, view: 'chips', ask: { status: 'loading', query: action.query }, requestId: state.requestId + 1, ttsPlaying: false };
    case 'askSuccess':
      if (action.requestId !== state.requestId || state.ask.status !== 'loading') return state;
      return { ...state, ask: { status: 'loaded', query: state.ask.query, response: action.response } };
    case 'askError':
      if (action.requestId !== state.requestId || state.ask.status !== 'loading') return state;
      return { ...state, ask: { status: 'error', query: state.ask.query, message: action.message } };
    case 'sharedAnswer':
      return {
        ...state,
        open: true,
        view: 'chips',
        ask: { status: 'loaded', query: action.query, response: action.response },
        positionMs: state.open ? state.positionMs : action.positionMs,
        requestId: state.requestId + 1,
        ttsPlaying: false,
      };
    case 'ttsStart':
      return { ...state, ttsPlaying: true };
    case 'ttsEnd':
      return state.ttsPlaying ? { ...state, ttsPlaying: false } : state;
    case 'session':
      return { ...state, sessionCode: action.code };
  }
}
