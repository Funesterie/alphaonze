const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  hasSdProxyUrl,
  resolveSdScriptPath,
  resolveSdPythonBin,
  isForeignAbsolutePath,
  shouldAllowLocalSdFallback,
  runSdScript,
  sanitizeProxyHeaders,
} = require('../lib/sd-runtime.cjs');

test('sd and vision requirements pin torchvision 0.27.0 for the torch 2.12 runtime', () => {
  const sdRequirements = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'sd', 'requirements.txt'),
    'utf8'
  );
  const visionRequirements = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'vision', 'requirements.txt'),
    'utf8'
  );

  assert.match(sdRequirements, /^torch==2\.12\.0\s*$/m);
  assert.match(sdRequirements, /^torchvision==0\.27\.0\s*$/m);
  assert.match(visionRequirements, /^torchvision==0\.27\.0\s*$/m);
});

test('local SD venv imports torch and torchvision when the bundled venv exists', { skip: !fs.existsSync(resolveSdPythonBin()) }, () => {
  const pythonBin = resolveSdPythonBin();
  const result = spawnSync(
    pythonBin,
    ['-c', 'import torch, torchvision; print(torch.__version__, torchvision.__version__)'],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(String(result.stdout || ''), /\d+\.\d+\.\d+/);
});

test('resolveSdPythonBin ignores a stale explicit path when a local adjacent venv exists', () => {
  const previousExplicit = process.env.SD_PYTHON_PATH;
  const previousFallbackFlag = process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-runtime-'));
  const scriptPath = path.join(tempRoot, 'generate_sd_image.py');
  const pythonPath = path.join(
    tempRoot,
    'venv',
    process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
  );

  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(scriptPath, '# test script\n', 'utf8');
  fs.writeFileSync(pythonPath, '', 'utf8');

  try {
    process.env.SD_PYTHON_PATH = path.join(tempRoot, 'missing', 'python.exe');
    process.env.A11_SD_ALLOW_LOCAL_FALLBACK = '1';

    assert.equal(resolveSdPythonBin(scriptPath), pythonPath);
  } finally {
    if (previousExplicit === undefined) delete process.env.SD_PYTHON_PATH;
    else process.env.SD_PYTHON_PATH = previousExplicit;

    if (previousFallbackFlag === undefined) delete process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
    else process.env.A11_SD_ALLOW_LOCAL_FALLBACK = previousFallbackFlag;

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('isForeignAbsolutePath treats windows absolute paths as foreign on linux runtimes', () => {
  const previousPlatform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.equal(isForeignAbsolutePath('D:\\funesterie\\a11\\llm\\scripts\\venv\\Scripts\\python.exe'), true);
    assert.equal(isForeignAbsolutePath('C:/Users/cella/Desktop/LLM/scripts/generate_sd_image.py'), true);
    assert.equal(isForeignAbsolutePath('/app/tools/sd/generate_sd_image.py'), false);
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
  }
});

test('resolveSdPythonBin ignores a windows explicit path on linux runtimes', () => {
  const previousExplicit = process.env.SD_PYTHON_PATH;
  const previousFallbackFlag = process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
  const previousPlatform = process.platform;

  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.SD_PYTHON_PATH = 'D:\\funesterie\\a11\\launchers\\dist\\a11-local\\llm\\scripts\\venv\\Scripts\\python.exe';
    process.env.A11_SD_ALLOW_LOCAL_FALLBACK = '1';

    assert.equal(resolveSdPythonBin('/app/tools/sd/generate_sd_image.py'), 'python3');
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
    if (previousExplicit === undefined) delete process.env.SD_PYTHON_PATH;
    else process.env.SD_PYTHON_PATH = previousExplicit;

    if (previousFallbackFlag === undefined) delete process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
    else process.env.A11_SD_ALLOW_LOCAL_FALLBACK = previousFallbackFlag;
  }
});

test('resolveSdScriptPath ignores a windows explicit path on linux runtimes', () => {
  const previousExplicit = process.env.SD_SCRIPT_PATH;
  const previousFallbackFlag = process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
  const previousPlatform = process.platform;

  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.SD_SCRIPT_PATH = 'D:\\funesterie\\a11\\backend\\apps\\server\\tools\\sd\\generate_sd_image.py';
    process.env.A11_SD_ALLOW_LOCAL_FALLBACK = '0';

    assert.equal(resolveSdScriptPath(), '');
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
    if (previousExplicit === undefined) delete process.env.SD_SCRIPT_PATH;
    else process.env.SD_SCRIPT_PATH = previousExplicit;

    if (previousFallbackFlag === undefined) delete process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
    else process.env.A11_SD_ALLOW_LOCAL_FALLBACK = previousFallbackFlag;
  }
});

test('hasSdProxyUrl only considers SD proxy variables', () => {
  assert.equal(hasSdProxyUrl({ A11_SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd' }), true);
  assert.equal(hasSdProxyUrl({ SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd' }), true);
  assert.equal(hasSdProxyUrl({ A11_VISION_BASE_URL: 'https://vision.example.com' }), false);
});

test('sanitizeProxyHeaders does not forward weak admin header shorthands', () => {
  assert.deepEqual(
    sanitizeProxyHeaders({
      authorization: 'Bearer strong-token',
      'x-nez-admin': 'true',
      'x-nez-token': 'legacy-token',
      'x-nez-admin-token': 'shared-admin-token',
      'x-qflush-token': 'qflush-token',
    }),
    {
      authorization: 'Bearer strong-token',
      'x-nez-admin-token': 'shared-admin-token',
      'x-qflush-token': 'qflush-token',
    }
  );
});

test('shouldAllowLocalSdFallback keeps production proxy-only by default when SD proxy is configured', () => {
  assert.equal(shouldAllowLocalSdFallback({
    NODE_ENV: 'production',
    ENABLE_SD: 'true',
    A11_SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd',
  }), false);

  assert.equal(shouldAllowLocalSdFallback({
    NODE_ENV: 'production',
    A11_SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd',
    A11_SD_ALLOW_LOCAL_FALLBACK: 'true',
  }), true);
});

test('runSdScript forwards init_image and strength arguments to the SD script', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-run-'));
  const scriptPath = path.join(tempRoot, 'echo-argv.js');
  const outputPath = path.join(tempRoot, 'result.png');

  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const findValue = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; };",
      "const output = findValue('--output');",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, Buffer.from('png'));",
      "process.stdout.write(JSON.stringify({ ok: true, output_path: output, argv: args }));",
    ].join('\n'),
    'utf8'
  );

  try {
    const result = await runSdScript({
      prompt: 'zelda heroique',
      prompt_2: 'princesse zelda, meme visage, meme tenue',
      prompt_3: 'variation visible: lumiere plus forte sur la frame',
      negative_prompt_2: 'drift identitaire',
      negative_prompt_3: 'frame plate',
      init_image_url: 'https://images.example.com/zelda-ref.png',
      strength: 0.4,
      output: outputPath,
    }, {
      scriptPath,
      pythonBin: process.execPath,
    });

    assert.equal(result.ok, true);
    assert.match(String(result.stdout || ''), /--init_image/);
    assert.match(String(result.stdout || ''), /https:\/\/images\.example\.com\/zelda-ref\.png/);
    assert.match(String(result.stdout || ''), /--strength/);
    assert.match(String(result.stdout || ''), /0\.4/);
    assert.match(String(result.stdout || ''), /--prompt_2/);
    assert.match(String(result.stdout || ''), /princesse zelda, meme visage, meme tenue/);
    assert.match(String(result.stdout || ''), /--prompt_3/);
    assert.match(String(result.stdout || ''), /variation visible: lumiere plus forte sur la frame/);
    assert.match(String(result.stdout || ''), /--negative_prompt_2/);
    assert.match(String(result.stdout || ''), /drift identitaire/);
    assert.match(String(result.stdout || ''), /--negative_prompt_3/);
    assert.match(String(result.stdout || ''), /frame plate/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runSdScript prefers strength_value when strength mode stays auto upstream', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-run-auto-'));
  const scriptPath = path.join(tempRoot, 'echo-argv.js');
  const outputPath = path.join(tempRoot, 'result.png');

  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const findValue = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; };",
      "const output = findValue('--output');",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, Buffer.from('png'));",
      "process.stdout.write(JSON.stringify({ ok: true, output_path: output, argv: args }));",
    ].join('\n'),
    'utf8'
  );

  try {
    const result = await runSdScript({
      prompt: 'goku heroique',
      init_image_url: 'https://images.example.com/goku-ref.png',
      strength: 'auto',
      strength_value: 0.27,
      output: outputPath,
    }, {
      scriptPath,
      pythonBin: process.execPath,
    });

    assert.equal(result.ok, true);
    const parsed = JSON.parse(String(result.stdout || '{}'));
    const argv = Array.isArray(parsed.argv) ? parsed.argv : [];
    const strengthIndex = argv.indexOf('--strength');

    assert.ok(strengthIndex >= 0);
    assert.equal(argv[strengthIndex + 1], '0.27');
    assert.equal(argv.includes('auto'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runSdScript downgrades unstable SD3 Windows profiles to sd35 and forces float16', async () => {
  const previousPlatform = process.platform;
  const previousDevice = process.env.SD_DEVICE;
  const previousDtype = process.env.SD_TORCH_DTYPE;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-run-compat-'));
  const scriptPath = path.join(tempRoot, 'echo-env.js');
  const outputPath = path.join(tempRoot, 'result.png');

  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const findValue = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; };",
      "const output = findValue('--output');",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, Buffer.from('png'));",
      "process.stdout.write(JSON.stringify({",
      "  ok: true,",
      "  output_path: output,",
      "  env_model_profile: process.env.SD_MODEL_PROFILE || '',",
      "  env_torch_dtype: process.env.SD_TORCH_DTYPE || ''",
      "}));",
    ].join('\n'),
    'utf8'
  );

  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.SD_DEVICE = 'cuda';
    process.env.SD_TORCH_DTYPE = 'auto';

    const result = await runSdScript({
      prompt: 'simple english prompt',
      prompt_prebuilt: true,
      model_profile: 'sd35turbo',
      output: outputPath,
    }, {
      scriptPath,
      pythonBin: process.execPath,
    });

    assert.equal(result.ok, true);
    assert.equal(result.env_model_profile, 'sd35');
    assert.equal(result.env_torch_dtype, 'float16');
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
    if (previousDevice === undefined) delete process.env.SD_DEVICE;
    else process.env.SD_DEVICE = previousDevice;
    if (previousDtype === undefined) delete process.env.SD_TORCH_DTYPE;
    else process.env.SD_TORCH_DTYPE = previousDtype;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runSdScript normalizes mixed french-english prompts before invoking the SD script', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-run-mixed-'));
  const scriptPath = path.join(tempRoot, 'echo-argv.js');
  const outputPath = path.join(tempRoot, 'result.png');
  const previousFetch = global.fetch;

  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const findValue = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; };",
      "const output = findValue('--output');",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, Buffer.from('png'));",
      "process.stdout.write(JSON.stringify({ ok: true, output_path: output, argv: args }));",
    ].join('\n'),
    'utf8'
  );

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content: 'character as the Joker, keeping the same face, facial structure, build, and posture of the reference person, wearing a chaotic Joker outfit and unsettling makeup. keep exactly the same face and identity. preserve natural anatomy and stable proportions. preserve the silhouette and main outfit',
      },
    }),
  });

  try {
    const result = await runSdScript({
      prompt: 'character en tant que joker, conservant the face, the structure faciale, the corpulence and the posture de the person de reference, wearing a tenue de joker chaotique and a maquillage inquietant. garder strictement le meme visage et la meme identite. preserver une anatomie naturelle et des proportions stables. preserver la silhouette et la tenue principale',
      output: outputPath,
    }, {
      scriptPath,
      pythonBin: process.execPath,
    });

    assert.equal(result.ok, true);
    const parsed = JSON.parse(String(result.stdout || '{}'));
    const argv = Array.isArray(parsed.argv) ? parsed.argv : [];
    const promptIndex = argv.indexOf('--prompt');
    const promptArg = promptIndex >= 0 ? String(argv[promptIndex + 1] || '') : '';

    assert.match(promptArg, /character as the Joker/i);
    assert.match(promptArg, /same face/i);
    assert.doesNotMatch(promptArg, /\bgarder\b|\bvisage\b|\btenue\b|\bmaquillage\b|\bcorpulence\b/i);
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runSdScript respects prompt_prebuilt and skips the final translation pass', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-run-prebuilt-'));
  const scriptPath = path.join(tempRoot, 'echo-argv.js');
  const outputPath = path.join(tempRoot, 'result.png');
  const previousFetch = global.fetch;
  let fetchCalls = 0;

  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const findValue = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; };",
      "const output = findValue('--output');",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, Buffer.from('png'));",
      "process.stdout.write(JSON.stringify({ ok: true, output_path: output, argv: args }));",
    ].join('\n'),
    'utf8'
  );

  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('translation should not run for prompt_prebuilt payloads');
  };

  try {
    const result = await runSdScript({
      prompt: 'main subject pose continuity: chevalier en armure sombre tenant une epee doree',
      prompt_2: 'scene camera decor continuity: torch-lit stone hall, same dark armor',
      prompt_3: 'visible frame delta anatomy prop detail: knight bends toward the golden sword',
      prompt_prebuilt: true,
      output: outputPath,
    }, {
      scriptPath,
      pythonBin: process.execPath,
    });

    assert.equal(result.ok, true);
    assert.equal(fetchCalls, 0);
    const parsed = JSON.parse(String(result.stdout || '{}'));
    const argv = Array.isArray(parsed.argv) ? parsed.argv : [];
    const promptIndex = argv.indexOf('--prompt');
    const promptArg = promptIndex >= 0 ? String(argv[promptIndex + 1] || '') : '';

    assert.equal(
      promptArg,
      'main subject pose continuity: chevalier en armure sombre tenant une epee doree'
    );
    assert.match(String(result.stdout || ''), /scene camera decor continuity:/i);
    assert.match(String(result.stdout || ''), /visible frame delta anatomy prop detail:/i);
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runSdScript retries rich prompt translation when the first english candidate is too compressed', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-run-rich-'));
  const scriptPath = path.join(tempRoot, 'echo-argv.js');
  const outputPath = path.join(tempRoot, 'result.png');
  const previousFetch = global.fetch;
  let fetchCalls = 0;

  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const findValue = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; };",
      "const output = findValue('--output');",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, Buffer.from('png'));",
      "process.stdout.write(JSON.stringify({ ok: true, output_path: output, argv: args }));",
    ].join('\n'),
    'utf8'
  );

  global.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({
        message: {
          content: fetchCalls === 1
            ? 'A Joker-inspired character keeping the same face.'
            : 'Use the input image as the identity, pose, and framing reference. Transform the person into a character inspired by the Joker in a dark, cinematic, realistic style while keeping the same recognizable face, facial structure, body build, posture, and overall presence as the original photo. Replace the wooden bat with a custom decorated threatening theatrical bat in the spirit of the Joker, personalized with paint, visual markings, chaotic details, dirty colors, and iconic criminal styling. Transform the background into a gritty Harlem-inspired urban street with a worn building entrance, city textures, graffiti, dirty pavement, tense atmosphere, dramatic cinematic lighting, strong contrast, and violet and green neon reflections. Keep a single full-body subject, clear silhouette, clean composition, high quality rendering, faithful face, clearly visible bat, and clearly readable outfit.',
        },
      }),
    };
  };

  try {
    const result = await runSdScript({
      prompt: 'Utilise l image d entree comme reference d identite, de pose et de cadrage. Transforme la personne en personnage inspire du Joker, dans un style sombre, cinematographique et realiste, tout en conservant un visage reconnaissable, la meme structure faciale, la meme corpulence, la meme posture et la meme presence generale que sur la photo d origine. Remplace la batte en bois par une batte custom dans l esprit du Joker: decoree, menacante, theatrale, personnalisee avec peinture, marques visuelles, details chaotiques, couleurs sales, style criminel iconique. Transforme le decor en environnement urbain inspire de Harlem: rue brute, ambiance de quartier, entree d immeuble usee, textures de ville, graffitis, sol sale, atmosphere tendue, lumiere cinematographique, contrastes marques, reflets de neons violets et verts. Sujet unique, personnage entier visible, silhouette claire, composition propre, haute qualite, visage fidele, batte visible, tenue bien lisible.',
      output: outputPath,
    }, {
      scriptPath,
      pythonBin: process.execPath,
    });

    assert.equal(result.ok, true);
    assert.equal(fetchCalls, 2);
    const parsed = JSON.parse(String(result.stdout || '{}'));
    const argv = Array.isArray(parsed.argv) ? parsed.argv : [];
    const promptIndex = argv.indexOf('--prompt');
    const promptArg = promptIndex >= 0 ? String(argv[promptIndex + 1] || '') : '';

    assert.match(promptArg, /custom decorated threatening(?: theatrical)? bat/i);
    assert.match(promptArg, /Harlem-inspired urban street/i);
    assert.match(promptArg, /graffiti/i);
    assert.match(promptArg, /single full-body subject/i);
    assert.doesNotMatch(promptArg, /^A Joker-inspired character keeping the same face\.?$/i);
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runSdScript preserves prompt_prebuilt payloads without final translation', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-run-prebuilt-'));
  const scriptPath = path.join(tempRoot, 'echo-argv.js');
  const outputPath = path.join(tempRoot, 'result.png');
  const previousFetch = global.fetch;
  let fetchCalls = 0;

  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const findValue = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; };",
      "const output = findValue('--output');",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, Buffer.from('png'));",
      "process.stdout.write(JSON.stringify({ ok: true, output_path: output, argv: args }));",
    ].join('\n'),
    'utf8'
  );

  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('translation should not run for prebuilt prompts');
  };

  try {
    const result = await runSdScript({
      prompt: 'main subject pose continuity: the knight in dark armor bends toward the golden sword',
      prompt_prebuilt: true,
      output: outputPath,
    }, {
      scriptPath,
      pythonBin: process.execPath,
    });

    assert.equal(result.ok, true);
    assert.equal(fetchCalls, 0);
    const parsed = JSON.parse(String(result.stdout || '{}'));
    const argv = Array.isArray(parsed.argv) ? parsed.argv : [];
    const promptIndex = argv.indexOf('--prompt');
    const promptArg = promptIndex >= 0 ? String(argv[promptIndex + 1] || '') : '';

    assert.equal(
      promptArg,
      'main subject pose continuity: the knight in dark armor bends toward the golden sword'
    );
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
