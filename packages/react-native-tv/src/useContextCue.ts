import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ContextCueController, type ContextCueOptions, type ContextCueViewState } from './controller.js';

export interface UseContextCueOptions extends ContextCueOptions {}

export interface ContextCue {
  state: ContextCueViewState;
  /** Opens the Ask panel (pauses the host player via the overlay's onRequestPause). */
  open: () => void;
  close: () => void;
  /** Wire to the TV Back key if you do not use the overlay's built-in handling. Returns true if consumed. */
  back: () => boolean;
  /** The underlying engine, for advanced use and for ContextCueOverlay. */
  controller: ContextCueController;
}

/** Creates the engine, starts the session + heartbeat, and exposes panel state. */
export function useContextCue(options: UseContextCueOptions): ContextCue {
  const ref = useRef<ContextCueController | null>(null);
  if (!ref.current) ref.current = new ContextCueController(options);
  const controller = ref.current;
  // Keep the engine's view of props fresh on every render (getPositionMs/isPlaying change identity).
  controller.setOptions(options);

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { state, open: controller.open, close: controller.close, back: controller.back, controller };
}
