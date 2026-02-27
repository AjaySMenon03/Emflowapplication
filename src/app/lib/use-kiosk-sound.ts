/**
 * useKioskSound — Web Audio API–based notification chime for the kiosk.
 *
 * Generates a pleasant two-tone chime when a new ticket is called.
 * Uses AudioContext (no external audio files needed).
 *
 * Features:
 *   - Triple ascending chime (C5 → E5 → G5)
 *   - Mute/unmute toggle with localStorage persistence
 *   - Graceful degradation if AudioContext unavailable
 *   - Auto-resume AudioContext after user interaction
 */
import { useRef, useCallback, useState, useEffect } from "react";

const STORAGE_KEY = "em-flow-kiosk-sound";

export function useKioskSound() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [isMuted, setIsMuted] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "muted";
  });

  // Ensure AudioContext exists (lazily created on first interaction)
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        return null;
      }
    }
    // Resume if suspended (browsers require user gesture)
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "muted" : "unmuted");
      // If unmuting, ensure AudioContext is active
      if (!next) getAudioCtx();
      return next;
    });
  }, [getAudioCtx]);

  /**
   * Play a pleasant ascending chime: C5 → E5 → G5
   * Each note is a sine wave with a short decay envelope.
   */
  const playChime = useCallback(() => {
    if (isMuted) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const noteSpacing = 0.15; // seconds between notes
    const noteDuration = 0.35; // seconds per note

    notes.forEach((freq, i) => {
      const startTime = ctx.currentTime + i * noteSpacing;

      // Oscillator
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      // Gain envelope (attack + decay)
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02); // quick attack
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration); // smooth decay

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + noteDuration + 0.05);
    });
  }, [isMuted, getAudioCtx]);

  /**
   * Play a more urgent "ding-dong" two-tone bell.
   * Used for announcements that need extra attention.
   */
  const playBell = useCallback(() => {
    if (isMuted) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const bellFreqs = [
      { freq: 880, start: 0, dur: 0.5 },    // A5
      { freq: 659.25, start: 0.25, dur: 0.6 }, // E5
    ];

    bellFreqs.forEach(({ freq, start, dur }) => {
      const startTime = ctx.currentTime + start;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + dur + 0.05);
    });
  }, [isMuted, getAudioCtx]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  return { isMuted, toggleMute, playChime, playBell };
}
