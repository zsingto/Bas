// ทดสอบตัวตรวจจับด้วยสัญญาณเสียงสังเคราะห์ ผ่าน FFT แบบเดียวกับ AnalyserNode
const test = require('node:test');
const assert = require('node:assert');
const { WhistleDetector } = require('../js/whistle.js');

const SR = 48000;
const N = 2048; // fftSize
const FRAME_MS = 1000 / 60;

let seed = 12345;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function gauss() {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// สร้างสเปกตรัม dB ของเฟรมเสียง (Blackman window เหมือน Web Audio)
function spectrum(signalFn, t0) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
    re[i] = signalFn(t0 + i / SR) * w;
  }
  fft(re, im);
  const out = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) out[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / N + 1e-12);
  return out;
}

let pinkState = [0, 0, 0];
function pink() {
  const w = gauss();
  pinkState[0] = 0.99765 * pinkState[0] + w * 0.099046;
  pinkState[1] = 0.963 * pinkState[1] + w * 0.2965164;
  pinkState[2] = 0.57 * pinkState[2] + w * 1.0526913;
  return (pinkState[0] + pinkState[1] + pinkState[2] + w * 0.1848) * 0.2;
}

// จำลองเวลา durationMs; whistleOn(tSec) บอกว่าตอนนั้นมีนกหวีดไหม
function run({ durationMs, whistleOn = () => false, freq = 3100, whistleAmp = 0.3, noise = () => pink() * 0.15 }) {
  const d = new WhistleDetector();
  const triggers = [];
  for (let t = 0; t < durationMs; t += FRAME_MS) {
    const sig = (s) => noise() + (whistleOn(s) ? whistleAmp * Math.sin(2 * Math.PI * freq * s) * (1 + 0.3 * Math.sin(2 * Math.PI * 30 * s)) : 0);
    const r = d.process(spectrum(sig, t / 1000), SR, t);
    if (r.triggered) triggers.push(t);
  }
  return triggers;
}

test('crowd noise alone does not trigger', () => {
  assert.deepStrictEqual(run({ durationMs: 3000 }), []);
});

test('loud white noise does not trigger', () => {
  assert.deepStrictEqual(run({ durationMs: 2000, noise: () => gauss() * 0.4 }), []);
});

test('whistle over crowd noise triggers once', () => {
  const tr = run({ durationMs: 2500, whistleOn: (s) => s > 0.5 && s < 1.5 });
  assert.strictEqual(tr.length, 1);
  assert.ok(tr[0] > 600 && tr[0] < 800, 'trigger latency ' + tr[0]);
});

test('short squeak (80ms) is ignored', () => {
  const tr = run({ durationMs: 1500, freq: 2500, whistleOn: (s) => s > 0.5 && s < 0.58 });
  assert.deepStrictEqual(tr, []);
});

test('two separate whistles trigger twice', () => {
  const tr = run({ durationMs: 4500, whistleOn: (s) => (s > 0.3 && s < 0.8) || (s > 2.5 && s < 3.0) });
  assert.strictEqual(tr.length, 2);
});

test('tone outside the whistle band is ignored', () => {
  const tr = run({ durationMs: 1500, freq: 800, whistleOn: (s) => s > 0.3 && s < 1.2 });
  assert.deepStrictEqual(tr, []);
});
