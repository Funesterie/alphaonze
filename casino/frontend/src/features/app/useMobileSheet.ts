import { useEffect, useMemo, useRef, useState } from "react";

export type MobileSheetMode = "closed" | "compact" | "open";

const MOBILE_QUERY = "(max-width: 780px)";

type Options = {
  defaultDesktopMode?: MobileSheetMode;
  defaultMobileMode?: MobileSheetMode;
  autoOpen?: boolean;
};

export function useMobileSheet({
  defaultDesktopMode = "open",
  defaultMobileMode = "compact",
  autoOpen = false,
}: Options = {}) {
  const [mode, setMode] = useState<MobileSheetMode>(defaultMobileMode);
  const [isMobile, setIsMobile] = useState(false);

  const startYRef = useRef<number | null>(null);
  const startModeRef = useRef<MobileSheetMode>("compact");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia(MOBILE_QUERY);

    const sync = () => {
      const mobile = media.matches;
      setIsMobile(mobile);
      setMode((current) => {
        if (!mobile) return defaultDesktopMode;
        if (current === "open" || current === "compact" || current === "closed") return current;
        return defaultMobileMode;
      });
    };

    sync();

    if (media.addEventListener) {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }

    media.addListener(sync);
    return () => media.removeListener(sync);
  }, [defaultDesktopMode, defaultMobileMode]);

  useEffect(() => {
    if (!isMobile || !autoOpen) return;
    setMode((current) => (current === "closed" ? "compact" : "open"));
  }, [autoOpen, isMobile]);

  const nextMode = useMemo(() => {
    if (mode === "closed") return "compact";
    if (mode === "compact") return "open";
    return "closed";
  }, [mode]);

  function cycleMode() {
    setMode((current) => {
      if (current === "closed") return "compact";
      if (current === "compact") return "open";
      return "closed";
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isMobile) return;
    startYRef.current = event.clientY;
    startModeRef.current = mode;
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isMobile || startYRef.current == null) return;

    const deltaY = event.clientY - startYRef.current;
    const threshold = 36;

    if (deltaY <= -threshold) {
      setMode((current) => {
        if (current === "closed") return "compact";
        return "open";
      });
    } else if (deltaY >= threshold) {
      setMode((current) => {
        if (current === "open") return "compact";
        return "closed";
      });
    } else {
      cycleMode();
    }

    startYRef.current = null;
  }

  void startModeRef;

  return {
    isMobile,
    mode,
    nextMode,
    setMode,
    cycleMode,
    handleProps: {
      onPointerDown,
      onPointerUp,
    },
  };
}
