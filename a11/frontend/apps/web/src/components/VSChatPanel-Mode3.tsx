// A11 VS Extension Chat Component
// Composant React pour communiquer avec Visual Studio Extension via WebView2
import { useEffect, useState, useRef } from 'react';
import { vsBridge } from '../vsbridge';
import { executeA11Command, waitForWebView2Ready, isA11HostAvailable, A11Command } from '../lib/a11host';
import { speak, cancelSpeech, isSpeaking } from '../lib/speech';
import './VSChatPanel-Mode3.css';

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
  const [hasHostAPI, setHasHostAPI] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initializeWebView = async () => {
      // Detect if running inside Visual Studio WebView2
      const inVS = !!(window as any).chrome?.webview;
      setIsVSMode(inVS);

      if (inVS) {
        // Wait for WebView2 to be ready
        setMessages(prev => [...prev, {
          role: 'system',
          content: '⏳ Initializing WebView2...',
          timestamp: new Date()
        }]);

        const ready = await waitForWebView2Ready(10000); // 10s timeout
        const hasAPI = isA11HostAvailable();
        setHasHostAPI(hasAPI);

        if (!ready || !hasAPI) {
          setMessages(prev => [...prev, {
            role: 'error',
            content: '⚠️ WebView2 API non disponible. Mode 3 désactivé.',
            timestamp: new Date()
          }]);
        }

        // Set up VS bridge handlers
        vsBridge.on('messageResponse', async (data) => {
          // 🔥 INTERROMPRE toute lecture vocale en cours avant nouvelle réponse
          if (isSpeaking()) {
            cancelSpeech();
            console.log('[VSChatPanel] Lecture vocale précédente interrompue');
          }

          // Try to parse response as command
          const handled = await tryExecuteCommand(data.response);
          
          if (!handled) {
            // Normal text response
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: data.response,
              timestamp: new Date()
            }]);

            // 🔊 Lire la réponse si voice activée
            if (voiceEnabled && data.response) {
              speak(data.response, { lang: 'fr-FR' });
            }
          }
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

        vsBridge.on('settings', async (data) => {
          setEndpoint(data.endpoint);
          setMessages(prev => [...prev, {
            role: 'system',
            content: `Connected to A11 backend: ${data.endpoint}${hasAPI ? ' | Mode 3 API available ✅' : ''}`,
            timestamp: new Date()
          }]);

          // 🔥 Envoyer automatiquement le contexte workspace à A-11
          if (hasAPI) {
            try {
              const { formatWorkspaceContextForA11 } = await import('../lib/a11host');
              const contextMsg = await formatWorkspaceContextForA11();
              
              // Envoyer ce contexte en tant que message système à A-11
              vsBridge.sendMessage(contextMsg);
              
              setMessages(prev => [...prev, {
                role: 'system',
                content: '📍 Contexte workspace envoyé à A-11',
                timestamp: new Date()
              }]);
            } catch (err) {
              console.error('Failed to send workspace context:', err);
            }
          }
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
    };

    initializeWebView();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Tente d'exécuter une commande VS si le message est au format JSON
   */
  const tryExecuteCommand = async (response: string): Promise<boolean> => {
    if (!hasHostAPI) return false;

    try {
      const parsed = JSON.parse(response);
      
      // Détecte les commandes A-11
      if (parsed.kind === 'vs_command' || parsed.type) {
        const cmd: A11Command = {
          type: parsed.command || parsed.type,
          path: parsed.path,
          line: parsed.line,
          content: parsed.content,
          command: parsed.shellCommand || parsed.cmd,
          args: parsed.args,
          directory: parsed.directory,
          name: parsed.name,
        };

        // Message optionnel d'A-11
        if (parsed.message) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: parsed.message,
            timestamp: new Date()
          }]);
        }

        // Affiche ce qui va être exécuté
        let actionMsg = '';
        switch (cmd.type) {
          case 'open_file':
            actionMsg = `📂 Ouverture de ${cmd.path?.split('\\').pop()}`;
            break;
          case 'goto_line':
            actionMsg = `📍 Navigation vers ${cmd.path?.split('\\').pop()}:${cmd.line}`;
            break;
          case 'read_file':
            actionMsg = `📖 Lecture de ${cmd.path?.split('\\').pop()}`;
            break;
          case 'write_file':
            actionMsg = `✍️ Écriture dans ${cmd.path?.split('\\').pop()}`;
            break;
          case 'execute_shell':
            actionMsg = `⚡ Exécution: ${cmd.command}`;
            break;
          case 'build':
            actionMsg = `🔨 Build de la solution`;
            break;
          case 'get_workspace_root':
            actionMsg = `📁 Récupération du workspace root`;
            break;
          case 'get_open_documents':
            actionMsg = `📋 Liste des documents ouverts`;
            break;
          default:
            actionMsg = `🔧 Exécution: ${cmd.type}`;
        }

        setMessages(prev => [...prev, {
          role: 'system',
          content: actionMsg,
          timestamp: new Date()
        }]);

        const result = await executeA11Command(cmd);
        
        // Affiche le résultat selon le type
        let resultMsg = '';
        if (result.success === false) {
          resultMsg = `❌ Erreur: ${result.error}`;
        } else {
          switch (cmd.type) {
            case 'read_file':
              if (typeof result === 'string' && result) {
                const preview = result.length > 500 ? result.substring(0, 500) + '...' : result;
                resultMsg = `✅ Fichier lu (${result.length} caractères):\n\`\`\`\n${preview}\n\`\`\``;
              } else {
                resultMsg = `❌ Fichier introuvable ou vide`;
              }
              break;
            case 'execute_shell':
              resultMsg = `✅ Sortie:\n\`\`\`\n${result}\n\`\`\``;
              break;
            case 'get_workspace_root':
              resultMsg = `✅ Workspace: ${result}`;
              break;
            case 'get_open_documents':
              if (Array.isArray(result) && result.length > 0) {
                resultMsg = `✅ Documents ouverts (${result.length}):\n${result.map(d => `- ${d.split('\\').pop()}`).join('\n')}`;
              } else {
                resultMsg = `ℹ️ Aucun document ouvert`;
              }
              break;
            case 'open_file':
            case 'goto_line':
            case 'write_file':
            case 'build':
              resultMsg = result ? '✅ Commande exécutée' : '❌ Échec';
              break;
            default:
              resultMsg = '✅ Commande exécutée';
          }
        }

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: resultMsg,
          timestamp: new Date()
        }]);

        return true;
      }
    } catch {
      // Pas du JSON ou pas une commande → message normal
      return false;
    }

    return false;
  };

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

  // Gère la lecture vocale des réponses
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.role === 'assistant' && voiceEnabled) {
      // Annule la lecture en cours si nouvelle réponse
      cancelSpeech();

      // Met en pause pour éviter des lectures simultanées
      const pauseReading = async () => {
        while (isSpeaking()) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Lit le message en utilisant la synthèse vocale
        speak(lastMessage.content);
      };

      pauseReading();
    }
  }, [messages, voiceEnabled]);

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
                {hasHostAPI && ' | Mode 3 🔥'}
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
        <div className="input-actions">
          <button 
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`voice-button ${voiceEnabled ? 'active' : ''}`}
            title={voiceEnabled ? 'Désactiver la lecture vocale' : 'Activer la lecture vocale'}
          >
            {voiceEnabled ? '🔊' : '🔇'}
          </button>
          {isSpeaking() && (
            <button 
              onClick={cancelSpeech}
              className="stop-button"
              title="Arrêter la lecture vocale"
            >
              ⏹️ Stop
            </button>
          )}
          <button 
            onClick={handleSend} 
            disabled={isLoading || !input.trim()}
            className="send-button"
          >
            {isLoading ? '⏳' : '📤'} Send
          </button>
        </div>
      </div>
    </div>
  );
}
