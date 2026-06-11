import type { FunesterieLanguageCode } from "./language";

export type UiLanguageCode = Extract<FunesterieLanguageCode, "fr" | "en" | "it" | "es" | "de">;

type TranslationSet = Partial<Record<UiLanguageCode, string>>;

const UI_LANGUAGES = new Set<UiLanguageCode>(["fr", "en", "it", "es", "de"]);

const textNodeSources = new WeakMap<Text, string>();
const attributeSources = new WeakMap<Element, Map<string, string>>();

function normalizeUiLanguage(value: unknown): UiLanguageCode {
  const raw = String(value || "").trim().toLowerCase();
  return UI_LANGUAGES.has(raw as UiLanguageCode) ? (raw as UiLanguageCode) : "fr";
}

function normalizeLookupText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

function tr(fr: string, en: string, it: string, es: string, de: string): [string, TranslationSet] {
  return [fr, { fr, en, it, es, de }];
}

const LEGACY_UI_TEXT_ENTRIES: Array<[string, TranslationSet]> = [
  tr("Accueil", "Home", "Home", "Inicio", "Startseite"),
  tr("Discussion", "Chat", "Chat", "Conversación", "Chat"),
  tr("Ouvrir", "Open", "Apri", "Abrir", "Öffnen"),
  tr("Studio", "Studio", "Studio", "Estudio", "Studio"),
  tr("Compte", "Account", "Account", "Cuenta", "Konto"),
  tr("Connexion", "Sign in", "Accesso", "Conexión", "Anmelden"),
  tr("Connexion...", "Signing in...", "Accesso...", "Conectando...", "Anmeldung..."),
  tr("Connexion requise", "Sign-in required", "Accesso richiesto", "Conexión requerida", "Anmeldung erforderlich"),
  tr("Utilisateur", "User", "Utente", "Usuario", "Benutzer"),
  tr("Menu", "Menu", "Menu", "Menú", "Menü"),
  tr("Langue", "Language", "Lingua", "Idioma", "Sprache"),
  tr("Options", "Options", "Opzioni", "Opciones", "Optionen"),
  tr("Agents", "Agents", "Agenti", "Agentes", "Agenten"),
  tr("Services", "Services", "Servizi", "Servicios", "Dienste"),
  tr("Légal", "Legal", "Legale", "Legal", "Rechtliches"),
  tr("Confidentialité", "Privacy", "Privacy", "Privacidad", "Datenschutz"),
  tr("Vie privée", "Privacy", "Privacy", "Privacidad", "Datenschutz"),
  tr("Conditions", "Terms", "Condizioni", "Condiciones", "Bedingungen"),
  tr("Utilisation", "Use", "Uso", "Uso", "Nutzung"),
  tr("Contact", "Contact", "Contatto", "Contacto", "Kontakt"),
  tr("Public", "Public", "Pubblico", "Público", "Öffentlich"),
  tr("État", "Status", "Stato", "Estado", "Status"),
  tr("Réglages", "Settings", "Impostazioni", "Ajustes", "Einstellungen"),
  tr("Profil", "Profile", "Profilo", "Perfil", "Profil"),
  tr("Historique", "History", "Cronologia", "Historial", "Verlauf"),
  tr("Fichiers", "Files", "File", "Archivos", "Dateien"),
  tr("Abonnement", "Subscription", "Abbonamento", "Suscripción", "Abonnement"),
  tr("Paiement", "Payment", "Pagamento", "Pago", "Zahlung"),
  tr("Outils", "Tools", "Strumenti", "Herramientas", "Werkzeuge"),
  tr("Autorisés", "Allowed", "Autorizzati", "Autorizados", "Erlaubt"),
  tr("Actifs session", "Active this session", "Attivi in sessione", "Activos en sesión", "In Sitzung aktiv"),
  tr("Sécurité", "Security", "Sicurezza", "Seguridad", "Sicherheit"),
  tr("Privé", "Private", "Privato", "Privado", "Privat"),
  tr("verrouillé", "locked", "bloccato", "bloqueado", "gesperrt"),
  tr("Admin requis", "Admin required", "Admin richiesto", "Admin requerido", "Admin erforderlich"),
  tr("Compte admin", "Admin account", "Account admin", "Cuenta admin", "Admin-Konto"),
  tr("Compte actuel", "Current account", "Account attuale", "Cuenta actual", "Aktuelles Konto"),
  tr("Compte connecté", "Connected account", "Account connesso", "Cuenta conectada", "Verbundenes Konto"),
  tr("Compte Funesterie", "Funesterie account", "Account Funesterie", "Cuenta Funesterie", "Funesterie-Konto"),
  tr("Se connecter", "Sign in", "Accedi", "Iniciar sesión", "Anmelden"),
  tr("Se déconnecter", "Sign out", "Esci", "Cerrar sesión", "Abmelden"),
  tr("Se deconnecter", "Sign out", "Esci", "Cerrar sesión", "Abmelden"),
  tr("Retour accueil", "Back home", "Torna alla home", "Volver al inicio", "Zurück zur Startseite"),
  tr("Retour à l'accueil Funesterie", "Back to Funesterie home", "Torna alla home Funesterie", "Volver al inicio de Funesterie", "Zurück zur Funesterie-Startseite"),
  tr("Connexion admin", "Admin sign in", "Accesso admin", "Conexión admin", "Admin-Anmeldung"),
  tr("Navigation Funesterie", "Funesterie navigation", "Navigazione Funesterie", "Navegación Funesterie", "Funesterie-Navigation"),
  tr("Funesterie accueil", "Funesterie home", "Home Funesterie", "Inicio Funesterie", "Funesterie-Startseite"),
  tr("Liens légaux Funesterie", "Funesterie legal links", "Link legali Funesterie", "Enlaces legales Funesterie", "Funesterie-Rechtslinks"),
  tr("Session Funesterie", "Funesterie session", "Sessione Funesterie", "Sesión Funesterie", "Funesterie-Sitzung"),

  tr("Studio Vivy", "Vivy Studio", "Studio Vivy", "Estudio Vivy", "Vivy Studio"),
  tr("Voix, chanson, clip et partage prêts depuis les trois blocs de droite.", "Voice, song, clip and sharing are ready from the three blocks on the right.", "Voce, canzone, clip e condivisione sono pronti dai tre blocchi a destra.", "Voz, canción, clip y publicación están listos desde los tres bloques de la derecha.", "Stimme, Song, Clip und Teilen sind in den drei Blöcken rechts bereit."),
  tr("Partager le brief", "Share brief", "Condividi brief", "Compartir brief", "Brief teilen"),
  tr("Modules Vivy", "Vivy modules", "Moduli Vivy", "Módulos Vivy", "Vivy-Module"),
  tr("Création voix", "Voice creation", "Creazione voce", "Creación de voz", "Stimmerstellung"),
  tr("Utiliser la voix Vivy officielle du module voix, tester une phrase et remplacer la référence seulement si besoin.", "Use the official Vivy voice from the voice module, test one phrase and replace the reference only if needed.", "Usa la voce Vivy ufficiale del modulo voce, prova una frase e sostituisci il riferimento solo se serve.", "Usar la voz Vivy oficial del módulo de voz, probar una frase y reemplazar la referencia solo si hace falta.", "Die offizielle Vivy-Stimme aus dem Stimmmodul nutzen, einen Satz testen und die Referenz nur bei Bedarf ersetzen."),
  tr("Préparer calibration", "Prepare calibration", "Prepara calibrazione", "Preparar calibración", "Kalibrierung vorbereiten"),
  tr("Méthode voix", "Voice method", "Metodo voce", "Método de voz", "Stimmmethode"),
  tr("Référence audio", "Audio reference", "Riferimento audio", "Referencia de audio", "Audioreferenz"),
  tr("Instruction voix", "Voice instruction", "Istruzione voce", "Instrucción de voz", "Stimmanweisung"),
  tr("Catalogue voix", "Voice catalog", "Catalogo voci", "Catálogo de voces", "Stimmenkatalog"),
  tr("Proposer cette voix aux chansons autorisées", "Offer this voice for authorized songs", "Proporre questa voce per brani autorizzati", "Proponer esta voz para canciones autorizadas", "Diese Stimme für autorisierte Songs anbieten"),
  tr("J’autorise les comptes Premium/Famille/Admin à créer des chansons avec cette voix.", "I allow Premium/Family/Admin accounts to create songs with this voice.", "Autorizzo gli account Premium/Famiglia/Admin a creare canzoni con questa voce.", "Autorizo a cuentas Premium/Familia/Admin a crear canciones con esta voz.", "Ich erlaube Premium-/Familien-/Admin-Konten, Songs mit dieser Stimme zu erstellen."),
  tr("Voix Vivy par défaut", "Default Vivy voice", "Voce Vivy predefinita", "Voz Vivy por defecto", "Standard-Vivy-Stimme"),
  tr("Tester voix active", "Test active voice", "Prova voce attiva", "Probar voz activa", "Aktive Stimme testen"),
  tr("Remplacer référence", "Replace reference", "Sostituisci riferimento", "Reemplazar referencia", "Referenz ersetzen"),
  tr("Composition - production", "Composition - production", "Composizione - produzione", "Composición - producción", "Komposition - Produktion"),
  tr("Transformer un thème, texte ou paroles en brief chanson utilisable par Vivy.", "Turn a theme, text or lyrics into a song brief Vivy can use.", "Trasforma un tema, testo o parole in un brief canzone utilizzabile da Vivy.", "Transformar un tema, texto o letra en un brief de canción usable por Vivy.", "Ein Thema, Text oder Lyrics in einen für Vivy nutzbaren Songbrief verwandeln."),
  tr("Départ chanson", "Song start", "Partenza canzone", "Inicio de canción", "Songstart"),
  tr("Casting vocal", "Voice casting", "Casting vocale", "Reparto vocal", "Stimmenbesetzung"),
  tr("Catalogue premium", "Premium catalog", "Catalogo premium", "Catálogo premium", "Premium-Katalog"),
  tr("Matière créative", "Creative material", "Materiale creativo", "Material creativo", "Kreativmaterial"),
  tr("Thème, paroles, ambiance, intention, histoire ou simple idée.", "Theme, lyrics, mood, intention, story or simple idea.", "Tema, parole, atmosfera, intenzione, storia o semplice idea.", "Tema, letra, ambiente, intención, historia o simple idea.", "Thema, Lyrics, Stimmung, Absicht, Geschichte oder einfache Idee."),
  tr("Clé Suno personnelle", "Personal Suno key", "Chiave Suno personale", "Clave Suno personal", "Persönlicher Suno-Schlüssel"),
  tr("Clé Suno session", "Suno session key", "Chiave Suno di sessione", "Clave Suno de sesión", "Suno-Sitzungsschlüssel"),
  tr("Optionnel, gardé seulement dans cette session navigateur", "Optional, kept only in this browser session", "Opzionale, conservato solo in questa sessione browser", "Opcional, guardado solo en esta sesión del navegador", "Optional, nur in dieser Browsersitzung gespeichert"),
  tr("Créer vraie chanson Suno", "Create real Suno song", "Crea vera canzone Suno", "Crear canción Suno real", "Echten Suno-Song erstellen"),
  tr("Oublier clé Suno", "Forget Suno key", "Dimentica chiave Suno", "Olvidar clave Suno", "Suno-Schlüssel vergessen"),
  tr("Préparer chanson", "Prepare song", "Prepara canzone", "Preparar canción", "Song vorbereiten"),
  tr("Scène - partage", "Scene - sharing", "Scena - condivisione", "Escena - publicación", "Szene - Teilen"),
  tr("Préparer partage", "Prepare sharing", "Prepara condivisione", "Preparar publicación", "Teilen vorbereiten"),
  tr("Canal", "Channel", "Canale", "Canal", "Kanal"),
  tr("Lien équipe", "Team link", "Link team", "Enlace de equipo", "Team-Link"),
  tr("Lien", "Link", "Link", "Enlace", "Link"),
  tr("Token local optionnel", "Optional local token", "Token locale opzionale", "Token local opcional", "Optionales lokales Token"),
  tr("Non stocké, non copié dans le brief", "Not stored, not copied into the brief", "Non salvato, non copiato nel brief", "No almacenado, no copiado en el brief", "Nicht gespeichert, nicht in den Brief kopiert"),
  tr("Instruction partage", "Sharing instruction", "Istruzione condivisione", "Instrucción de publicación", "Teilanweisung"),
  tr("Demander à Vivy", "Ask Vivy", "Chiedi a Vivy", "Pedir a Vivy", "Vivy fragen"),
  tr("Ouvrir A11", "Open A11", "Apri A11", "Abrir A11", "A11 öffnen"),
  tr("Sauver dans A11", "Save in A11", "Salva in A11", "Guardar en A11", "In A11 speichern"),
  tr("Brief agents", "Agent brief", "Brief agenti", "Brief de agentes", "Agentenbrief"),
  tr("Copier", "Copy", "Copia", "Copiar", "Kopieren"),
  tr("Partager", "Share", "Condividi", "Compartir", "Teilen"),
  tr("Parler à Vivy", "Talk to Vivy", "Parla con Vivy", "Hablar con Vivy", "Mit Vivy sprechen"),
  tr("Voix, chanson, ambiance ou scène: Vivy transforme l'idée en direction exploitable.", "Voice, song, mood or scene: Vivy turns the idea into usable direction.", "Voce, canzone, atmosfera o scena: Vivy trasforma l'idea in una direzione utilizzabile.", "Voz, canción, ambiente o escena: Vivy convierte la idea en una dirección usable.", "Stimme, Song, Stimmung oder Szene: Vivy macht aus der Idee eine nutzbare Richtung."),
  tr("Reset", "Reset", "Reset", "Reiniciar", "Zurücksetzen"),
  tr("Je compose la réponse...", "Composing the reply...", "Sto componendo la risposta...", "Compongo la respuesta...", "Antwort wird erstellt..."),
  tr("Préécoute chanson", "Song preview", "Anteprima canzone", "Preescucha de canción", "Song-Vorschau"),
  tr("Maquette vidéo locale", "Local video mockup", "Bozza video locale", "Maqueta de vídeo local", "Lokale Video-Demo"),
  tr("Audio Vivy prêt", "Vivy audio ready", "Audio Vivy pronto", "Audio Vivy listo", "Vivy-Audio bereit"),
  tr("Clip Vivy prêt", "Vivy clip ready", "Clip Vivy pronto", "Clip Vivy listo", "Vivy-Clip bereit"),
  tr("Vision reliée au LLM Vivy: Janus quand il répond, fallback vision LLM si le worker dort, Qflush et runtime local en contrôle.", "Vision linked to the Vivy LLM: Janus when it responds, LLM vision fallback if the worker sleeps, Qflush and local runtime in control.", "Visione collegata al LLM Vivy: Janus quando risponde, fallback visione LLM se il worker dorme, Qflush e runtime locale sotto controllo.", "Visión conectada al LLM Vivy: Janus cuando responde, respaldo de visión LLM si el worker duerme, Qflush y runtime local bajo control.", "Vision mit Vivy-LLM verbunden: Janus wenn verfügbar, LLM-Vision-Fallback falls der Worker schläft, Qflush und lokaler Runtime unter Kontrolle."),
  tr("Voix", "Voice", "Voce", "Voz", "Stimme"),
  tr("Chanson", "Song", "Canzone", "Canción", "Song"),
  tr("Scène", "Scene", "Scena", "Escena", "Szene"),
  tr("Fichier", "File", "File", "Archivo", "Datei"),
  tr("Envoyer", "Send", "Invia", "Enviar", "Senden"),
  tr("Fichiers joints au message", "Files attached to the message", "File allegati al messaggio", "Archivos adjuntos al mensaje", "An die Nachricht angehängte Dateien"),
  tr("Fichiers prêts pour Vivy", "Files ready for Vivy", "File pronti per Vivy", "Archivos listos para Vivy", "Dateien bereit für Vivy"),
  tr("Vivy présence musicale", "Vivy musical presence", "Presenza musicale Vivy", "Presencia musical Vivy", "Vivy musikalische Präsenz"),
  tr("Accès directs Vivy", "Vivy quick access", "Accessi rapidi Vivy", "Accesos directos Vivy", "Vivy-Schnellzugriff"),
  tr("Navigation Vivy", "Vivy navigation", "Navigazione Vivy", "Navegación Vivy", "Vivy-Navigation"),
  tr("Langue Vivy", "Vivy language", "Lingua Vivy", "Idioma Vivy", "Vivy-Sprache"),
  tr("Panneau studio", "Studio panel", "Pannello studio", "Panel de estudio", "Studio-Panel"),
  tr("Agent bureau", "Desktop agent", "Agente desktop", "Agente de escritorio", "Desktop-Agent"),
  tr("Agent média", "Media agent", "Agente media", "Agente multimedia", "Medien-Agent"),
  tr("Agent musical", "Music agent", "Agente musicale", "Agente musical", "Musik-Agent"),

  tr("Voix persona", "Persona voices", "Voci persona", "Voces persona", "Persona-Stimmen"),
  tr("A11, Kaen44 et Vivy parlent avec leur identité.", "A11, Kaen44 and Vivy speak with their own identity.", "A11, Kaen44 e Vivy parlano con la loro identità.", "A11, Kaen44 y Vivy hablan con su identidad.", "A11, Kaen44 und Vivy sprechen mit ihrer eigenen Identität."),
  tr("Le bouton teste la route TTS officielle avec persona et style dédiés, sans afficher de configuration sensible.", "The button tests the official TTS route with dedicated persona and style, without showing sensitive configuration.", "Il pulsante testa la rotta TTS ufficiale con persona e stile dedicati, senza mostrare configurazioni sensibili.", "El botón prueba la ruta TTS oficial con persona y estilo dedicados, sin mostrar configuración sensible.", "Der Button testet die offizielle TTS-Route mit eigener Persona und Stil, ohne sensible Konfiguration zu zeigen."),
  tr("Mode versus", "Versus mode", "Modalità versus", "Modo versus", "Versus-Modus"),
  tr("Funesterie.me vs utilisateur", "Funesterie.me vs user", "Funesterie.me vs utente", "Funesterie.me vs usuario", "Funesterie.me gegen Benutzer"),
  tr("Utilisateur", "User", "Utente", "Usuario", "Benutzer"),
  tr("Explorer les agents", "Explore agents", "Esplora agenti", "Explorar agentes", "Agenten erkunden"),
  tr("Voir les agents", "See agents", "Vedi agenti", "Ver agentes", "Agenten ansehen"),
  tr("Modules @nossen", "@nossen modules", "Moduli @nossen", "Módulos @nossen", "@nossen-Module"),
  tr("site public, agents IA et modules reliés proprement", "public site, AI agents and modules connected cleanly", "sito pubblico, agenti IA e moduli collegati correttamente", "sitio público, agentes IA y módulos conectados limpiamente", "öffentliche Seite, KI-Agenten und Module sauber verbunden"),
  tr("Centre", "Center", "Centro", "Centro", "Zentrum"),
  tr("Point d'entrée public. Les routes visibles restent lisibles, les actions sensibles restent protégées.", "Public entry point. Visible routes stay readable, sensitive actions stay protected.", "Punto di ingresso pubblico. Le rotte visibili restano leggibili, le azioni sensibili protette.", "Punto de entrada público. Las rutas visibles siguen legibles y las acciones sensibles protegidas.", "Öffentlicher Einstieg. Sichtbare Routen bleiben lesbar, sensible Aktionen geschützt."),
  tr("Lecture rapide", "Quick read", "Lettura rapida", "Lectura rápida", "Kurzüberblick"),
  tr("Du site au graphe", "From site to graph", "Dal sito al grafo", "Del sitio al grafo", "Von der Seite zum Graphen"),
  tr("Connexions privées", "Private connections", "Connessioni private", "Conexiones privadas", "Private Verbindungen"),
  tr("Connexions utilisateur", "User connections", "Connessioni utente", "Conexiones de usuario", "Benutzerverbindungen"),
  tr("Google", "Google", "Google", "Google", "Google"),
  tr("Microsoft", "Microsoft", "Microsoft", "Microsoft", "Microsoft"),
  tr("GitHub / npm", "GitHub / npm", "GitHub / npm", "GitHub / npm", "GitHub / npm"),
  tr("Agents locaux", "Local agents", "Agenti locali", "Agentes locales", "Lokale Agenten"),
  tr("Coffre local", "Local vault", "Caveau locale", "Caja local", "Lokaler Tresor"),
  tr("Vérifier MCP", "Check MCP", "Verifica MCP", "Verificar MCP", "MCP prüfen"),
  tr("MCP Funesterie", "Funesterie MCP", "MCP Funesterie", "MCP Funesterie", "Funesterie MCP"),
  tr("MCP public", "Public MCP", "MCP pubblico", "MCP público", "Öffentliches MCP"),
  tr("Connecteurs publics", "Public connectors", "Connettori pubblici", "Conectores públicos", "Öffentliche Konnektoren"),
  tr("routes séparées", "separate routes", "rotte separate", "rutas separadas", "getrennte Routen"),
  tr("Compte MCP", "MCP account", "Account MCP", "Cuenta MCP", "MCP-Konto"),
  tr("Paquets publics @nossen et surface packages Funesterie.", "Public @nossen packages and Funesterie surface packages.", "Pacchetti pubblici @nossen e pacchetti superficie Funesterie.", "Paquetes públicos @nossen y paquetes de superficie Funesterie.", "Öffentliche @nossen-Pakete und Funesterie-Oberflächenpakete."),
  tr("Contrôle du statut MCP et des droits associés au compte connecté.", "Checks MCP status and rights associated with the connected account.", "Controlla lo stato MCP e i diritti associati all'account connesso.", "Controla el estado MCP y los derechos asociados a la cuenta conectada.", "Prüft MCP-Status und Rechte des verbundenen Kontos."),
  tr("Graphe Cypher public", "Public Cypher graph", "Grafo Cypher pubblico", "Grafo Cypher público", "Öffentlicher Cypher-Graph"),
  tr("Les liaisons vivantes", "Living links", "Connessioni vive", "Enlaces vivos", "Lebendige Verbindungen"),
  tr("Architecture Funesterie", "Funesterie architecture", "Architettura Funesterie", "Arquitectura Funesterie", "Funesterie-Architektur"),

  tr("Accès et données", "Access and data", "Accesso e dati", "Acceso y datos", "Zugriff und Daten"),
  tr("Inventaire récupérable du compte, des discussions, médias et fichiers liés à ta session.", "Recoverable inventory of the account, chats, media and files linked to your session.", "Inventario recuperabile dell'account, delle discussioni, dei media e dei file legati alla sessione.", "Inventario recuperable de la cuenta, conversaciones, medios y archivos ligados a tu sesión.", "Wiederherstellbares Inventar von Konto, Chats, Medien und Dateien deiner Sitzung."),
  tr("Connexion Funesterie centrale pour A11, Kaen44 et Vivy.", "Central Funesterie sign-in for A11, Kaen44 and Vivy.", "Accesso centrale Funesterie per A11, Kaen44 e Vivy.", "Conexión central Funesterie para A11, Kaen44 y Vivy.", "Zentrale Funesterie-Anmeldung für A11, Kaen44 und Vivy."),
  tr("Conversations", "Conversations", "Conversazioni", "Conversaciones", "Unterhaltungen"),
  tr("Inventaire", "Inventory", "Inventario", "Inventario", "Inventar"),
  tr("Médias", "Media", "Media", "Medios", "Medien"),
  tr("Désabonnement programmé", "Cancellation scheduled", "Disdetta programmata", "Cancelación programada", "Kündigung geplant"),
  tr("Session", "Session", "Sessione", "Sesión", "Sitzung"),
  tr("Jetons applicatifs", "Application tokens", "Token applicativi", "Tokens de aplicación", "Anwendungs-Token"),
  tr("Ajoute des clés temporaires pour les services de création. Elles restent dans cette session navigateur et ne partent jamais dans l'export.", "Add temporary keys for creation services. They stay in this browser session and never leave in exports.", "Aggiungi chiavi temporanee per i servizi creativi. Restano in questa sessione del browser e non finiscono mai nell'export.", "Añade claves temporales para servicios de creación. Permanecen en esta sesión del navegador y nunca salen en la exportación.", "Füge temporäre Schlüssel für Kreativdienste hinzu. Sie bleiben in dieser Browser-Sitzung und werden nie exportiert."),
  tr("Connecte-toi avant d'ajouter un jeton applicatif. Les clés restent privées dans le navigateur et expirent avec la session.", "Sign in before adding an application token. Keys stay private in the browser and expire with the session.", "Accedi prima di aggiungere un token applicativo. Le chiavi restano private nel browser e scadono con la sessione.", "Conéctate antes de añadir un token de aplicación. Las claves quedan privadas en el navegador y expiran con la sesión.", "Melde dich an, bevor du ein Anwendungs-Token hinzufügst. Schlüssel bleiben privat im Browser und laufen mit der Sitzung ab."),
  tr("Les comptes admin/fondateur peuvent garder les clés serveur privées. Ces jetons de session servent seulement quand l'utilisateur veut brancher son propre service.", "Admin/founder accounts can keep private server keys. These session tokens are only used when the user wants to connect their own service.", "Gli account admin/fondatore possono mantenere chiavi server private. Questi token di sessione servono solo quando l'utente vuole collegare il proprio servizio.", "Las cuentas admin/fundador pueden guardar claves privadas de servidor. Estos tokens de sesión solo sirven cuando el usuario conecta su propio servicio.", "Admin-/Gründerkonten können private Serverschlüssel behalten. Diese Sitzungstoken dienen nur, wenn der Benutzer einen eigenen Dienst verbindet."),
  tr("Accès autorisés", "Authorized access", "Accessi autorizzati", "Accesos autorizados", "Autorisierte Zugriffe"),
  tr("Choisis les outils actifs pour cette session. Les limites serveur restent liées à ton type de compte.", "Choose active tools for this session. Server limits still depend on your account type.", "Scegli gli strumenti attivi per questa sessione. I limiti server restano legati al tipo di account.", "Elige las herramientas activas para esta sesión. Los límites del servidor siguen ligados a tu tipo de cuenta.", "Wähle die aktiven Werkzeuge für diese Sitzung. Serverlimits bleiben an deinen Kontotyp gebunden."),
  tr("Connecte-toi avec Google ou Microsoft pour vérifier les accès MCP liés à ton compte.", "Sign in with Google or Microsoft to check MCP access linked to your account.", "Accedi con Google o Microsoft per verificare gli accessi MCP legati al tuo account.", "Conéctate con Google o Microsoft para verificar los accesos MCP ligados a tu cuenta.", "Melde dich mit Google oder Microsoft an, um MCP-Zugriffe deines Kontos zu prüfen."),
  tr("Catalogue des outils indisponible pour le moment. Réessaie avec “Vérifier MCP”.", "Tool catalog unavailable for now. Try again with \"Check MCP\".", "Catalogo strumenti non disponibile per ora. Riprova con \"Verifica MCP\".", "Catálogo de herramientas no disponible por ahora. Reintenta con \"Verificar MCP\".", "Werkzeugkatalog derzeit nicht verfügbar. Versuche es mit \"MCP prüfen\" erneut."),
  tr("Plan actuel", "Current plan", "Piano attuale", "Plan actual", "Aktueller Plan"),
  tr("Comparatif des abonnements non chargé.", "Subscription comparison not loaded.", "Confronto abbonamenti non caricato.", "Comparativa de suscripciones no cargada.", "Abonnementvergleich nicht geladen."),
  tr("Djeff, rider origine. Contact officiel Funesterie / NOSSEN.", "Djeff, original rider. Official Funesterie / NOSSEN contact.", "Djeff, rider originale. Contatto ufficiale Funesterie / NOSSEN.", "Djeff, rider de origen. Contacto oficial Funesterie / NOSSEN.", "Djeff, Original-Rider. Offizieller Funesterie-/NOSSEN-Kontakt."),
  tr("Modules", "Modules", "Moduli", "Módulos", "Module"),
  tr("NOSSEN", "NOSSEN", "NOSSEN", "NOSSEN", "NOSSEN"),

  tr("Réinitialiser le mot de passe", "Reset password", "Reimposta password", "Restablecer contraseña", "Passwort zurücksetzen"),
  tr("Mot de passe oublie ?", "Forgot password?", "Password dimenticata?", "¿Olvidaste la contraseña?", "Passwort vergessen?"),
  tr("Un seul accès pour Funesterie, K44, A11 et Vivy.", "One sign-in for Funesterie, K44, A11 and Vivy.", "Un solo accesso per Funesterie, K44, A11 e Vivy.", "Un solo acceso para Funesterie, K44, A11 y Vivy.", "Ein Zugang für Funesterie, K44, A11 und Vivy."),
  tr("Création...", "Creating...", "Creazione...", "Creando...", "Wird erstellt..."),
  tr("Créer le compte", "Create account", "Crea account", "Crear cuenta", "Konto erstellen"),
  tr("Si l'email existe, un lien a été envoyé.", "If the email exists, a link has been sent.", "Se l'email esiste, è stato inviato un link.", "Si el email existe, se ha enviado un enlace.", "Falls die E-Mail existiert, wurde ein Link gesendet."),
  tr("Nouveau mot de passe", "New password", "Nuova password", "Nueva contraseña", "Neues Passwort"),
  tr("Confirmer le mot de passe", "Confirm password", "Conferma password", "Confirmar contraseña", "Passwort bestätigen"),
  tr("Mot de passe modifié. Tu peux revenir sur la page de connexion.", "Password changed. You can return to the sign-in page.", "Password modificata. Puoi tornare alla pagina di accesso.", "Contraseña modificada. Puedes volver a la página de conexión.", "Passwort geändert. Du kannst zur Anmeldeseite zurückkehren."),
  tr("Pseudo", "Username", "Nome utente", "Usuario", "Benutzername"),
  tr("Email", "Email", "Email", "Email", "E-Mail"),
  tr("Mot de passe", "Password", "Password", "Contraseña", "Passwort"),
  tr("Ton email", "Your email", "La tua email", "Tu email", "Deine E-Mail"),

  tr("Accès rapide", "Quick access", "Accesso rapido", "Acceso rápido", "Schnellzugriff"),
  tr("Match Arena", "Match Arena", "Match Arena", "Match Arena", "Match Arena"),
  tr("Aucun jeu detecte", "No game detected", "Nessun gioco rilevato", "Ningún juego detectado", "Kein Spiel erkannt"),
  tr("Image en attente", "Image pending", "Immagine in attesa", "Imagen pendiente", "Bild ausstehend"),
  tr("Mode de match", "Match mode", "Modalità match", "Modo de partida", "Match-Modus"),
  tr("Priorité session", "Session priority", "Priorità sessione", "Prioridad de sesión", "Sitzungspriorität"),
  tr("Depose ici", "Drop here", "Rilascia qui", "Suelta aquí", "Hier ablegen"),
  tr("Images, texte, JSON, PDF...", "Images, text, JSON, PDF...", "Immagini, testo, JSON, PDF...", "Imágenes, texto, JSON, PDF...", "Bilder, Text, JSON, PDF..."),
  tr("FILE", "FILE", "FILE", "ARCHIVO", "DATEI"),
  tr("Modele", "Model", "Modello", "Modelo", "Modell"),
  tr("Voix officielle", "Official voice", "Voce ufficiale", "Voz oficial", "Offizielle Stimme"),
  tr("Secours local", "Local fallback", "Fallback locale", "Respaldo local", "Lokaler Ersatz"),
  tr("Auto", "Auto", "Auto", "Auto", "Auto"),
  tr("Panneau conversation", "Conversation panel", "Pannello conversazione", "Panel de conversación", "Konversationspanel"),
  tr("Chat", "Chat", "Chat", "Chat", "Chat"),
  tr("Direct", "Direct", "Diretto", "Directo", "Direkt"),
  tr("Aides connectees", "Connected helpers", "Aiuti connessi", "Ayudas conectadas", "Verbundene Hilfen"),
  tr("Plan", "Plan", "Piano", "Plan", "Tarif"),
  tr("Global", "Global", "Globale", "Global", "Global"),
  tr("+ Nouveau", "+ New", "+ Nuovo", "+ Nuevo", "+ Neu"),
  tr("Renommer", "Rename", "Rinomina", "Renombrar", "Umbenennen"),
  tr("Supprimer", "Delete", "Elimina", "Eliminar", "Löschen"),
  tr("Edit", "Edit", "Modifica", "Editar", "Bearbeiten"),
  tr("Del", "Del", "Elimina", "Borrar", "Löschen"),
  tr("Chargement...", "Loading...", "Caricamento...", "Cargando...", "Laden..."),
  tr("Chargement…", "Loading...", "Caricamento...", "Cargando...", "Laden..."),
  tr("Memoire locale", "Local memory", "Memoria locale", "Memoria local", "Lokaler Speicher"),
  tr("Mémoire locale", "Local memory", "Memoria locale", "Memoria local", "Lokaler Speicher"),
  tr("Historique local", "Local history", "Cronologia locale", "Historial local", "Lokaler Verlauf"),
  tr("Aucune purge locale pour le moment.", "No local purge yet.", "Nessuna pulizia locale per ora.", "Sin purga local por ahora.", "Noch keine lokale Bereinigung."),
  tr("Mémoire non cruciale", "Non-critical memory", "Memoria non critica", "Memoria no crítica", "Nichtkritischer Speicher"),
  tr("Entrees", "Entries", "Voci", "Entradas", "Einträge"),
  tr("Plus recent", "Most recent", "Più recente", "Más reciente", "Neueste"),
  tr("Types", "Types", "Tipi", "Tipos", "Typen"),
  tr("Fermer", "Close", "Chiudi", "Cerrar", "Schließen"),
  tr("Audio bloqué", "Audio blocked", "Audio bloccato", "Audio bloqueado", "Audio blockiert"),
  tr("Jouer", "Play", "Riproduci", "Reproducir", "Abspielen"),
  tr("Ignorer", "Ignore", "Ignora", "Ignorar", "Ignorieren"),
  tr("Agrandir l'image", "Enlarge image", "Ingrandisci immagine", "Ampliar imagen", "Bild vergrößern"),
  tr("Image precedente", "Previous image", "Immagine precedente", "Imagen anterior", "Vorheriges Bild"),
  tr("Image suivante", "Next image", "Immagine successiva", "Imagen siguiente", "Nächstes Bild"),
  tr("Apercu de l'image", "Image preview", "Anteprima immagine", "Vista previa de imagen", "Bildvorschau"),
  tr("Fermer l'apercu", "Close preview", "Chiudi anteprima", "Cerrar vista previa", "Vorschau schließen"),
  tr("Apercu agrandi", "Enlarged preview", "Anteprima ingrandita", "Vista ampliada", "Vergrößerte Vorschau"),
  tr("Sortie coupée", "Output muted", "Uscita muta", "Salida silenciada", "Ausgabe stumm"),
  tr("Sortie automatique", "Automatic output", "Uscita automatica", "Salida automática", "Automatische Ausgabe"),
  tr("Sortie auto", "Auto output", "Uscita auto", "Salida auto", "Auto-Ausgabe"),
  tr("On", "On", "On", "On", "Ein"),
  tr("Off", "Off", "Off", "Off", "Aus"),

  tr("Nezlephant Security", "Nezlephant Security", "Sicurezza Nezlephant", "Seguridad Nezlephant", "Nezlephant-Sicherheit"),
  tr("Mode:", "Mode:", "Modalità:", "Modo:", "Modus:"),
  tr("Clients connus", "Known clients", "Client conosciuti", "Clientes conocidos", "Bekannte Clients"),
  tr("Accès récents", "Recent access", "Accessi recenti", "Accesos recientes", "Letzte Zugriffe"),
  tr("Température", "Temperature", "Temperatura", "Temperatura", "Temperatur"),
  tr("Fournisseur LLM", "LLM provider", "Fornitore LLM", "Proveedor LLM", "LLM-Anbieter"),
  tr("Autre", "Other", "Altro", "Otro", "Andere"),
  tr("Nindô (voie personnelle)", "Nindo (personal path)", "Nindô (via personale)", "Nindô (vía personal)", "Nindô (persönlicher Weg)"),
  tr("Soirée Rétro — Tekken 3", "Retro Night - Tekken 3", "Serata Retro - Tekken 3", "Noche retro - Tekken 3", "Retro-Abend - Tekken 3"),
  tr("Crée une salle POOL, invite un ami, puis lance l’émulateur externe.", "Create a POOL room, invite a friend, then launch the external emulator.", "Crea una stanza POOL, invita un amico, poi avvia l'emulatore esterno.", "Crea una sala POOL, invita a un amigo y luego abre el emulador externo.", "Erstelle einen POOL-Raum, lade einen Freund ein und starte dann den externen Emulator."),
  tr("Nom de la salle (ex: Tekken3 Night #Paris)", "Room name (ex: Tekken3 Night #Paris)", "Nome stanza (es: Tekken3 Night #Paris)", "Nombre de la sala (ej: Tekken3 Night #Paris)", "Raumname (z. B. Tekken3 Night #Paris)"),
  tr("Créer la salle", "Create room", "Crea stanza", "Crear sala", "Raum erstellen"),
  tr("Copier le code", "Copy code", "Copia codice", "Copiar código", "Code kopieren"),
  tr("▶️ Ouvrir l’émulateur Tekken 3", "▶️ Open the Tekken 3 emulator", "▶️ Apri l'emulatore Tekken 3", "▶️ Abrir el emulador Tekken 3", "▶️ Tekken-3-Emulator öffnen"),
  tr("📺 Tuto", "📺 Tutorial", "📺 Tutorial", "📺 Tutorial", "📺 Anleitung"),
  tr("Essayer d’intégrer l’émulateur (beta)", "Try embedding the emulator (beta)", "Prova a integrare l'emulatore (beta)", "Probar integrar el emulador (beta)", "Emulator-Einbettung testen (Beta)"),

  tr("Console A11", "A11 console", "Console A11", "Consola A11", "A11-Konsole"),
  tr("Control Center", "Control Center", "Control Center", "Centro de control", "Kontrollzentrum"),
  tr("Diagnostic runtime", "Runtime diagnostics", "Diagnostica runtime", "Diagnóstico runtime", "Runtime-Diagnose"),
  tr("Aucune capacité exposée.", "No exposed capability.", "Nessuna capacità esposta.", "Ninguna capacidad expuesta.", "Keine Fähigkeit offengelegt."),
  tr("Chargement du diagnostic…", "Loading diagnostics...", "Caricamento diagnostica...", "Cargando diagnóstico...", "Diagnose wird geladen..."),
  tr("Chargement du profil…", "Loading profile...", "Caricamento profilo...", "Cargando perfil...", "Profil wird geladen..."),
  tr("Capacites agent", "Agent capabilities", "Capacità agente", "Capacidades del agente", "Agentenfähigkeiten"),
  tr("Capacités agent", "Agent capabilities", "Capacità agente", "Capacidades del agente", "Agentenfähigkeiten"),
  tr("Modules Funesterie", "Funesterie modules", "Moduli Funesterie", "Módulos Funesterie", "Funesterie-Module"),
  tr("Memoire etendue", "Extended memory", "Memoria estesa", "Memoria extendida", "Erweiterter Speicher"),
  tr("Mémoire étendue", "Extended memory", "Memoria estesa", "Memoria extendida", "Erweiterter Speicher"),
  tr("Processus supervises", "Supervised processes", "Processi supervisionati", "Procesos supervisados", "Überwachte Prozesse"),
  tr("Aucun processus supervise expose.", "No supervised process exposed.", "Nessun processo supervisionato esposto.", "Ningún proceso supervisado expuesto.", "Kein überwachter Prozess offengelegt."),
  tr("Profils IA distants", "Remote AI profiles", "Profili IA remoti", "Perfiles IA remotos", "Remote-KI-Profile"),
  tr("Nom du profil", "Profile name", "Nome profilo", "Nombre del perfil", "Profilname"),
  tr("Base URL", "Base URL", "URL base", "URL base", "Basis-URL"),
  tr("Modele", "Model", "Modello", "Modelo", "Modell"),
  tr("Modèle", "Model", "Modello", "Modelo", "Modell"),
  tr("Cle API", "API key", "Chiave API", "Clave API", "API-Schlüssel"),
  tr("Clé API", "API key", "Chiave API", "Clave API", "API-Schlüssel"),
  tr("Effacer la console", "Clear console", "Svuota console", "Vaciar consola", "Konsole leeren"),
  tr("Écris ton message…", "Write your message...", "Scrivi il tuo messaggio...", "Escribe tu mensaje...", "Schreibe deine Nachricht..."),
  tr("Type your message... (Enter to send, Shift+Enter for new line)", "Type your message... (Enter to send, Shift+Enter for a new line)", "Scrivi il messaggio... (Invio per inviare, Shift+Invio per andare a capo)", "Escribe tu mensaje... (Entrar para enviar, Shift+Entrar para nueva línea)", "Nachricht eingeben... (Enter sendet, Shift+Enter neue Zeile)"),
  tr("Arrêter la lecture vocale", "Stop voice playback", "Ferma lettura vocale", "Detener lectura de voz", "Sprachausgabe stoppen"),

  tr("Supprimer la conversation", "Delete conversation", "Elimina conversazione", "Eliminar conversación", "Unterhaltung löschen"),
  tr("Cette conversation locale sera retirée de la liste actuelle.", "This local conversation will be removed from the current list.", "Questa conversazione locale sarà rimossa dall'elenco attuale.", "Esta conversación local se quitará de la lista actual.", "Diese lokale Unterhaltung wird aus der aktuellen Liste entfernt."),
  tr("Supprimer tout l'historique", "Delete all history", "Elimina tutta la cronologia", "Eliminar todo el historial", "Gesamten Verlauf löschen"),
  tr("Tout supprimer", "Delete all", "Elimina tutto", "Eliminar todo", "Alles löschen"),
  tr("Confirmer la purge mémoire", "Confirm memory purge", "Conferma pulizia memoria", "Confirmar purga de memoria", "Speicherbereinigung bestätigen"),
  tr("Lancer une simulation de purge de la mémoire structurée ?", "Run a simulated structured-memory purge?", "Eseguire una simulazione di pulizia della memoria strutturata?", "¿Lanzar una simulación de purga de memoria estructurada?", "Simulation der strukturierten Speicherbereinigung starten?"),
  tr("Déclencher immédiatement la purge réelle de la mémoire structurée ?", "Start the real structured-memory purge now?", "Avviare ora la pulizia reale della memoria strutturata?", "¿Iniciar ahora la purga real de memoria estructurada?", "Echte strukturierte Speicherbereinigung jetzt starten?"),
  tr("Lancer le dry run", "Run dry run", "Avvia dry run", "Lanzar dry run", "Dry-Run starten"),
  tr("Lancer la purge", "Run purge", "Avvia pulizia", "Lanzar purga", "Bereinigung starten"),
  tr("Réinitialiser la mémoire non cruciale", "Reset non-critical memory", "Reimposta memoria non critica", "Restablecer memoria no crítica", "Nichtkritischen Speicher zurücksetzen"),
  tr("Réinitialiser", "Reset", "Reimposta", "Restablecer", "Zurücksetzen"),

  tr("Funesterie - État", "Funesterie - Status", "Funesterie - Stato", "Funesterie - Estado", "Funesterie - Status"),
  tr("Funesterie - Accueil", "Funesterie - Home", "Funesterie - Home", "Funesterie - Inicio", "Funesterie - Startseite"),
  tr("Funesterie - Agents", "Funesterie - Agents", "Funesterie - Agenti", "Funesterie - Agentes", "Funesterie - Agenten"),
  tr("Funesterie - Architecture", "Funesterie - Architecture", "Funesterie - Architettura", "Funesterie - Arquitectura", "Funesterie - Architektur"),
  tr("Funesterie - Compte", "Funesterie - Account", "Funesterie - Account", "Funesterie - Cuenta", "Funesterie - Konto"),
  tr("Funesterie - Contact", "Funesterie - Contact", "Funesterie - Contatto", "Funesterie - Contacto", "Funesterie - Kontakt"),
  tr("Funesterie - Confidentialité", "Funesterie - Privacy", "Funesterie - Privacy", "Funesterie - Privacidad", "Funesterie - Datenschutz"),
  tr("Funesterie - Conditions", "Funesterie - Terms", "Funesterie - Condizioni", "Funesterie - Condiciones", "Funesterie - Bedingungen"),
  tr("Funesterie - Connexion", "Funesterie - Sign in", "Funesterie - Accesso", "Funesterie - Conexión", "Funesterie - Anmeldung"),
  tr("Kaen44 - Assistante bureau Funesterie", "Kaen44 - Funesterie desktop assistant", "Kaen44 - Assistente desktop Funesterie", "Kaen44 - Asistente de escritorio Funesterie", "Kaen44 - Funesterie-Desktop-Assistent"),
  tr("A11 - Alpha Onze Funesterie", "A11 - Alpha Eleven Funesterie", "A11 - Alpha Undici Funesterie", "A11 - Alfa Once Funesterie", "A11 - Alpha Elf Funesterie"),
];

