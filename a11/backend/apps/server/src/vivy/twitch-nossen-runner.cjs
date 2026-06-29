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

function isExternalMediaUrl(url = '') {
  return /^https?:\/\//i.test(cleanText(url, '', 1200));
}

function isLocalVivyMediaUrl(url = '') {
  const value = cleanText(url, '', 1200);
  return /^\/api\/vivy\/studio\/assets\//i.test(value)
    || /^\/api\/double-harmonic\/out\//i.test(value)
    || /^https?:\/\/vivy\.funesterie\.me\/api\/vivy\/studio\/assets\//i.test(value)
    || /^https?:\/\/vivy\.funesterie\.me\/api\/double-harmonic\/out\//i.test(value);
}

function getReadyLocalMedia(value = {}, logger = console, context = {}) {
  const media = getReadyMedia(value);
  if (!media) return null;
  if (isExternalMediaUrl(media.url) && !isLocalVivyMediaUrl(media.url)) {
    logger.warn?.(
      '[vivy-twitch-nossen] round=%s provider media ready but local asset missing url=%s',
      cleanText(context.roundId || '', 'unknown', 120),
      cleanText(media.url, '', 180)
    );
    return null;
  }
  return media;
}

function foldTwitchLyricText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const TWITCH_OPERATIONAL_LEAK_TERMS = [
  'nossen',
  'twitch',
  'live',
  'stream',
  'chat',
  'raid',
  'sub',
  'viewer',
  'viewers',
  'modo',
  'mod',
  'moderation',
  'obs',
  'overlay',
  'suno',
  'prompt',
  'canevas',
  'production',
  'serveur',
  'server',
  'notification',
  'notifications',
  'notif',
  'notifs',
  'commande',
  'camera',
  'micro',
  'donjon',
  'skin',
];

const TWITCH_VEHICLE_LEAK_TERMS = [
  'casque',
  'visiere',
  'guidon',
  'gyros',
  'gyrophare',
  'gyrophares',
];

function hasFoldedWord(text = '', term = '') {
  return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);
}

function sanitizeTwitchLyricsForSubject(lyrics = '', subject = '') {
  const foldedSubject = foldTwitchLyricText(subject);
  const vehicleSubject = /\b(moto|motard|scooter|booster|tzr|derbi|casque|visiere|guidon|poursuite|course|rallye|voiture|volant|autoroute)\b/i
    .test(foldedSubject);
  const blockedTerms = TWITCH_OPERATIONAL_LEAK_TERMS
    .filter((term) => !hasFoldedWord(foldedSubject, term));
  const blockedVehicleTerms = vehicleSubject
    ? []
    : TWITCH_VEHICLE_LEAK_TERMS.filter((term) => !hasFoldedWord(foldedSubject, term));
  if (!blockedTerms.length && !blockedVehicleTerms.length) return cleanLyrics(lyrics);

  const kept = [];
  for (const line of String(lyrics || '').split(/\n/)) {
    const folded = foldTwitchLyricText(line);
    const isSectionTag = /^\s*\[[^\]]+\]\s*$/.test(line);
    const leaksOperational = !isSectionTag && blockedTerms.some((term) => hasFoldedWord(folded, term));
    const leaksVehicle = !isSectionTag && blockedVehicleTerms.some((term) => hasFoldedWord(folded, term));
    if (leaksOperational || leaksVehicle) continue;
    kept.push(line);
  }
  return cleanLyrics(kept.join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[\s*(Verse|Couplet)\s*\]/gi, '[Verse]')
  );
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
    `Écris les paroles complètes et directement chantables d'une chanson originale sur ce sujet exact: ${winner.text}`,
    `Direction sonore partagée avec la composition: ${routing?.songMood || 'moderne, précise et liée au sujet'}.`,
    `Casting vocal: ${artists}.`,
    seed?.notes || '',
    'Conserve tous les noms, objets et détails distinctifs du sujet. Ne remplace pas la demande par une histoire générique.',
    'Le contexte de diffusion, de vote, de live, de chat, de stream, de Twitch, de NOSSEN, de raid, de sub, de modération ou d’OBS est strictement interne: ne l’écris jamais dans les paroles sauf si ces mots sont explicitement dans le sujet exact.',
    'Si le sujet est court, amplifie son champ naturel au lieu de remplir avec le contexte technique. Exemple: vacances -> départ, valises, route, plage, fatigue qui tombe, soleil, amis, liberté, refrain d’été.',
    'Utilise des sections balisées [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Final Chorus], [Outro].',
    'Écris un refrain mémorable, des images concrètes, des rimes naturelles et des allusions liées au sujet.',
    'Ne parle jamais de prompt, de durée, de Suno, de production, de canevas ou de consignes.',
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
      const rawLyrics = cleanLyrics(
        lyricsPayload?.vocalLyrics
        || lyricsPayload?.publicLyrics
        || lyricsPayload?.assistant
        || lyricsPayload?.content
      );
      const lyrics = sanitizeTwitchLyricsForSubject(rawLyrics, winner.text);
      if (lyrics !== rawLyrics) {
        logger.warn?.('[vivy-twitch-nossen] round=%s stripped operational lyric leakage before Suno', roundId);
      }
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
        requireLocalSunoAudio: true,
        sunoLocalAudioRequired: true,
        sunoStatusAudioFetchAttempts: Number(process.env.VIVY_STREAM_SUNO_AUDIO_FETCH_ATTEMPTS || 4),
        sunoStatusAudioFetchTimeoutMs: Number(process.env.VIVY_STREAM_SUNO_AUDIO_FETCH_TIMEOUT_MS || 180000),
        sunoStatusAudioRetryDelayMs: Number(process.env.VIVY_STREAM_SUNO_AUDIO_RETRY_DELAY_MS || 3000),
      };
      let result = await startMusic('song', productionInput, req);
      let media = getReadyLocalMedia(result, logger, { roundId });
      const taskId = getMusicTaskId(result);
      logger.info?.(
        '[vivy-twitch-nossen] round=%s suno submitted task=%s status=%s model=%s',
        roundId,
        taskId || 'immediate',
        cleanText(result?.status || result?.state || 'unknown', '', 80),
        cleanText(result?.model || productionInput.musicModel || 'unknown', '', 80)
      );

      if (!media && !taskId) throw new Error('vivy_stream_suno_task_missing');
      for (let attempt = 1; !media && attempt <= pollAttempts; attempt += 1) {
        await sleepFn(attempt <= 2 ? Math.min(5000, pollIntervalMs) : pollIntervalMs);
        result = await pollMusic(taskId, productionInput, req);
        if (String(result?.state || '').toLowerCase() === 'error') {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s suno rejected task=%s status=%s message=%s',
            roundId,
            taskId,
            cleanText(result?.status || 'error', '', 80),
            cleanText(result?.message || result?.providerDetail || 'unknown', '', 220)
          );
          throw new Error(result?.message || 'vivy_stream_suno_failed');
        }
        media = getReadyLocalMedia(result, logger, { roundId });
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
