/*
 * clock.js — ตรรกะของนาฬิกาเกมและช็อตคล็อค (ไม่ผูกกับ UI ทดสอบได้ด้วย Node)
 *
 * เวลาคำนวณจากนาฬิกาอ้างอิง (performance.now) ไม่ได้นับทีละ tick
 * จึงไม่คลาดเคลื่อนแม้เบราว์เซอร์จะหน่วงเฟรม
 */
(function (root) {
  'use strict';

  class Clock {
    constructor(ms, now) {
      this.now = now;
      this.base = Math.max(0, ms); // เวลาที่เหลือ ณ ตอนเริ่มเดิน (หรือค่าปัจจุบันถ้าหยุดอยู่)
      this.t0 = 0;
      this.running = false;
    }
    remaining() {
      if (!this.running) return this.base;
      return Math.max(0, this.base - (this.now() - this.t0));
    }
    start() {
      if (this.running || this.base <= 0) return false;
      this.t0 = this.now();
      this.running = true;
      return true;
    }
    stop() {
      if (!this.running) return false;
      this.base = this.remaining();
      this.running = false;
      return true;
    }
    set(ms) {
      this.base = Math.max(0, ms);
      if (this.running) this.t0 = this.now();
    }
    add(ms) {
      this.set(this.remaining() + ms);
    }
  }

  const PRESETS = {
    fiba: { name: 'FIBA', shotFull: 24000, shotShort: 14000, periodMs: 10 * 60000, periods: 4, overtimeMs: 5 * 60000 },
    nba: { name: 'NBA', shotFull: 24000, shotShort: 14000, periodMs: 12 * 60000, periods: 4, overtimeMs: 5 * 60000 },
    fiba3x3: { name: 'FIBA 3x3', shotFull: 12000, shotShort: 12000, periodMs: 10 * 60000, periods: 1, overtimeMs: 0 },
  };

  const DEFAULT_CONFIG = Object.assign({}, PRESETS.fiba, {
    stopGameOnShotExpire: true, // หยุดเกมคล็อคเมื่อช็อตคล็อคหมด
  });

  class ShotClockController {
    constructor(opts) {
      opts = opts || {};
      this.now = opts.now || (() => performance.now());
      this.cfg = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
      this.shot = new Clock(this.cfg.shotFull, this.now);
      this.game = new Clock(this.cfg.periodMs, this.now);
      this.period = 1;
      this.shotExpired = false;
      this.lastStop = null; // ใช้สำหรับ "ยกเลิก" การหยุดที่ผิดพลาด
      this.listeners = {};
    }

    on(ev, fn) {
      (this.listeners[ev] = this.listeners[ev] || []).push(fn);
      return this;
    }
    emit(ev, data) {
      (this.listeners[ev] || []).forEach((fn) => fn(data));
    }

    get running() {
      return this.game.running;
    }

    configure(cfg) {
      this.cfg = Object.assign({}, this.cfg, cfg);
      this.emit('change');
    }

    start() {
      if (this.game.remaining() <= 0) return false;
      this.game.start();
      if (this.shot.remaining() > 0) this.shot.start();
      this.lastStop = null;
      this.emit('start');
      this.emit('change');
      return true;
    }

    stop(reason) {
      if (!this.game.running && !this.shot.running) return false;
      const shotWasRunning = this.shot.running;
      this.game.stop();
      this.shot.stop();
      this.lastStop = { at: this.now(), reason: reason || 'manual', shotWasRunning };
      this.emit('stop', { reason: reason || 'manual' });
      this.emit('change');
      return true;
    }

    toggle() {
      return this.running ? this.stop('manual') : this.start();
    }

    /** ยกเลิกการหยุดล่าสุด: เดินต่อเหมือนไม่เคยหยุด (หักเวลาที่หยุดไปออก) */
    undoStop() {
      const s = this.lastStop;
      if (!s || this.running) return false;
      const elapsed = this.now() - s.at;
      this.game.set(this.game.remaining() - elapsed);
      if (s.shotWasRunning) this.shot.set(this.shot.remaining() - elapsed);
      this.lastStop = null;
      if (this.game.remaining() <= 0) return false;
      this.game.start();
      if (s.shotWasRunning && this.shot.remaining() > 0) this.shot.start();
      this.emit('start');
      this.emit('change');
      return true;
    }

    resetShot(ms) {
      this.shot.set(Math.min(ms, this.cfg.shotFull));
      this.shotExpired = false;
      // ช็อตคล็อคเดินตามเกมคล็อค
      if (this.game.running) this.shot.start();
      this.emit('shotreset', ms);
      this.emit('change');
    }
    reset24() {
      this.resetShot(this.cfg.shotFull);
    }
    reset14() {
      this.resetShot(this.cfg.shotShort);
    }
    /** กติกา FIBA: ฟาวล์/ฟาวล์ในแดนหน้า ถ้าเหลือ ≥14 ไม่รีเซ็ต ถ้าน้อยกว่ารีเซ็ตเป็น 14 */
    reset14IfLess() {
      if (this.shot.remaining() < this.cfg.shotShort) this.reset14();
    }

    adjustShot(ms) {
      const v = Math.min(this.cfg.shotFull, Math.max(0, this.shot.remaining() + ms));
      this.shot.set(v);
      if (v > 0) this.shotExpired = false;
      if (v > 0 && this.game.running) this.shot.start();
      this.emit('change');
    }
    adjustGame(ms) {
      this.game.set(this.game.remaining() + ms);
      this.emit('change');
    }
    setGame(ms) {
      this.game.set(ms);
      this.emit('change');
    }

    nextPeriod() {
      this.stop('period');
      this.period += 1;
      this.game.set(this.period > this.cfg.periods ? this.cfg.overtimeMs : this.cfg.periodMs);
      this.resetShot(this.cfg.shotFull);
      this.lastStop = null;
      this.emit('change');
    }

    newGame() {
      this.stop('reset');
      this.period = 1;
      this.game.set(this.cfg.periodMs);
      this.resetShot(this.cfg.shotFull);
      this.lastStop = null;
      this.emit('change');
    }

    /** กติกา: ปิดช็อตคล็อคเมื่อเวลาเกมเหลือน้อยกว่าช็อตคล็อค */
    shotOff() {
      return this.game.remaining() < this.shot.remaining();
    }

    /** เรียกทุกเฟรม ตรวจเวลาหมดและส่งอีเวนต์ */
    tick() {
      const g = this.game.remaining();
      const s = this.shot.remaining();

      if (this.game.running && g <= 0) {
        this.game.stop();
        this.shot.stop();
        this.lastStop = null;
        this.emit('gameexpired');
        this.emit('change');
      } else if (this.shot.running && s <= 0) {
        this.shot.stop();
        if (!this.shotExpired) {
          this.shotExpired = true;
          this.emit('shotexpired');
          if (this.cfg.stopGameOnShotExpire) {
            this.game.stop();
            this.lastStop = null;
          }
          this.emit('change');
        }
      }
      return { game: this.game.remaining(), shot: this.shot.remaining() };
    }

    snapshot() {
      return {
        game: this.game.remaining(),
        shot: this.shot.remaining(),
        running: this.running,
        shotRunning: this.shot.running,
        period: this.period,
        shotOff: this.shotOff(),
        shotExpired: this.shotExpired,
        canUndo: !!this.lastStop && !this.running,
      };
    }
  }

  /** ช็อตคล็อค: แสดงวินาทีปัดขึ้น, ต่ำกว่า 5 วิ แสดงทศนิยม 1 ตำแหน่ง */
  function formatShot(ms) {
    if (ms <= 0) return '0';
    if (ms < 5000) return (Math.floor(ms / 100) / 10).toFixed(1);
    return String(Math.ceil(ms / 1000));
  }

  /** เกมคล็อค: mm:ss, ต่ำกว่า 1 นาที แสดง ss.t */
  function formatGame(ms) {
    if (ms <= 0) return '0.0';
    if (ms < 60000) return (Math.floor(ms / 100) / 10).toFixed(1);
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function periodLabel(period, periods) {
    if (period <= periods) return 'Q' + period;
    const ot = period - periods;
    return ot === 1 ? 'OT' : 'OT' + ot;
  }

  const api = { Clock, ShotClockController, PRESETS, DEFAULT_CONFIG, formatShot, formatGame, periodLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShotClock = api;
})(typeof window !== 'undefined' ? window : globalThis);
