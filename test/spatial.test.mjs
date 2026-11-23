import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/spatial.js';

const near = (a, b, e = 1.5) => assert.ok(Math.abs(S.normAngle(a - b)) <= e, `${a} ≉ ${b}`);

test('κάμερα προς βορρά (όρθιο κινητό)', () => near(S.cameraDirection(0, 90, 0).heading, 0));
test('κάμερα προς ανατολή (alpha=270)', () => near(S.cameraDirection(270, 90, 0).heading, 90));
test('κάμερα προς νότο (alpha=180)', () => near(S.cameraDirection(180, 90, 0).heading, 180));
test('κάμερα προς δύση (alpha=90)', () => near(S.cameraDirection(90, 90, 0).heading, 270));
test('οριζόντιο κινητό → άγνωστο heading', () => assert.equal(S.cameraDirection(0, 0, 0).heading, null));
test('pitch όρθιο ≈ 0', () => assert.ok(Math.abs(S.cameraDirection(0, 90, 0).pitch) < 1));
test('hfov πορτραίτο < μεγάλης πλευράς', () => assert.ok(S.horizontalFov(66, 720, 1280) < 66 && S.horizontalFov(66, 1280, 720) === 66));
test('clock', () => { assert.equal(S.clockPosition(0), 12); assert.equal(S.clockPosition(90), 3); assert.equal(S.clockPosition(-90), 9); assert.equal(S.clockPosition(180), 6); });
test('describeRelative', () => { assert.equal(S.describeRelative(5), 'ευθεία μπροστά'); assert.equal(S.describeRelative(-90), 'αριστερά σας'); assert.equal(S.describeRelative(180), 'πίσω σας'); });
test('turnInstruction', () => { assert.equal(S.turnInstruction(43), 'γυρίστε δεξιά 40 μοίρες'); assert.equal(S.turnInstruction(-100), 'γυρίστε αριστερά 100 μοίρες'); assert.equal(S.turnInstruction(2), 'ευθεία μπροστά'); });
test('απόσταση άνθρωπου', () => {
  // άνθρωπος 1.7m, bbox ύψους 400px σε καρέ 720x1280, f≈ (360)/tan(hfov/2)
  const hfov = S.horizontalFov(66, 720, 1280);
  const d = S.estimateDistance('person', { x: 200, y: 400, w: 200, h: 400 }, 720, 1280, hfov);
  assert.ok(d > 1 && d < 5, String(d));
  const d2 = S.estimateDistance('person', { x: 200, y: 400, w: 100, h: 200 }, 720, 1280, hfov);
  assert.ok(d2 > d * 1.7);
});
test('bboxAngle κέντρο = 0', () => assert.ok(Math.abs(S.bboxAngle({ x: 310, y: 0, w: 100, h: 100 }, 720, 50))<0.01));
test('geoVector βορράς', () => { const v = S.geoVector(37, 22, 37.001, 22); assert.ok(Math.abs(v.distance - 111) < 2); near(v.bearing, 0); });
test('geoVector ανατολή', () => { const v = S.geoVector(37, 22, 37, 22.001); near(v.bearing, 90); });
test('describeAge', () => { assert.equal(S.describeAge(5000), 'μόλις τώρα'); assert.equal(S.describeAge(600000), 'πριν 10 λεπτά'); });
test('describeDistance', () => { assert.equal(S.describeDistance(0.3), 'πολύ κοντά'); assert.equal(S.describeDistance(2.1), 'σε περίπου 2 μέτρα'); });
