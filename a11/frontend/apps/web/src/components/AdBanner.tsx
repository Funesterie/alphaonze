import React from 'react';

interface AdBannerProps {
  position?: 'top' | 'bottom' | 'sidebar';
  style?: React.CSSProperties;
}

const SALES_CONTACT_EMAIL = 'funeste38@gmail.com';

function buildQualifiedSalesLink(subject: string, body: string) {
  return `mailto:${SALES_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function AdBanner({ position = 'bottom', style }: AdBannerProps) {
  const ads = [
    {
      title: 'A11 Pro - assistant sur mesure',
      description: 'Un assistant personnalise pour documents, voix, creation, suivi et automatisations utiles.',
      price: 'Sur devis',
      cta: 'Parler du projet',
      link: buildQualifiedSalesLink(
        'Projet A11 sur mesure',
        'Bonjour,\n\nJe souhaite parler d un projet A11 sur mesure.\n\nContexte:\nBesoin principal:\nDelais:\nBudget estime:\n\nMerci.'
      ),
      highlight: true,
    },
    {
      title: 'A11 Studio - creation et documents',
      description: 'Images, videos, audio, resumes et documents depuis les fichiers que tu choisis de partager.',
      price: '9 EUR/mois',
      cta: 'Activer Studio',
      link: '/subscription',
      highlight: false,
    },
  ];

  const [currentAd, setCurrentAd] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentAd((prev) => (prev + 1) % ads.length);
    }, 10000);

    return () => clearInterval(interval);
  }, [ads.length]);

  const ad = ads[currentAd];

  const baseStyle: React.CSSProperties = {
    background: ad.highlight
      ? 'linear-gradient(135deg, #041018 0%, #0f766e 54%, #365314 100%)'
      : 'linear-gradient(135deg, #041018 0%, #0e7490 56%, #166534 100%)',
    color: '#ecfeff',
    padding: position === 'sidebar' ? '15px' : '20px',
    borderRadius: '8px',
    border: '1px solid rgba(45, 212, 191, 0.26)',
    marginBottom: position === 'bottom' ? '20px' : '0',
    marginTop: position === 'top' ? '20px' : '0',
    boxShadow: '0 18px 44px rgba(0, 0, 0, 0.28)',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
    ...style,
  };

  const handleClick = () => {
    if (ad.link.startsWith('http') || ad.link.startsWith('mailto')) {
      window.open(ad.link, '_blank');
    } else {
      window.location.href = ad.link;
    }
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = 'translateY(-2px)';
    e.currentTarget.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.15)';
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleClick();
  };

  return (
    <div
      style={baseStyle}
      role="button"
      tabIndex={0}
      aria-label={`${ad.cta}: ${ad.title}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '15px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: position === 'sidebar' ? '14px' : '16px', fontWeight: 'bold', marginBottom: '5px' }}>
            {ad.title}
          </div>
          <div style={{ fontSize: position === 'sidebar' ? '12px' : '14px', opacity: 0.9, marginBottom: '8px' }}>
            {ad.description}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: position === 'sidebar' ? '16px' : '18px', fontWeight: 'bold' }}>
              {ad.price}
            </span>
            <button
              type="button"
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid rgba(209, 250, 229, 0.42)',
                color: '#ecfeff',
                minHeight: 44,
                padding: position === 'sidebar' ? '5px 10px' : '8px 16px',
                borderRadius: '4px',
                fontSize: position === 'sidebar' ? '12px' : '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
            >
              {ad.cta}
            </button>
          </div>
        </div>
        <div style={{ fontSize: position === 'sidebar' ? '24px' : '32px', opacity: 0.8 }}>
          {ad.highlight ? 'A11' : 'CR'}
        </div>
      </div>
    </div>
  );
}
