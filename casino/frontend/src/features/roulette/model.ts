export const ROULETTE_AMOUNT_PRESETS = [10, 50, 200, 500];

export const QUICK_BETS = [
  { betType: "color", betValue: "red", label: "Rouge" },
  { betType: "color", betValue: "black", label: "Noir" },
  { betType: "parity", betValue: "even", label: "Pair" },
  { betType: "parity", betValue: "odd", label: "Impair" },
  { betType: "lowhigh", betValue: "low", label: "1-18" },
  { betType: "lowhigh", betValue: "high", label: "19-36" },
  { betType: "dozen", betValue: "first12", label: "1er 12" },
  { betType: "dozen", betValue: "second12", label: "2e 12" },
  { betType: "dozen", betValue: "third12", label: "3e 12" },
] as const;

export const ROULETTE_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const WHEEL_POCKET_ANGLE = 360 / ROULETTE_ORDER.length;
export const BALL_START_ANGLE = 32;
export const BALL_TARGET_ANGLE = 270;
export const BALL_OUTER_RADIUS = 45.4;
export const BALL_INNER_RADIUS = 37.2;
export const SPIN_DURATION_MS = 4100;
export const HOLD_DURATION_MS = 30000;
export const ROULETTE_TIRAGE_CANNON_DELAY_MS = 700;
export const ROULETTE_ANNOUNCE_LEAD_IN_MS = 6200;

export type RouletteSequencePhase = "idle" | "intro" | "spin" | "hold" | "reload";

export type RouletteAnimationState = {
  wheelRotation: number;
  ballAngle: number;
  ballRadius: number;
  ballX: number;
  ballY: number;
  highlightedNumber: number | null;
  fireRotation: number;
  fireScale: number;
};

export function normalizeAngle(value: number) {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

export function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

export function easeOutQuart(value: number) {
  return 1 - Math.pow(1 - value, 4);
}

export function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

export function toBallCoordinates(angle: number, radius: number, bounce = 0) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: 50 + Math.cos(radians) * radius,
    y: 50 + Math.sin(radians) * radius - bounce,
  };
}

export function getNumberColor(number: number) {
  if (number === 0) return "green";
  return [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(number) ? "red" : "black";
}

export function getPocketIndex(number: number | null) {
  if (typeof number !== "number") return -1;
  return ROULETTE_ORDER.indexOf(number);
}

export function buildStaticAnimation(): RouletteAnimationState {
  const ball = toBallCoordinates(BALL_START_ANGLE, BALL_OUTER_RADIUS, 0);
  return {
    wheelRotation: 0,
    ballAngle: BALL_START_ANGLE,
    ballRadius: BALL_OUTER_RADIUS,
    ballX: ball.x,
    ballY: ball.y,
    highlightedNumber: null,
    fireRotation: 0,
    fireScale: 1,
  };
}

export function buildSettledAnimation(winningNumber: number) {
  const pocketIndex = getPocketIndex(winningNumber);
  const ball = toBallCoordinates(BALL_TARGET_ANGLE, BALL_INNER_RADIUS, 0);
  return {
    wheelRotation: -(pocketIndex * WHEEL_POCKET_ANGLE),
    ballAngle: BALL_TARGET_ANGLE,
    ballRadius: BALL_INNER_RADIUS,
    ballX: ball.x,
    ballY: ball.y,
    highlightedNumber: winningNumber,
    fireRotation: 0,
    fireScale: 1,
  };
}

export function waitForMs(duration: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

export async function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadedmetadata", finish);
      video.removeEventListener("error", finish);
      resolve();
    };

    video.addEventListener("loadedmetadata", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
    window.setTimeout(finish, 1500);
    video.load();
  });
}

export async function playVideoForward(video: HTMLVideoElement, fallbackMs = 2200) {
  await waitForVideoMetadata(video);
  video.pause();
  try {
    video.currentTime = 0;
  } catch {
    // ignore reset failures
  }
  video.playbackRate = 1;
  video.muted = true;
  video.volume = 0;

  try {
    await video.play();
  } catch {
    await waitForMs(fallbackMs);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.pause();
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", finish);
      resolve();
    };

    video.addEventListener("ended", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
    window.setTimeout(finish, Math.max(fallbackMs, Math.ceil((video.duration || 0) * 1000) + 220));
  });
}

export async function playVideoReverse(
  video: HTMLVideoElement,
  token: number,
  isCurrent: () => boolean,
) {
  await waitForVideoMetadata(video);
  video.pause();
  video.playbackRate = 1;
  video.muted = true;
  video.volume = 0;

  try {
    await video.play();
    video.pause();
  } catch {
    // ignore autoplay warmup failures
  }

  const safeDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1.6;
  try {
    // Start from the tail of the clip so the reload really runs end -> start.
    video.currentTime = Math.max(0, safeDuration - 0.01);
  } catch {
    // ignore reset failures
  }

  await new Promise<void>((resolve) => {
    let rafId: number | null = null;
    let previousNow = 0;

    const finish = () => {
      if (rafId) cancelAnimationFrame(rafId);
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // ignore reset failures
      }
      resolve();
    };

    const tick = (now: number) => {
      if (!isCurrent()) {
        finish();
        return;
      }

      if (!previousNow) previousNow = now;
      const deltaSeconds = (now - previousNow) / 1000;
      previousNow = now;
      const nextTime = Math.max(0, video.currentTime - deltaSeconds);

      try {
        video.currentTime = nextTime;
      } catch {
        finish();
        return;
      }

      if (nextTime <= 0.02) {
        finish();
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame((now) => {
      previousNow = now;
      tick(now);
    });
  });

  void token;
}

export function getBetLabel(betType: string, betValue: string) {
  if (betType === "straight") return `Numero ${betValue}`;
  if (betType === "column") {
    if (betValue === "col1") return "Colonne 1 (2 to 1)";
    if (betValue === "col2") return "Colonne 2 (2 to 1)";
    if (betValue === "col3") return "Colonne 3 (2 to 1)";
    if (betValue === "first") return "Colonne 1 (2 to 1)";
    if (betValue === "second") return "Colonne 2 (2 to 1)";
    if (betValue === "third") return "Colonne 3 (2 to 1)";
  }
  if (betType === "street") {
    const start = Number.parseInt(betValue, 10);
    if (Number.isFinite(start)) return `Transversale ${start}-${start + 2}`;
  }
  if (betType === "sixline") {
    const start = Number.parseInt(betValue, 10);
    if (Number.isFinite(start)) return `Sixain ${start}-${start + 5}`;
  }
  if (betType === "split") return `Cheval ${betValue.split("-").join("/")}`;
  if (betType === "corner") return `Carre ${betValue.split("-").join("/")}`;
  if (betType === "trio") return `Trio ${betValue.split("-").join("/")}`;
  return QUICK_BETS.find((entry) => entry.betType === betType && entry.betValue === betValue)?.label || `${betType}:${betValue}`;
}
