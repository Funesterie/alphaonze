import { useEffect, useRef, useState } from "react";

export type MobileBottomSheetMode = "closed" | "compact" | "open";

const MOBILE_QUERY = "(max-width: 780px)";
const DRAG_THRESHOLD = 34;

type Options = {
  autoOpen?: boolean;
  desktopMode?: MobileBottomSheetMode;
  mobileMode?: MobileBottomSheetMode;
};

export function useMobileBottomSheet({
  autoOpen = false,
  desktopMode = "open",
  mobileMode = "compact",
}: Options = {}) {
  const [isMobile, setIsMobile] = useState(false);
  const [mode, setMode] = useState<MobileBottomSheetMode>(mobileMode);
  const [isDragging, setIsDragging] = useState(false);

  const startYRef = useRef<number | null>(null);
  const lastDeltaRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia(MOBILE_QUERY);

    const sync = () => {
      const mobile = media.matches;
      setIsMobile(mobile);
      setMode((current) => (mobile ? current : desktopMode));
    };

    sync();

    if (media.addEventListener) {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }

    media.addListener(sync);
    return () => media.removeListener(sync);
  }, [desktopMode]);

  useEffect(() => {
    if (!isMobile || !autoOpen) return;
    setMode((current) => {
      if (current === "open") return current;
      return "open";
    });
  }, [autoOpen, isMobile]);

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
    lastDeltaRef.current = 0;
    setIsDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isMobile || startYRef.current == null) return;
    lastDeltaRef.current = event.clientY - startYRef.current;
  }

  function onPointerUp() {
    if (!isMobile) return;

    const deltaY = lastDeltaRef.current;

    if (deltaY <= -DRAG_THRESHOLD) {
      setMode((current) => {
        if (current === "closed") return "compact";
        return "open";
      });
    } else if (deltaY >= DRAG_THRESHOLD) {
      setMode((current) => {
        if (current === "open") return "compact";
        return "closed";
      });
    } else {
      cycleMode();
    }

    startYRef.current = null;
    lastDeltaRef.current = 0;
    setIsDragging(false);
  }

  return {
    isMobile,
    isDragging,
    mode,
    isOpenLike: mode === "compact" || mode === "open",
    showBackdrop: isMobile && mode === "open",
    setMode,
    cycleMode,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
