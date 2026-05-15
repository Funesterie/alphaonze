const express = require('express');

const FRAMEBOOK_VERSION = 'a11-portrait-framebook-v1';

function buildPortraitFramebook() {
  const frameDurationMs = 140;
  return {
    ok: true,
    version: FRAMEBOOK_VERSION,
    generatedAt: new Date().toISOString(),
    policy: {
      mode: 'bounded_framebook',
      owner: 'A11',
      foreground: true,
      noInfiniteGeneration: true,
      maxFrames: 8,
      maxSequenceFrames: 16,
    },
    audioSync: {
      source: 'speech_events_audio_clock',
      frameDurationMs,
      transitionMs: 120,
      minMessageHoldMs: 800,
      cleanup: 'audio_object_urls_are_revoked_after_playback',
    },
    frames: [
      {
        id: 'idle',
        src: 'a11_static.png',
        layer: 'foreground',
        mood: 'calm',
        holdMs: 1200,
        transform: 'scale(1)',
        filter: 'saturate(1.02) contrast(1.02)',
        shadow: '0 0 12px rgba(34, 211, 238, 0.58)',
      },
      {
        id: 'listen',
        src: 'a11_static.png',
        layer: 'foreground',
        mood: 'listening',
        holdMs: 220,
        transform: 'scale(1.035) translateY(-1px)',
        filter: 'saturate(1.18) contrast(1.08) brightness(1.04)',
        shadow: '0 0 16px rgba(125, 211, 252, 0.72)',
      },
      {
        id: 'focus',
        src: 'a11_static.png',
        layer: 'foreground',
        mood: 'thinking',
        holdMs: 260,
        transform: 'scale(1.018) rotate(-1deg)',
        filter: 'saturate(1.08) contrast(1.12) hue-rotate(8deg)',
        shadow: '0 0 18px rgba(168, 85, 247, 0.58)',
      },
      {
        id: 'speak-a',
        src: 'A11_talking_smooth_8s.gif',
        layer: 'foreground',
        mood: 'speaking',
        holdMs: frameDurationMs,
        transform: 'scale(1.045)',
        filter: 'saturate(1.2) contrast(1.1)',
        shadow: '0 0 18px rgba(45, 212, 191, 0.78)',
      },
      {
        id: 'speak-b',
        src: 'A11_talking_smooth_8s.gif',
        layer: 'foreground',
        mood: 'speaking',
        holdMs: frameDurationMs,
        transform: 'scale(1.03) translateX(1px)',
        filter: 'saturate(1.12) contrast(1.16) brightness(1.04)',
        shadow: '0 0 20px rgba(96, 165, 250, 0.72)',
      },
      {
        id: 'speak-c',
        src: 'A11_talking_smooth_8s.gif',
        layer: 'foreground',
        mood: 'speaking',
        holdMs: frameDurationMs,
        transform: 'scale(1.038) translateX(-1px)',
        filter: 'saturate(1.18) contrast(1.08) brightness(1.08)',
        shadow: '0 0 20px rgba(244, 114, 182, 0.52)',
      },
    ],
    sequences: {
      idle: ['idle'],
      thinking: ['listen', 'focus', 'idle', 'focus'],
      speaking: ['speak-a', 'speak-b', 'speak-c', 'speak-b'],
      transition: ['focus', 'idle'],
    },
  };
}

function createPortraitFramebookRouter({ verifyJWT } = {}) {
  const router = express.Router();
  const routeHandlers = typeof verifyJWT === 'function' ? [verifyJWT] : [];

  router.get('/a11/portrait-framebook', ...routeHandlers, (_req, res) => {
    res.json(buildPortraitFramebook());
  });

  return router;
}

module.exports = {
  FRAMEBOOK_VERSION,
  buildPortraitFramebook,
  createPortraitFramebookRouter,
};
