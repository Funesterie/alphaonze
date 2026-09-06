/**
 * Filtres de paroles Vivy.
 *
 * Ces fonctions retirent des paroles ce qui n'en est pas: consignes adressees a Vivy,
 * bruit d'operateur, direction de style, references techniques. Elles vivaient dans
 * App.tsx, ou rien ne les testait -- et elles ont mange a plusieurs reprises de vraies
 * paroles: un couplet entier vide, puis paroles_vivy_invalides.
 *
 * Elles sont ici pour etre testees directement, par le corpus de
 * vivy-lyrics-filters.node.test.ts. Une copie des regex dans un script de test derive
 * de la realite -- c'est arrive le 27/07 et le resultat etait faux.
 *
 * Principe: le discriminant n'est pas le mot mais l'usage. « j'envoie le son » est une
 * parole, « envoie le son quand tu es prete » une consigne. Un mot francais courant
 * (reponse, secret, telephone, generique, ko) ne doit jamais suffire a couper une ligne.
 */

import { foldForLookup } from "./language.ts";

export function looksLikeVivyNossenTechnicalMediaLine(value = "") {
  const raw = String(value || "").trim();
  const folded = foldForLookup(raw);
  if (!folded) return false;
  if (/\.(?:jpe?g|png|webp|gif|bmp|svg|heic|avif)\b/i.test(raw)) return true;
  if (/https?:\/\/\S+/i.test(raw) || /\b(?:downloadurl|storagekey|contenttype|textpreview|visualdescription|analysissummary)\b/i.test(raw)) return true;
  // « ko » retire: c'est un mot de rap avant d'etre une unite de taille -- « je te mets
  // KO » disparaissait des paroles. « px » reste, il n'apparait pas dans une chanson.
  if (/\b(?:ocr|analyse\s+a11|jpg|jpeg|png|webp|gif|maxresdefault|wallpaper|preview|filename|nom\s+de\s+fichier|fichier\s+image|metadata|metadonnees|métadonnées|lecture\s+locale|vision\s+avancee|vision\s+avancée|format\s+jpeg|format\s+png|image\s+recue|image\s+reçue|px)\b/.test(folded)) return true;
  if (/\b[a-f0-9]{14,}\b/i.test(raw) || /\b\d{8,}\b/.test(raw)) return true;
  return false;
}

export function isVivyNossenSonicStyleLine(value = "") {
  const raw = String(value || "").trim();
  const folded = foldForLookup(raw);
  if (!folded) return false;
  if (/^(?:style\s+sonore|direction\s+sonore|couleur\s+sonore|ambiance\s+sonore|mood|genre|style)\b/.test(folded)) return true;
  const styleMatches = folded.match(/\b(?:epic|cinematic|cinematique|cinématique|dark|pop|rock|metal|electro|rap|anthem|motorbike|racing|powerful|female|male|vocal|voice|guitars?|guitares?|drums?|batterie|synths?|orchestr(?:e|al|ation)?|strings?|bpm|stadium|crowd|choir|reverb|bass|basse)\b/g) || [];
  if (styleMatches.length < 3) return false;
  if (!raw.includes(",") && !/\b(?:vocal|bpm|drums?|guitars?|synths?|orchestr|anthem)\b/.test(folded)) return false;
  // Compter trois mots de musique ne suffit pas: « la basse, la batterie, le rap qui
  // monte dans la piece » est une parole, pas une consigne de style. Une consigne est
  // une liste d'etiquettes, donc dense; une parole dilue ces mots dans une phrase.
  const totalMots = folded.split(/\s+/).filter(Boolean).length;
  return totalMots > 0 && (styleMatches.length / totalMots) >= 0.4;
}

