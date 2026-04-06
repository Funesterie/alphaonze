// A11 VS Extension Chat Component
// Composant React pour communiquer avec Visual Studio Extension via WebView2
import { useEffect, useState, useRef } from 'react';
import { vsBridge } from '../vsbridge';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
}

export function VSChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [isVSMode, setIsVSMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Detect if running inside Visual Studio WebView2
    const inVS = !!(window as any).chrome?.webview;
    setIsVSMode(inVS);

    if (inVS) {
      // Set up VS bridge handlers
      vsBridge.on('messageResponse', (data) => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        }]);
        setIsLoading(false);
      });

      vsBridge.on('error', (data) => {
        setMessages(prev => [...prev, {
          role: 'error',
          content: data.message,
          timestamp: new Date()
        }]);
        setIsLoading(false);
      });

      vsBridge.on('settings', (data) => {
        setEndpoint(data.endpoint);
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Connected to A11 backend: ${data.endpoint}`,
          timestamp: new Date()
        }]);
      });

      // Request settings
      vsBridge.getSettings();
    } else {
      setMessages([{
        role: 'system',
        content: 'Running in standalone mode. Open in Visual Studio to connect to backend.',
        timestamp: new Date()
      }]);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    if (isVSMode) {
      vsBridge.sendMessage(input);
    } else {
      // Fallback: standalone mode (optional)
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'system',
          content: 'Not connected to Visual Studio. Please open this in VS Extension.',
          timestamp: new Date()
        }]);
        setIsLoading(false);
      }, 500);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="vs-chat-panel">
      <div className="vs-chat-header">
        <h1>💬 A11 (funesterie)</h1>
        <div className="vs-chat-status">
          {isVSMode ? (
            <>
              <span className="status-indicator connected" />
              <span className="status-text">
                Connected {endpoint && `to ${endpoint}`}
              </span>
            </>
          ) : (
            <>
              <span className="status-indicator disconnected" />
              <span className="status-text">Standalone Mode</span>
            </>
          )}
        </div>
      </div>

      <div className="vs-chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message message-${msg.role}`}>
            <div className="message-header">
              <span className="message-role">
                {msg.role === 'user' ? '👤 You' : 
                 msg.role === 'assistant' ? '🤖 A11' :
                 msg.role === 'system' ? 'ℹ️ System' : 
                 '⚠️ Error'}
              </span>
              <span className="message-time">
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="message message-assistant">
            <div className="message-content loading">
              <span className="loading-dot">●</span>
              <span className="loading-dot">●</span>
              <span className="loading-dot">●</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="vs-chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
          disabled={isLoading}
          rows={3}
        />
        <button 
          onClick={handleSend} 
          disabled={isLoading || !input.trim()}
          className="send-button"
        >
          {isLoading ? '⏳' : '📤'} Send
        </button>
      </div>
    </div>
  );
}
