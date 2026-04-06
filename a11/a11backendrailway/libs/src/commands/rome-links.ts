import { computeRomeLinks, writeRomeLinks } from '../rome/linker.js';

export async function runRomeLinks(argv?: string[]) {
  const projectRoot = process.cwd();
  const links = computeRomeLinks(projectRoot);
  writeRomeLinks(projectRoot, links);
  console.log(`rome-links: ${links.length} references enregistrées.`);
  if (argv && argv.includes('--interactive')) {
    console.log('interactive mode not implemented in CLI stub.');
  }
  return 0;
}

export default runRomeLinks;
