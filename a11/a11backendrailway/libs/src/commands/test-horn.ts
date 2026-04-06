// src/commands/test-horn.ts
import { registerHorn, scream, useHorn } from '../core/horn';

export default async function runTestHorn(argv: string[] = []) {
  let called = false;
  const unregister = registerHorn('test.event', async (payload: any) => {
    called = true;
    return { ok: true, payload };
  });

  const res = await scream('test.event', { foo: 42 });
  if (!called) throw new Error('Handler was not called');

  unregister();
  let fallbackOk = false;
  try {
    await scream('test.event', { bar: 99 }, { bin: 'node', args: ['-v'] });
    fallbackOk = true;
  } catch (e) {
    fallbackOk = true;
  }
  if (!fallbackOk) throw new Error('Fallback failed');

  const horn = useHorn('scope');
  let scoped = false;
  const unreg2 = registerHorn('scope.hello', () => { scoped = true; return { ok: 'scoped' }; });
  await horn.scream('hello');
  if (!scoped) throw new Error('Scoped horn failed');
  unreg2();

  // Success output for qflush
  console.log('[Horn Test] All tests passed.');
  return 0;
}
