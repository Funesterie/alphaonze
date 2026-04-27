/**
 * web-guide.cjs
 *
 * Web Guide pour A11 — inspiré du format Google Web Guide.
 * Regroupe les résultats de recherche web par thèmes via analyse heuristique.
 * Intègre Janus Vision pour analyser les images trouvées dans les résultats.
 *
 * Au lieu d'une liste plate de liens, les résultats sont organisés en sections
 * thématiques avec un titre, une description et les liens associés.
 * Les images sont analysées par Janus si disponible.
 *
 * Usage :
 *   const { buildWebGuide, enrichWebGuideWithJanus } = require('./web-guide.cjs');
 *   const guide = buildWebGuide(query, results);
 *   const enriched = await enrichWebGuideWithJanus(guide); // optionnel
 */

// ─── Détecteurs de thèmes ─────────────────────────────────────────────────────

const THEME_RULES = [
  {
    id: 'official',
    label: 'Sources officielles',
    icon: '🏛️',
    patterns: [/\.gov\b/, /\.gouv\b/, /\.org\b/, /wikipedia\.org/, /official/, /officiel/i],
    priority: 1,
  },
  {
    id: 'tutorial',
    label: 'Guides & tutoriels',
    icon: '📖',
    patterns: [/guide/i, /tutoriel/i, /tutorial/i, /how.to/i, /comment/i, /étape/i, /step/i, /learn/i, /apprendre/i],
    priority: 2,
  },
  {
    id: 'news',
    label: 'Actualités',
    icon: '📰',
    patterns: [/news/i, /actualit/i, /article/i, /blog/i, /press/i, /presse/i, /journal/i, /magazine/i, /\.fr\//, /lemonde/, /lefigaro/, /bbc/, /reuters/, /techcrunch/, /01net/],
    priority: 3,
  },
  {
    id: 'video',
    label: 'Vidéos',
    icon: '🎬',
    patterns: [/youtube\.com/, /youtu\.be/, /vimeo\.com/, /dailymotion/, /video/i, /watch/i],
    priority: 4,
  },
  {
    id: 'forum',
    label: 'Discussions & expériences',
    icon: '💬',
    patterns: [/reddit\.com/, /forum/i, /stackoverflow/, /quora/, /discord/, /community/i, /communauté/i, /discussion/i, /thread/i],
    priority: 5,
  },
  {
    id: 'technical',
    label: 'Documentation technique',
    icon: '⚙️',
    patterns: [/docs\./i, /documentation/i, /api\./i, /github\.com/, /gitlab/, /npm\.js/, /pypi/, /developer/i, /dev\./i, /reference/i],
    priority: 6,
  },
  {
    id: 'ecommerce',
    label: 'Produits & services',
    icon: '🛒',
    patterns: [/amazon\./i, /ebay\./i, /shop/i, /store/i, /boutique/i, /prix/i, /price/i, /acheter/i, /buy/i],
    priority: 7,
  },
  {
    id: 'image',
    label: 'Images',
    icon: '🖼️',
    patterns: [],
    isImageTheme: true,
    priority: 8,
  },
  {
    id: 'other',
    label: 'Autres résultats',
    icon: '🔗',
    patterns: [],
    priority: 99,
  },
];

/**
 * Détermine le thème d'un résultat de recherche.
 */
function classifyResult(result) {
  if (result.isImage) return 'image';

  const text = `${result.url || ''} ${result.title || ''} ${result.snippet || ''}`.toLowerCase();

  for (const theme of THEME_RULES) {
    if (theme.id === 'other' || theme.id === 'image') continue;
    if (theme.patterns.some((pattern) => pattern.test(text))) {
      return theme.id;
    }
  }

  return 'other';
}

/**
 * Génère un résumé court pour une section thématique.
 */
function buildSectionSummary(themeId, results, query) {
  const count = results.length;
  const q = String(query || '').trim();

  switch (themeId) {
    case 'official':
      return `${count} source${count > 1 ? 's' : ''} officielle${count > 1 ? 's' : ''} sur ${q}.`;
    case 'tutorial':
      return `${count} guide${count > 1 ? 's' : ''} et tutoriel${count > 1 ? 's' : ''} pour ${q}.`;
    case 'news':
      return `${count} article${count > 1 ? 's' : ''} d'actualité sur ${q}.`;
    case 'video':
      return `${count} vidéo${count > 1 ? 's' : ''} sur ${q}.`;
    case 'forum':
      return `${count} discussion${count > 1 ? 's' : ''} et retours d'expérience sur ${q}.`;
    case 'technical':
      return `${count} ressource${count > 1 ? 's' : ''} technique${count > 1 ? 's' : ''} sur ${q}.`;
    case 'ecommerce':
      return `${count} produit${count > 1 ? 's' : ''} ou service${count > 1 ? 's' : ''} liés à ${q}.`;
    case 'image':
      return `${count} image${count > 1 ? 's' : ''} trouvée${count > 1 ? 's' : ''} pour ${q}.`;
    default:
      return `${count} résultat${count > 1 ? 's' : ''} supplémentaire${count > 1 ? 's' : ''} sur ${q}.`;
  }
}

/**
 * Construit le Web Guide à partir des résultats de recherche.
 *
 * @param {string} query - La requête de recherche
 * @param {Array}  results - Les résultats bruts de t_web_search
 * @returns {Object} Guide structuré par thèmes
 */
function buildWebGuide(query, results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      query,
      sections: [],
      totalResults: 0,
      formatted: `Aucun résultat trouvé pour "${query}".`,
    };
  }

  // Classifier chaque résultat
  const classified = results.map((result) => ({
    ...result,
    themeId: classifyResult(result),
  }));

  // Grouper par thème
  const groups = {};
  for (const result of classified) {
    if (!groups[result.themeId]) groups[result.themeId] = [];
    groups[result.themeId].push(result);
  }

  // Construire les sections dans l'ordre de priorité
  const sections = THEME_RULES
    .filter((theme) => groups[theme.id]?.length > 0)
    .map((theme) => {
      const themeResults = groups[theme.id] || [];
      return {
        id: theme.id,
        label: theme.label,
        icon: theme.icon,
        summary: buildSectionSummary(theme.id, themeResults, query),
        results: themeResults.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet || '',
          isImage: r.isImage || false,
        })),
      };
    });

  // Formater en texte lisible pour le LLM
  const formatted = formatWebGuideForLLM(query, sections);

  return {
    query,
    sections,
    totalResults: results.length,
    formatted,
  };
}

