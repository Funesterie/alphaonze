import React, { useEffect, useState } from 'react';
import {
  getSubscriptionStatus,
  createCheckoutSession,
  createCustomerPortal,
  cancelSubscription,
  createFunesterieContribution,
  type SubscriptionStatus
} from '../lib/api';

interface SubscriptionPanelProps {
  isAdmin: boolean;
  onClose?: () => void;
  productName?: string;
}

type CheckoutPlan = 'premium' | 'founder';

const SUBSCRIPTION_PLANS: Array<{
  id: CheckoutPlan;
  name: string;
  price: string;
  period: string;
  includedTokens: string;
  features: string[];
}> = [
  {
    id: 'premium',
    name: 'A11 Premium',
    price: '8,99 EUR',
    period: 'par mois',
    includedTokens: 'Chat long + crédits création inclus',
    features: [
      'Chat long et contexte mieux conservé',
      'Crédits mensuels pour images, audio, fichiers et exports',
      'Routage automatique vers le meilleur pipeline disponible',
      'Annulable à tout moment depuis le portail client',
    ],
  },
  {
    id: 'founder',
    name: 'Fondateur',
    price: '29,99 EUR',
    period: 'par mois',
    includedTokens: 'Priorité haute, IA custom future et permissions avancées',
    features: [
      'Priorité haute sur les jobs et files de traitement',
      'Accès fondateur aux outils avancés, sessions et connecteurs',
      'IA custom future: avatar, image, description d’entrée et prompt',
      'Providers IA personnels: OpenAI, Grok, Claude ou compatible',
      'Réglages avancés MCP, Neo4j et Docker avec garde-fous',
      'Canal de cadrage pour blueprint, gros achats et intégrations',
    ],
  },
];

const CONTRIBUTION_REWARDS = [
  '+10 à +40 crédits pour un retour utile, reproductible ou bien annoté',
  '+100 à +300 crédits pour un dataset, prompt, correction ou cas métier qui améliore A11',
  'Attribution après score de pertinence, sans revente ni publication automatique des apports',
];

const BLUEPRINT_OFFER = {
  price: '85 000 EUR+',
  label: 'Blueprint source qualifié',
  detail: 'Source, orchestration, mémoire, runbook, transfert technique et cadrage de déploiement.',
};

const SALES_CONTACT_EMAIL = 'funeste38@gmail.com';
const WERO_QR_URL = String(import.meta.env.VITE_A11_WERO_QR_URL || '/assets/wero-jeffrey-cellauro-qr.png').trim();
const PAYPAL_DONATION_URL = String(import.meta.env.VITE_A11_PAYPAL_URL || 'https://paypal.me/funeste38').trim();

function buildBlueprintContactLink() {
  return `mailto:${SALES_CONTACT_EMAIL}?subject=${encodeURIComponent('Qualification Blueprint A11')}&body=${encodeURIComponent(
    'Bonjour,\n\nJe souhaite qualifier une licence Blueprint A11.\n\nOrganisation:\nBesoin:\nBudget:\nDélai:\n\nMerci.'
  )}`;
}

function buildPaymentContactLink() {
  return `mailto:${SALES_CONTACT_EMAIL}?subject=${encodeURIComponent('Paiement A11')}&body=${encodeURIComponent(
    'Bonjour,\n\nJe souhaite cadrer un paiement A11.\n\nCompte A11 / email:\nOffre visée: Premium / Fondateur / Blueprint\nBesoin:\n\nMerci.'
  )}`;
}

function formatFrenchPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return value;
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

