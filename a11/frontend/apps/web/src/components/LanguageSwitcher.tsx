import React, { useEffect, useRef, useState } from "react";

import { chooseInterfaceLanguage, getAuthAccountLanguage, INTERFACE_LANGUAGE_EVENT } from "../lib/api";
import { applyInterfaceLanguage } from "../lib/ui-translation";

// Bouton de langue toujours visible (16/09/2026, demande de Djeff : « si un chinois
// vivant en France veut l'appli en chinois, il faut un bouton accessible »). Le
// sélecteur existait, mais caché dans le menu du chat A11 et le menu Vivy ; la page
// d'accueil n'en avait aucun. Chaque langue est écrite dans sa propre langue, pour
// que la personne reconnaisse la sienne sans lire le français.
const LANGUAGES: Array<{ code: string; label: string; short: string; htmlLang: string }> = [
  { code: "fr", label: "Français", short: "FR", htmlLang: "fr-FR" },
  { code: "en", label: "English", short: "EN", htmlLang: "en-US" },
  { code: "es", label: "Español", short: "ES", htmlLang: "es-ES" },
  { code: "it", label: "Italiano", short: "IT", htmlLang: "it-IT" },
  { code: "de", label: "Deutsch", short: "DE", htmlLang: "de-DE" },
  { code: "ja", label: "日本語", short: "日本語", htmlLang: "ja-JP" },
  { code: "zh", label: "中文", short: "中文", htmlLang: "zh-CN" },
];

// Le nom du bouton dans toutes les langues : lisible avant d'avoir choisi.
const BUTTON_NAME = "Langue / Language / Idioma / Lingua / Sprache / 言語 / 语言";

function readLanguage(): string {
  try {
    return getAuthAccountLanguage(localStorage.getItem("a11:language") || "fr");
  } catch {
    return "fr";
  }
}

export function LanguageSwitcher() {
  const [language, setLanguage] = useState(readLanguage);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onLanguage = (event: Event) => {
      const next = (event as CustomEvent<{ language?: string }>).detail?.language;
      if (next) setLanguage(next);
    };
    window.addEventListener(INTERFACE_LANGUAGE_EVENT, onLanguage);
    return () => window.removeEventListener(INTERFACE_LANGUAGE_EVENT, onLanguage);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = LANGUAGES.find((entry) => entry.code === language) || LANGUAGES[0];

  const choose = (code: string) => {
    const chosen = chooseInterfaceLanguage(code);
    setLanguage(chosen);
    setOpen(false);
    try {
      document.documentElement.lang = LANGUAGES.find((entry) => entry.code === chosen)?.htmlLang || "fr-FR";
    } catch {
      // document indisponible
    }
    applyInterfaceLanguage(chosen);
  };

  return (
    <div ref={boxRef} className="fun-language-switcher" data-no-ui-translate>
      {open ? (
        <ul className="fun-language-switcher-list" role="listbox" aria-label={BUTTON_NAME}>
          {LANGUAGES.map((entry) => (
            <li key={entry.code}>
              <button
                type="button"
                role="option"
                lang={entry.htmlLang}
                aria-selected={entry.code === current.code}
                className={entry.code === current.code ? "is-current" : undefined}
                onClick={() => choose(entry.code)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="fun-language-switcher-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${BUTTON_NAME} : ${current.label}`}
        title={BUTTON_NAME}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">🌐</span> {current.short}
      </button>
    </div>
  );
}
