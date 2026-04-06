import vision from '../cortex/vision.js';

export default async function runVision(argv: string[] = []) {
  const file = argv[0];
  if (!file) {
    console.log('usage: qflush vision <png-path>');
    return 1;
  }
  try {
    const res = await vision.processVisionImage(file);
    console.log('vision processed, output written to .qflush/spyder-vision.json');
    return 0;
  } catch (e) {
    console.error('vision failed', e);
    return 2;
  }
}