export function isVivyNossenStructureInstructionLine(value = "") {
  const folded = foldForLookup(value);
  if (!folded) return false;
  if (/^(?:instruction|consigne|structure|format\s+attendu|ecrire|écrire|ecris|écris)\b/.test(folded)) return true;
  // Ces motifs visaient des consignes mais mangeaient le vocabulaire courant du rap:
  // << j'envoie le son >>, << je mets l'ambiance >>, << il sort son flow >>. Un couplet
  // entier est parti comme ca. Le discriminant n'est pas le verbe mais l'adresse: une
  // consigne parle a Vivy (imperatif en tete de ligne, << quand tu es prete >>), une
  // parole a un sujet qui chante. On exige donc la forme imperative, et on abandonne
  // << sort >>, qui n'est jamais un verbe de consigne ici.
  if (/^(?:mets|met|mettre)\b.{0,80}\b(?:action|theme|th[eè]me|ambiance|titre)\b/.test(folded)) return true;
  if (/\btu\s+(?:mets|met)\b.{0,60}\b(?:action|theme|th[eè]me|ambiance|titre)\b/.test(folded)) return true;
  if (/^(?:put|turn|make)\b.{0,80}\b(?:action|theme|mood|ambience|ambiance|title|epic|fantasy)\b/.test(folded)) return true;
  if (/\bquand\s+tu\s+es\s+pr[eê]te\b/.test(folded)) return true;
  if (/^(?:envoie|envois|envoies|lance)\b.{0,80}\b(?:son|chanson|musique|voix\s+f[eé]minine|bien\s+aim[eé]e)\b/.test(folded)) return true;
  if (/\b(?:when\s+you(?:\s+re|\s+are)\s+ready|send|launch|release|drop)\b.{0,80}\b(?:song|track|music|lyrics|female\s+voice|beloved)\b/.test(folded)) return true;
  if (/\b(?:vraie\s+chanson\s+complete|vraie\s+chanson\s+complète|ecrire.{0,50}chanson\s+complete|écrire.{0,50}chanson\s+complète|ecris.{0,50}chanson\s+complete|écris.{0,50}chanson\s+complète|intro.*couplet.*refrain|couplet.*refrain.*pont|ne\s+pas\s+recopier|ne\s+chante\s+pas|paroles\s+chantables)\b/.test(folded)) return true;

  // Consignes que Vivy a recrachees telles quelles dans des paroles envoyees a Suno:
  // << Utilise le tag exact [Vivy] >>, << CONTRAT_COMPOSITION_NOSSEN >>, << Casting
  // verrouille >>... Ces lignes finissaient chantees. Motifs releves sur cas reel.
  if (/^utilise\b.{0,60}\btag\b/.test(folded)) return true;
  if (/\btag\s+exact\b/.test(folded)) return true;
  if (/^chaque\s+(?:section|detail|nom)\b/.test(folded)) return true;
  if (/^(?:origine\s+de\s+mati|casting\s+(?:verrouille|demande|impose)|distribution\s+vocale|contrat\b)/.test(folded)) return true;
  if (/contrat[_\s-]?composition|composition[_\s-]?nossen/.test(folded)) return true;
  if (/\bevite\s+les\s+formules\b|\bformules\s+generiques\b/.test(folded)) return true;
  if (/\bne\s+decris\s+jamais\b|\bfabrication\s+du\s+morceau\b/.test(folded)) return true;
  if (/\brimes\s+travaillees\b|\bprogression\s+emotionnelle\b/.test(folded)) return true;
  // << on garde le cap >> et << le dernier mot reste au micro >> sont des paroles. Ces
  // tournures ne trahissent une consigne que si elles parlent de la fabrication.
  if (/^(?:on\s+garde|le\s+dernier\s+mot\s+reste)\b.{0,60}\b(?:refrain|couplet|structure|section|tag|casting|voix|titre|format)\b/.test(folded)) return true;
  if (/^le\s+refrain\s+prend\s+forme\b/.test(folded)) return true;
  // Jetons internes en majuscules avec underscore: jamais des paroles.
  if (/^[A-Z][A-Z0-9_]{6,}$/.test(String(value || '').trim())) return true;

  // Seconde vague relevee en freestyle: la matiere brute du canevas et les etiquettes
  // internes remontaient telles quelles. Volontairement etroit: << le cypher reste
  // ouvert >> ou << Solo Djeff dans la piece >> sont de vraies paroles, on n'y touche pas.
  if (/^mati[eè]re\s+creative\b/.test(folded)) return true;
  if (/\bcanevas\s+composition\b|\ba\s+transformer\s*$/.test(folded)) return true;
  if (/^origine\s+de\s+mati|^source\s+de\s+mati|^seed\b|^brouillon\s*:/.test(folded)) return true;
  if (/^r[eè]gles\s+communes\b/.test(folded)) return true;
  if (/^ce\s+bloc\s+est\s+l\s+autorit[eé]\s+commune\b/.test(folded)) return true;
  if (/^ne\s+jamais\s+(?:remplacer|changer|chanter)\b.{0,120}\b(?:univers|casting|consignes?|techniques?)\b/.test(folded)) return true;
  if (/^(?:ne\s+mets\s+pas\s+le\s+mot\s+banger|le\s+mot\s+banger\s+est\s+autoris[eé])\b/.test(folded)) return true;
  if (/^mati[eè]re\s+cr[eé]ative\s+du\s+canevas\s+composition\s+[àa]\s+transformer\b/.test(folded)) return true;

  return false;
}

