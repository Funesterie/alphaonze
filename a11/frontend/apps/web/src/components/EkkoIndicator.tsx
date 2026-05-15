import { useEffect, useRef, useState } from 'react';
import { fetchEkkoStatus, type EkkoStatusResponse } from '../lib/api';

/**
 * EkkoIndicator — point rouge pulsant quand Ekko est actif (listening = true).
 *
 * Poll toutes les 5s. Si le serveur est injoignable, pas d'erreur visible.
 * Tooltip : dernière app détectée + nombre total d'events.
 */

const POLL_INTERVAL_MS = 5_000;

export function EkkoIndicator() {
  const [status, setStatus] = useState<EkkoStatusResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function poll() {
    try {
      const s = await fetchEkkoStatus();
      setStatus(s);
    } catch {
      // silence — Ekko peut ne pas être démarré
    } finally {
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }

  useEffect(() => {
    poll();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status?.listening) return null;

  const tooltip = [
    'Ekko actif',
    status.stats.last_app ? `app: ${status.stats.last_app}` : null,
    `${status.stats.total_received} event${status.stats.total_received !== 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: '#ef4444',
        boxShadow: '0 0 0 0 rgba(239,68,68,0.7)',
        animation: 'ekko-pulse 1.4s ease-in-out infinite',
        verticalAlign: 'middle',
        marginLeft: 6,
        flexShrink: 0,
        cursor: 'default',
      }}
    />
  );
}
