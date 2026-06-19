'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadEnvFile } = require('./a11-env-loader.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = path.resolve(SERVER_ROOT, '..', '..');
const DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1';
const PROFILE_ENV_PATH = path.join(SERVER_ROOT, 'profiles', 'a11.env');

loadEnvFile(PROFILE_ENV_PATH);
loadEnvFile(path.join(SERVER_ROOT, '.env'), { override: true });
loadEnvFile(path.join(SERVER_ROOT, '.env.local'), { override: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const force = args.has('--force');
const writeProfileEnv = args.has('--write-profile-env');
const removeBackgroundNoise = args.has('--remove-background-noise');
const onlyVoices = new Set(process.argv.slice(2)
  .filter((arg) => arg.startsWith('--only='))
  .flatMap((arg) => arg.slice('--only='.length).split(','))
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean));

const VOICES = [
  {
    id: 'a11',
    name: 'Funesterie A11 officiel',
    env: 'A11_ELEVENLABS_A11_VOICE_ID',
    refs: [
      'C:\\Users\\Djeff\\Desktop\\voix\\A11 ref.mp3',
      'C:\\Users\\Djeff\\Desktop\\voix\\A11 ref.wav',
      'C:\\Users\\Djeff\\Downloads\\A11 ref.mp3',
      path.join(BACKEND_ROOT, 'runtime', 'voice-library', 'a11-official-stern-french.wav'),
      path.join(SERVER_ROOT, 'runtime', 'voice-library', 'a11-official-stern-french.wav'),
    ],
  },
  {
    id: 'djeff',
    name: 'Funesterie Djeff officiel',
    env: 'A11_ELEVENLABS_DJEFF_VOICE_ID',
    refs: [
      'C:\\Users\\Djeff\\Desktop\\voix\\Djeff ref elevenlabs.mp3',
      'C:\\Users\\Djeff\\Desktop\\voix\\Djeff ref.wav',
      'C:\\Users\\Djeff\\Desktop\\voix\\Djeff ref.m4a',
      'C:\\Users\\Djeff\\Downloads\\Djeff ref.m4a',
      path.join(BACKEND_ROOT, 'runtime', 'voice-library', 'Djeff ref.wav'),
      path.join(SERVER_ROOT, 'runtime', 'voice-library', 'Djeff ref.wav'),
      path.join(BACKEND_ROOT, 'runtime', 'voice-library', 'djeff-rap.wav'),
      path.join(SERVER_ROOT, 'runtime', 'voice-library', 'djeff-rap.wav'),
    ],
  },
  {
    id: 'kaen44',
    name: 'Funesterie K44 officiel',
    env: 'A11_ELEVENLABS_K44_VOICE_ID',
    aliasEnv: 'A11_ELEVENLABS_KAEN44_VOICE_ID',
    refs: [
      'C:\\Users\\Djeff\\Desktop\\voix\\K44 Ref.m4a',
      'C:\\Users\\Djeff\\Desktop\\voix\\K44 Ref.wav',
      'C:\\Users\\Djeff\\Downloads\\K44 Ref.m4a',
      path.join(BACKEND_ROOT, 'runtime', 'voice-library', 'kaen44-official-french-narrator.wav'),
      path.join(SERVER_ROOT, 'runtime', 'voice-library', 'kaen44-official-french-narrator.wav'),
    ],
  },
  {
    id: 'vivy',
    name: 'Funesterie Vivy officielle',
    env: 'A11_ELEVENLABS_VIVY_VOICE_ID',
    refs: [
      'C:\\Users\\Djeff\\Desktop\\voix\\Vivy ref elevenlabs.mp3',
      'C:\\Users\\Djeff\\Desktop\\voix\\Vivy ref.wav',
      'C:\\Users\\Djeff\\Downloads\\Vivy ref.wav',
      path.join(BACKEND_ROOT, 'runtime', 'voice-library', 'vivy.wav'),
      path.join(SERVER_ROOT, 'runtime', 'voice-library', 'vivy.wav'),
    ],
  },
];

function getApiKey() {
  const filePath = String(
    process.env.VIVY_ELEVENLABS_API_KEY_FILE
    || process.env.A11_ELEVENLABS_API_KEY_FILE
    || process.env.ELEVENLABS_API_KEY_FILE
    || ''
  ).trim();
  if (filePath && fs.existsSync(filePath)) {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    if (value) return value;
  }
  return String(
    process.env.VIVY_ELEVENLABS_API_KEY
    || process.env.A11_ELEVENLABS_API_KEY
    || process.env.ELEVENLABS_API_KEY
    || process.env.XI_API_KEY
    || ''
  ).trim();
}

function firstExisting(paths) {
  return paths.find((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile()) || '';
}

async function createVoice(voice, filePath, apiKey) {
  const baseUrl = String(process.env.A11_ELEVENLABS_BASE_URL || process.env.ELEVENLABS_BASE_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/$/, '');
  const form = new FormData();
  form.append('name', voice.name);
  form.append('description', `Funesterie official ${voice.id} voice created from the private approved reference sample.`);
  form.append('remove_background_noise', removeBackgroundNoise ? 'true' : 'false');
  form.append('labels', JSON.stringify({ language: 'fr', source: 'funesterie-official-reference' }));
  form.append('files', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));

  const response = await fetch(`${baseUrl}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(Number(process.env.ELEVENLABS_VOICE_CREATE_TIMEOUT_MS || 60000) || 60000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`elevenlabs_voice_create_http_${response.status}`);
  }
  const payload = JSON.parse(text || '{}');
  if (!payload.voice_id) throw new Error('elevenlabs_voice_create_missing_voice_id');
  return payload.voice_id;
}

function upsertEnvValue(filePath, key, value) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/) : [];
  const nextLine = `${key}=${value}`;
  let updated = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      updated = true;
      return nextLine;
    }
    return line;
  });
  if (!updated) nextLines.push(nextLine);
  fs.writeFileSync(filePath, nextLines.join('\n').replace(/\n*$/, '\n'));
}

async function main() {
  const apiKey = getApiKey();
  if (apply && !apiKey) throw new Error('elevenlabs_api_key_missing');

  for (const voice of VOICES) {
    if (onlyVoices.size && !onlyVoices.has(String(voice.id || '').toLowerCase())) continue;
    const existingVoiceId = String(process.env[voice.env] || '').trim();
    const ref = firstExisting(voice.refs);
    const status = existingVoiceId && !force ? 'already-configured' : ref ? 'ready' : 'missing-reference';
    console.log(`${voice.id}: ${status}`);
    console.log(`  env: ${voice.env}${voice.aliasEnv ? ` / ${voice.aliasEnv}` : ''}`);
    console.log(`  ref: ${ref || '(not found)'}`);

    if (!apply || (existingVoiceId && !force) || !ref) continue;
    const voiceId = await createVoice(voice, ref, apiKey);
    if (writeProfileEnv) {
      upsertEnvValue(PROFILE_ENV_PATH, voice.env, voiceId);
      if (voice.aliasEnv) upsertEnvValue(PROFILE_ENV_PATH, voice.aliasEnv, voiceId);
      console.log(`  created and saved: ${voice.env}`);
      if (voice.aliasEnv) console.log(`  alias saved: ${voice.aliasEnv}`);
    } else {
      console.log(`  created: ${voice.env}=${voiceId}`);
      if (voice.aliasEnv) console.log(`  alias: ${voice.aliasEnv}=${voiceId}`);
    }
  }

  if (!apply) {
    console.log('dry-run only: add --apply to create missing ElevenLabs IVC voices.');
  } else if (writeProfileEnv) {
    console.log('created voice ids were written to the local profile env without printing their values.');
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