function openExternal(url: string) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function SubscriptionPanel({ isAdmin, onClose, productName = 'A11' }: SubscriptionPanelProps) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionLoadingPlan, setActionLoadingPlan] = useState<CheckoutPlan | null>(null);

  useEffect(() => {
    loadSubscriptionStatus();
  }, []);

  async function loadSubscriptionStatus() {
    setLoading(true);
    setError('');
    try {
      const data = await getSubscriptionStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(plan: CheckoutPlan = 'premium') {
    setActionLoading(true);
    setActionLoadingPlan(plan);
    setError('');
    try {
      const data = await createCheckoutSession(plan);
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de la souscription');
    } finally {
      setActionLoading(false);
      setActionLoadingPlan(null);
    }
  }

  async function handleManageSubscription() {
    setActionLoading(true);
    setError('');
    try {
      const data = await createCustomerPortal();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de l\'ouverture du portail');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelSubscription() {
    if (!window.confirm("Programmer le désabonnement à la fin de la période déjà payée ?")) return;
    setActionLoading(true);
    setError('');
    try {
      await cancelSubscription();
      await loadSubscriptionStatus();
    } catch (err) {
      setError((err as Error).message || "Erreur lors du désabonnement");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleContribute() {
    setActionLoading(true);
    setError('');
    try {
      const result = await createFunesterieContribution('royalties');
      if (result.ok && result.url) {
        window.location.href = result.url;
      } else {
        setError(result.error || 'Contribution indisponible pour le moment');
      }
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de la contribution');
    } finally {
      setActionLoading(false);
    }
  }

  function formatDate(dateString?: string | number | null) {
    if (!dateString) return 'N/A';
    try {
      const date = typeof dateString === 'number' 
        ? new Date(dateString * 1000) 
        : new Date(dateString);
      return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);
    } catch {
      return 'N/A';
    }
  }

  const panelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    padding: '24px',
    maxWidth: '760px',
    margin: '0 auto',
  };

  const cardStyle: React.CSSProperties = {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '20px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: '#7c3aed',
    color: 'white',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: '#334155',
    color: '#e2e8f0',
  };

  const dangerButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: '#7f1d1d',
    color: '#fecaca',
    border: '1px solid #dc2626',
  };

  const paymentGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: '10px',
    marginTop: '16px',
  };

  const paymentTileStyle: React.CSSProperties = {
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '12px',
    background: '#111827',
    minHeight: '132px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: '10px',
  };

  const paymentTileButtonStyle: React.CSSProperties = {
    ...secondaryButtonStyle,
    width: '100%',
    padding: '9px 12px',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
  };

  const subscriptionPlans = SUBSCRIPTION_PLANS.map((plan) => ({
    ...plan,
    name: plan.id === 'premium' && productName === 'Kaen44' ? 'Kaen44 Premium' : plan.name.replace(/\bA11\b/g, productName),
    includedTokens: plan.includedTokens.replace(/\bA11\b/g, productName),
    features: plan.features.map((feature) => feature.replace(/\bA11\b/g, productName)),
  }));
  const activeTier = String(status?.tier || status?.plan || '').toLowerCase();
  const isFounderAccount = Boolean(
    isAdmin
    || status?.fullAccess
    || activeTier.includes('founder')
    || activeTier.includes('fondateur')
    || activeTier.includes('admin')
  );
  const founderPayment = isFounderAccount ? status?.founderPayment : null;
  const activePlan = activeTier.includes('founder') || activeTier.includes('fondateur')
    ? subscriptionPlans.find((plan) => plan.id === 'founder') || subscriptionPlans[1]
    : subscriptionPlans[0];
  const contributionRewards = CONTRIBUTION_REWARDS.map((reward) => reward.replace(/\bA11\b/g, productName));
  const subscriptionTitle = productName === 'Kaen44' ? 'Abonnement Kaen44' : 'Abonnement A11';

  if (loading) {
    return (
      <div style={panelStyle}>
        <h2 style={{ margin: 0, color: '#f1f5f9' }}>{subscriptionTitle}</h2>
        <div style={{ ...cardStyle, textAlign: 'center', padding: '40px' }}>
          <div style={{ color: '#94a3b8' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (isAdmin || status?.fullAccess) {
    return (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: '#f1f5f9' }}>{subscriptionTitle}</h2>
          {onClose && (
            <button
              onClick={onClose}
              style={{ ...secondaryButtonStyle, padding: '8px 16px' }}
            >
              Fermer
            </button>
          )}
        </div>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>👑</div>
          <h3 style={{ margin: '0 0 8px 0', color: '#f1f5f9' }}>
            {isAdmin ? 'Accès administrateur' : 'Accès gratuit complet'}
          </h3>
          <p style={{ margin: 0, color: '#94a3b8' }}>
            Vous avez un accès complet à {productName}, aux quotas internes et à la supervision des crédits.
          </p>
        </div>
        {founderPayment?.available && founderPayment.ribUrl && (
          <div style={cardStyle}>
            <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '16px' }}>Paiement fondateur réservé</div>
            <p style={{ margin: '8px 0 14px', color: '#94a3b8', fontSize: '13px' }}>
              Coordonnées bancaires pour blueprint, achats importants et paiements qualifiés.
              {founderPayment.phone ? ` Contact: ${formatFrenchPhone(founderPayment.phone)}.` : ''}
            </p>
            <button
              type="button"
              onClick={() => openExternal(founderPayment.ribUrl || '')}
              style={secondaryButtonStyle}
            >
              Ouvrir le RIB
            </button>
          </div>
        )}
      </div>
    );
  }

  const isActive = status?.active || false;
  const willCancel = status?.stripeStatus?.cancelAtPeriodEnd || false;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, color: '#f1f5f9' }}>{subscriptionTitle}</h2>
        {onClose && (
          <button
            onClick={onClose}
            style={{ ...secondaryButtonStyle, padding: '8px 16px' }}
          >
            Fermer
          </button>
        )}
      </div>

      {error && (
        <div style={{
          background: '#7f1d1d',
          border: '1px solid #991b1b',
          borderRadius: '8px',
          padding: '12px 16px',
          color: '#fecaca',
          fontSize: '14px',
        }}>
          {error}
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '32px' }}>
            {isActive ? '✅' : '❌'}
          </div>
          <div>
            <h3 style={{ margin: '0 0 4px 0', color: '#f1f5f9' }}>
              {isActive ? 'Abonnement actif' : 'Pas d\'abonnement'}
            </h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
              {isActive 
                ? willCancel 
                  ? `Actif jusqu'au ${formatDate(status?.stripeStatus?.currentPeriodEnd)}`
                  : `Renouvellement le ${formatDate(status?.stripeStatus?.currentPeriodEnd)}`
                : `Activez ${activePlan.name} pour obtenir le chat long et des crédits création`
              }
            </p>
          </div>
        </div>

        {!isActive && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '12px',
            marginBottom: '16px',
          }}>
            {subscriptionPlans.map((plan) => {
              const loadingThisPlan = actionLoadingPlan === plan.id;
              return (
                <div
                  key={plan.id}
                  style={{
                    background: '#0f172a',
                    border: plan.id === 'founder' ? '1px solid #a855f7' : '1px solid #334155',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div>
                      <div style={{ color: '#f1f5f9', fontWeight: 'bold', fontSize: '18px' }}>{plan.name}</div>
                      <div style={{ color: '#38bdf8', fontSize: '13px', marginTop: '4px' }}>{plan.includedTokens}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span style={{ color: '#f1f5f9', fontWeight: 'bold', fontSize: '22px' }}>{plan.price}</span>
                      <div style={{ color: '#94a3b8', fontSize: '13px' }}>{plan.period}</div>
                    </div>
                  </div>
                  <ul style={{ margin: '0', paddingLeft: '18px', color: '#cbd5e1', fontSize: '13px' }}>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={actionLoading}
                    style={{
                      ...(plan.id === 'founder' ? primaryButtonStyle : secondaryButtonStyle),
                      marginTop: 'auto',
                      opacity: actionLoading ? 0.6 : 1,
                      cursor: actionLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loadingThisPlan
                      ? 'Chargement...'
                      : plan.id === 'founder'
                        ? 'Devenir Fondateur'
                        : 'Activer Premium'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {isActive && (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleManageSubscription}
              disabled={actionLoading}
              style={{
                ...primaryButtonStyle,
                opacity: actionLoading ? 0.6 : 1,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading ? 'Chargement...' : 'Gérer mon abonnement'}
            </button>

            {/* Accès au portail Stripe (factures) */}
            <button
              onClick={handleManageSubscription}
              disabled={actionLoading}
              style={{
                ...secondaryButtonStyle,
                opacity: actionLoading ? 0.6 : 1,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              🧾 {actionLoading ? 'Chargement...' : 'Mes factures'}
            </button>
            {willCancel ? (
              <span style={{
                alignSelf: 'center',
                color: '#fbbf24',
                fontWeight: 800,
                fontSize: '13px',
              }}>
                Désabonnement programmé
              </span>
            ) : (
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                style={{
                  ...dangerButtonStyle,
                  opacity: actionLoading ? 0.6 : 1,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {actionLoading ? 'Chargement...' : 'Se désabonner'}
              </button>
            )}
          </div>
        )}

        {!isActive && (
          <div style={{ borderTop: '1px solid #1e293b', marginTop: '18px', paddingTop: '16px' }}>
            <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '15px' }}>
              Moyens de paiement disponibles
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
              Stripe active les abonnements automatiquement. Wero reste un don libre, et le virement n'apparaît qu'aux comptes fondateurs.
            </div>

            <div style={paymentGridStyle}>
              <div style={paymentTileStyle}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Stripe Checkout</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                    Carte, wallets, Link et moyens locaux selon pays. Choisissez Premium ou Fondateur ci-dessus.
                  </div>
                </div>
                <div style={{ color: '#a7f3d0', fontSize: '12px', fontWeight: 800 }}>
                  Activation automatique par webhook
                </div>
              </div>

              <div style={{ ...paymentTileStyle, minHeight: 210 }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Don Wero</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                    Scannez le QR code pour un don libre. Aucun numéro public n'est affiché.
                  </div>
                </div>
                <a
                  href={WERO_QR_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Agrandir le QR code Wero"
                  style={{
                    alignSelf: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#38bdf8',
                    fontSize: '12px',
                    fontWeight: 800,
                    textDecoration: 'none',
                  }}
                >
                  <img
                    src={WERO_QR_URL}
                    alt="QR code Wero"
                    style={{
                      width: '100%',
                      maxWidth: '176px',
                      aspectRatio: '1 / 1',
                      objectFit: 'contain',
                      background: '#ffffff',
                      borderRadius: '8px',
                      padding: '8px',
                    }}
                  />
                  Agrandir le QR
                </a>
              </div>

              <div style={paymentTileStyle}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Don PayPal</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                    PayPal.me Funesterie pour les pourboires et coups de pouce, montant libre.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openExternal(PAYPAL_DONATION_URL)}
                  style={paymentTileButtonStyle}
                >
                  Ouvrir PayPal
                </button>
              </div>

              {founderPayment?.available && founderPayment.ribUrl && (
                <div style={paymentTileStyle}>
                  <div>
                    <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Virement bancaire</div>
                    <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                      Réservé aux comptes fondateurs pour blueprint, gros achats et paiements qualifiés.
                    </div>
                    {founderPayment.phone && (
                      <div style={{ color: '#38bdf8', fontSize: '13px', marginTop: '6px', fontWeight: 800 }}>
                        Tél. fondateur: {formatFrenchPhone(founderPayment.phone)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openExternal(founderPayment.ribUrl || '')}
                    style={paymentTileButtonStyle}
                  >
                    Ouvrir le RIB
                  </button>
                </div>
              )}

              <div style={paymentTileStyle}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Devis ou autre moyen</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                    Pour facture, preuve de paiement, changement d'offre ou paiement manuel.
                  </div>
                </div>
                <a
                  href={buildPaymentContactLink()}
                  style={paymentTileButtonStyle}
                >
                  Contacter
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{
        ...cardStyle,
        background: 'linear-gradient(135deg, #2e1065 0%, #1e293b 100%)',
        border: '1px solid #7c3aed',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '16px' }}>💜 Soutenir la Funesterie</div>
          <div style={{ color: '#c4b5fd', fontSize: '13px', marginTop: '6px' }}>
            Contribution libre pour participer à l'évolution de la Funesterie. Montant au choix (à partir de 2 €), sans abonnement.
          </div>
        </div>
        <button
          type="button"
          onClick={handleContribute}
          disabled={actionLoading}
          style={{
            ...primaryButtonStyle,
            opacity: actionLoading ? 0.6 : 1,
            cursor: actionLoading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {actionLoading ? 'Chargement...' : 'Faire un don'}
        </button>
      </div>

      {isActive && (
        <div style={{
          background: '#064e3b',
          border: '1px solid #065f46',
          borderRadius: '8px',
          padding: '12px 16px',
          color: '#a7f3d0',
          fontSize: '14px',
        }}>
          <strong>Merci pour votre soutien !</strong> Vous avez accès à {activePlan.name}, au chat long et aux crédits de création.
        </div>
      )}

      <div style={{
        ...cardStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '16px' }}>{BLUEPRINT_OFFER.label}</div>
          <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '6px' }}>{BLUEPRINT_OFFER.detail}</div>
          <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '8px' }}>
            Contact qualifié par email; téléphone transmis uniquement après cadrage.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '22px' }}>{BLUEPRINT_OFFER.price}</div>
          <a
            href={buildBlueprintContactLink()}
            style={{
              ...secondaryButtonStyle,
              marginTop: '10px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
            }}
          >
            Qualifier le Blueprint
          </a>
        </div>
      </div>
    </div>
  );
}
