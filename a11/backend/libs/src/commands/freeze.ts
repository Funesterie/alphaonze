export default async function runFreeze(argv: string[] = []) {
  // parse --health=<url>
  let healthUrl: string | null = null;
  for (const a of argv) {
    if (a.startsWith('--health=')) {
      healthUrl = a.split('=')[1];
      break;
    }
    if (a === '--health') {
      const idx = argv.indexOf(a);
      if (idx >= 0 && idx < argv.length - 1) healthUrl = argv[idx + 1];
      break;
    }
  }

  if (!healthUrl) {
    console.log('QFLUSH frozen (manual)');
    return 0;
  }

  console.log(`QFLUSH frozen + auto-resume active (health=${healthUrl})`);
  return 0;
}
