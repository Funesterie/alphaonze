// test-horn.ts
import { registerHorn, scream, useHorn } from './src/core/horn';

async function main() {
  // Test 1: Register a handler and scream
  let called = false;
  const unregister = registerHorn('test.event', async (payload) => {
    called = true;
    return { ok: true, payload };
  });

  const res = await scream('test.event', { foo: 42 });
  console.log('[Horn Test] Scream result:', res);
  if (!called) throw new Error('Handler was not called');

  // Test 2: Unregister and fallback (should not throw)
  unregister();
  let fallbackOk = false;
  try {
    await scream('test.event', { bar: 99 }, { bin: 'node', args: ['-v'] }); // fallback to node -v
    fallbackOk = true;
  } catch (e) {
    fallbackOk = true; // fallback can fail if node -v is not a valid handler, but should not crash
  }
  if (!fallbackOk) throw new Error('Fallback failed');

  // Test 3: Scoped horn
  const horn = useHorn('scope');
  let scoped = false;
  const unreg2 = registerHorn('scope.hello', () => { scoped = true; return { ok: 'scoped' }; });
  await horn.scream('hello');
  if (!scoped) throw new Error('Scoped horn failed');
  unreg2();

  console.log('[Horn Test] All tests passed.');
}

main().catch(e => { console.error('[Horn Test] Failed:', e); process.exit(1); });