/**
 * Formate le Web Guide en réponse courte pour A11.
 * Version condensée pour les réponses chat.
 */
function formatWebGuideShort(query, sections) {
  if (!sections.length) return `Aucun résultat pour "${query}".`;

  const nonImageSections = sections.filter((s) => s.id !== 'image');
  const imageSections = sections.filter((s) => s.id === 'image');

  const lines = [`Voici ce que j'ai trouvé sur **"${query}"** :\n`];

  for (const section of nonImageSections.slice(0, 4)) {
    lines.push(`${section.icon} **${section.label}**`);
    for (const result of section.results.slice(0, 2)) {
      lines.push(`• [${result.title}](${result.url})`);
      if (result.snippet) {
        lines.push(`  _${result.snippet.slice(0, 100)}${result.snippet.length > 100 ? '…' : ''}_`);
      }
    }
    lines.push('');
  }

  if (imageSections.length > 0 && imageSections[0].results.length > 0) {
    lines.push(`🖼️ **Images** : ${imageSections[0].results.length} image(s) trouvée(s).`);
  }

  return lines.join('\n');
}

// ─── Intégration Janus Vision ─────────────────────────────────────────────────

/**
 * Télécharge une image depuis une URL et retourne son buffer.
 */
async function fetchImageBuffer(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 A11-WebGuide/1.0' },
    });
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enrichit le Web Guide avec des descriptions Janus des images trouvées.
 * Si Janus n'est pas disponible, retourne le guide inchangé.
 *
 * @param {Object} guide - Le Web Guide produit par buildWebGuide
 * @param {Object} options - Options (maxImages, timeoutMs)
 * @returns {Object} Guide enrichi avec les descriptions Janus
 */
