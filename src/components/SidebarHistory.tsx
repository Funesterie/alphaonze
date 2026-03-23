import React, { useEffect, useState } from 'react';

export function SidebarHistory({ onSelect }) {
  const [convs, setConvs] = useState([]);

  useEffect(() => {
    fetch('/api/a11/memory/conversations')
      .then(r => r.json())
      .then(data => setConvs(data.entries || []));
  }, []);

  return (
    <div className="sidebar-history" style={{ width: 260, background: '#181a20', color: '#eee', height: '100vh', padding: '1rem', borderRight: '1px solid #222' }}>
      <h3 style={{ marginTop: 0, marginBottom: 16 }}>Historique</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {convs
          .filter(c => c.conversationId)
          .map((conv, idx) => (
            <li key={idx} style={{ marginBottom: 12 }}>
              <button
                onClick={() => onSelect(conv)}
                style={{
                  width: '100%',
                  background: '#23272f',
                  color: '#eee',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '1em',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{ fontWeight: 500 }}>
                  {conv.conversationId || 'Session'}
                </div>
                <div style={{ fontSize: '0.8em', color: '#888' }}>
                  {conv.ts && new Date(conv.ts).toLocaleString()}
                </div>
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
