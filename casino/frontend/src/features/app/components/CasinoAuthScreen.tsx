import type * as React from "react";

type AuthMode = "login" | "register" | "forgot";

type CasinoAuthScreenProps = {
  authMode: AuthMode;
  busy: boolean;
  error: string;
  notice: string;
  loginName: string;
  loginPassword: string;
  registerName: string;
  registerEmail: string;
  registerPassword: string;
  registerPasswordConfirm: string;
  forgotEmail: string;
  onAuthModeChange: (mode: AuthMode) => void;
  onLoginNameChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onRegisterNameChange: (value: string) => void;
  onRegisterEmailChange: (value: string) => void;
  onRegisterPasswordChange: (value: string) => void;
  onRegisterPasswordConfirmChange: (value: string) => void;
  onForgotEmailChange: (value: string) => void;
  onLoginSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onRegisterSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onForgotSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export default function CasinoAuthScreen({
  authMode,
  busy,
  error,
  notice,
  loginName,
  loginPassword,
  registerName,
  registerEmail,
  registerPassword,
  registerPasswordConfirm,
  forgotEmail,
  onAuthModeChange,
  onLoginNameChange,
  onLoginPasswordChange,
  onRegisterNameChange,
  onRegisterEmailChange,
  onRegisterPasswordChange,
  onRegisterPasswordConfirmChange,
  onForgotEmailChange,
  onLoginSubmit,
  onRegisterSubmit,
  onForgotSubmit,
}: CasinoAuthScreenProps) {
  return (
    <div className="casino-auth-layout">
      <section className="casino-poster">
        <div className="casino-poster__veil" />
        <div className="casino-poster__content casino-poster__content--centered">
          <h1 className="casino-poster__title">TREASURE CRUISE</h1>
        </div>
      </section>

      <aside className="casino-auth-panel">
        <div className="casino-auth-panel__header">
          <h2>{authMode === "login" ? "Connexion" : authMode === "register" ? "Inscription" : "Mot de passe oublie"}</h2>
          <p>
            {authMode === "login"
              ? "Reconnecte-toi avec tes identifiants pour retrouver instantanement ton solde."
              : authMode === "register"
                ? ""
                : "On reutilise le circuit mail A11 pour te renvoyer un lien de recuperation."}
          </p>
        </div>

        <div className="casino-auth-tabs" role="tablist" aria-label="Modes d’authentification">
          <button className={authMode === "login" ? "is-active" : ""} onClick={() => onAuthModeChange("login")} type="button">
            Connexion
          </button>
          <button className={authMode === "register" ? "is-active" : ""} onClick={() => onAuthModeChange("register")} type="button">
            Inscription
          </button>
          <button className={authMode === "forgot" ? "is-active" : ""} onClick={() => onAuthModeChange("forgot")} type="button">
            Recuperation
          </button>
        </div>

        {error ? <div className="casino-alert casino-alert--error">{error}</div> : null}
        {notice ? <div className="casino-alert casino-alert--success">{notice}</div> : null}

        {authMode === "login" ? (
          <form className="casino-auth-form" onSubmit={onLoginSubmit}>
            <label>
              Identifiant
              <input value={loginName} onChange={(event) => onLoginNameChange(event.target.value)} placeholder="Nom de joueur ou email" autoComplete="username" />
            </label>
            <label>
              Mot de passe
              <input value={loginPassword} onChange={(event) => onLoginPasswordChange(event.target.value)} placeholder="Mot de passe" type="password" autoComplete="current-password" />
            </label>
            <button type="submit" className="casino-primary-button" disabled={busy}>
              {busy ? "Connexion..." : "Entrer dans le casino"}
            </button>
          </form>
        ) : null}

        {authMode === "register" ? (
          <form className="casino-auth-form" onSubmit={onRegisterSubmit}>
            <label>
              Nom de joueur
              <input value={registerName} onChange={(event) => onRegisterNameChange(event.target.value)} placeholder="Capitaine Carmelo" autoComplete="username" />
            </label>
            <label>
              Email
              <input value={registerEmail} onChange={(event) => onRegisterEmailChange(event.target.value)} placeholder="joueur@exemple.com" type="email" autoComplete="email" />
            </label>
            <label>
              Mot de passe
              <input value={registerPassword} onChange={(event) => onRegisterPasswordChange(event.target.value)} placeholder="Mot de passe" type="password" autoComplete="new-password" />
            </label>
            <label>
              Confirmer le mot de passe
              <input value={registerPasswordConfirm} onChange={(event) => onRegisterPasswordConfirmChange(event.target.value)} placeholder="Confirmer le mot de passe" type="password" autoComplete="new-password" />
            </label>
            <button type="submit" className="casino-primary-button" disabled={busy}>
              {busy ? "Creation..." : "Creer le compte"}
            </button>
          </form>
        ) : null}

        {authMode === "forgot" ? (
          <form className="casino-auth-form" onSubmit={onForgotSubmit}>
            <label>
              Email
              <input value={forgotEmail} onChange={(event) => onForgotEmailChange(event.target.value)} placeholder="joueur@exemple.com" type="email" autoComplete="email" />
            </label>
            <button type="submit" className="casino-primary-button" disabled={busy}>
              {busy ? "Envoi..." : "Recevoir le lien"}
            </button>
          </form>
        ) : null}

      </aside>
    </div>
  );
}
