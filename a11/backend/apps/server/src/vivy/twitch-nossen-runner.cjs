const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  buildRealMusicForProduction,
  buildVivyAiChat,
  buildVivyNossenRoutingPlan,
  getSunoMusicJob,
} = require('../routes/vivy-studio.cjs');

const execFileAsync = promisify(execFile);
const DEFAULT_TARGET_DURATION_SECONDS = 300;
const DEFAULT_POLL_ATTEMPTS = 60;
const DEFAULT_POLL_INTERVAL_MS = 10000;

function cleanText(value = '', fallbackOrMax = 6000, maybeMax = 6000) {
  const fallback = typeof fallbackOrMax === 'string' ? fallbackOrMax : '';
  const max = typeof fallbackOrMax === 'number' ? fallbackOrMax : maybeMax;
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return cleaned || fallback;
}

function cleanLyrics(value = '', max = 12000) {
  return String(value || '')
    .normalize('NFC')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTrustedTwitchRequest() {
  return {
    protocol: 'https',
    headers: { host: 'vivy.funesterie.me' },
    user: {
      id: 'vivy-twitch-live',
      username: 'vivy-twitch-live',
      role: 'founder',
      tier: 'founder',
      isAdmin: true,
    },
    get(name = '') {
      const key = String(name || '').toLowerCase();
      if (key === 'host' || key === 'x-forwarded-host') return 'vivy.funesterie.me';
      if (key === 'x-forwarded-proto') return 'https';
      return '';
    },
  };
}

function getMusicTaskId(value = {}) {
  return cleanText(
    value?.taskId
    || value?.jobId
    || value?.mediaStatus?.taskId
    || value?.musicJob?.taskId
    || value?.media?.taskId,
    160
  );
}

function getReadyMedia(value = {}) {
  const media = value?.media?.url || value?.media?.audioUrl || value?.media?.audio_url
    ? value.media
    : value?.url || value?.audioUrl || value?.audio_url
      ? value
      : null;
  if (!media) return null;
  const url = cleanText(media.audioUrl || media.audio_url || media.downloadUrl || media.url, 1200);
  if (!url) return null;
  return {
    ...media,
    url,
    durationSeconds: Number(
      media.durationSeconds
      || media.duration
      || value?.durationSeconds
      || value?.duration
      || 0
    ) || 0,
  };
}

async function probeMediaDurationSeconds(media = {}) {
  const reported = Number(media.durationSeconds || media.duration || 0);
  if (Number.isFinite(reported) && reported > 0) return reported;
  const filePath = String(media.path || '').trim();
  if (!filePath) return 0;
  try {
    const { stdout } = await execFileAsync(
      String(process.env.FFPROBE_BIN || 'ffprobe').trim() || 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 15000, windowsHide: true }
    );
    const duration = Number(String(stdout || '').trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function buildTwitchLyricsRequest({ winner, routing, seed }) {
  const artists = Array.isArray(routing?.artists) && routing.artists.length
    ? routing.artists.join(' + ')
    : 'Vivy';
  return [
    'NOSSEN Twitch Live.',
    `Écris les paroles complètes et directement chantables d'une chanson originale sur ce sujet exact: ${winner.text}`,
    `Direction sonore partagée avec la composition: ${routing?.songMood || 'moderne, précise et liée au sujet'}.`,
    `Casting vocal: ${artists}.`,
    seed?.notes || '',
    'Conserve tous les noms, objets et détails distinctifs du sujet. Ne remplace pas la demande par une histoire générique.',
    'Utilise des sections balisées [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Final Chorus], [Outro].',
    'Écris un refrain mémorable, des images concrètes, des rimes naturelles et des allusions liées au sujet.',
    'Ne parle jamais de prompt, de durée, de Suno, de NOSSEN, de production, de canevas ou de consignes.',
    'Réponds uniquement avec les paroles.',
  ].filter(Boolean).join('\n');
}

function createVivyStreamNossenRunner(options = {}) {
  const routeComposition = options.routeComposition || buildVivyNossenRoutingPlan;
  const writeLyrics = options.writeLyrics || buildVivyAiChat;
  const startMusic = options.startMusic || buildRealMusicForProduction;
  const pollMusic = options.pollMusic || getSunoMusicJob;
  const probeDuration = options.probeDuration || probeMediaDurationSeconds;
  const updateLive = options.updateLive || (() => {});
  const sleepFn = options.sleep || sleep;
  const logger = options.logger || console;
  const pollAttempts = Math.max(1, Number(options.pollAttempts || DEFAULT_POLL_ATTEMPTS));
  const pollIntervalMs = Math.max(10, Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS));
  const revealDelayMs = Math.max(0, Number(options.revealDelayMs ?? 4000));
  const targetDurationSeconds = Math.max(
    150,
    Number(options.targetDurationSeconds || process.env.VIVY_STREAM_TARGET_DURATION_SECONDS || DEFAULT_TARGET_DURATION_SECONDS)
  );
  const activeRuns = new Map();

  async function update(input) {
    const result = await Promise.resolve(updateLive({ source: 'twitch-live', ...input }));
    if (result?.error === 'twitch_stream_offline') {
      throw new Error('twitch_stream_offline');
    }
    return result;
  }

  async function run(payload = {}) {
    const winner = payload.winner || payload.nossenSeed?.winner;
    const roundId = cleanText(payload.roundId || payload.id, '', 120);
    if (!winner?.text || !roundId) throw new Error('vivy_stream_winner_missing');
    const req = options.requestFactory ? options.requestFactory(payload) : createTrustedTwitchRequest();
    const sessionId = `twitch-${roundId}`;
    const conversationId = `vivy-twitch-${roundId}`;
    const seed = payload.nossenSeed || {};

    try {
      if (revealDelayMs) await sleepFn(revealDelayMs);
      logger.info?.('[vivy-twitch-nossen] round=%s analysis started', roundId);
      await update({
        action: 'progress',
        stage: 'analysis',
        progress: 12,
        title: winner.text,
        requestedBy: winner.author,
        message: 'Vivy analyse le thème gagnant.',
      });
      const routing = await routeComposition({
        canvas: seed.canvas || winner.text,
        songText: winner.text,
        message: winner.text,
        notes: seed.notes,
        sessionId,
        conversationId,
      }, req);
      const artists = Array.isArray(routing?.artists) && routing.artists.length
        ? routing.artists.slice(0, 2)
        : ['vivy'];

      await update({
        action: 'progress',
        stage: 'lyrics',
        progress: 8,
        message: `Vivy écrit pour ${artists.join(' + ')}.`,
      });
      const lyricsPayload = await writeLyrics({
        mode: 'song',
        language: 'fr',
        conversationId,
        sessionId,
        sessionName: `Twitch Live - ${winner.text}`,
        history: [],
        message: buildTwitchLyricsRequest({ winner, routing, seed }),
        songText: winner.text,
        songMood: routing?.songMood,
        songArtists: artists,
        artistCount: artists.length,
        singerCount: artists.length,
        vocalCast: artists.join(' + '),
        disableSongcraftFallback: true,
      }, req);
      const lyrics = cleanLyrics(
        lyricsPayload?.vocalLyrics
        || lyricsPayload?.publicLyrics
        || lyricsPayload?.assistant
        || lyricsPayload?.content
      );
      if (lyrics.length < 120) throw new Error('vivy_stream_lyrics_too_short');

      await update({
        action: 'progress',
        stage: 'composition',
        progress: 5,
        message: 'Paroles prêtes, Suno lance la composition.',
      });
      const productionInput = {
        mode: 'song',
        language: 'fr',
        conversationId,
        sessionId,
        sessionName: `Twitch Live - ${winner.text}`,
        message: 'NOSSEN Twitch Live: production finale.',
        prompt: routing?.songMood || winner.text,
        title: winner.text,
        songTitle: winner.text,
        songSource: 'Twitch Live',
        songArtists: artists,
        artistCount: artists.length,
        singerCount: artists.length,
        vocalCast: artists.join(' + '),
        songMood: routing?.songMood,
        lyrics,
        songText: lyrics,
        forceRealMusic: true,
        generateMusic: true,
        makeSong: true,
        preserveSelectedVoice: true,
        allowExternalVoiceMix: false,
        externalVoiceMix: false,
        forceExternalVoiceMix: false,
        previewInstrumental: false,
        disableEmergencyMedia: true,
        musicProvider: 'suno',
        musicModel: process.env.VIVY_SUNO_LONG_MODEL || process.env.VIVY_SUNO_MODEL || 'V5_5',
        longSong: true,
        targetDurationSeconds,
      };
      let result = await startMusic('song', productionInput, req);
      let media = getReadyMedia(result);
      const taskId = getMusicTaskId(result);

      if (!media && !taskId) throw new Error('vivy_stream_suno_task_missing');
      for (let attempt = 1; !media && attempt <= pollAttempts; attempt += 1) {
        await sleepFn(attempt <= 2 ? Math.min(5000, pollIntervalMs) : pollIntervalMs);
        result = await pollMusic(taskId, productionInput, req);
        if (String(result?.state || '').toLowerCase() === 'error') {
          throw new Error(result?.message || 'vivy_stream_suno_failed');
        }
        media = getReadyMedia(result);
        await update({
          action: 'progress',
          stage: 'composition',
          progress: Math.min(94, 8 + Math.round((attempt / pollAttempts) * 86)),
          message: `Suno compose le morceau (${attempt}/${pollAttempts}).`,
        });
      }
      if (!media) throw new Error('vivy_stream_suno_timeout');

      await update({
        action: 'progress',
        stage: 'mix',
        progress: 100,
        message: 'Composition terminée, préparation de la lecture.',
      });
      const measuredDuration = await probeDuration(media);
      const durationSeconds = Math.max(1, Number(measuredDuration || targetDurationSeconds));
      await update({
        action: 'ready',
        title: winner.text,
        trackTitle: winner.text,
        trackUrl: media.url,
        durationSeconds,
        requestedBy: winner.author,
      });
      logger.info?.(
        '[vivy-twitch-nossen] round=%s ready task=%s duration=%ss',
        roundId,
        taskId || 'immediate',
        Math.round(durationSeconds)
      );
      return { ok: true, roundId, taskId, media, routing, lyrics };
    } catch (error) {
      const message = cleanText(error?.message || error, 'Échec de la composition Twitch.', 240);
      logger.error?.('[vivy-twitch-nossen] round=%s failed: %s', roundId, message);
      await update({
        action: 'error',
        message: `NOSSEN Twitch arrêté: ${message}`,
      });
      throw error;
    }
  }

  function start(payload = {}) {
    const roundId = cleanText(payload.roundId || payload.id, '', 120);
    if (!roundId) return { started: false, error: 'round_id_missing', promise: null };
    if (activeRuns.has(roundId)) {
      return { started: false, error: 'round_already_running', promise: activeRuns.get(roundId) };
    }
    const promise = run(payload).finally(() => activeRuns.delete(roundId));
    promise.catch(() => {});
    activeRuns.set(roundId, promise);
    return { started: true, promise };
  }

  return {
    isRunning: (roundId) => activeRuns.has(cleanText(roundId, '', 120)),
    run,
    start,
  };
}

module.exports = {
  buildTwitchLyricsRequest,
  createTrustedTwitchRequest,
  createVivyStreamNossenRunner,
  getMusicTaskId,
  getReadyMedia,
  probeMediaDurationSeconds,
};