const LEGACY_UI_TEXT: Record<string, TranslationSet> = LEGACY_UI_TEXT_ENTRIES.reduce<Record<string, TranslationSet>>(
  (dictionary, [source, translations]) => {
    dictionary[normalizeLookupText(source)] = translations;
    for (const value of Object.values(translations)) {
      dictionary[normalizeLookupText(value)] = translations;
    }
    return dictionary;
  },
  {}
);

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];

function shouldSkipElement(element: Element | null): boolean {
  if (!element) return true;
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "code", "pre", "textarea"].includes(tag)) return true;
  return Boolean(element.closest([
    "[data-no-ui-translate]",
    "[contenteditable='true']",
    ".markdown",
    ".prose",
    ".chat-message-content",
    ".message-content",
    ".a11-message-content",
    ".a11-chat-message",
    ".vivy-chat-message",
    ".bubble",
  ].join(",")));
}

function isOptionUsingTextValue(element: Element | null): boolean {
  return Boolean(element?.tagName.toLowerCase() === "option" && !element.hasAttribute("value"));
}

function shouldSkipTextElement(element: Element | null): boolean {
  return shouldSkipElement(element) || isOptionUsingTextValue(element);
}

function translated(language: UiLanguageCode, source: string): string {
  const key = normalizeLookupText(source);
  const entry = LEGACY_UI_TEXT[key];
  return entry?.[language] || source;
}

