import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import districtArtwork from "./images/ChatGPT Image 2 avr. 2026, 21_17_56.png";
import cardArtwork from "./images/Cartes de pirate au crépuscule.png";
import freshVideo from "./videos/fresh.mp4";
import CasinoAuthScreen from "./features/app/components/CasinoAuthScreen";
import CasinoGameScreen from "./features/app/components/CasinoGameScreen";
import LoadingPanel from "./features/app/components/LoadingPanel";
import { useCasinoMedia } from "./features/app/useCasinoMedia";
import { useCasinoSession } from "./features/app/useCasinoSession";

const PirateSlotsGame = lazy(() => import("./PirateSlotsGame"));

export default function App() {
  const session = useCasinoSession();
  const [ambientPanel, setAmbientPanel] = useState<ReactNode>(null);
  const media = useCasinoMedia({
    activeCasinoRoom: session.activeCasinoRoom,
    profileLoaded: Boolean(session.profile),
  });

  useEffect(() => {
    if (!session.profile || !session.pendingImmersionName) return;
    const nextImmersionName = session.consumePendingImmersionName();
    if (!nextImmersionName) return;
    void media.startConnectionImmersion(nextImmersionName);
  }, [session.profile, session.pendingImmersionName]);

  if (session.booting) {
    return (
      <main className="casino-shell casino-shell--loading">
        <div className="casino-portrait-lock" role="alert" aria-live="polite">
          <div className="casino-portrait-lock__card">
            <strong>Mode portrait requis</strong>
            <p>Tourne ton telephone en mode portrait pour acceder au casino.</p>
          </div>
        </div>
        <div className="casino-app-content">
          <LoadingPanel label="Ouverture du salon prive..." />
        </div>
      </main>
    );
  }

  return (
    <main className={`casino-shell ${session.profile ? "casino-shell--game" : ""}`}>
      <div className="casino-portrait-lock" role="alert" aria-live="polite">
        <div className="casino-portrait-lock__card">
          <strong>Mode portrait requis</strong>
          <p>Tourne ton telephone en mode portrait pour acceder au casino.</p>
        </div>
      </div>
      <div className="casino-app-content">
        {!session.profile ? (
          <CasinoAuthScreen
            authMode={session.authMode}
            busy={session.busy}
            error={session.error}
            notice={session.notice}
            loginName={session.loginName}
            loginPassword={session.loginPassword}
            registerName={session.registerName}
            registerEmail={session.registerEmail}
            registerPassword={session.registerPassword}
            registerPasswordConfirm={session.registerPasswordConfirm}
            forgotEmail={session.forgotEmail}
            onAuthModeChange={session.setAuthMode}
            onLoginNameChange={session.setLoginName}
            onLoginPasswordChange={session.setLoginPassword}
            onRegisterNameChange={session.setRegisterName}
            onRegisterEmailChange={session.setRegisterEmail}
            onRegisterPasswordChange={session.setRegisterPassword}
            onRegisterPasswordConfirmChange={session.setRegisterPasswordConfirm}
            onForgotEmailChange={session.setForgotEmail}
            onLoginSubmit={(event) => {
              void media.requestMediaPlayback();
              void session.handleLogin(event);
            }}
            onRegisterSubmit={(event) => {
              void media.requestMediaPlayback();
              void session.handleRegister(event);
            }}
            onForgotSubmit={() => {
              void media.requestMediaPlayback();
              session.handleForgot();
            }}
          />
        ) : (
          <CasinoGameScreen
            profile={session.profile}
            busy={session.busy}
            error={session.error}
            notice={session.notice}
            displayName={session.displayName}
            activeCasinoRoom={session.activeCasinoRoom}
            showImmersion={media.showImmersion}
            immersionLine={media.immersionLine}
            mediaReady={media.mediaReady}
            ambientVideoAudible={media.ambientVideoAudible}
            ambientVideoRef={media.ambientVideoRef}
            ambientPanel={ambientPanel}
            freshVideo={freshVideo}
            districtArtwork={districtArtwork}
            cardArtwork={cardArtwork}
            onClaimBonus={session.handleClaimBonus}
            onRefreshProfile={() => void session.refreshProfile("Compte synchronise.")}
            onLogout={() => {
              media.resetMediaSession();
              session.handleLogout();
            }}
            onRoomChange={session.setActiveCasinoRoom}
            gameTable={(
              <Suspense fallback={<LoadingPanel label="Chargement de la table..." />}>
                <PirateSlotsGame
                  profile={session.profile}
                  busy={session.busy}
                  mediaReady={media.mediaReady}
                  immersionActive={media.showImmersion}
                  connectionImmersionPending={Boolean(session.pendingImmersionName) || media.showImmersion}
                  slotsIntroDelayActive={media.slotsIntroDelayActive}
                  ambientVideoAudible={media.ambientVideoAudible}
                  ambientVideoRef={media.ambientVideoRef}
                  freshVideo={freshVideo}
                  activeRoom={session.activeCasinoRoom}
                  onRouletteEvent={media.handleRouletteEvent}
                  onAmbientPanelChange={setAmbientPanel}
                  onRequestMediaPlayback={() => {
                    void media.requestMediaPlayback();
                  }}
                  onProfileChange={session.handleProfileChange}
                  onError={session.setError}
                  onRoomChange={session.setActiveCasinoRoom}
                />
              </Suspense>
            )}
          />
        )}
      </div>
    </main>
  );
}
