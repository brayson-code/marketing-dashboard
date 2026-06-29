'use client';

// useDictation — push-to-talk speech-to-text for any composer.
//
// PRIMARY path: Deepgram streaming, mirroring the SalesOps extension offscreen pipeline:
//   POST /api/stt/token  → short-lived browser token (tenant's BYO Deepgram key)
//   getUserMedia({audio:true})
//   new WebSocket("wss://api.deepgram.com/v1/listen?…", ["token", access_token])
//   on open → MediaRecorder(stream,{mimeType:"audio/webm;codecs=opus"}).start(250),
//             send each ondataavailable blob to the socket
//   on message → channel.alternatives[0].transcript, interim while !is_final,
//                committed on is_final.
//
// FALLBACK: if /api/stt/token returns connect_deepgram, OR getUserMedia / WebSocket /
// MediaRecorder is unavailable, fall back to the browser's SpeechRecognition. Emits the
// SAME onTranscript(text, isFinal) shape. If neither path is available → onError + supported=false.
//
// Teardown is always clean: stop() and unmount stop the mic tracks, close the socket, and
// stop SpeechRecognition. Nothing throws into render — errors go to onError.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseDictationOptions {
  /** Called for every transcript chunk. isFinal=false → interim (will be replaced),
   *  isFinal=true → committed segment. */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Called when dictation can't start or fails mid-stream. */
  onError?: (e: Error) => void;
}

export interface UseDictation {
  recording: boolean;
  /** The current interim (not-yet-final) transcript, for live display. */
  interim: string;
  /** False once we've determined no STT path is available in this browser. */
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
}

const DG_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-2' +
  '&language=en' +
  '&smart_format=true' +
  '&interim_results=true' +
  '&utterance_end_ms=1000' +
  '&vad_events=true';

// Minimal shape of the Web Speech API we touch (TS lib types are inconsistent across DOM versions).
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
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

