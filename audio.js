// Typewriter sound generator using WebAudio (no external files)
class TypewriterSound {
  constructor() {
    this.ctx = null
    this.enabled = false
    this.volume = 0.15
    this.lastAt = 0
  }
  ensureCtx() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      this.ctx = new AudioContext()
    }
  }
  setEnabled(on) {
    this.enabled = on
    if (on) this.ensureCtx()
  }
  click() {
    if (!this.enabled) return
    const now = performance.now()
    if (now - this.lastAt < 20) return // throttle
    this.lastAt = now
    this.ensureCtx()
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(220 + Math.random()*120, t)
    gain.gain.value = this.volume
    osc.connect(gain).connect(this.ctx.destination)
    osc.start(t)
    osc.stop(t + 0.03)
    // small click tail
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
  }
  bell() {
    if (!this.enabled) return
    this.ensureCtx()
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t)
    gain.gain.value = this.volume * 0.6
    osc.connect(gain).connect(this.ctx.destination)
    osc.start(t)
    osc.stop(t + 0.25)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
  }
}
window.TypewriterSound = TypewriterSound
