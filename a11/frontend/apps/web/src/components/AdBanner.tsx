import React from 'react';

interface AdBannerProps {
  position?: 'top' | 'bottom' | 'sidebar';
  style?: React.CSSProperties;
}

export function AdBanner({ position = 'bottom', style }: AdBannerProps) {
  const ads = [
    {
      title: '🚀 A11 Blueprint - Code Source Complet',
      description: 'Lancez votre propre assistant IA en quelques jours. Backend + Frontend + Infrastructure prêts.',
      price: '8000€',
      cta: 'Découvrir le Blueprint',
      link: 'mailto:djeff@funesterie.pro?subject=Achat%20Blueprint%20A11',
      highlight: true,
    },
    {
      title: '💎 Passez à A11 Premium',
      description: 'Générations d\'images illimitées, vidéos, support prioritaire.',
      price: '2,99€/mois',
      cta: 'Upgrade Premium',
      link: '/subscription',
      highlight: false,
    },
  ];

  // Rotation des pubs
  const [currentAd, setCurrentAd] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentAd((prev) => (prev + 1) % ads.length);
    }, 10000); // Change toutes les 10 secondes

    return () => clearInterval(interval);
  }, [ads.length]);

  const ad = ads[currentAd];

  const baseStyle: React.CSSProperties = {
    background: ad.highlight
      ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      : 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    color: 'white',
    padding: position === 'sidebar' ? '15px' : '20px',
    borderRadius: '8px',
    marginBottom: position === 'bottom' ? '20px' : '0',
    marginTop: position === 'top' ? '20px' : '0',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
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

  return (
    <div
      style={baseStyle}
      onClick={handleClick}
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
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                color: 'white',
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
        {ad.highlight && (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              padding: '5px 10px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
            }}
          >
            🔥 HOT
          </div>
        )}
      </div>
      {/* Indicateur de rotation */}
      <div style={{ display: 'flex', gap: '5px', marginTop: '10px', justifyContent: 'center' }}>
        {ads.map((_, index) => (
          <div
            key={index}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: index === currentAd ? 'white' : 'rgba(255, 255, 255, 0.3)',
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>
    </div>
  );
}
