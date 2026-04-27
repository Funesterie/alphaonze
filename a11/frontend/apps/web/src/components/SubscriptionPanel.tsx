import React, { useEffect, useState } from 'react';
import { 
  getSubscriptionStatus, 
  createCheckoutSession, 
  createCustomerPortal,
  type SubscriptionStatus 
} from '../lib/api';

interface SubscriptionPanelProps {
  isAdmin: boolean;
  onClose?: () => void;
}

export function SubscriptionPanel({ isAdmin, onClose }: SubscriptionPanelProps) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

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

  async function handleSubscribe() {
    setActionLoading(true);
    setError('');
    try {
      const data = await createCheckoutSession();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de la souscription');
    } finally {
      setActionLoading(false);
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
    maxWidth: '600px',
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

  if (loading) {
    return (
      <div style={panelStyle}>
        <h2 style={{ margin: 0, color: '#f1f5f9' }}>Abonnement A11</h2>
        <div style={{ ...cardStyle, textAlign: 'center', padding: '40px' }}>
          <div style={{ color: '#94a3b8' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: '#f1f5f9' }}>Abonnement A11</h2>
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
          <h3 style={{ margin: '0 0 8px 0', color: '#f1f5f9' }}>Accès Administrateur</h3>
          <p style={{ margin: 0, color: '#94a3b8' }}>
            Vous avez un accès illimité à toutes les fonctionnalités A11 sans abonnement.
          </p>
        </div>
      </div>
    );
  }

  const isActive = status?.active || false;
  const willCancel = status?.stripeStatus?.cancelAtPeriodEnd || false;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, color: '#f1f5f9' }}>Abonnement A11</h2>
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
              {isActive ? 'Abonnement Actif' : 'Pas d\'abonnement'}
            </h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
              {isActive 
                ? willCancel 
                  ? `Actif jusqu'au ${formatDate(status?.stripeStatus?.currentPeriodEnd)}`
                  : `Renouvellement le ${formatDate(status?.stripeStatus?.currentPeriodEnd)}`
                : 'Souscrivez pour accéder aux fonctionnalités premium'
              }
            </p>
          </div>
        </div>

        {!isActive && (
          <div style={{
            background: '#0f172a',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color: '#f1f5f9', fontWeight: 'bold', fontSize: '24px' }}>2,99€</span>
              <span style={{ color: '#94a3b8', fontSize: '14px' }}>par mois</span>
            </div>
            <ul style={{ margin: '0', paddingLeft: '20px', color: '#cbd5e1', fontSize: '14px' }}>
              <li>Génération d'images illimitée</li>
              <li>Génération de vidéos</li>
              <li>Accès prioritaire aux nouvelles fonctionnalités</li>
              <li>Annulable à tout moment</li>
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {!isActive ? (
            <button
              onClick={handleSubscribe}
              disabled={actionLoading}
              style={{
                ...primaryButtonStyle,
                opacity: actionLoading ? 0.6 : 1,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading ? 'Chargement...' : 'S\'abonner maintenant'}
            </button>
          ) : (
            <button
              onClick={handleManageSubscription}
              disabled={actionLoading}
              style={{
                ...secondaryButtonStyle,
                opacity: actionLoading ? 0.6 : 1,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading ? 'Chargement...' : 'Gérer mon abonnement'}
            </button>
          )}
        </div>
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
          <strong>Merci pour votre soutien !</strong> Vous avez accès à toutes les fonctionnalités premium d'A11.
        </div>
      )}
    </div>
  );
}
