/*
 * whistle.js — ตรวจจับเสียงนกหวีดผู้ตัดสินจากสเปกตรัมความถี่ (FFT)
 *
 * หลักการ: นกหวีดกรรมการ (เช่น Fox 40) เป็นเสียงโทนเดียวที่ดังมาก
 * ช่วงประมาณ 2–4.5 kHz ส่วนเสียงคนดู/เสียงลูกบอลเป็นเสียงกว้าง (broadband)
 * เราจึงหา "ยอด" ในย่านนกหวีด แล้ววัดว่ายอดนั้นสูงกว่าค่ามัธยฐานของสเปกตรัม
 * (prominence) มากแค่ไหน ถ้าโดดเด่นต่อเนื่องนานพอ (holdMs) ถือว่าเป็นนกหวีด
 * การกำหนดเวลาขั้นต่ำช่วยตัดเสียงสั้น ๆ เช่น เสียงรองเท้าเสียดพื้น
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    minFreq: 1800, // Hz
    maxFreq: 4500, // Hz
    refMinFreq: 300, // ย่านอ้างอิงสำหรับหาค่าพื้นหลัง
    refMaxFreq: 10000,
    minDb: -60, // ความดังขั้นต่ำของยอด (dBFS จาก AnalyserNode)
    prominenceDb: 25, // ยอดต้องสูงกว่ามัธยฐานกี่ dB (ยิ่งน้อยยิ่งไว)
    holdMs: 140, // ต้องดังต่อเนื่องนานเท่าไร
    gapMs: 60, // ยอมให้เสียงขาดช่วงสั้น ๆ (นกหวีดแบบมีลูกกลิ้งเสียงจะสั่น)
    cooldownMs: 1200, // หลังตรวจพบ รอเท่าไรก่อนตรวจครั้งถัดไป
  };

  function median(arr) {
    const a = Array.from(arr).sort((x, y) => x - y);
    const n = a.length;
    if (!n) return -Infinity;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  class WhistleDetector {
    constructor(opts) {
      this.opts = Object.assign({}, DEFAULTS, opts || {});
      this.reset();
    }

    configure(opts) {
      Object.assign(this.opts, opts);
    }

    reset() {
      this.onsetAt = null;
      this.lastTonalAt = -Infinity;
      this.lastTriggerAt = -Infinity;
      this.latched = false;
    }

    /**
     * วิเคราะห์สเปกตรัมหนึ่งเฟรม
     * @param {Float32Array|number[]} spectrumDb ค่า dB ต่อ bin (จาก getFloatFrequencyData)
     * @param {number} sampleRate
     */
    analyze(spectrumDb, sampleRate) {
      const o = this.opts;
      const n = spectrumDb.length;
      const binHz = sampleRate / 2 / n;
      const lo = Math.max(1, Math.ceil(o.minFreq / binHz));
      const hi = Math.min(n - 1, Math.floor(o.maxFreq / binHz));

      let peakIdx = lo;
      let peakDb = -Infinity;
      for (let i = lo; i <= hi; i++) {
        const v = spectrumDb[i];
        if (v > peakDb) {
          peakDb = v;
          peakIdx = i;
        }
      }

      const rLo = Math.max(1, Math.ceil(o.refMinFreq / binHz));
      const rHi = Math.min(n - 1, Math.floor(o.refMaxFreq / binHz));
      const ref = [];
      for (let i = rLo; i <= rHi; i++) {
        const v = spectrumDb[i];
        if (Number.isFinite(v)) ref.push(v);
      }
      const floorDb = median(ref);
      const prominence = Number.isFinite(peakDb) && Number.isFinite(floorDb) ? peakDb - floorDb : 0;
      const tonal = peakDb >= o.minDb && prominence >= o.prominenceDb;

      return { tonal, peakFreq: peakIdx * binHz, peakDb, floorDb, prominence };
    }

    /**
     * ป้อนเฟรมใหม่ คืนค่า { triggered, ...analysis }
     * @param {number} t เวลาปัจจุบัน (ms)
     */
    process(spectrumDb, sampleRate, t) {
      const a = this.analyze(spectrumDb, sampleRate);
      const o = this.opts;
      let triggered = false;

      if (a.tonal) {
        if (this.onsetAt === null) this.onsetAt = t;
        this.lastTonalAt = t;
        const held = t - this.onsetAt;
        if (!this.latched && held >= o.holdMs && t - this.lastTriggerAt >= o.cooldownMs) {
          triggered = true;
          this.latched = true; // นกหวีดยาวหนึ่งครั้ง = ทริกเกอร์ครั้งเดียว
          this.lastTriggerAt = t;
        }
      } else if (t - this.lastTonalAt > o.gapMs) {
        this.onsetAt = null;
        this.latched = false;
      }

      a.triggered = triggered;
      a.holding = this.onsetAt !== null ? t - this.onsetAt : 0;
      return a;
    }
  }

  const api = { WhistleDetector, WHISTLE_DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Whistle = api;
})(typeof window !== 'undefined' ? window : globalThis);