// The Deepgram WS path needs MediaRecorder to actually produce webm/opus. Safari has
// MediaRecorder but NOT that codec, so we check isTypeSupported too — otherwise a Safari
// tenant WITH a Deepgram key would take the Deepgram path and the recorder would throw.
// When this is false the hook falls back to browser SpeechRecognition.
const DG_MIME = 'audio/webm;codecs=opus';
function deepgramAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(DG_MIME) &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function useDictation({ onTranscript, onError }: UseDictationOptions): UseDictation {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  // supported is conservative: true if EITHER path could plausibly work in this browser.
  const [supported, setSupported] = useState(true);

  // Keep latest callbacks in refs so teardown / socket handlers never go stale.
  // Assign in an effect (NOT during render) — React 19's hooks lint forbids mutating
  // a ref while rendering.
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  });

  // Live resources (refs, not state — they must survive re-renders and be reachable from stop()).
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Guards against double-start and against late async work after stop()/unmount.
  const activeRef = useRef(false);

  // Determine static browser-capability support ONCE on mount. `supported` defaults to
  // true so SSR + first client render agree (no hydration mismatch); we reconcile to the
  // real capability after mount. This is a one-shot [] probe, not a render cascade — the
  // exact "detect the environment on mount" case the rule's guidance allows.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(deepgramAvailable() || !!getSpeechRecognitionCtor());
  }, []);

  const emit = useCallback((text: string, isFinal: boolean) => {
    if (isFinal) {
      setInterim('');
      if (text) onTranscriptRef.current(text, true);
    } else {
      setInterim(text);
      if (text) onTranscriptRef.current(text, false);
    }
  }, []);

  // Tear everything down. Idempotent; safe to call from stop(), error paths, and unmount.
  const teardown = useCallback(() => {
    activeRef.current = false;

    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null;

    const stream = streamRef.current;
    if (stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* noop */
        }
      }
    }
    streamRef.current = null;

    const sock = socketRef.current;
    if (sock) {
      try {
        sock.onmessage = null;
        sock.onerror = null;
        sock.onclose = null;
        if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) {
          sock.close();
        }
      } catch {
        /* noop */
      }
    }
    socketRef.current = null;

    const reco = recognitionRef.current;
    if (reco) {
      try {
        reco.onresult = null;
        reco.onerror = null;
        reco.onend = null;
        reco.stop();
      } catch {
        /* noop */
      }
    }
    recognitionRef.current = null;

    setInterim('');
  }, []);

  const stop = useCallback(() => {
    teardown();
    setRecording(false);
  }, [teardown]);

  const fail = useCallback(
    (e: unknown) => {
      teardown();
      setRecording(false);
      const err = e instanceof Error ? e : new Error(String(e));
      onErrorRef.current?.(err);
    },
    [teardown],
  );

  // ── FALLBACK: browser SpeechRecognition ──
  const startBrowserRecognition = useCallback((): boolean => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;
    try {
      const reco = new Ctor();
      reco.continuous = true;
      reco.interimResults = true;
      reco.lang = 'en-US';
      reco.onresult = (event: SpeechRecognitionEventLike) => {
        if (!activeRef.current) return;
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? '';
          if (result.isFinal) {
            emit(transcript.trim(), true);
          } else {
            interimText += transcript;
          }
        }
        if (interimText) emit(interimText.trim(), false);
      };
      reco.onerror = (ev: { error?: string }) => {
        // 'no-speech' / 'aborted' are benign; only surface real failures.
        if (ev?.error && ev.error !== 'no-speech' && ev.error !== 'aborted') {
          fail(new Error(`speech_recognition_${ev.error}`));
        }
      };
      reco.onend = () => {
        // If we're still meant to be recording, the engine auto-stopped (common after a
        // pause) — restart it. Otherwise this is our own teardown; do nothing.
        if (activeRef.current) {
          try {
            reco.start();
          } catch {
            /* will settle on next user toggle */
          }
        }
      };
      recognitionRef.current = reco;
      reco.start();
      return true;
    } catch {
      return false;
    }
  }, [emit, fail]);

  // ── PRIMARY: Deepgram streaming ──
  const startDeepgram = useCallback(async (): Promise<'ok' | 'connect_deepgram' | 'unavailable'> => {
    if (!deepgramAvailable()) return 'unavailable';

    // 1. Mint a short-lived browser token.
    let token: string;
    try {
      const res = await fetch('/api/stt/token', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body?.error === 'connect_deepgram') return 'connect_deepgram';
        return 'unavailable';
      }
      const data = (await res.json()) as { access_token?: string };
      if (!data.access_token) return 'unavailable';
      token = data.access_token;
    } catch {
      return 'unavailable';
    }

    if (!activeRef.current) return 'ok'; // stopped while awaiting the token

    // 2. Mic.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // Permission denied / no device — surface as a real error (no point falling back to
      // SpeechRecognition, which needs the same mic permission).
      throw e;
    }
    if (!activeRef.current) {
      for (const t of stream.getTracks()) t.stop();
      return 'ok';
    }
    streamRef.current = stream;

    // 3. Socket.
    const socket = new WebSocket(DG_URL, ['token', token]);
    socketRef.current = socket;

    socket.onopen = () => {
      if (!activeRef.current) {
        try {
          socket.close();
        } catch {
          /* noop */
        }
        return;
      }
      try {
        const recorder = new MediaRecorder(stream, { mimeType: DG_MIME });
        recorderRef.current = recorder;
        recorder.ondataavailable = (ev: BlobEvent) => {
          if (ev.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(ev.data);
          }
        };
        recorder.start(250);
      } catch (e) {
        fail(e);
      }
    };

    socket.onmessage = (ev: MessageEvent) => {
      if (!activeRef.current) return;
      let data: {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: Array<{ transcript?: string }> };
      };
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (typeof transcript !== 'string' || !transcript) return;
      emit(transcript, data.is_final === true);
    };

    socket.onerror = () => {
      if (activeRef.current) fail(new Error('deepgram_socket_error'));
    };

    socket.onclose = () => {
      // Unexpected close while recording → treat as an error so the UI can recover.
      if (activeRef.current) fail(new Error('deepgram_socket_closed'));
    };

    return 'ok';
  }, [emit, fail]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setRecording(true);
    setInterim('');

    try {
      const result = await startDeepgram();
      if (!activeRef.current) return; // stopped mid-start

      if (result === 'ok') return;

      // Deepgram unavailable or tenant has no key → try the browser engine.
      if (startBrowserRecognition()) return;

      // Neither path works.
      setSupported(false);
      const reason =
        result === 'connect_deepgram'
          ? new Error('connect_deepgram')
          : new Error('dictation_unsupported');
      fail(reason);
    } catch (e) {
      fail(e);
    }
  }, [startDeepgram, startBrowserRecognition, fail]);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      stop();
    } else {
      void start();
    }
  }, [start, stop]);

  // Clean teardown on unmount.
  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return { recording, interim, supported, start, stop, toggle };
}
