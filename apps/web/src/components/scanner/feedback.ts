/** Retour haptique et sonore à chaque code reconnu (section 8). */
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioContext;
}

/** À appeler depuis un geste utilisateur pour débloquer l'audio sur iOS. */
export function primeAudio(): void {
  const context = getAudioContext();
  if (context && context.state === 'suspended') void context.resume();
}

export function beep(frequency = 1760, durationMs = 80): void {
  const context = getAudioContext();
  if (!context) return;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    const now = context.currentTime;
    oscillator.start(now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    oscillator.stop(now + durationMs / 1000 + 0.02);
  } catch {
    /* audio indisponible : le retour haptique suffit */
  }
}

export function vibrate(pattern: number | number[] = 40): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* non pris en charge */
    }
  }
}

export function scanFeedback(): void {
  vibrate(40);
  beep();
}

export function errorFeedback(): void {
  vibrate([60, 40, 60]);
  beep(440, 160);
}
