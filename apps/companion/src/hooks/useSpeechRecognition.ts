import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Minimal shape of the Web Speech API we rely on — not in lib.dom.d.ts everywhere,
// so it's declared locally rather than pulling in a whole ambient types package.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognition {
  supported: boolean;
  listening: boolean;
  /** Starts listening; calls onResult with the final transcript once recognized. */
  start: () => void;
  stop: () => void;
}

/**
 * Thin wrapper around SpeechRecognition / webkitSpeechRecognition.
 * Gracefully reports `supported: false` (e.g. Firefox, some in-app browsers)
 * so callers can hide the mic button entirely.
 */
export function useSpeechRecognition(onResult: (transcript: string) => void): UseSpeechRecognition {
  const Ctor = useMemo(getSpeechRecognitionCtor, []);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last?.[0]?.transcript) {
        onResultRef.current(last[0].transcript.trim());
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [Ctor]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { supported: Ctor !== null, listening, start, stop };
}
