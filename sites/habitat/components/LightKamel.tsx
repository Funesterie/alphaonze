'use client';

import { useState, useRef, useEffect } from 'react';

export default function LightKamel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ text: string; sender: 'user' | 'lightkamel' }>>([
    { text: "Salut ! Je suis LightKamel, assoiffé de succès et gardien de cet habitat. Explore, pose-moi des questions, ou demande à visiter une pièce.", sender: 'lightkamel' }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { text: input, sender: 'user' as const };
    setMessages(prev => [...prev, userMessage]);
    setInput('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, history: messages.slice(-5) }),
      });

      if (!response.ok) {
        throw new Error('LightKamel réfléchit trop fort...');
      }

      const data = await response.json();
      const lightkamelMessage = { text: data.message || "Je n'ai pas tout compris, mais cet habitat regorge de trésors à découvrir.", sender: 'lightkamel' as const };
      setMessages(prev => [...prev, lightkamelMessage]);
    } catch (error) {
      const fallbackMessage = { 
        text: "LightKamel (en mode local) : *Fait un geste élégant avec sa bosse* : \"Le MCP Server semble dormir. Je peux quand même t'aider avec ce que je sais !\"", 
        sender: 'lightkamel' as const 
      };
      setMessages(prev => [...prev, fallbackMessage]);
    }
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
  };

  // Suggestions de questions
  const suggestions = [
    "Qu'est-ce qu'il y a dans le Garden ?",
    "Montre-moi tes projets",
    "Raconte-moi une histoire"
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Bouton flottant */}
      <button
        onClick={toggleChat}
        className="w-14 h-14 rounded-full bg-gradient-to-br from-gold to-amber-600 shadow-lg hover:scale-110 transition-transform flex items-center justify-center border-2 border-[var(--cobalt)]"
        aria-label="Parler à LightKamel"
      >
        <svg className="w-8 h-8 text-[var(--cobalt)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {/* Camel minimaliste */}
          <path d="M3 10c0-4 4-8 8-8s8 4 8 8-4 4-8-4-8-4z" />
          <path d="M7 14h4v4" />
          <path d="M13 14h4v4" />
          <path d="M9 8V4" />
          <path d="M15 8V4" />
        </svg>
      </button>

      {/* Fenêtre de chat */}
      {isOpen && (
        <div className="absolute bottom-20 right-0 w-80 bg-[var(--surface)] border border-[var(--rule)] rounded-lg shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-[var(--cobalt)] text-white px-4 py-3 flex items-center gap-2">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10c0-4 4-8 8-8s8 4 8 8-4 4-8-4-8-4z" />
              <path d="M7 14h4v4" />
              <path d="M13 14h4v4" />
            </svg>
            <span className="font-bold text-sm">LightKamel</span>
            <span className="text-xs opacity-75">Assoiffé de succès</span>
          </div>

          {/* Messages */}
          <div className="h-80 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs rounded-lg px-4 py-2 ${
                    msg.sender === 'user'
                      ? 'bg-[var(--cobalt)] text-white'
                      : 'bg-[var(--cobalt-wash)] text-[var(--ink)]'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          <div className="px-4 pb-2">
            <div className="flex flex-wrap gap-1">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(s);
                    setTimeout(() => {
                      const form = document.getElementById('chat-form');
                      form?.dispatchEvent(new Event('submit', { cancelable: true }));
                    }, 0);
                  }}
                  className="text-xs px-2 py-1 bg-[var(--rule)] bg-opacity-20 rounded-full text-[var(--ink-soft)] hover:bg-[var(--cobalt-wash)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <form id="chat-form" onSubmit={handleSend} className="border-t border-[var(--rule)] p-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Parle à LightKamel..."
                className="flex-1 px-3 py-2 bg-[var(--ground)] text-[var(--ink)] rounded-lg border border-[var(--rule)] focus:outline-none focus:border-[var(--gold)]"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-[var(--gold)] text-white rounded-lg hover:bg-amber-600 transition-colors"
              >
                →
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bouton de fermeture */}
      {isOpen && (
        <button
          onClick={toggleChat}
          className="absolute bottom-16 right-2 w-6 h-6 bg-[var(--surface)] border border-[var(--rule)] rounded-full flex items-center justify-center text-[var(--ink-soft)] hover:bg-[var(--cobalt)] hover:text-white"
        >
          ×
        </button>
      )}
    </div>
  );
}
