import { describe, expect, it } from 'vitest';
import { initialPanelState, panelReducer, type PanelAction, type PanelState } from '../src/machine.js';
import type { AskQuery } from '../src/types.js';

const q: AskQuery = { label: 'Catch me up', mode: 'recap', question: 'x', source: 'tv' };
const resp = { answer: 'A', citations: [] };
const run = (actions: PanelAction[], from: PanelState = initialPanelState) => actions.reduce(panelReducer, from);
const opened = run([{ type: 'open', positionMs: 5000 }]);

describe('panelReducer', () => {
  it('opens and freezes the position', () => {
    expect(opened).toMatchObject({ open: true, positionMs: 5000, view: 'chips' });
  });
  it('open is idempotent (keeps first frozen position)', () => {
    expect(panelReducer(opened, { type: 'open', positionMs: 9999 }).positionMs).toBe(5000);
  });
  it('ask goes loading then loaded', () => {
    const l = run([{ type: 'askStart', query: q }], opened);
    expect(l.ask.status).toBe('loading');
    expect(panelReducer(l, { type: 'askSuccess', requestId: l.requestId, response: resp }).ask.status).toBe('loaded');
  });
  it('ignores askStart while closed', () => {
    expect(panelReducer(initialPanelState, { type: 'askStart', query: q })).toBe(initialPanelState);
  });
  it('drops a stale success after back', () => {
    const l = run([{ type: 'askStart', query: q }], opened);
    const id = l.requestId;
    const back = panelReducer(l, { type: 'back' });
    expect(back.ask.status).toBe('idle');
    expect(panelReducer(back, { type: 'askSuccess', requestId: id, response: resp })).toBe(back);
  });
  it('drops a stale success after close', () => {
    const l = run([{ type: 'askStart', query: q }], opened);
    const closed = panelReducer(l, { type: 'close' });
    expect(panelReducer(closed, { type: 'askSuccess', requestId: l.requestId, response: resp })).toBe(closed);
  });
  it('error state keeps the query for retry', () => {
    const l = run([{ type: 'askStart', query: q }], opened);
    const e = panelReducer(l, { type: 'askError', requestId: l.requestId, message: 'boom' });
    expect(e.ask).toMatchObject({ status: 'error', message: 'boom', query: q });
  });
  it('back unwinds: answer -> chips -> closed', () => {
    const l = run([{ type: 'askStart', query: q }], opened);
    const a = panelReducer(l, { type: 'askSuccess', requestId: l.requestId, response: resp });
    const b1 = panelReducer(a, { type: 'back' });
    expect(b1.open).toBe(true);
    expect(b1.ask.status).toBe('idle');
    expect(panelReducer(b1, { type: 'back' }).open).toBe(false);
  });
  it('back from phone/typing returns to chips, not closed', () => {
    expect(run([{ type: 'showPhone' }, { type: 'back' }], opened)).toMatchObject({ open: true, view: 'chips' });
    expect(run([{ type: 'showTyping' }, { type: 'back' }], opened)).toMatchObject({ open: true, view: 'chips' });
  });
  it('back when closed is a no-op', () => {
    expect(panelReducer(initialPanelState, { type: 'back' })).toBe(initialPanelState);
  });
  it('sharedAnswer opens the panel with a loaded phone answer', () => {
    const s = panelReducer(initialPanelState, { type: 'sharedAnswer', query: { ...q, source: 'phone' }, response: resp, positionMs: 7000 });
    expect(s).toMatchObject({ open: true, positionMs: 7000 });
    expect(s.ask.status).toBe('loaded');
  });
  it('sharedAnswer keeps the frozen position if already open', () => {
    expect(panelReducer(opened, { type: 'sharedAnswer', query: q, response: resp, positionMs: 9000 }).positionMs).toBe(5000);
  });
  it('tts toggles and close clears it', () => {
    const t = run([{ type: 'ttsStart' }], opened);
    expect(t.ttsPlaying).toBe(true);
    expect(panelReducer(t, { type: 'close' }).ttsPlaying).toBe(false);
  });
  it('stores the session code', () => {
    expect(panelReducer(initialPanelState, { type: 'session', code: 'ABC123' }).sessionCode).toBe('ABC123');
  });
});
