/* app.js — เชื่อม UI กับ ShotClockController, เสียงบัซเซอร์ และไมโครโฟน */
(function () {
  'use strict';
  const { ShotClockController, PRESETS, formatShot, formatGame, periodLabel } = window.ShotClock;
  const { WhistleDetector } = window.Whistle;
  const $ = (id) => document.getElementById(id);

  // ---------- การตั้งค่า (จำไว้ในเบราว์เซอร์) ----------
  const STORE_KEY = 'autoShotClock.settings.v1';
  const defaults = {
    preset: 'fiba',
    shotFull: 24, shotShort: 14, periodMin: 10,
    stopOnShot: true,
    sens: 25, holdMs: 140, fmin: 1800, fmax: 4500,
  };
  let settings = Object.assign({}, defaults);
  try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { /* ไม่มี storage ก็ใช้ค่าเริ่มต้น */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };

  function clockConfig() {
    const p = PRESETS[settings.preset] || PRESETS.fiba;
    return {
      shotFull: settings.shotFull * 1000,
      shotShort: settings.shotShort * 1000,
      periodMs: settings.periodMin * 60000,
      periods: p.periods,
      overtimeMs: p.overtimeMs,
      stopGameOnShotExpire: settings.stopOnShot,
    };
  }
  const detectorConfig = () => ({
    prominenceDb: 50 - settings.sens, holdMs: settings.holdMs, minFreq: settings.fmin, maxFreq: settings.fmax,
  });

  const ctl = new ShotClockController({ config: clockConfig() });
  const detector = new WhistleDetector(detectorConfig());

  // ---------- เสียง ----------
  let audioCtx = null;
  let suppressUntil = 0; // ไม่ฟังนกหวีดขณะบัซเซอร์ดัง (กันไมค์ได้ยินเสียงตัวเอง)
  function ac() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function horn(seconds) {
    seconds = seconds || 1.0;
    const a = ac();
    const t = a.currentTime;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.setValueAtTime(0.25, t + seconds - 0.05);
    gain.gain.linearRampToValueAtTime(0, t + seconds);
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1500; // ตัดฮาร์มอนิกสูงไม่ให้ชนย่านนกหวีด
    lp.connect(gain).connect(a.destination);
    [233, 277, 349].forEach((f) => {
      const o = a.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(lp); o.start(t); o.stop(t + seconds);
    });
    suppressUntil = performance.now() + seconds * 1000 + 400;
  }

  // ---------- ไมโครโฟน ----------
  let mic = null; // { stream, analyser, buf, timer }
  async function micOn() {
    if (mic) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const a = ac();
      const src = a.createMediaStreamSource(stream);
      const analyser = a.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.2;
      src.connect(analyser);
      const buf = new Float32Array(analyser.frequencyBinCount);
      detector.reset();
      mic = { stream, analyser, buf, timer: setInterval(micTick, 16), sampleRate: a.sampleRate };
      setStatus('🎤 ไมค์เปิด — นาฬิกาจะหยุดเองเมื่อได้ยินนกหวีด');
    } catch (err) {
      setStatus('เปิดไมค์ไม่ได้: ' + (err && err.message ? err.message : err) + ' (ต้องเปิดผ่าน https หรือ localhost)');
    }
    render(true);
  }
  function micOff() {
    if (!mic) return;
    clearInterval(mic.timer);
    mic.stream.getTracks().forEach((t) => t.stop());
    mic = null;
    setStatus('ไมค์ปิด');
    render(true);
  }
  const micToggle = () => (mic ? micOff() : micOn());

  let hitFlashUntil = 0;
  function micTick() {
    if (!mic) return;
    mic.analyser.getFloatFrequencyData(mic.buf);
    const now = performance.now();
    if (now < suppressUntil) { detector.reset(); return; }
    const r = detector.process(mic.buf, mic.sampleRate, now);
    updateMeter(r);
    if (r.triggered) onWhistle(r);
  }

  function onWhistle(r) {
    hitFlashUntil = performance.now() + 800;
    const wasRunning = ctl.running || ctl.shot.running;
    const g = formatGame(ctl.game.remaining());
    const s = formatShot(ctl.shot.remaining());
    if (wasRunning) {
      ctl.stop('whistle');
      setStatus('🟠 ได้ยินนกหวีด (' + Math.round(r.peakFreq) + ' Hz) — หยุดนาฬิกาแล้ว · กด U ถ้าหยุดผิด');
    }
    addLog((wasRunning ? 'หยุด' : 'ได้ยิน') + ' · ' + periodLabel(ctl.period, ctl.cfg.periods) + ' ' + g + ' · ช็อต ' + s + ' · ' + Math.round(r.peakFreq) + ' Hz');
  }

  function updateMeter(r) {
    if (!$('dlg').open) return;
    const max = 50;
    $('meterBar').style.width = Math.max(0, Math.min(100, (r.prominence / max) * 100)) + '%';
    $('meterBar').style.background = r.tonal ? 'var(--warn)' : 'var(--ok)';
    $('meterMark').style.left = ((50 - settings.sens) / max) * 100 + '%';
    $('meterText').textContent =
      'ยอด ' + Math.round(r.peakFreq) + ' Hz · ' + r.peakDb.toFixed(0) + ' dB · โดดเด่น ' + r.prominence.toFixed(1) +
      ' dB (เกณฑ์ ' + (50 - settings.sens) + ')' + (r.holding ? ' · ค้าง ' + Math.round(r.holding) + ' ms' : '');
  }

  function addLog(text) {
    const li = document.createElement('li');
    li.textContent = new Date().toLocaleTimeString('th-TH') + ' — ' + text;
    $('log').prepend(li);
    while ($('log').children.length > 50) $('log').lastChild.remove();
  }

  // ---------- อีเวนต์ของนาฬิกา ----------
  ctl.on('shotexpired', () => { horn(1.0); setStatus('⏱ ช็อตคล็อคหมด (Shot clock violation)'); });
  ctl.on('gameexpired', () => { horn(1.6); setStatus('🏁 หมดเวลา ' + periodLabel(ctl.period, ctl.cfg.periods) + ' — กด N เพื่อไปควอเตอร์ถัดไป'); });

  // ---------- การแสดงผล ----------
  let statusText = '';
  function setStatus(t) { statusText = t; $('status').textContent = t; }

  let last = {};
  function render(force) {
    const s = ctl.snapshot();
    const shotTxt = s.shotOff ? '' : formatShot(s.shot);
    const view = {
      shot: shotTxt,
      game: formatGame(s.game),
      period: periodLabel(s.period, ctl.cfg.periods),
      running: s.running,
      shotRunning: s.shotRunning,
      off: s.shotOff,
      expired: s.shotExpired,
      undo: s.canUndo,
      mic: !!mic,
      hit: performance.now() < hitFlashUntil,
    };
    if (!force && Object.keys(view).every((k) => view[k] === last[k])) return;
    last = view;
    const shotEl = $('shot');
    shotEl.textContent = view.off ? '––' : view.shot;
    shotEl.classList.toggle('off', view.off);
    shotEl.classList.toggle('stopped', !view.shotRunning && !view.off);
    shotEl.classList.toggle('expired', view.expired);
    $('game').textContent = view.game;
    $('period').textContent = view.period;
    $('btnStartText').textContent = view.running ? '⏸ หยุด' : '▶ เริ่ม';
    $('btnStart').classList.toggle('running', view.running);
    $('btnUndo').disabled = !view.undo;
    $('btnMic').classList.toggle('on', view.mic);
    $('pillRun').classList.toggle('running', view.running);
    $('pillRun').classList.toggle('on', view.running);
    $('pillRunText').textContent = view.running ? 'กำลังเดิน' : 'หยุด';
    $('pillMic').classList.toggle('on', view.mic);
    $('pillMic').classList.toggle('hit', view.hit);
    $('pillMicText').textContent = view.mic ? (view.hit ? 'นกหวีด!' : 'ฟังนกหวีด') : 'ไมค์ปิด';
  }

  function loop() {
    ctl.tick();
    render(false);
    requestAnimationFrame(loop);
  }

  // ---------- คำสั่ง ----------
  const actions = {
    toggle: () => { ac(); ctl.toggle(); if (ctl.running) setStatus(mic ? '🎤 กำลังเดิน · ฟังนกหวีดอยู่' : 'กำลังเดิน'); else setStatus('หยุด'); keepAwake(); },
    r24: () => ctl.reset24(),
    r14: () => ctl.reset14(),
    r14less: () => ctl.reset14IfLess(),
    undo: () => { if (ctl.undoStop()) setStatus('↶ ยกเลิกการหยุด — เดินต่อตามเวลาจริง'); },
    shotUp: () => ctl.adjustShot(1000),
    shotDown: () => ctl.adjustShot(-1000),
    gameUp: () => ctl.adjustGame(1000),
    gameDown: () => ctl.adjustGame(-1000),
    period: () => { ctl.nextPeriod(); setStatus('เริ่ม ' + periodLabel(ctl.period, ctl.cfg.periods)); },
    horn: () => horn(0.8),
    mic: micToggle,
    full: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    },
  };
  const bind = (id, fn) => $(id).addEventListener('click', (e) => { e.currentTarget.blur(); fn(); render(true); });
  bind('btnStart', actions.toggle);
  bind('btn24', actions.r24);
  bind('btn14', actions.r14);
  bind('btnUndo', actions.undo);
  bind('btnMic', actions.mic);
  bind('btnShotUp', actions.shotUp);
  bind('btnShotDown', actions.shotDown);
  bind('btnGameUp', actions.gameUp);
  bind('btnGameDown', actions.gameDown);
  bind('btnPeriod', actions.period);
  bind('btnHorn', actions.horn);
  bind('btnFull', actions.full);
  $('btnSettings').addEventListener('click', () => { loadForm(); $('dlg').showModal(); });

  document.addEventListener('keydown', (e) => {
    if ($('dlg').open || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    let fn = null;
    if (e.code === 'Space') fn = actions.toggle;
    else if (k === 'r' || k === '2') fn = actions.r24;
    else if (k === 't' || k === '1') fn = e.shiftKey ? actions.r14less : actions.r14;
    else if (k === 'u') fn = actions.undo;
    else if (k === 'w') fn = actions.mic;
    else if (k === 'n') fn = actions.period;
    else if (k === 'b') fn = actions.horn;
    else if (k === 'f') fn = actions.full;
    else if (e.key === 'ArrowUp') fn = e.shiftKey ? actions.gameUp : actions.shotUp;
    else if (e.key === 'ArrowDown') fn = e.shiftKey ? actions.gameDown : actions.shotDown;
    if (fn) { e.preventDefault(); if (!e.repeat || e.key.startsWith('Arrow')) fn(); render(true); }
  });

  // ---------- ฟอร์มตั้งค่า ----------
  function loadForm() {
    $('setPreset').value = settings.preset;
    $('setShotFull').value = settings.shotFull;
    $('setShotShort').value = settings.shotShort;
    $('setPeriod').value = settings.periodMin;
    $('setStopOnShot').checked = settings.stopOnShot;
    $('setSens').value = settings.sens;
    $('setHold').value = settings.holdMs;
    $('setFmin').value = settings.fmin;
    $('setFmax').value = settings.fmax;
    $('meterMark').style.left = ((50 - settings.sens) / 50) * 100 + '%';
  }
  function num(id, lo, hi, fallback) {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  }
  function applyForm(e) {
    if (e && e.target.id === 'setPreset') {
      const p = PRESETS[$('setPreset').value];
      $('setShotFull').value = p.shotFull / 1000;
      $('setShotShort').value = p.shotShort / 1000;
      $('setPeriod').value = p.periodMs / 60000;
    }
    const periodChanged = num('setPeriod', 1, 30, settings.periodMin) !== settings.periodMin;
    settings = {
      preset: $('setPreset').value,
      shotFull: num('setShotFull', 5, 60, settings.shotFull),
      shotShort: num('setShotShort', 5, 60, settings.shotShort),
      periodMin: num('setPeriod', 1, 30, settings.periodMin),
      stopOnShot: $('setStopOnShot').checked,
      sens: num('setSens', 10, 40, settings.sens),
      holdMs: num('setHold', 40, 600, settings.holdMs),
      fmin: num('setFmin', 500, 8000, settings.fmin),
      fmax: num('setFmax', 1000, 12000, settings.fmax),
    };
    if (settings.shotShort > settings.shotFull) settings.shotShort = settings.shotFull;
    save();
    ctl.configure(clockConfig());
    detector.configure(detectorConfig());
    // ถ้านาฬิกายังไม่เคยเดินในควอเตอร์นี้ ให้ปรับเวลาตามค่าใหม่ทันที
    if (periodChanged && !ctl.running && ctl.period <= ctl.cfg.periods) ctl.setGame(ctl.cfg.periodMs);
    if (!ctl.running && ctl.shot.remaining() > ctl.cfg.shotFull) ctl.reset24();
    $('meterMark').style.left = ((50 - settings.sens) / 50) * 100 + '%';
    render(true);
  }
  $('dlg').addEventListener('input', applyForm);
  $('dlg').addEventListener('change', applyForm);
  $('btnNewGame').addEventListener('click', () => {
    if (confirm('เริ่มเกมใหม่? เวลาทั้งหมดจะถูกรีเซ็ต')) { ctl.newGame(); $('log').innerHTML = ''; setStatus('เกมใหม่'); render(true); }
  });

  // ---------- กันหน้าจอดับ ----------
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ctl.running) keepAwake(); });

  // เริ่มต้น
  ctl.newGame();
  render(true);
  requestAnimationFrame(loop);
  window.__shotclock = ctl; // สำหรับดีบัก
})();