function isRenderedVariant(source: string, current: string): boolean {
  const key = normalizeLookupText(source);
  const normalizedCurrent = normalizeLookupText(current);
  const entry = LEGACY_UI_TEXT[key];
  if (!entry) return key === normalizedCurrent;
  return Object.values(entry).some((value) => normalizeLookupText(value) === normalizedCurrent);
}

function translateTextNode(node: Text, language: UiLanguageCode) {
  const current = normalizeLookupText(node.data);
  const storedSource = textNodeSources.get(node);
  const source = storedSource && isRenderedVariant(storedSource, current) ? storedSource : current;
  if (!source || !/[A-Za-zÀ-ÿ]/.test(source)) return;
  textNodeSources.set(node, source);
  const next = translated(language, source);
  if (current !== normalizeLookupText(next)) {
    const leading = node.data.match(/^\s*/)?.[0] || "";
    const trailing = node.data.match(/\s*$/)?.[0] || "";
    node.data = `${leading}${next}${trailing}`;
  }
}

function translateElementAttributes(element: Element, language: UiLanguageCode) {
  if (shouldSkipElement(element)) return;
  if (isOptionUsingTextValue(element)) {
    let sources = attributeSources.get(element);
    if (!sources) {
      sources = new Map();
      attributeSources.set(element, sources);
    }
    const current = element.getAttribute("label") || element.textContent || "";
    const storedSource = sources.get("label");
    const normalizedCurrent = normalizeLookupText(current);
    const source = storedSource && isRenderedVariant(storedSource, normalizedCurrent) ? storedSource : normalizeLookupText(element.textContent || current);
    if (!source || !/[A-Za-zÀ-ÿ]/.test(source)) return;
    sources.set("label", source);
    const next = translated(language, source);
    if (normalizeLookupText(current) !== normalizeLookupText(next)) element.setAttribute("label", next);
    return;
  }
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current || !/[A-Za-zÀ-ÿ]/.test(current)) continue;
    let sources = attributeSources.get(element);
    if (!sources) {
      sources = new Map();
      attributeSources.set(element, sources);
    }
    const storedSource = sources.get(attribute);
    const normalizedCurrent = normalizeLookupText(current);
    const source = storedSource && isRenderedVariant(storedSource, normalizedCurrent) ? storedSource : normalizedCurrent;
    sources.set(attribute, source);
    const next = translated(language, source);
    if (current !== next) element.setAttribute(attribute, next);
  }
}

