// compile-mask-to-python.cjs
// Compile MASK to Python code (V1, simple mapping)

function compileMaskToPython(mask) {
  // Support filesystem.sort_images
  if (mask.task.domain === 'filesystem' && mask.task.action === 'sort_images') {
    const { path, extensions, recursive } = mask.inputs || {};
    const sortBy = mask.options && mask.options.sort_by ? mask.options.sort_by : 'name';
    if (!path) {
      throw new Error('MASK.inputs.path required');
    }
    // Build Python code
    let code = [
      'import os',
      'from pathlib import Path',
      '',
      `search_path = r'''${path}'''`,
      `extensions = {}`,
      `recursive = {}`,
      '',
      'def list_images(path, extensions, recursive):',
      '    p = Path(path)',
      '    if recursive:',
      '        files = list(p.rglob("*"))',
      '    else:',
      '        files = list(p.glob("*"))',
      '    images = [str(f) for f in files if f.is_file() and (not extensions or f.suffix.lower() in extensions)]',
      '    return images',
      '',
      'images = list_images(search_path, set(extensions), recursive)',
      '',
    ];
    // Sorting
    if (sortBy === 'mtime') {
      code.push('images.sort(key=lambda x: os.path.getmtime(x))');
    } else if (sortBy === 'size') {
      code.push('images.sort(key=lambda x: os.path.getsize(x))');
    } else {
      code.push('images.sort()');
    }
    code.push('for img in images:');
    code.push('    print(img)');
    // Fill extensions and recursive
    const extList = Array.isArray(extensions) ? extensions.map(e => e.startsWith('.') ? e.toLowerCase() : '.' + e.toLowerCase()) : [];
    code = code.map(line =>
      line.replace('extensions = {}', `extensions = ${JSON.stringify(extList)}`)
          .replace('recursive = {}', `recursive = ${!!recursive}`)
    );
    return code.join('\n');
  }
  throw new Error('Unsupported task for MASK → Python');
}

module.exports = compileMaskToPython;
