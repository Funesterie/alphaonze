function normalizeIntentText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toUniqueTrimmedList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  ));
}

function extractEmailRecipients(value = '') {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return toUniqueTrimmedList(matches.map((entry) => entry.toLowerCase()));
}

function cleanupPdfTopicFragment(value = '') {
  let topic = String(value || '')
    .replace(/[?.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!topic) return '';

  topic = topic
    .replace(/\b(?:et|puis)\s+(?:envoi|envois|envoie|envoyer|mail|email|e-mail|partage|transmet|transmets|adresse)\b[\s\S]*$/i, '')
    .replace(/\b(?:par\s+mail|mail|email|e-mail)\b[\s\S]*$/i, '')
    .replace(/\b(?:a|à)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '')
    .replace(/^(?:de|du|des|d['’]|sur|avec)\s+/i, '')
    .replace(/^(?:un|une)\s+/i, '')
    .trim();

  return topic;
}

function normalizePdfThemeTopic(value = '') {
  return String(value || '')
    .replace(/^(?:le|la|les)\s+theme\s+(?:de\s+|du\s+|des\s+)?/i, '')
    .replace(/^(?:theme|th[eè]me)\s+(?:de\s+|du\s+|des\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPdfTopic(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';

  const patterns = [
    /\bpdf\s+(?:de|du|des|d['’]|sur|avec)\s+(.+?)(?:\s+(?:par\s+mail|mail|email|e-mail|a|à)\b|$)/i,
    /\bpdf\b\s+(.+?)(?:\s+(?:par\s+mail|mail|email|e-mail|a|à)\b|$)/i,
    /\bdocument\s+(?:de|du|des|d['’]|sur|avec)\s+(.+?)(?:\s+(?:par\s+mail|mail|email|e-mail|a|à)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const topic = cleanupPdfTopicFragment(match?.[1] || '');
    if (topic) return topic;
  }

  return '';
}

function capitalizeTopic(value = '') {
  const topic = normalizePdfThemeTopic(String(value || '').trim());
  if (!topic) return 'Document';
  if (/^[a-z0-9]{2,5}$/i.test(topic)) {
    return topic.toUpperCase();
  }
  return topic.charAt(0).toUpperCase() + topic.slice(1);
}

function extractIllustratedPdfTopic(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';

  let topic = extractPdfTopic(text) || text;
  topic = String(topic || '')
    .replace(/\bavec\s+(?:des?|les)\s+(?:images?|photos?|illustrations?)\b[\s\S]*$/i, '')
    .replace(/\b(?:en|avec)\s+images?\b[\s\S]*$/i, '')
    .replace(/\b(?:genere|g[eé]n[eè]re|cree|cr[eé]e|creer|fais|fait|prepare|pr[eé]pare|realise|r[eé]alise|produis|fabrique)\s+(?:moi\s+)?(?:un|une)\s+(?:document\s+)?pdf\b/i, '')
    .replace(/\b(?:avec|des)\s+(?:images?|photos?|illustrations?)\b/gi, '')
    .replace(/\b(?:images?|photos?|illustrations?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizePdfThemeTopic(cleanupPdfTopicFragment(topic));
}

function buildAutoPdfSections(topic = '') {
  const rawTopic = normalizePdfThemeTopic(String(topic || '').trim());
  const normalizedTopic = normalizeIntentText(rawTopic);
  const safeTopic = rawTopic || 'document';

  if (/\b(dbz|dragon ball z)\b/.test(normalizedTopic)) {
    return [
      {
        heading: 'Introduction',
        text: "Dragon Ball Z est une serie d animation japonaise adaptee du manga d Akira Toriyama. Elle met en scene des combats spectaculaires, des transformations celebres et un imaginaire fonde sur le depassement de soi.",
        illustrationPrompt: "un visuel epique inspire de dragon ball z, aura d energie, paysage rocheux, style anime dynamique, sans texte",
      },
      {
        heading: 'Univers',
        text: "L univers de DBZ melange arts martiaux, science-fiction et mythologie. On y trouve la Terre, Namek et de nombreuses autres planetes, avec des ennemis puissants comme Freezer, Cell ou Boo.",
      },
      {
        heading: 'Personnages',
        text: "Parmi les figures les plus connues, on retrouve Goku, Vegeta, Gohan, Piccolo et Trunks. Chacun joue un role precis dans l evolution du recit, entre rivalite, transmission et protection du monde.",
        illustrationPrompt: "une scene heroique inspiree de dragon ball z avec un combattant a l aura lumineuse, pose de combat, ciel dramatique, style anime propre, sans texte",
      },
      {
        heading: 'Themes',
        text: "DBZ insiste sur la perseverance, l entrainement, l amitie et le sacrifice. Les affrontements servent souvent a montrer comment les heros progressent face a des limites toujours plus hautes.",
      },
      {
        heading: 'Impact culturel',
        text: "Dragon Ball Z a marque plusieurs generations de spectateurs. Son style visuel, ses musiques, ses attaques speciales et ses transformations sont devenus des references majeures de la culture populaire.",
      },
    ];
  }

  if (/\b(tortues ninja|tmnt|teenage mutant ninja turtles)\b/.test(normalizedTopic)) {
    return [
      {
        heading: 'Introduction',
        text: "Les Tortues Ninja sont une equipe de heros fictifs vivant a New York. Elles combinent humour, arts martiaux et aventure dans un univers melangeant science-fiction, mutation et culture pop.",
        illustrationPrompt: "une illustration dynamique inspiree des tortues ninja dans une ruelle urbaine, style bande dessinee energique, sans texte",
      },
      {
        heading: 'Equipe',
        text: "Leonardo, Raphael, Donatello et Michelangelo ont chacun une personnalite bien distincte. Cette complementarite renforce l identite du groupe et rend leurs interactions memorables.",
      },
      {
        heading: 'Univers',
        text: "Autour des tortues gravitent Splinter, April O Neil, Casey Jones et le Shredder. Les egouts, les toits de New York et les repaires ennemis donnent au recit une ambiance urbaine reconnaissable.",
        illustrationPrompt: "une scene nocturne inspiree des tortues ninja sur les toits de new york, ambiance neon, action, sans texte",
      },
      {
        heading: 'Themes',
        text: "L oeuvre parle de fraternite, de discipline, de transmission et d esprit d equipe. Sous son apparence legerement absurde, elle repose sur des valeurs simples mais fortes.",
      },
    ];
  }

  if (/\blapin(s)?\b/.test(normalizedTopic)) {
    return [
      {
        heading: 'Presentation',
        text: 'Les lapins sont des mammiferes herbivores connus pour leurs grandes oreilles, leur vivacite et leur mode de vie social.',
      },
      {
        heading: 'Points cles',
        text: 'Ce document a ete genere automatiquement par A11 sur le theme des lapins. Ils vivent souvent en groupe, communiquent par leur posture et ont besoin d un environnement calme, propre et securise.',
      },
    ];
  }

  return [
    {
      heading: 'Introduction',
      text: `Ce document presente une synthese claire sur le theme ${safeTopic}. Il a ete structure automatiquement par A11 pour fournir une vue d ensemble utile et lisible.`,
      illustrationPrompt: `une illustration editoriale propre sur le theme ${safeTopic}, composition claire, sans texte`,
    },
    {
      heading: 'Contexte',
      text: `Le sujet demande est ${safeTopic}. Cette section sert a cadrer le theme, a rappeler son importance et a fournir un point de depart pour la lecture du document.`,
    },
    {
      heading: 'Points essentiels',
      text: `A11 a prepare un resume des idees principales liees a ${safeTopic}, avec une organisation simple en sections pour faciliter la comprehension.`,
    },
    {
      heading: 'Conclusion',
      text: `En resume, ${safeTopic} peut etre aborde sous plusieurs angles. Le but de ce PDF est d offrir une base exploitable, concise et presentable.`,
    },
  ];
}

function parsePdfEmailIntent(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = normalizeIntentText(text);
  const recipients = extractEmailRecipients(text);
  const mentionsPdf = /\b(pdf|document)\b/.test(normalized);
  const asksEmail = /\b(envoi|envois|envoie|envoyer|mail|email|e-mail|transmet|transmets|partage|expedie|expedier)\b/.test(normalized);
  if (!recipients.length || !mentionsPdf || !asksEmail) return null;

  const topic = normalizePdfThemeTopic(extractPdfTopic(text) || 'document');
  const title = capitalizeTopic(topic);

  return {
    recipients,
    topic,
    title,
    sections: buildAutoPdfSections(topic),
    emailSubject: `A11 - PDF ${title}`,
    emailMessage: `Voici le PDF demande sur ${topic}.`,
  };
}

function extractSimpleEmailMessage(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';

  const quotedMatch = text.match(/["“'`](.+?)["”'`]/);
  if (quotedMatch?.[1]) {
    return String(quotedMatch[1] || '').trim();
  }

  const patterns = [
    /\b(?:en\s+disant|disant|pour\s+dire|en\s+lui\s+disant|en\s+leur\s+disant|qui\s+dit|avec\s+ce\s+message|avec\s+le\s+message|avec\s+comme\s+message|message\s*[:\-])\s+(.+)$/i,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b\s+(?:que|qu['’]il\s+dit|en\s+disant|disant|pour\s+dire)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = String(match?.[1] || '')
      .trim()
      .replace(/^["“'`]+/, '')
      .replace(/["”'`]+$/g, '')
      .trim();
    if (candidate) return candidate;
  }

  return '';
}

function parseSimpleEmailIntent(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = normalizeIntentText(text);
  const recipients = extractEmailRecipients(text);
  const asksEmail = /\b(envoi|envois|envoie|envoyer|mail|email|e-mail|courriel|transmet|transmets|expedie|expedier|adresse)\b/.test(normalized);
  const mentionsAttachmentLikeArtifact = /\b(pdf|document|piece jointe|pieces jointes|fichier|archive|zip|image|illustration|photo|ressource|dernier fichier|derniere ressource|pi[eè]ce jointe)\b/.test(normalized);

  if (!recipients.length || !asksEmail || mentionsAttachmentLikeArtifact) {
    return null;
  }

  const message = extractSimpleEmailMessage(text);
  if (!message) {
    return null;
  }

  return {
    recipients,
    subject: 'A11',
    message,
  };
}

function parseSimplePdfIntent(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = normalizeIntentText(text);
  const mentionsPdf = /\b(pdf|document)\b/.test(normalized);
  const asksCreate = /\b(fais|fait|cree|creer|genere|generer|prepare|preparer|produis|fabrique|realise|realiser)\b/.test(normalized);
  const asksEmail = /\b(mail|email|e-mail|envoi|envoie|envois|envoyer|courriel)\b/.test(normalized);
  const mentionsImageFlow = /\b(image|images|photo|photos|illustration|web|internet)\b/.test(normalized);

  if (!mentionsPdf || !asksCreate || asksEmail || mentionsImageFlow) {
    return null;
  }

  const topic = normalizePdfThemeTopic(extractPdfTopic(text) || 'document');
  const title = capitalizeTopic(topic);

  return {
    topic,
    title,
    sections: buildAutoPdfSections(topic),
    filename: `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'document'}.pdf`,
  };
}

function normalizeGeneratedImagePrompt(value = '') {
  let text = String(value || '')
    .replace(/\b(?:puis|et)\s+(?:envoie|envois|envoyer|envoi|mail|email|adresse|partage|transmets?)\b[\s\S]*$/i, '')
    .trim();
  if (!text) return '';

  text = text
    .replace(/^(?:peux-tu\s+|tu peux\s+|merci de\s+)?(?:moi\s+)?(?:envoie|envois|envoyer|nvois|adresse|partage|transmets?)\s+(?:moi\s+)?(?:une?\s+)?(?:image|illustration|photo)\s+/i, 'genere une image de ')
    .replace(/^(?:peux-tu\s+|tu peux\s+|merci de\s+)?(?:fais|fait|cree|crée|creer|genere|génère|generer|dessine|dessiner)\s+(?:moi\s+)?(?:une?\s+)?(?:image|illustration|photo)\s*/i, 'genere une image ')
    .replace(/^genere une image\s+(?!de\b)/i, 'genere une image de ')
    .replace(/^genere une image de\s+de\b/i, 'genere une image de')
    .replace(/^cr[eé]e une image\s+(?!de\b)/i, 'genere une image de ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function classifyAssistantCapabilityRefusal(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return { any: false, image: false, email: false, generic: false };

  const image = /(ne peux pas|n ai pas|pas la capacite|pas capable|assistant texte).{0,80}(generer|creer|faire).{0,40}(image|illustration|photo|visuel)/.test(normalized)
    || /(je ne peux pas generer d images|je ne peux pas creer d images|je ne peux pas generer une image)/.test(normalized);
  const email = /(ne dispose pas d outils|assistant texte|je ne peux pas).{0,80}(mail|email|e-mail|envoyer des e-mails|envoyer des mails)/.test(normalized);
  const generic = image
    || email
    || /(assistant texte|texte uniquement|texte seulement|je suis un assistant texte)/.test(normalized)
    || /(je pense que je comprends le probleme).{0,120}(outils|modules|capacite|capacites)/.test(normalized);

  return {
    any: image || email || generic,
    image,
    email,
    generic,
  };
}

function getRecentMessagesByRole(messages = [], role = '', limit = 4) {
  return (Array.isArray(messages) ? messages : [])
    .filter((entry) => String(entry?.role || '').trim().toLowerCase() === String(role || '').trim().toLowerCase())
    .slice(-Math.max(1, Number(limit || 4)));
}

function hasRecentAssistantCapabilityRefusal(messages = [], type = 'generic') {
  return getRecentMessagesByRole(messages, 'assistant', 4).some((entry) => {
    const flags = classifyAssistantCapabilityRefusal(entry?.content || '');
    if (type === 'image') return flags.image;
    if (type === 'email') return flags.email;
    return flags.any;
  });
}

function extractImplicitImageGenerationPrompt({ latestUserMessage = '', messages = [], detectImageIntent = null } = {}) {
  const rawMessage = String(latestUserMessage || '').trim();
  if (!rawMessage) return '';
  if (typeof detectImageIntent === 'function' && detectImageIntent(rawMessage)) return '';

  const normalized = normalizeIntentText(rawMessage);
  const recentImageRefusal = hasRecentAssistantCapabilityRefusal(messages, 'image');
  const recentGenericRefusal = hasRecentAssistantCapabilityRefusal(messages, 'generic');
  const asksToSee = /\b(?:je voulais voir|je veux voir|je voudrais voir|j aimerais voir|fais moi voir|montre moi)\b/.test(normalized);
  const sceneCue = /\b(avec|en train de|dans|sur|sous|devant|derriere|seulement)\b/.test(normalized);
  const correctiveCue = /^(?:presque|bah|non|pas exactement|plutot|plutôt|en fait)\b/.test(normalized);

  if (!(asksToSee || (sceneCue && (recentImageRefusal || recentGenericRefusal)) || (correctiveCue && recentImageRefusal))) {
    return '';
  }

  let subject = rawMessage
    .replace(/^(?:presque\s+mais\s+)?(?:bah\s+)?(?:en\s+fait\s+)?(?:non\s+)?/i, '')
    .replace(/^(?:je\s+(?:voulais|veux|voudrais|souhaite|souhaitais)\s+(?:bien\s+)?)?(?:voi(?:r|re)|avoir|obtenir)\s+/i, '')
    .replace(/^(?:fais(?:-|\s)?moi\s+voir|montre(?:-|\s)?moi)\s+/i, '')
    .replace(/^(?:une?\s+image|un\s+visuel|une?\s+illustration)\s+(?:de|du|des|d['’])\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  if (!subject || subject.length < 6) return '';
  if (/\b(pdf|mail|email|e-mail|fichier|dossier|json|endpoint|route|token|bug|erreur|probleme)\b/i.test(subject)) {
    return '';
  }

  return `genere une image de ${subject}`;
}

function detectCapabilityDiagnosticIntent({ latestUserMessage = '', messages = [] } = {}) {
  const normalized = normalizeIntentText(latestUserMessage);
  if (!normalized) return null;

  const asksDiagnostic = /(explique|detaille|detaille moi|diagnostic|debug|qu est ce qui|qu est ce qui bloque|ce qui bloque|pourquoi ca bloque|pourquoi ca ne marche pas|pourquoi ca marche pas)/.test(normalized)
    && /(bloque|blocage|coince|coince|probleme|souci|marche pas|fonctionne pas|rate|ratee|echec|echec)/.test(normalized);

  if (!asksDiagnostic) return null;
  if (!hasRecentAssistantCapabilityRefusal(messages, 'generic')) return null;
  return 'diagnostiquer les capacites A11';
}

module.exports = {
  normalizeIntentText,
  extractEmailRecipients,
  extractPdfTopic,
  extractIllustratedPdfTopic,
  buildAutoPdfSections,
  parsePdfEmailIntent,
  parseSimpleEmailIntent,
  parseSimplePdfIntent,
  normalizeGeneratedImagePrompt,
  classifyAssistantCapabilityRefusal,
  hasRecentAssistantCapabilityRefusal,
  extractImplicitImageGenerationPrompt,
  detectCapabilityDiagnosticIntent,
};