export function translateLegacyStaticUi(root: ParentNode, languageValue: unknown) {
  const language = normalizeUiLanguage(languageValue);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (shouldSkipTextElement(parent)) return NodeFilter.FILTER_REJECT;
      const text = normalizeLookupText(node.textContent);
      if (!text || !/[A-Za-zÀ-ÿ]/.test(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let textNode = walker.nextNode();
  while (textNode) {
    translateTextNode(textNode as Text, language);
    textNode = walker.nextNode();
  }

  const elements = root instanceof Element
    ? [root, ...Array.from(root.querySelectorAll("*"))]
    : Array.from(root.querySelectorAll("*"));
  for (const element of elements) translateElementAttributes(element, language);
}

export function translateLegacyStaticDocumentTitle(languageValue: unknown) {
  const language = normalizeUiLanguage(languageValue);
  const source = normalizeLookupText(document.title);
  const next = translated(language, source);
  if (next !== document.title) document.title = next;
}

export function attachLegacyStaticUiTranslator(languageValue: unknown) {
  if (typeof document === "undefined") return () => {};
  const language = normalizeUiLanguage(languageValue);
  const root = document.getElementById("root") || document.body;

  const translateAll = () => {
    translateLegacyStaticUi(root, language);
    translateLegacyStaticDocumentTitle(language);
  };

  translateAll();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = (node as Text).parentElement;
          if (!shouldSkipTextElement(parent)) translateTextNode(node as Text, language);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          translateLegacyStaticUi(node as Element, language);
        }
      }
      if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
        const node = mutation.target as Text;
        if (!shouldSkipTextElement(node.parentElement)) translateTextNode(node, language);
      }
      if (mutation.type === "attributes" && mutation.target instanceof Element) {
        translateElementAttributes(mutation.target, language);
      }
    }
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });

  return () => observer.disconnect();
}