async function enrichWebGuideWithJanus(guide, options = {}) {
  if (!guide || !guide.sections) return guide;

  const maxImages = Math.min(Number(options.maxImages || 3), 5);
  const timeoutMs = Number(options.timeoutMs || 10000);

  // Vérifier si Janus est disponible
  let callJanusVisionText;
  let resolveVisionProvider;
  try {
    const janusModule = require('./janus-vision-runtime.cjs');
    callJanusVisionText = janusModule.callJanusVisionText;
    resolveVisionProvider = janusModule.resolveVisionProvider;
  } catch (_) {
    return guide; // Janus non disponible
  }

  const provider = resolveVisionProvider();
  if (provider === 'none') return guide; // Janus désactivé

  // Collecter les images des résultats
  const imageSection = guide.sections.find((s) => s.id === 'image');
  const imageResults = imageSection?.results?.slice(0, maxImages) || [];

  // Aussi chercher des images dans les autres sections (URLs d'images dans les snippets)
  const allImageUrls = imageResults.map((r) => r.url).filter(Boolean);

  if (allImageUrls.length === 0) return guide;

  const janusDescriptions = [];

  for (const imageUrl of allImageUrls) {
    try {
      const fetched = await fetchImageBuffer(imageUrl, timeoutMs);
      if (!fetched?.buffer) continue;

      const result = await callJanusVisionText({
        imageBuffer: fetched.buffer,
        contentType: fetched.contentType,
        prompt: `Décris brièvement ce que tu vois dans cette image en lien avec la recherche "${guide.query}". Sois concis (1-2 phrases).`,
        maxNewTokens: 120,
        timeoutMs,
      });

      const description = String(result?.text || result || '').trim();
      if (description) {
        janusDescriptions.push({ url: imageUrl, description });
      }
    } catch (_) {
      // Janus indisponible ou timeout — on continue sans
    }
  }

  if (janusDescriptions.length === 0) return guide;

  // Enrichir la section images avec les descriptions Janus
  const enrichedSections = guide.sections.map((section) => {
    if (section.id !== 'image') return section;
    return {
      ...section,
      label: 'Images analysées par Janus',
      icon: '👁️',
      summary: `${janusDescriptions.length} image(s) analysée(s) par Janus Vision.`,
      results: section.results.map((result) => {
        const desc = janusDescriptions.find((d) => d.url === result.url);
        return desc ? { ...result, janusDescription: desc.description } : result;
      }),
      janusAnalysis: janusDescriptions,
    };
  });

  // Reconstruire le formatted avec les descriptions Janus
  const enrichedGuide = {
    ...guide,
    sections: enrichedSections,
    janusEnabled: true,
    janusDescriptions,
  };

  enrichedGuide.formatted = formatWebGuideForLLM(guide.query, enrichedSections, janusDescriptions);

  return enrichedGuide;
}

/**
 * Formate le Web Guide en texte lisible pour le LLM.
 * Version enrichie avec descriptions Janus si disponibles.
 */
function formatWebGuideForLLM(query, sections, janusDescriptions = []) {
  if (!sections.length) return `Aucun résultat pour "${query}".`;

  const lines = [`🔍 Web Guide — "${query}"\n`];

  for (const section of sections) {
    lines.push(`${section.icon} **${section.label}**`);
    lines.push(`_${section.summary}_`);

    for (const result of section.results.slice(0, 3)) {
      if (result.isImage) {
        const desc = result.janusDescription
          || janusDescriptions.find((d) => d.url === result.url)?.description;
        if (desc) {
          lines.push(`  • 👁️ [Image](${result.url}) — ${desc}`);
        } else {
          lines.push(`  • [Image](${result.url})`);
        }
      } else {
        lines.push(`  • [${result.title}](${result.url})`);
        if (result.snippet) {
          lines.push(`    ${result.snippet.slice(0, 120)}${result.snippet.length > 120 ? '…' : ''}`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  buildWebGuide,
  formatWebGuideForLLM,
  formatWebGuideShort,
  classifyResult,
  enrichWebGuideWithJanus,
  THEME_RULES,
};
