import * as React from "react";
import { startTransition, useEffect, useMemo, useState } from "react";
import { SLOT_VIDEO_INTRO_SESSION_KEY, type RoomId } from "../casino/catalog";
import {
  claimCasinoDailyBonus,
  clearCasinoSession,
  fetchCasinoProfile,
  getCasinoDisplayName,
  hasCasinoToken,
  isCasinoSessionError,
  loginCasino,
  registerCasino,
  requestCasinoPasswordReset,
  type CasinoProfile,
} from "../../lib/casinoApi";

export type AuthMode = "login" | "register" | "forgot";

const CASINO_IMMERSION_AUDIO_SESSION_KEY = "casino.immersion.funesterie.played";

type UseCasinoSessionOptions = {
};

export function useCasinoSession(_: UseCasinoSessionOptions = {}) {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [profile, setProfile] = useState<CasinoProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeCasinoRoom, setActiveCasinoRoom] = useState<RoomId>("slots");
  const [pendingImmersionName, setPendingImmersionName] = useState("");

  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!hasCasinoToken()) {
        if (!cancelled) setBooting(false);
        return;
      }

      try {
        const nextProfile = await fetchCasinoProfile();
        if (cancelled) return;
        startTransition(() => setProfile(nextProfile));
        setNotice(`Bienvenue a bord, ${nextProfile.user.username}.`);
      } catch (error_) {
        if (cancelled) return;
        if (isCasinoSessionError(error_)) {
          clearCasinoSession();
          setError("La session a expire. Reconnecte-toi pour retrouver ton solde.");
        } else {
          setError(error_ instanceof Error ? error_.message : "Le compte est momentanement indisponible.");
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => {
      setNotice((current) => (current === notice ? "" : current));
    }, 3600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  const displayName = useMemo(() => {
    return profile?.user?.username || getCasinoDisplayName() || "Capitaine";
  }, [profile]);

  function resetConnectedSessionMediaIntro() {
    try {
      sessionStorage.removeItem(SLOT_VIDEO_INTRO_SESSION_KEY);
      sessionStorage.removeItem(CASINO_IMMERSION_AUDIO_SESSION_KEY);
    } catch {
      // ignore storage failures
    }
  }

  async function refreshProfile(message = "") {
    setBusy(true);
    setError("");
    try {
      const nextProfile = await fetchCasinoProfile();
      startTransition(() => setProfile(nextProfile));
      if (message) setNotice(message);
    } catch (error_) {
      if (isCasinoSessionError(error_)) {
        handleLogout();
        setError("La session a expire. Reconnecte-toi pour retrouver ton solde.");
        return;
      }
      setError(error_ instanceof Error ? error_.message : "Impossible de charger le compte.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await loginCasino(loginName, loginPassword);
      const nextProfile = await fetchCasinoProfile();
      resetConnectedSessionMediaIntro();
      setActiveCasinoRoom("slots");
      startTransition(() => setProfile(nextProfile));
      setPendingImmersionName(nextProfile.user.username);
      setNotice(`Bienvenue a bord, ${nextProfile.user.username}.`);
      setLoginPassword("");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (registerPassword !== registerPasswordConfirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await registerCasino(registerName, registerEmail, registerPassword);
      const nextProfile = await fetchCasinoProfile();
      resetConnectedSessionMediaIntro();
      setActiveCasinoRoom("slots");
      startTransition(() => setProfile(nextProfile));
      setPendingImmersionName(nextProfile.user.username);
      setNotice(`Compte cree. Bon vent, ${nextProfile.user.username}.`);
      setRegisterPassword("");
      setRegisterPasswordConfirm("");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Inscription impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestCasinoPasswordReset(forgotEmail);
      setNotice("Un lien de reinitialisation a ete envoye si l’email existe.");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClaimBonus() {
    setBusy(true);
    setError("");
    try {
      const result = await claimCasinoDailyBonus();
      startTransition(() => setProfile(result.profile));
      setNotice(`Bonus journalier recupere: +${result.claimedAmount} credits.`);
    } catch (error_) {
      if (isCasinoSessionError(error_)) {
        handleLogout();
        setError("La session a expire. Reconnecte-toi pour retrouver ton solde.");
        return;
      }
      setError(error_ instanceof Error ? error_.message : "Bonus indisponible.");
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    setPendingImmersionName("");
    setActiveCasinoRoom("slots");
    clearCasinoSession();
    setProfile(null);
    setNotice("Session fermee.");
    setError("");
    setLoginPassword("");
  }

  function consumePendingImmersionName() {
    const nextValue = pendingImmersionName;
    setPendingImmersionName("");
    return nextValue;
  }

  function handleProfileChange(nextProfile: CasinoProfile, message?: string) {
    startTransition(() => setProfile(nextProfile));
    if (message) setNotice(message);
  }

  return {
    authMode,
    setAuthMode,
    profile,
    booting,
    busy,
    error,
    notice,
    activeCasinoRoom,
    setActiveCasinoRoom,
    displayName,
    pendingImmersionName,
    consumePendingImmersionName,
    loginName,
    setLoginName,
    loginPassword,
    setLoginPassword,
    registerName,
    setRegisterName,
    registerEmail,
    setRegisterEmail,
    registerPassword,
    setRegisterPassword,
    registerPasswordConfirm,
    setRegisterPasswordConfirm,
    forgotEmail,
    setForgotEmail,
    setError,
    setNotice,
    refreshProfile,
    handleLogin,
    handleRegister,
    handleForgot,
    handleClaimBonus,
    handleLogout,
    handleProfileChange,
  };
}
