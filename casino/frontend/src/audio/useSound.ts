// useSound.ts - gestion simple du son pour le slot
import * as React from "react";
import { useState } from "react";

export function useSound() {
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [ready, setReady] = useState(false);

  function unlock() {
    setReady(true);
    return Promise.resolve();
  }

  function play(_name: string, _opts?: any) {
    if (!muted && ready) {
      // Ici, on pourrait jouer un son réel
      // console.log(`play sound: ${_name}`);
    }
  }

  return {
    muted,
    setMuted,
    volume,
    setVolume,
    ready,
    unlock,
    play
  };
}
