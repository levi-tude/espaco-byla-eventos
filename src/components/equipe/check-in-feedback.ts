/**
 * Som, vibração e tela acesa da portaria. Tudo é "melhor esforço": aparelho sem suporte
 * (ex.: iPhone não vibra) simplesmente fica sem aquele aviso, nunca quebra a leitura.
 */

export type FeedbackTone = "success" | "meia" | "error";

type AudioCtor = typeof AudioContext;

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const Ctor: AudioCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

/** O iPhone só libera som depois de um toque: chamar em qualquer toque da equipe. */
export function unlockAudio() {
  const context = getAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

/** Bipes por resultado: 1 agudo (ok), 2 médios (meia: conferir), 3 graves (recusa). */
export const BEEP_PATTERNS: Record<FeedbackTone, { frequency: number; count: number }> = {
  success: { frequency: 1046, count: 1 },
  meia: { frequency: 784, count: 2 },
  error: { frequency: 220, count: 3 },
};

export const VIBRATION_PATTERNS: Record<FeedbackTone, number[]> = {
  success: [120],
  meia: [120, 80, 120],
  error: [300, 100, 300, 100, 300],
};

export function playFeedback(tone: FeedbackTone) {
  try {
    navigator.vibrate?.(VIBRATION_PATTERNS[tone]);
  } catch {
    // sem vibração
  }
  const context = getAudioContext();
  if (!context) return;
  try {
    const { frequency, count } = BEEP_PATTERNS[tone];
    const duration = tone === "error" ? 0.18 : 0.12;
    const gap = 0.08;
    const start = context.currentTime + 0.01;
    for (let index = 0; index < count; index += 1) {
      const at = start + index * (duration + gap);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone === "error" ? "square" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.02);
    }
  } catch {
    // sem som
  }
}

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

/** Mantém a tela acesa enquanto a portaria está aberta; volta a pedir ao voltar para a aba. */
export function keepScreenOn(): () => void {
  if (typeof navigator === "undefined" || typeof document === "undefined") return () => undefined;
  const wakeLock = (navigator as unknown as {
    wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
  }).wakeLock;
  if (!wakeLock) return () => undefined;

  let sentinel: WakeLockSentinelLike | null = null;
  let disposed = false;

  const request = async () => {
    if (disposed || document.visibilityState !== "visible") return;
    try {
      sentinel = await wakeLock.request("screen");
      if (disposed) void sentinel.release().catch(() => undefined);
    } catch {
      sentinel = null;
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void request();
  };

  void request();
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    sentinel = null;
  };
}
