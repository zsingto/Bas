const test = require('node:test');
const assert = require('node:assert');
const { ShotClockController, formatShot, formatGame, periodLabel } = require('../js/clock.js');

function make(config) {
  let t = 0;
  const c = new ShotClockController({ now: () => t, config });
  return { c, adv: (ms) => { t += ms; return c.tick(); } };
}

test('start/stop runs game and shot together', () => {
  const { c, adv } = make();
  c.start();
  adv(3000);
  assert.strictEqual(c.shot.remaining(), 21000);
  assert.strictEqual(c.game.remaining(), 597000);
  c.stop();
  adv(5000);
  assert.strictEqual(c.shot.remaining(), 21000);
});

test('reset 24 / 14 while running keeps running', () => {
  const { c, adv } = make();
  c.start();
  adv(15000);
  c.reset14();
  assert.strictEqual(c.shot.remaining(), 14000);
  assert.ok(c.shot.running);
  c.reset24();
  adv(1000);
  assert.strictEqual(c.shot.remaining(), 23000);
});

test('reset14IfLess follows FIBA rule', () => {
  const { c, adv } = make();
  c.start();
  adv(5000); // 19 left
  c.reset14IfLess();
  assert.strictEqual(c.shot.remaining(), 19000);
  adv(8000); // 11 left
  c.reset14IfLess();
  assert.strictEqual(c.shot.remaining(), 14000);
});

test('shot expiry fires once and stops game when configured', () => {
  const { c, adv } = make();
  let n = 0;
  c.on('shotexpired', () => n++);
  c.start();
  adv(24000);
  adv(100);
  assert.strictEqual(n, 1);
  assert.strictEqual(c.running, false);
  assert.strictEqual(c.game.remaining(), 576000);
});

test('shot expiry keeps game running when option off', () => {
  const { c, adv } = make({ stopGameOnShotExpire: false });
  c.start();
  adv(25000);
  assert.strictEqual(c.running, true);
  assert.strictEqual(c.shot.remaining(), 0);
  c.reset24(); // after reset shot restarts with game
  adv(1000);
  assert.strictEqual(c.shot.remaining(), 23000);
});

test('game expiry stops everything', () => {
  const { c, adv } = make({ periodMs: 10000 });
  let ended = false;
  c.on('gameexpired', () => (ended = true));
  c.start();
  adv(10500);
  assert.ok(ended);
  assert.strictEqual(c.running, false);
  assert.strictEqual(c.game.remaining(), 0);
  assert.strictEqual(c.start(), false);
});

test('shot clock off when game time is lower', () => {
  const { c } = make({ periodMs: 20000 });
  assert.strictEqual(c.shotOff(), true);
  c.reset14();
  assert.strictEqual(c.shotOff(), false);
});

test('undoStop resumes as if never stopped', () => {
  const { c, adv } = make();
  c.start();
  adv(4000);
  c.stop('whistle');
  adv(1500);
  assert.ok(c.undoStop());
  assert.strictEqual(c.shot.remaining(), 18500);
  assert.strictEqual(c.game.remaining(), 594500);
  assert.ok(c.running);
});

test('next period and overtime', () => {
  const { c } = make();
  for (let i = 0; i < 4; i++) c.nextPeriod();
  assert.strictEqual(c.period, 5);
  assert.strictEqual(c.game.remaining(), 300000);
  assert.strictEqual(periodLabel(5, 4), 'OT');
  assert.strictEqual(periodLabel(6, 4), 'OT2');
});

test('formatting', () => {
  assert.strictEqual(formatShot(24000), '24');
  assert.strictEqual(formatShot(23001), '24');
  assert.strictEqual(formatShot(5000), '5');
  assert.strictEqual(formatShot(4999), '4.9');
  assert.strictEqual(formatShot(0), '0');
  assert.strictEqual(formatGame(600000), '10:00');
  assert.strictEqual(formatGame(61000), '1:01');
  assert.strictEqual(formatGame(59950), '59.9');
});