/**
 * Coupe une fuite de contrat NOSSEN collee apres une vraie ligne.
 *
 * Le filtre ligne-par-ligne ne suffisait pas lorsque le LLM renvoyait:
 * « vraie punchline : Règles communes: ... ». Dans ce cas on conserve la punchline
 * et on supprime seulement la queue d'instruction, avant validation et envoi a Suno.
 */
export function stripVivyNossenInstructionLeakTail(value = "") {
  const raw = String(value || "");
  if (!raw.trim()) return raw;
  const leak = raw.match(
    /(?:^|\s)(?:r[eè]gles\s+communes\s*:|ce\s+bloc\s+est\s+l['’]autorit[eé]\s+commune\b|origine\s+de\s+mati[eè]re\s*:|sujet\s+original\s+verrouill[eé]\s*:|casting\s+verrouill[eé]\s*:|couleur\s+sonore(?:\s+verrouill[eé]e)?\s*:|structure\s+verrouill[eé]e\s*:|notes?\s+composition\s+verrouill[eé]es?\s*:|mati[eè]re\s+cr[eé]ative\s+canonique\s*:|mati[eè]re\s+cr[eé]ative\s+du\s+canevas\s+composition\s+[àa]\s+transformer\s*:|canevas\s+composition\s+brut\b|distribution\s+vocale\s+choisie\s*:|utilise\s+le\s+tag\s+exact\b|ne\s+reprends\s+pas\s+les\s+phrases\s+de\s+r[eé]glage\b|ne\s+mets\s+pas\s+le\s+mot\s+banger\b|le\s+mot\s+banger\s+est\s+autoris[eé]\b)/i
  );
  if (!leak || typeof leak.index !== "number") return raw;
  return raw
    .slice(0, leak.index)
    .replace(/[\s,;:—-]+$/g, "")
    .trimEnd();
}

export function looksLikeVivyNossenOperatorNoiseLine(folded = "") {
  if (!folded) return true;
  if (looksLikeVivyNossenTechnicalMediaLine(folded)) return true;
  if (isVivyNossenSonicStyleLine(folded)) return true;
  if (isVivyNossenStructureInstructionLine(folded)) return true;
  if (/\b(?:d40|suno|fallback|secours|codex|prompt|telechargement|téléchargement|telecharger|télécharger|bouton|compile|compil|compiler|compilateur|formulaire|detecteur|détecteur|ajustements internes|grand modele|grand modèle|mode automatique|generation d40|génération d40)\b/.test(folded)) return true;
  if (/\b(?:nossen\s+mode|mode\s+nossen|tu\s+peux\s+faire\s+le\s+nossen|que\s+tu\s+fasses\s+un\s+son|fais\s+le\s+banger|lance\s+le\s+banger|demander\s+a\s+vivy|demander\s+à\s+vivy)\b/.test(folded)) return true;
  // « generique » seul est retire: « le beat est generique » est une punchline, pas un
  // rapport de bug. Les formes explicites restent.
  if (/\b(?:paroles?\s+passent?\s+pas|musique\s+bug|generation\s+musique\s+bug|génération\s+musique\s+bug|phrase générique|truc générique|réecrit|réécrit|reecrit|recopie|recopier)\b/.test(folded)) return true;
  // « secret », « cles », « key », « fix », « token » et « credits » sont des mots de
  // chanson autant que de console -- « mon secret tient dans la doublure de ma veste »
  // partait a la poubelle. On garde ce qui ne s'ecrit pas dans des paroles.
  if (/\b(?:bug|bugs?|marche\s+pas|sort\s+pas|sorti\s+pas|corrige|corriger|logs?|llm|quota)\b/.test(folded)) return true;
  // « repete », « reponse », « singe », « confond » sont du francais courant: trois
  // paroles sur trente et une disparaissaient a cause d'eux, dont « ma reponse tombe
  // avant meme leur question ». Seules les tournures d'operateur restent.
  if (/\b(?:perroquet|sortie\s+compilateur|user\s+avec|compiler\s+output)\b/.test(folded)) return true;
  if (/\b(?:oui\s+je\s+te\s+suis|je\s+suis\s+la\s+et\s+je\s+te\s+suis|je\s+dois\s+repondre\s+a\s+ce\s+que\s+tu\s+poses|je\s+dois\s+répondre\s+à\s+ce\s+que\s+tu\s+poses|sur\s+le\s+fond|avec\s+le\s+contexte)\b/.test(folded)) return true;
  // « telephone », « mobile » et « clavier » existent dans les chansons -- « le telephone
  // sonne dans le vide de la cuisine » etait supprime. « viewport » et « dezoom », non.
  if (/\b(?:affichage|dezoom|dézoom|viewport|scroll|impossible\s+d[' ]?ecrire|impossible\s+d[' ]?écrire)\b/.test(folded)) return true;
  // Ces motifs sont aussi appliques aux PAROLES: sanitizeVivyNossenSongSeed appelle
  // cette fonction ligne par ligne. Les avoir laisses larges ici annulait la correction
  // faite dans isVivyNossenStructureInstructionLine -- « j'envoie le son », « je mets
  // l'ambiance », « il sort son flow » disparaissaient encore, le compte de lignes
  // tombait sous le minimum de dix, et la production s'arretait sur
  // paroles_vivy_invalides. Meme discriminant que la-bas: l'adresse, pas le verbe.
  if (/^(?:mets|met|mettre)\b.{0,80}\b(?:action|theme|th[eè]me|ambiance|titre)\b/.test(folded)) return true;
  if (/\btu\s+(?:mets|met)\b.{0,60}\b(?:action|theme|th[eè]me|ambiance|titre)\b/.test(folded)) return true;
  if (/^(?:put|turn|make)\b.{0,80}\b(?:action|theme|mood|ambience|ambiance|title|epic|fantasy)\b/.test(folded)) return true;
  if (/\bquand\s+tu\s+es\s+pr[eê]te\b/.test(folded)) return true;
  if (/^(?:envoie|envois|envoies|lance)\b.{0,80}\b(?:son|chanson|musique|voix\s+f[eé]minine|bien\s+aim[eé]e)\b/.test(folded)) return true;
  if (/^(?:when\s+you(?:\s+re|\s+are)\s+ready|send|launch|release|drop)\b.{0,80}\b(?:song|track|music|lyrics|female\s+voice|beloved)\b/.test(folded)) return true;
  return false;
}
