const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildQflushRgbaMultiload,
  buildQflushRgbaPacket,
  buildShiryuZenRgba,
  getQflushRgbaCubeSpec,
} = require('../src/qflush-rgba-cube.cjs');
const { runQflushFlow } = require('../src/qflush-integration.cjs');

test('Qflush RGBA cube routes payloads to memory, tools, data and orchestration faces', () => {
  const memory = buildQflushRgbaPacket({ payload: 'Resume cette conversation.' });
  const tool = buildQflushRgbaPacket({ payload: { tool: 'fs.search', q: 'qflush' } });
  const data = buildQflushRgbaPacket({ payload: { filename: 'logo.png' }, contentType: 'image/png' });
  const orchestration = buildQflushRgbaPacket({ payload: { flow: 'a11.chat.v1', steps: ['draft', 'rewrite'] } });

  assert.equal(memory.face, 'R');
  assert.equal(memory.faceName, 'memory');
  assert.equal(tool.face, 'G');
  assert.equal(tool.faceName, 'tools');
  assert.equal(data.face, 'B');
  assert.equal(data.faceName, 'data');
  assert.equal(orchestration.face, 'A');
  assert.equal(orchestration.faceName, 'orchestration');
});

test('Qflush RGBA cube sorts by priority then stable face order', () => {
  const plan = buildQflushRgbaMultiload([
    { payload: 'message public', priority: 'basic' },
    { payload: { filename: 'capture.png' }, contentType: 'image/png', priority: 'premium' },
    { payload: { tool: 'terminal.guard' }, priority: 'admin' },
  ]);

  assert.equal(plan.ok, true);
  assert.equal(plan.count, 3);
  assert.equal(plan.packets[0].face, 'G');
  assert.equal(plan.packets[0].route.priority, 245);
  assert.equal(plan.packets[1].face, 'B');
  assert.equal(plan.packets[1].route.priority, 210);
  assert.equal(plan.packets[2].face, 'R');
  assert.equal(plan.packets[2].route.priority, 95);
});

test('Qflush RGBA cube deduplicates repeated files in the same session', () => {
  const plan = buildQflushRgbaMultiload([
    { sessionId: 'conv-1', payload: { filename: 'same.png', mediaUrl: '/files/same.png' }, contentType: 'image/png' },
    { sessionId: 'conv-1', payload: { filename: 'same.png', mediaUrl: '/files/same.png' }, contentType: 'image/png' },
    { sessionId: 'conv-2', payload: { filename: 'same.png', mediaUrl: '/files/same.png' }, contentType: 'image/png' },
  ]);

  assert.equal(plan.count, 2);
  assert.equal(plan.droppedDuplicates, 1);
  assert.equal(plan.duplicates[0].duplicateOf, plan.packets.find((packet) => packet.sessionId === 'conv-1').id);
});

test('Qflush RGBA cube exposes a compact public spec', () => {
  const spec = getQflushRgbaCubeSpec();

  assert.equal(spec.ok, true);
  assert.equal(spec.schema, 'nossen.qflush.rgba_cube.v1');
  assert.deepEqual(Object.keys(spec.faces).sort(), ['A', 'B', 'G', 'R']);
  assert.ok(spec.flows.includes('qflush.rgba.multiload.v1'));
  assert.ok(spec.flows.includes('qflush.shiryu.zen_rgba.v1'));
  assert.match(spec.modules.shiryu, /JSON to zen RGBA/i);
});

test('Shiryu blade sculpts JSON into zen RGBA with bounded deterministic noise', () => {
  const input = {
    sessionId: 'conv-shiryu',
    message: 'allo pourquoi tu repetes ?',
    history: [
      { role: 'assistant', content: 'ancienne réponse outil/canevas' },
      { role: 'user', content: 'chrome et workspace pour vivy' },
    ],
    payload: { route: 'vivy.chat', reason: 'smoke_cut' },
    intent: 'cut stale workspace smoke',
  };
  const first = buildShiryuZenRgba(input);
  const second = buildShiryuZenRgba(input);

  assert.equal(first.ok, true);
  assert.equal(first.schema, 'nossen.shiryu.zen_rgba.v1');
  assert.equal(first.blade, 'blood-rain');
  assert.equal(first.zen.currentFirst, true);
  assert.equal(first.zen.historyIsContextOnly, true);
  assert.deepEqual(first.controlledNoise, second.controlledNoise);
  assert.deepEqual(first.sculptedRgba, second.sculptedRgba);
  assert.ok(Object.values(first.controlledNoise).every((value) => value >= -8 && value <= 8));
  assert.equal(first.plan.packets.some((packet) => packet.source === 'shiryu.current'), true);
  assert.equal(first.plan.packets.some((packet) => packet.source === 'shiryu.json'), true);
});

test('runQflushFlow supports qflush.rgba.multiload.v1 as a local fallback without previews by default', async () => {
  const result = await runQflushFlow('qflush.rgba.multiload.v1', {
    sessionId: 'conv-flow',
    accountTier: 'family',
    items: [
      { payload: 'texte de test' },
      { payload: { filename: 'capture.png' }, contentType: 'image/png' },
      { payload: { filename: 'capture.png' }, contentType: 'image/png' },
    ],
  }, { requestId: 'req-rgba-cube' });

  assert.equal(result.ok, true);
  assert.equal(result.flow, 'qflush.rgba.multiload.v1');
  assert.equal(result.provider, 'local-qflush-fallback');
  assert.equal(result.count, 2);
  assert.equal(result.droppedDuplicates, 1);
  assert.equal(result.packets.every((packet) => packet.preview === null), true);
});

test('runQflushFlow supports qflush.shiryu.zen_rgba.v1 as a local fallback', async () => {
  const result = await runQflushFlow('qflush.shiryu.zen_rgba.v1', {
    sessionId: 'conv-flow-shiryu',
    message: 'allo ?',
    payload: { json: true, smoke: 'workspace history' },
    intent: 'conversation smoke cutter',
  }, { requestId: 'req-shiryu-rgba' });

  assert.equal(result.ok, true);
  assert.equal(result.flow, 'qflush.shiryu.zen_rgba.v1');
  assert.equal(result.provider, 'local-qflush-fallback');
  assert.equal(result.schema, 'nossen.shiryu.zen_rgba.v1');
  assert.equal(result.zen.currentFirst, true);
  assert.match(result.principle, /rgba-controlled-noise/);
});
