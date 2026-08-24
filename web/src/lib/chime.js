/**
 * The sound a finished timer makes, synthesised rather than loaded — a few
 * hundred bytes of arithmetic instead of an audio file to ship, cache and
 * mis-serve.
 *
 * The notes come from the harmonic minor scale, whose raised seventh is the
 * whole point: it sits a semitone under the tonic and leans on it, so a phrase
 * ending on the tonic sounds finished rather than merely stopped. That is
 * exactly what a timer needs to say.
 *
 *   A harmonic minor:  A  B  C  D  E  F  G♯   (0 2 3 5 7 8 11)
 *
 * Browsers refuse to start audio that no one asked for, so the context is
 * created on the first play — which only ever happens inside a click — and
 * resumed if the tab suspended it since.
 */

const SEMITONE = [0, 2, 3, 5, 7, 8, 11]
const TONIC = 440 // A4

/** `degree` counts scale steps from the tonic and may run past an octave. */
function hz(degree) {
  const octave = Math.floor(degree / 7)
  const step = SEMITONE[((degree % 7) + 7) % 7]
  return TONIC * 2 ** (octave + step / 12)
}

let ctx = null

function audio() {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

/**
 * One note. Triangle rather than sine: a sine at this length reads as a beep
 * from a machine, and the odd harmonics of a triangle give it enough body to
 * sound like an instrument without becoming harsh.
 */
function note(at, freq, seconds, gain) {
  const a = audio()
  if (!a) return

  const osc = a.createOscillator()
  const vol = a.createGain()
  osc.type = 'triangle'
  osc.frequency.value = freq

  // A hard start or stop clicks, so both ends are ramped. The decay is
  // exponential because that is how struck things actually fade.
  vol.gain.setValueAtTime(0.0001, at)
  vol.gain.exponentialRampToValueAtTime(gain, at + 0.012)
  vol.gain.exponentialRampToValueAtTime(0.0001, at + seconds)

  osc.connect(vol).connect(a.destination)
  osc.start(at)
  osc.stop(at + seconds + 0.02)
}

/** Play a sequence of [scaleDegree, startBeat, beats] at `bpm`. */
function phrase(notes, { bpm = 150, gain = 0.16 } = {}) {
  const a = audio()
  if (!a) return
  const beat = 60 / bpm
  const t0 = a.currentTime + 0.04
  for (const [degree, at, len] of notes) {
    note(t0 + at * beat, hz(degree), len * beat, gain)
  }
}

/**
 * Work finished: the tonic arpeggio climbing to the raised seventh and settling
 * on the octave — the leading note doing its job.
 */
export const chimeDone = () =>
  phrase([[0, 0, 1], [2, 1, 1], [4, 2, 1], [6, 3, 1], [7, 4, 2.4]])

/** A break beginning: the same notes falling, so it reads as release. */
export const chimeBreak = () =>
  phrase([[7, 0, 1], [4, 1, 1], [2, 2, 1], [0, 3, 2.2]], { gain: 0.13 })

/** A quiet two-note nudge for something starting rather than ending. */
export const chimeStart = () =>
  phrase([[0, 0, 0.6], [4, 0.6, 1]], { bpm: 200, gain: 0.1 })
