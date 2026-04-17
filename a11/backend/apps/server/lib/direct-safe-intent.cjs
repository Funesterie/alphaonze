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
    .replace(/\b(?:par\s+mail|mail|email|e-mail)\b[\s\S]*$/i, '')
    .replace(/\b(?:a|à)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '')
    .replace(/^(?:de|du|des|d['’]|sur|avec)\s+/i, '')
    .replace(/^(?:un|une)\s+/i, '')
    .trim();

  return topic;
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
  const topic = String(value || '').trim();
  if (!topic) return 'Document';
  return topic.charAt(0).toUpperCase() + topic.slice(1);
}

function buildAutoPdfSections(topic = '') {
  const rawTopic = String(topic || '').trim();
  const normalizedTopic = normalizeIntentText(rawTopic);
  const safeTopic = rawTopic || 'document';

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
      heading: 'Sujet',
      text: `Document genere automatiquement par A11 sur le theme suivant : ${safeTopic}.`,
    },
    {
      heading: 'Resume',
      text: `Ce PDF a ete prepare a partir de la demande utilisateur. Sujet demande : ${safeTopic}.`,
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

  const topic = extractPdfTopic(text) || 'document';
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
  buildAutoPdfSections,
  parsePdfEmailIntent,
  classifyAssistantCapabilityRefusal,
  hasRecentAssistantCapabilityRefusal,
  extractImplicitImageGenerationPrompt,
  detectCapabilityDiagnosticIntent,
};
