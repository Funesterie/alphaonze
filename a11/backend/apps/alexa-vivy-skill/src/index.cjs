'use strict';

const Alexa = require('ask-sdk-core');

const SKILL_NAME = 'Vivy';
const SOURCE = 'alexa-vivy-skill';

function env(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function joinUrl(base, path) {
  const cleanBase = String(base || '').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

function assertHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}_invalid_url`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label}_must_be_https`);
  }

  return parsed.toString();
}

function getRequestLocale(handlerInput) {
  return handlerInput?.requestEnvelope?.request?.locale || 'fr-FR';
}

function getRequestId(handlerInput) {
  return handlerInput?.requestEnvelope?.request?.requestId || `local-${Date.now()}`;
}

function slotValue(handlerInput, slotName) {
  const slots = handlerInput?.requestEnvelope?.request?.intent?.slots || {};
  const slot = slots[slotName];
  return slot?.value || slot?.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name || '';
}

async function fetchVivySong(handlerInput) {
  const fallbackUrl = env('VIVY_DEFAULT_TRACK_URL');
  const fallbackTitle = env('VIVY_DEFAULT_TITLE', 'Vivy demo');
  const fallbackArtist = env('VIVY_DEFAULT_ARTIST', 'Funesterie');
  const serverUrl = env('VIVY_SERVER_URL');
  const endpointPath = env('VIVY_MUSIC_ENDPOINT', '/api/vivy/alexa/song');
  const serverToken = env('VIVY_SERVER_TOKEN');
  const mood = slotValue(handlerInput, 'mood');

  if (!serverUrl && fallbackUrl) {
    return {
      title: fallbackTitle,
      artist: fallbackArtist,
      audioUrl: assertHttpsUrl(fallbackUrl, 'fallback_audio_url'),
      source: 'fallback',
    };
  }

  const url = assertHttpsUrl(joinUrl(serverUrl, endpointPath), 'vivy_server_endpoint');
  const headers = {
    'content-type': 'application/json',
    'user-agent': `${SOURCE}/0.1.0`,
  };

  if (serverToken) {
    headers.authorization = `Bearer ${serverToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: SOURCE,
      requestId: getRequestId(handlerInput),
      locale: getRequestLocale(handlerInput),
      mood: mood || null,
      device: 'alexa',
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`vivy_server_http_${response.status}`);
  }

  const payload = await response.json();
  const audioUrl = assertHttpsUrl(payload.audioUrl || payload.audio_url || payload.url, 'audio_url');

  return {
    title: String(payload.title || fallbackTitle),
    artist: String(payload.artist || fallbackArtist),
    audioUrl,
    durationMs: Number(payload.durationMs || payload.duration_ms || 0) || undefined,
    artworkUrl: payload.artworkUrl || payload.artwork_url || undefined,
    soundcloudUrl: payload.soundcloudUrl || payload.soundcloud_url || undefined,
    source: payload.source || 'vivy-server',
  };
}

function canHandleType(handlerInput, type) {
  return handlerInput.requestEnvelope.request.type === type;
}

function canHandleIntent(handlerInput, name) {
  const request = handlerInput.requestEnvelope.request;
  return request.type === 'IntentRequest' && request.intent.name === name;
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return canHandleType(handlerInput, 'LaunchRequest');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Je suis Vivy, je suis en ligne. Tu peux me demander de chanter.')
      .reprompt('Dis simplement: chante.')
      .getResponse();
  },
};

const SingIntentHandler = {
  canHandle(handlerInput) {
    return canHandleIntent(handlerInput, 'SingIntent');
  },
  async handle(handlerInput) {
    const song = await fetchVivySong(handlerInput);
    const token = Buffer.from(`${song.title}:${song.artist}:${Date.now()}`).toString('base64url');

    return handlerInput.responseBuilder
      .addAudioPlayerPlayDirective('REPLACE_ALL', song.audioUrl, token, 0)
      .withShouldEndSession(true)
      .getResponse();
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return canHandleIntent(handlerInput, 'AMAZON.HelpIntent');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Tu peux me dire: chante une chanson.')
      .reprompt('Essaie: chante.')
      .getResponse();
  },
};

const StopIntentHandler = {
  canHandle(handlerInput) {
    return canHandleIntent(handlerInput, 'AMAZON.StopIntent')
      || canHandleIntent(handlerInput, 'AMAZON.CancelIntent')
      || canHandleIntent(handlerInput, 'AMAZON.PauseIntent');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .addAudioPlayerStopDirective()
      .getResponse();
  },
};

const AudioPlayerEventHandler = {
  canHandle(handlerInput) {
    return String(handlerInput.requestEnvelope.request.type || '').startsWith('AudioPlayer.');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return canHandleType(handlerInput, 'SessionEndedRequest');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error(JSON.stringify({
      level: 'error',
      source: SOURCE,
      requestId: getRequestId(handlerInput),
      message: error?.message || 'unknown_error',
    }));

    return handlerInput.responseBuilder
      .speak("Je n'arrive pas a lancer la chanson pour le moment. Le serveur Vivy a ete prevenu.")
      .getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    SingIntentHandler,
    HelpIntentHandler,
    StopIntentHandler,
    AudioPlayerEventHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();

exports._private = {
  assertHttpsUrl,
  joinUrl,
  fetchVivySong,
};
