/**
 * Audio Alerts for Seat Drop Sniper
 *
 * Uses the Web Audio API to synthesize a distinctive chime when
 * newly opened seats are captured, without external sound files.
 */

export function playSuccessChime(): void {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Harmonious victory chord sequence (C5, E5, G5, C6)
    const notes = [
      { freq: 523.25, time: 0.0, dur: 0.15 }, // C5
      { freq: 659.25, time: 0.12, dur: 0.18 }, // E5
      { freq: 783.99, time: 0.25, dur: 0.22 }, // G5
      { freq: 1046.5, time: 0.38, dur: 0.45 }, // C6
    ];

    notes.forEach(({ freq, time, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + time);

      gain.gain.setValueAtTime(0, now + time);
      gain.gain.linearRampToValueAtTime(0.3, now + time + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + dur);
    });
  } catch (err) {
    console.warn('[Movie Assistant] Could not play audio chime:', err);
  }
}
