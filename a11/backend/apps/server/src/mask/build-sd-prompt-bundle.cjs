const {
  bindSemanticAtoms,
  bindSemanticCompoundsEnglish,
} = require('./bind-semantic-atoms.cjs');

const COLOR_WORD_MAP = new Map([
  ['rouge', 'rouge'],
  ['rouges', 'rouge'],
  ['bleu', 'bleu'],
  ['bleue', 'bleu'],
  ['bleus', 'bleu'],
  ['bleues', 'bleu'],
  ['vert', 'vert'],
  ['verte', 'vert'],
  ['verts', 'vert'],
  ['vertes', 'vert'],
  ['jaune', 'jaune'],
  ['jaunes', 'jaune'],
  ['violet', 'violet'],
  ['violette', 'violet'],
  ['violets', 'violet'],
  ['violettes', 'violet'],
  ['orange', 'orange'],
  ['oranges', 'orange'],
  ['rose', 'rose'],
  ['roses', 'rose'],
  ['blanc', 'blanc'],
  ['blanche', 'blanc'],
  ['blancs', 'blanc'],
  ['blanches', 'blanc'],
  ['noir', 'noir'],
  ['noire', 'noir'],
  ['noirs', 'noir'],
  ['noires', 'noir'],
  ['marron', 'marron'],
  ['marrons', 'marron'],
  ['gris', 'gris'],
  ['grise', 'gris'],
  ['grises', 'gris'],
  ['doré', 'doré'],
  ['dorée', 'doré'],
  ['dorés', 'doré'],
  ['dorées', 'doré'],
  ['argent', 'argent'],
  ['argenté', 'argenté'],
  ['argentée', 'argenté'],
  ['argentés', 'argenté'],
  ['argentées', 'argenté'],
  ['roux', 'orange'],
  ['rousse', 'orange'],
  ['rousses', 'orange'],
]);

const CHARACTER_REFERENCE_WORDS = new Set([
  'batman',
  'robin',
  'mario',
  'zelda',
  'donkey kong',
  'pikachu',
  'vegeta',
  'pokemon',
  'personnage',
  'princesse',
  'hero',
  'héros',
]);

const NAMED_GROUP_REFERENCE_PATTERNS = [
  /\bavengers\b/,
  /\bx[\s-]?men\b/,
  /\bjustice league\b/,
  /\bguardians? of the galaxy\b/,
  /\bfantastic four\b/,
  /\bteen titans\b/,
  /\bsuicide squad\b/,
  /\bpower rangers\b/,
  /\bstraw hat pirates\b/,
  /\bchapeau(?:x)? de paille\b/,
  /\bmugiwaras?\b/,
  /\béquipage\b/,
  /\bequipage\b/,
];

const NON_SUBJECT_DETAIL_PATTERNS = [
  /\b(?:cigarette|cigare|pipe|joint|clope|fumee|fumée)\b/,
  /\b(?:sombrero|chapeau|casquette|couronne|capuche|helmet|helm|masque|lunettes)\b/,
  /\b(?:epee|épée|sabre|katana|pistolet|fusil|arme|bouclier)\b/,
  /\b(?:costume|tenue|robe|veste|manteau|cape|armure|uniforme)\b/,
  /\b(?:guitare|micro|instrument|sac|sacoche|accessoire|objet)\b/,
  /\b(?:bouche|levres|l[eè]vres|mouth|head|tete|tête|visage|face|main|mains|hand|hands|bras|arm|jambes|legs?)\b/,
  /\b(?:visible|visibles|lisible|lisibles)\b.+\b(?:bouche|mouth|main|hand|tete|tête|head|visage|face)\b/,
  /\b(?:pres|près)\s+de\s+(?:la|le|l|du)\s+(?:bouche|main|tete|tête|visage)\b/,
  /\b(?:dans|sur)\s+(?:la|le|l|du)\s+(?:main|mains|hand|head|tete|tête|visage|bouche)\b/,
];

const FRENCH_LANGUAGE_MARKERS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'aux', 'avec', 'dans', 'sur', 'pour',
  'par', 'qui', 'que', 'est', 'sont', 'et', 'ou', 'mais', 'donc', 'car', 'moi', 'toi', 'nous',
  'vous', 'comme', 'visage', 'tenue', 'decor', 'ambiance', 'silhouette', 'dessine', 'genere',
  'cree', 'fais', 'montre', 'fond', 'personnage', 'image', 'photo', 'jeu', 'type', 'garder',
  'preserver', 'lumiere', 'maquillage', 'corpulence', 'structure', 'reference',
]);

const ENGLISH_LANGUAGE_MARKERS = new Set([
  'the', 'a', 'an', 'with', 'in', 'on', 'for', 'from', 'and', 'or', 'but', 'same', 'keep',
  'preserve', 'background', 'lighting', 'effects', 'character', 'image', 'photo', 'face',
  'identity', 'outfit', 'scene', 'dark', 'clean', 'composition', 'reference', 'build',
  'facial', 'structure', 'dramatic', 'joker', 'wearing', 'makeup', 'person', 'visible',
  'game', 'play', 'buy', 'type',
]);

const NON_SUBJECT_PLACEHOLDER_PATTERNS = [
  /^(?:moi|me|toi|te|lui|elle|eux|elles|nous|vous|myself|yourself|himself|herself|them)$/i,
  /^(?:la|le)\s+meme\s+personne$/i,
  /\b(?:ma|mon|mes|my|this|cette|ce|cet|la|le)\s+(?:photo|image|portrait|visuel|fichier)\b/i,
  /\b(?:image|photo|portrait|visuel|fichier)\s+de\s+reference\b/i,
  /\b(?:reference|référence)\s+d(?:['’]|\s+)identit(?:e|é)\b/i,
  /\b(?:sujet|personne)\s+de\s+reference\b/i,
  /\bsource\s+image\b/i,
];

const WORKFLOW_DIRECTIVE_PATTERNS = [
  /^(?:utilise|utiliser|use|using|prends|prendre|take|garde|garder|keep|conserve|conserver|preserve|preserver)\b/i,
  /^(?:transforme|transformer|transform|turn|change|convert|mets|mettre|put|place|placer|ajoute|ajouter|add|remplace|remplacer|replace|donne|donner|give|fais|faire|make|cree|cr[eé]e(?:r)?|genere|g[eé]n[eé]r(?:e|er)?|montre|montrer|show|depict|anime|animer|retravaille|retouche|rework|restyle)\b/i,
];

const ENGLISH_PHRASE_REPLACEMENTS = [
  ['photo studio', 'studio photo'],
  ['studio un', 'studio photo of a'],
  ['studio une', 'studio photo of a'],
  ['petit chat roux', 'small ginger cat'],
  ['petite chatte rousse', 'small ginger cat'],
  ['portrait homme', 'male portrait'],
  ['portrait propre', 'clean portrait'],
  ['chat roux', 'ginger cat'],
  ['assis sur un tabouret', 'sitting on a stool'],
  ['assise sur un tabouret', 'sitting on a stool'],
  ['lumiere douce', 'soft light'],
  ['fond neutre', 'neutral background'],
  ['fond simple coherent avec le personnage', 'simple background consistent with the character'],
  ['fond simple coherent avec le sujet', 'simple background consistent with the subject'],
  ['fond simple', 'simple background'],
  ['decor coherent avec la scene demandee', 'coherent decor matching the requested scene'],
  ['decor naturel simple', 'simple natural setting'],
  ['decor simple', 'simple setting'],
  ['decor encombre', 'cluttered setting'],
  ['arriere plan charge', 'busy background'],
  ['arriere-plan charge', 'busy background'],
  ['atmosphere froide et cristalline', 'cold crystalline atmosphere'],
  ['textures cristallines', 'crystalline textures'],
  ['givre visible sur le sujet', 'visible frost on the subject'],
  ['effets lumineux bien separes du sujet', 'lighting effects clearly separated from the subject'],
  ['dessin anime classique', 'classic cartoon'],
  ['dessin anime fidele', 'faithful cartoon style'],
  ['dessin anime', 'cartoon'],
  ['anime classique', 'classic anime'],
  ['anime fidele', 'faithful anime style'],
  ['lapin de dessin anime gris et blanc', 'gray-and-white cartoon rabbit'],
  ['illustration fantasy nette', 'clean fantasy illustration'],
  ['illustration science-fiction nette', 'clean science fiction illustration'],
  ['illustration science fiction nette', 'clean science fiction illustration'],
  ['illustration de jeu video nette', 'clean video game illustration'],
  ['illustration nette', 'clean illustration'],
  ['haute qualite', 'high quality'],
  ['tres detaille', 'highly detailed'],
  ['tres detaillee', 'highly detailed'],
  ['detaille', 'detailed'],
  ['detaillee', 'detailed'],
  ['photorealiste', 'photorealistic'],
  ['realiste', 'realistic'],
  ['style dragonball z', 'dragon ball z style'],
  ['style dragon ball z', 'dragon ball z style'],
  ['style dbz', 'dragon ball z style'],
  ['sujet unique bien cadre', 'single well-framed subject'],
  ['single main subject', 'single main subject'],
  ['clear centered composition', 'clear centered composition'],
  ['simple clean background', 'simple clean background'],
  ['silhouette lisible', 'clear silhouette'],
  ['silhouette humaine complete', 'full human silhouette'],
  ['forme complete visible', 'full shape visible'],
  ['lecture simple et claire', 'simple clear composition'],
  ['sujet centre', 'centered subject'],
  ['objet centre', 'centered object'],
  ['un seul sujet principal', 'single main subject'],
  ['deux sujets distincts et lisibles', 'two distinct readable subjects'],
  ['deux personnages complets et reconnaissables', 'two full recognizable characters'],
  ['personnage complet et reconnaissable', 'full recognizable character'],
  ['corps entier dans le cadre', 'full body in frame'],
  ['visage unique bien lisible', 'single clearly visible face'],
  ['une seule personne complete', 'one full person'],
  ['un seul personnage complet', 'one full character'],
  ['une seule plante complete', 'one full plant'],
  ['un seul animal complet', 'one full animal'],
  ['un seul phenix complet', 'one full phoenix'],
  ['creature complete et lisible', 'complete readable creature'],
  ['ailes bien lisibles', 'clearly readable wings'],
  ['flammes nettes autour du sujet', 'clear flames around the subject'],
  ['flammes lisibles autour du sujet', 'clear flames around the subject'],
  ['sans texte lisible', 'no readable text'],
  ['representer un seul personnage complet et reconnaissable', 'depict a single full recognizable character'],
  ['representer une seule personne complete et reconnaissable', 'depict a single full recognizable person'],
  ['representer un seul animal complet et bien lisible', 'depict a single complete readable animal'],
  ['representer un seul personnage de lapin de dessin anime gris et blanc avec de longues oreilles et un visage reconnaissable', 'depict a single gray-and-white cartoon rabbit character with long ears and a recognizable face'],
  ['armure complete bien lisible', 'full armor clearly visible'],
  ['montrer clairement', 'show clearly'],
  ['montrer un seul', 'show a single'],
  ['garder le meme visage et la meme coiffure', 'keep the same face and hairstyle'],
  ['garder le meme visage et la meme identite', 'keep the same face and identity'],
  ['garder strictement le meme visage et la meme identite', 'keep exactly the same face and identity'],
  ['garder exactement le meme visage, la meme structure faciale et la meme identite', 'keep exactly the same face, facial structure, and identity'],
  ['garder les memes yeux, les memes sourcils, le meme nez, la meme machoire et le meme sourire', 'keep the same eyes, eyebrows, nose, jawline, and smile from the reference image'],
  ['preserver la meme corpulence et la meme posture', 'preserve the same build and posture'],
  ['preserver une anatomie naturelle et des proportions stables', 'preserve natural anatomy and stable proportions'],
  ['preserver la pose et le cadrage de l image de reference', 'preserve the pose and framing from the reference image'],
  ['preserver l angle du corps, le placement des bras, la lateralite et la pose visible des mains de l image de reference', 'preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image'],
  ['preserver l angle du corps, le placement des bras, la lateralite du meme cote et la pose visible des mains de l image de reference', 'preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image'],
  ['preserver la silhouette et la tenue principale', 'preserve the silhouette and main outfit'],
  ['preserver le sujet de reference', 'preserve the reference subject'],
  ['sujet de reference', 'reference subject'],
  ['la meme personne que sur l image de reference', 'the exact same person from the reference image'],
  ['le meme sujet que sur l image de reference', 'the same subject as in the reference image'],
  ['utilise l image d entree comme reference d identite, de pose et de cadrage', 'use the input image as an identity, pose, and framing reference'],
  ['utilise l image d entree', 'use the input image'],
  ['image d entree', 'input image'],
  ['reference d identite, de pose et de cadrage', 'identity, pose, and framing reference'],
  ['reference d identite', 'identity reference'],
  ['tout en conservant', 'while preserving'],
  ['tout en conservant le meme visage, la meme structure faciale, la meme corpulence, la meme posture et la meme presence generale', 'while preserving the same face, the same facial structure, the same build, the same posture, and the same overall presence'],
  ['la meme structure faciale', 'the same facial structure'],
  ['la meme corpulence', 'the same build'],
  ['la meme posture', 'the same posture'],
  ['la meme presence generale', 'the same overall presence'],
  ['visage reconnaissable', 'recognizable face'],
  ['structure faciale', 'facial structure'],
  ['presence generale', 'overall presence'],
  ['transforme la personne en personnage inspire du joker dans un style sombre, cinematographique et realiste', 'transform the same person from the reference image into a dark, cinematic, realistic Joker-style version without altering identity'],
  ['transforme la personne en personnage inspire du joker', 'transform the same person from the reference image into a Joker-style version without altering identity'],
  ['la personne en personnage inspire du joker dans un style sombre, cinematographique et realiste', 'the same person from the reference image transformed into a dark, cinematic, realistic Joker-style version without altering identity'],
  ['la personne en personnage inspire du joker', 'the same person from the reference image transformed into a Joker-style version without altering identity'],
  ['personne en personnage inspire du joker', 'the same person from the reference image transformed into a Joker-style version without altering identity'],
  ['costume joker elegant mais chaotique', 'elegant but chaotic Joker-themed suit'],
  ['maquillage de clown inquietant mais credible', 'unsettling but believable clown makeup'],
  ['batte custom', 'custom bat'],
  ['rends la batte custom clairement visible', 'make the custom bat clearly visible'],
  ['la batte custom doit etre bien visible', 'the custom bat must be clearly visible'],
  ['batte custom clairement visible', 'custom bat clearly visible'],
  ['decor urbain inspire de harlem', 'Harlem-inspired urban environment'],
  ['rue brute avec graffitis', 'gritty street with graffiti'],
  ['rue inspiree de harlem', 'Harlem-inspired street'],
  ['rue brute', 'gritty street'],
  ['entree d immeuble usee', 'worn building entrance'],
  ['immeubles uses', 'worn buildings'],
  ['immeuble use', 'worn building'],
  ['sol sale', 'dirty pavement'],
  ['atmosphere tendue', 'tense atmosphere'],
  ['reflets de neons', 'neon reflections'],
  ['reflets de neons violets et verts', 'purple and green neon reflections'],
  ['avec une lumiere dramatique', 'with dramatic lighting'],
  ['avec lumiere dramatique', 'with dramatic lighting'],
  ['lumiere dramatique', 'dramatic lighting'],
  ['portrait live action sombre et credible', 'dark believable live-action portrait'],
  ['portrait live action credible', 'believable live-action portrait'],
  ['decor urbain sombre', 'dark urban setting'],
  ['style sombre, cinematographique et realiste', 'dark, cinematic, realistic style'],
  ['personnage entier visible', 'full character visible'],
  ['composition propre', 'clean composition'],
  ['couleurs violet, vert, rouge', 'purple, green, and red color palette'],
  ['rendre le changement de tenue clairement visible', 'make the outfit change clearly visible'],
  ['reinventer clairement le decor et l ambiance', 'clearly redesign the background and atmosphere'],
  ['rendre les effets et la lumiere clairement visibles', 'make the lighting and effects clearly visible'],
  ['rendre l accessoire demande clairement visible', 'make the requested prop or accessory clearly visible'],
  ['accessoire bien visible', 'accessory clearly visible'],
  ['accessoire baton bien visible', 'baton accessory clearly visible'],
  ['accessoire baton', 'baton accessory'],
  ['image de reference', 'reference image'],
  ['photo de reference', 'reference photo'],
  ['capture d ecran', 'screenshot'],
  ['barre de statut', 'status bar'],
  ['icones de telephone', 'phone icons'],
  ['cadre de smartphone', 'smartphone frame'],
  ['texte incruste', 'overlaid text'],
  ['date incrustee', 'timestamp overlay'],
  ['visages dupliques', 'duplicated faces'],
  ['visage fusionne', 'merged face'],
  ['visages fusionnes', 'merged faces'],
  ['visage duplique', 'duplicated face'],
  ['yeux deformes', 'deformed eyes'],
  ['bouche deformee', 'deformed mouth'],
  ['nez deforme', 'deformed nose'],
  ['double visage', 'double face'],
  ['visage different', 'different face'],
  ['identite differente', 'different identity'],
  ['autre personne', 'different person'],
  ['sujet different', 'different subject'],
  ['texte lisible', 'readable text'],
  ['sujet coupe', 'cropped subject'],
  ['personnage coupe', 'cropped character'],
  ['hors cadre', 'out of frame'],
  ['gros plan', 'close-up'],
  ['plan poitrine', 'chest-up crop'],
  ['creatures multiples', 'multiple creatures'],
  ['plusieurs plantes', 'multiple plants'],
  ['plusieurs tetes', 'multiple heads'],
  ['ailes supplementaires', 'extra wings'],
  ['forme de fleur', 'flower shape'],
  ['anatomie fusionnee', 'fused anatomy'],
  ['objets multiples', 'multiple objects'],
  ['plusieurs sujets', 'multiple subjects'],
  ['doublon du sujet', 'duplicate subject'],
  ['troisieme sujet', 'third subject'],
  ['personnage supplementaire', 'extra character'],
  ['mosaïque de personnages', 'character mosaic'],
  ['mosaique de personnages', 'character mosaic'],
  ['fusion des personnages', 'merged characters'],
  ['dupliquer le premier personnage', 'duplicate the first character'],
  ['clone du premier sujet', 'clone of the first subject'],
  ['plusieurs personnages', 'multiple characters'],
  ['foule', 'crowd'],
  ['cigarette bien visible pres de la bouche', 'cigarette clearly visible near the mouth'],
  ['cigarette visible pres de la bouche', 'cigarette clearly visible near the mouth'],
  ['carotte dans la bouche', 'carrot in the mouth'],
  ['montrer clairement la carotte attachee au sujet principal', 'show clearly the carrot attached to the main subject'],
  ['montrer clairement l epee tenue par le personnage principal', 'show clearly the sword held by the main character'],
  ['montrer clairement boruto en train de fumer avec cigarette visible pres de la bouche', 'show clearly Boruto smoking with a cigarette clearly visible near the mouth'],
  ['montrer clairement le sombrero et la cigarette pres de la bouche', 'show clearly the sombrero and the cigarette near the mouth'],
  ['en train de fumer', 'smoking'],
  ['avec une cigarette', 'with a cigarette'],
  ['dans une grotte', 'in a cave'],
  ['dans un volcan', 'in a volcano'],
  ['sur une plage', 'on a beach'],
  ['dans la foret', 'in the forest'],
  ['devant un chateau', 'in front of a castle'],
  ['en armure bleue', 'in blue armor'],
  ['avec la chevelure rose', 'with pink hair'],
  ['grand sombrero mexicain', 'large Mexican sombrero'],
  ['sombrero mexicain', 'Mexican sombrero'],
  ['qui se tiennent la main', 'holding hands'],
  ['dans la bouche du sujet principal', 'in the main subject mouth'],
  ['a velo', 'on a bicycle'],
  ['en velo', 'on a bicycle'],
  ['au milieu de', 'in the middle of'],
  ['au bord de', 'at the edge of'],
  ['sortant de', 'coming out of'],
  ['face a', 'facing'],
  ['contre', 'versus'],
  ['decor simple et lisible', 'simple readable setting'],
  ['decor sobre et lisible', 'understated readable setting'],
  ['decor coherent avec l univers', 'setting consistent with the universe'],
  ['rester fidele au sujet canonique nomme', 'stay faithful to the canonical subject named'],
  ['rester coherent avec l univers', 'stay consistent with the universe'],
  ['presence spectrale complete et lisible', 'full readable spectral presence'],
  ['presence spectrale full and readable', 'full readable spectral presence'],
  ['presence spectrale lisible', 'readable spectral presence'],
  ['presence spectrale', 'spectral presence'],
  ['forme spectrale clairement lisible', 'clearly readable spectral form'],
  ['forme spectrale lisible', 'readable spectral form'],
  ['forme spectrale', 'spectral form'],
  ['silhouette spectrale', 'spectral silhouette'],
  ['couronne portee par le sujet principal', 'crown worn by the main subject'],
  ['couronne portee par the main subject', 'crown worn by the main subject'],
  ['show clearly couronne porte par the main subject', 'show clearly the crown worn by the main subject'],
  ['show clearly couronne portee par the main subject', 'show clearly the crown worn by the main subject'],
  ['inclure clairement une vraie personnalite visuelle', 'clearly include a strong visual identity'],
  ['inclure clearly a vraie personnalite visuelle', 'clearly include a strong visual identity'],
  ['vraie personnalite visuelle', 'strong visual identity'],
  ['cadre en plan moyen mettant accent sur le personnage principal', 'medium shot focused on the main character'],
  ['cadre en plan moyen mettant accent on the character main', 'medium shot focused on the main character'],
  ['cadre en plan moyen', 'medium shot framing'],
  ['plan moyen', 'medium shot'],
  ['en valeur la profondeur de champ', 'highlighted depth of field'],
  ['profondeur de champ', 'depth of field'],
  ['foret et ville', 'forest and city'],
  ['forest and ville', 'forest and city'],
  ['decor foret ville', 'forest and city setting'],
  ['scene hyperrealiste et picturale representant', 'hyperrealistic painterly scene depicting'],
  ['scene hyperrealiste and picturale representant', 'hyperrealistic painterly scene depicting'],
  ['hyperrealiste et picturale', 'hyperrealistic and painterly'],
  ['hyperrealiste and picturale', 'hyperrealistic and painterly'],
  ['esthetique de peinture hyperrealiste', 'hyperrealistic painting aesthetic'],
  ['peinture hyperrealiste', 'hyperrealistic painting'],
  ['style academique', 'academic style'],
  ['photoréalisme', 'photorealism'],
  ['photorealisme', 'photorealism'],
  ['qualite d image artistique extremement elevee', 'extremely high artistic image quality'],
  ['maintenir un ton dramatique', 'maintain a dramatic tone'],
  ['maintenir a ton dramatic', 'maintain a dramatic tone'],
  ['peinture dark ou symboliste', 'dark or symbolist painting'],
  ['contours bien visibles', 'clearly visible contours'],
  ['de maniere proeminente et visible', 'prominently and visibly'],
  ['presence heroique lisible', 'clear heroic presence'],
  ['silhouette heroique lisible', 'clear heroic silhouette'],
  ['mise en scene nette', 'clean staging'],
  ['elan vivant mais lisible', 'lively readable motion'],
  ['ambiance simple coherente avec le sujet', 'simple atmosphere consistent with the subject'],
  ['action dynamique lisible', 'readable dynamic action'],
  ['derapage visible', 'visible drift'],
  ['kart bien lisible', 'kart clearly visible'],
  ['vitesse lisible', 'clear sense of speed'],
  ['virage dynamique lisible', 'readable dynamic turn'],
  ['virage de circuit lisible', 'clearly readable racetrack turn'],
  ['circuit colore coherent avec l univers', 'colorful track consistent with the universe'],
  ['energie arcade nette', 'clean arcade energy'],
  ['accessoires lisibles', 'readable accessories'],
  ['en pleine course', 'racing at full speed'],
  ['circuit coherent', 'coherent track'],
  ['legere fumee', 'light smoke'],
  ['petites flammes', 'small flames'],
  ['flammes a l echappement', 'exhaust flames'],
  ['montrer le sujet en pleine course sur un circuit coherent simple et lisible', 'show the subject racing on a simple coherent readable track'],
  ['ajouter un derapage visible avec legere fumee sur les pneus et de petites flammes a l echappement', 'add a visible drift with light tire smoke and small exhaust flames'],
  ['ajouter une petite energie visuelle coherente avec le personnage tout en gardant une scene simple et lisible', 'add a small visual energy consistent with the character while keeping the scene simple and readable'],
  ['oreilles longues bien visibles', 'long ears clearly visible'],
];

const ENGLISH_TOKEN_REPLACEMENTS = [
  ['couleurs', 'colors'],
  ['couleur', 'color'],
  ['demande', 'request'],
  ['sujet principal', 'main subject'],
  ['scene', 'scene'],
  ['simple', 'simple'],
  ['coherent', 'coherent'],
  ['naturel', 'natural'],
  ['animal', 'animal'],
  ['personnage', 'character'],
  ['personnages', 'characters'],
  ['personne', 'person'],
  ['personnes', 'people'],
  ['homme', 'man'],
  ['femme', 'woman'],
  ['sujet', 'subject'],
  ['sujets', 'subjects'],
  ['creature', 'creature'],
  ['creatures', 'creatures'],
  ['lapin', 'rabbit'],
  ['chat', 'cat'],
  ['chien', 'dog'],
  ['ours', 'bear'],
  ['dragon', 'dragon'],
  ['licorne', 'unicorn'],
  ['phoenix', 'phoenix'],
  ['velo', 'bicycle'],
  ['velo', 'bicycle'],
  ['velos', 'bicycles'],
  ['canette', 'can'],
  ['soda', 'soda'],
  ['docteur', 'doctor'],
  ['patient', 'patient'],
  ['magicien', 'wizard'],
  ['mage', 'mage'],
  ['guerriere', 'warrior'],
  ['guerrier', 'warrior'],
  ['herisson', 'hedgehog'],
  ['nordique', 'nordic'],
  ['armure', 'armor'],
  ['complete', 'full'],
  ['complet', 'full'],
  ['complets', 'full'],
  ['accessoires', 'accessories'],
  ['classique', 'classic'],
  ['fidele', 'faithful'],
  ['pleine', 'full'],
  ['course', 'race'],
  ['legere', 'light'],
  ['fumee', 'smoke'],
  ['pneus', 'tires'],
  ['flammes', 'flames'],
  ['echappement', 'exhaust'],
  ['chateau', 'castle'],
  ['foret', 'forest'],
  ['grotte', 'cave'],
  ['volcan', 'volcano'],
  ['plage', 'beach'],
  ['cheval', 'horse'],
  ['sapin', 'fir tree'],
  ['carotte', 'carrot'],
  ['tabouret', 'stool'],
  ['bouche', 'mouth'],
  ['mains', 'hands'],
  ['visage', 'face'],
  ['oreilles', 'ears'],
  ['oreille', 'ear'],
  ['longues', 'long'],
  ['longue', 'long'],
  ['chevelure', 'hair'],
  ['identite', 'identity'],
  ['meme', 'same'],
  ['pose', 'pose'],
  ['cadrage', 'framing'],
  ['corpulence', 'build'],
  ['posture', 'posture'],
  ['garde', 'keep'],
  ['garder', 'keep'],
  ['preserver', 'preserve'],
  ['rends', 'make'],
  ['rend', 'make'],
  ['doit', 'must'],
  ['etre', 'be'],
  ['inspire', 'inspired'],
  ['batte', 'bat'],
  ['graffitis', 'graffiti'],
  ['immeuble', 'building'],
  ['neons', 'neon'],
  ['cigarette', 'cigarette'],
  ['couronne', 'crown'],
  ['baton', 'baton'],
  ['ville', 'city'],
  ['hyperrealiste', 'hyperrealistic'],
  ['picturale', 'painterly'],
  ['peinture', 'painting'],
  ['profondeur', 'depth'],
  ['champ', 'field'],
  ['accent', 'focus'],
  ['visuelle', 'visual'],
  ['personnalite', 'identity'],
  ['spectrale', 'spectral'],
  ['forme', 'form'],
  ['contours', 'contours'],
  ['arriere-plan', 'background'],
  ['arriere', 'background'],
  ['representer', 'depict'],
  ['montrer', 'show'],
  ['clairement', 'clearly'],
  ['reconnaissable', 'recognizable'],
  ['nette', 'clean'],
  ['propre', 'clean'],
  ['petit', 'small'],
  ['petite', 'small'],
  ['petits', 'small'],
  ['petites', 'small'],
  ['seul', 'single'],
  ['unique', 'unique'],
  ['fumant', 'smoking'],
  ['marchant', 'walking'],
  ['assis', 'sitting'],
  ['assise', 'sitting'],
  ['principal', 'main'],
  ['univers', 'universe'],
  ['lisible', 'readable'],
  ['lisibles', 'readable'],
  ['heroique', 'heroic'],
  ['sobre', 'understated'],
  ['pres', 'near'],
  ['rose', 'pink'],
  ['rouge', 'red'],
  ['rouges', 'red'],
  ['bleu', 'blue'],
  ['bleus', 'blue'],
  ['verte', 'green'],
  ['vert', 'green'],
  ['verts', 'green'],
  ['jaune', 'yellow'],
  ['violet', 'violet'],
  ['violets', 'violet'],
  ['violettes', 'violet'],
  ['blanc', 'white'],
  ['blanche', 'white'],
  ['noir', 'black'],
  ['noire', 'black'],
  ['orange', 'orange'],
  ['roux', 'ginger'],
  ['rousse', 'ginger'],
  ['rousses', 'ginger'],
  ['gris', 'gray'],
  ['grise', 'gray'],
  ['dore', 'golden'],
  ['argente', 'silver'],
  ['lumiere', 'light'],
  ['dramatique', 'dramatic'],
  ['sombre', 'dark'],
  ['cinematographique', 'cinematic'],
  ['credible', 'believable'],
  ['theatrale', 'theatrical'],
  ['theatrales', 'theatrical'],
  ['use', 'worn'],
  ['uses', 'worn'],
  ['usee', 'worn'],
  ['usees', 'worn'],
  ['douce', 'soft'],
  ['doux', 'soft'],
  ['neutre', 'neutral'],
  ['avec', 'with'],
  ['dans', 'in'],
  ['sur', 'on'],
  ['sous', 'under'],
  ['portant', 'wearing'],
  ['tenant', 'holding'],
  ['et', 'and'],
  ['un', 'a'],
  ['une', 'a'],
  ['le', 'the'],
  ['la', 'the'],
  ['les', 'the'],
];

function normalizeWhitespace(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinPromptSections(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map((entry) => normalizeWhitespace(String(entry || '').replace(/[.。\s]+$/g, '')))
    .filter(Boolean)
    .join('. ');
}

function normalizeIntentText(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bd['’]\s*(un|une|des|le|la|les|l)\b/g, '$1')
    .replace(/\bl['’]\s*/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function detectPromptLanguageProfile(value = '') {
  const raw = normalizeWhitespace(value);
  const normalized = normalizeIntentText(raw);
  if (!normalized) {
    return {
      language: 'unknown',
      dominant: 'unknown',
      frenchScore: 0,
      englishScore: 0,
      mixed: false,
    };
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  let frenchScore = 0;
  let englishScore = 0;

  for (const token of tokens) {
    if (FRENCH_LANGUAGE_MARKERS.has(token)) frenchScore += 2;
    if (ENGLISH_LANGUAGE_MARKERS.has(token)) englishScore += 2;
  }

  if (/[àâçéèêëîïôûùüÿœæ]/i.test(raw)) {
    frenchScore += 2;
  }

  const mixed = frenchScore > 0 && englishScore > 0;
  let dominant = 'unknown';
  if (frenchScore || englishScore) {
    if (frenchScore >= englishScore + 2) dominant = 'fr';
    else if (englishScore >= frenchScore + 2) dominant = 'en';
    else dominant = frenchScore >= englishScore ? 'fr' : 'en';
  }

  return {
    language: mixed ? 'mixed' : dominant,
    dominant,
    frenchScore,
    englishScore,
    mixed,
  };
}

function normalizeEnglishText(value = '') {
  return bindSemanticCompoundsEnglish(normalizeWhitespace(value)
    .replace(/\b(?:d|l)\b/g, '')
    .replace(/\bthe the\b/g, 'the')
    .replace(/\ba a\b/g, 'a')
    .replace(/\ba ([aeiou])/g, 'an $1')
    .replace(/\bof the the\b/g, 'of the')
    .replace(/\bwith the same same\b/g, 'with the same')
    .replace(/\bmain subject\s*:\s*/g, 'main subject: ')
    .replace(/\brequest\s*:\s*/g, 'request: ')
    .replace(/\bcolors\s*:\s*/g, 'colors: ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' '))
    .trim();
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceEnglishPatterns(source = '', entries = []) {
  let result = String(source || '');
  const orderedEntries = [...entries].sort((left, right) => String(right[0]).length - String(left[0]).length);
  for (const [needle, replacement] of orderedEntries) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'g'), replacement);
  }
  return result;
}

function stripImageGenerationCommandPrefix(value = '') {
  return String(value || '')
    .replace(/^(?:utilise|utiliser|use|using|prends|prendre|take|garde|garder|keep|conserve|conserver|preserve|preserver)\s+[\s\S]*?\b(?:photo|image|portrait|visuel|fichier)\b[\s\S]*?\b(?:reference|référence|identite|identité|source|pose|cadrage|visage)\b[\s\S]*?(?:[.!?]\s*|\s+(?:et|and|&)\s+)/i, '')
    .replace(/^(?:cr[eé]er|composer|produire|faire)\s+une?\s+(?:image|illustration|sc[eè]ne)\s+[^,;:.]*?\b(?:de|d['’])\s*['"]?(?:contenu\s+du\s+fichier|ce\s+fichier|cet?\s+image|cette\s+image|cette\s+photo|ce\s+visuel)['"]?\s+(?:dans|en)\s+un\s+style\s+/i, 'style ')
    .replace(/^(?:avec|a(?:\s+partir)?\s+de|en\s+partant\s+de|depuis|from|using)\s+(?:cette|ce|la|le|l['’])?\s*(?:image|photo|illustration|visuel|portrait|reference|référence)(?:\s+(?:de\s+reference|de\s+référence))?(?:\s*(?:ci|l[aà]))?(?:\s*(?:,|:|;|-|et|&)\s*)?/i, '')
    .replace(/^(?:(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+)+(?:que\s+tu\s+)?(?:me\s+)?/i, '')
    .replace(/^que\s+tu\s+/i, '')
    .replace(/^(?:peux[- ]?tu\s+)?(?:s(?:tp|il te plait|’il te plait|il te plaît)\s+)?/i, '')
    .replace(/^(?:transforme|transformer|transform|turn|change|convert)\s+(?:moi|me|lui|leur|him|her|them)\s+(?:en|into)\s+/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|generate(?:d)?|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche|fais|fait|faire|fias|faix|ajoute|ajouter|mets|mettre|donne|donner|transforme|transformer|anime|animer)\s+(?:moi\s+)?/i, '')
    .replace(/^(?:lui|leur)\s+/i, '')
    .replace(/^(?:avec|a(?:\s+partir)?\s+de|en\s+partant\s+de|depuis|from|using)\s+(?:cette|ce|la|le|l['’])?\s*(?:image|photo|illustration|visuel|portrait|reference|référence)(?:\s+(?:de\s+reference|de\s+référence))?(?:\s*(?:ci|l[aà]))?(?:\s*(?:,|:|;|-|et|&)\s*)?/i, '')
    .replace(/^(?:une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait|vid[eé]o|video|animation|clip)\s+(?:de|du|de la|de l['’]?|d(?:['’]|\s+))?\s*/i, '')
    .replace(/^(?:ce|cet|cette)\s+(?:fichier|photo|image|portrait|visuel)\s+/i, '')
    .replace(/^['"]?(?:contenu\s+du\s+fichier|ce\s+fichier|cette\s+image|cette\s+photo|ce\s+visuel)['"]?\s+/i, '')
    .replace(/^(?:au|a la|à la|aux)\s+(?:theme|th[eè]me)(?:\s+et\s+style)?\s+/i, 'style ')
    .replace(/^(?:theme|th[eè]me)\s+et\s+style\s+/i, 'style ')
    .trim();
}

function normalizeImagePromptLiteral(value = '') {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  return stripImageGenerationCommandPrefix(raw) || raw;
}

function extractPalette(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  if (!normalized) return [];

  const palette = [];
  for (const [variant, canonical] of COLOR_WORD_MAP.entries()) {
    const pattern = new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'i');
    if (pattern.test(normalized)) palette.push(canonical);
  }
  return [...new Set(palette)];
}

function stripPaletteSuffixFromSubject(value = '', palette = []) {
  const tokens = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return normalizeWhitespace(value);

  const paletteSet = new Set(
    (Array.isArray(palette) ? palette : [])
      .map((entry) => normalizeIntentText(entry))
      .filter(Boolean)
  );

  while (tokens.length > 1 && paletteSet.has(normalizeIntentText(tokens[tokens.length - 1]))) {
    tokens.pop();
  }

  return normalizeWhitespace(tokens.join(' ')) || normalizeWhitespace(value);
}

function trimSubjectPhrase(value = '', palette = []) {
  const subject = normalizeWhitespace(String(value || '')
    .replace(/^(?:photo(?:\s+studio)?|studio\s+photo|portrait(?:\s+photo)?|studio)\s+/i, '')
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d(?:['’]|\s+)un|d(?:['’]|\s+)une|d['’]?|le|la|les)\s+/i, '')
    .replace(/\b(?:qui|avec|dans|sur|au milieu de|au bord de|sous|portant|tenant|sortant|sorti|sortie|en)\b.*$/i, '')
    .replace(/\b(?:style|cartoon|anime|ghibli|photo|photorealiste|photoréaliste|realiste|réaliste|fantasy)\b.*$/i, '')
    .trim());

  return stripPaletteSuffixFromSubject(subject, palette);
}

function isPluralRequested(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  return (
    /\b(des|plusieurs|many|multiple|crowd|group|groupe|ensemble)\b/.test(normalized)
    || /\b(?:deux|two|2)\s+(?:personnages?|characters?|combattants?|fighters?|guerriers?|warriors?|adversaires?|opponents?|sujets?|subjects?|personnes?|people|humains?|humans?)\b/.test(normalized)
    || /\b(?:les\s+deux|both)\s+(?:personnages?|characters?|combattants?|fighters?|guerriers?|warriors?|adversaires?|opponents?|sujets?|subjects?|personnes?|people|humains?|humans?)\b/.test(normalized)
    || NAMED_GROUP_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function isMultiSubjectSceneRequest(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  if (!normalized) return false;
  return (
    isPluralRequested(prompt)
    || /\b(?:entre|between)\s+(?:deux|two|2)\b/.test(normalized)
    || /\b(?:duel|face\s+a\s+face|face\s+to\s+face|one\s+on\s+one|1\s*(?:v|vs|versus|contre)\s*1|1v1)\b/.test(normalized)
    || /\b(?:contre|vs\.?|versus|face\s+a)\b/.test(normalized)
    || /\b(crew|team|squad|party|band|bande|troupe|alliance|league)\b/.test(normalized)
    || /\b(scene de groupe|composition de groupe|scene multi|multi personnages|multi personnage|multi character|multi characters)\b/.test(normalized)
    || /\b(groupe|equipage|équipage)\b/.test(normalized)
    || /\b(personnages|characters)\b/.test(normalized)
  );
}

function isSubjectPhraseMeaningful(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  if (normalized.split(/\s+/).length > 8) return false;
  if (COLOR_WORD_MAP.has(normalized)) return false;
  if (/^(image|illustration|dessin|photo|visuel|portrait|style)$/.test(normalized)) return false;
  if (NON_SUBJECT_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (WORKFLOW_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return true;
}

function looksLikeCharacterSubject(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  for (const entry of CHARACTER_REFERENCE_WORDS) {
    if (normalized.includes(normalizeIntentText(entry))) return true;
  }
  return false;
}

function looksLikeNonSubjectDetailPhrase(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  return NON_SUBJECT_DETAIL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeWorkflowDirectivePhrase(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  return WORKFLOW_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function trimRelationalSubjectPhrase(value = '', palette = []) {
  const subject = normalizeWhitespace(String(value || ''))
    .replace(/^(?:photo(?:\s+studio)?|studio\s+photo|portrait(?:\s+photo)?|studio)\s+/i, '')
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d(?:['’]|\s+)un|d(?:['’]|\s+)une|d['’]?|le|la|les)\s+/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim();

  return stripPaletteSuffixFromSubject(subject, palette);
}

function extractRelationalPairConstraints(basePrompt = '', palette = []) {
  const relationMatch = String(basePrompt || '').match(
    /^(.+?)\s+\bavec\s+((?:un|une|des)\s+(?:patient|patiente|ennemi|ennemie|ennemie|enemy|adversaire|compagnon|compagnonne|companion|ami|amie|friend|monstre|monster|creature|créature|pokemon|pokémon|dragon|robot|zombie|squelette|skeletrex)\b[^,.!?;:]*)$/i
  );
  if (!relationMatch) return null;

  const firstSubject = trimRelationalSubjectPhrase(relationMatch[1], palette);
  const secondSubject = trimRelationalSubjectPhrase(relationMatch[2], palette);
  if (!isSubjectPhraseMeaningful(firstSubject) || !isSubjectPhraseMeaningful(secondSubject)) return null;

  const kind = [firstSubject, secondSubject].some(looksLikeCharacterSubject) ? 'characters' : 'subjects';
  return {
    count: 2,
    kind,
    relation: 'with',
    subjects: [firstSubject, secondSubject],
    promptHints: [
      `Montrer clairement ${firstSubject} avec ${secondSubject}.`,
      `Deux ${kind === 'characters' ? 'personnages' : 'sujets'} distincts et lisibles.`,
      'Exactement deux personnages, une seule occurrence de chaque personnage.',
      'Éviter de dupliquer le premier sujet à la place du second.',
    ],
    negativeHints: ['clone du premier sujet', 'dupliquer le premier personnage', 'collage', 'montage', 'mosaïque de personnages'],
  };
}

function extractVersusPairConstraints(basePrompt = '', palette = []) {
  const relationMatch = String(basePrompt || '').match(
    /^(.+?)\s+\b(?:contre|vs\.?|versus|face\s+a|face\s+à)\s+(.+)$/i
  );
  if (!relationMatch) return null;

  const firstSubject = trimRelationalSubjectPhrase(relationMatch[1], palette);
  const secondSubject = trimRelationalSubjectPhrase(relationMatch[2], palette);
  if (!isSubjectPhraseMeaningful(firstSubject) || !isSubjectPhraseMeaningful(secondSubject)) return null;
  if (looksLikeNonSubjectDetailPhrase(firstSubject) || looksLikeNonSubjectDetailPhrase(secondSubject)) return null;

  const kind = [firstSubject, secondSubject].some(looksLikeCharacterSubject) ? 'characters' : 'subjects';
  return {
    count: 2,
    kind,
    relation: 'versus',
    subjects: [firstSubject, secondSubject],
    promptHints: [
      `Montrer clairement ${firstSubject} contre ${secondSubject}.`,
      `Deux ${kind === 'characters' ? 'personnages' : 'sujets'} distincts et lisibles.`,
      'Interaction lisible entre les deux personnages.',
      'Exactement deux personnages, une seule occurrence de chaque personnage.',
    ],
    negativeHints: [
      'clone du premier sujet',
      'dupliquer le premier personnage',
      'fusion des personnages',
      'collage',
      'montage',
      'mosaïque de personnages',
    ],
  };
}

function translateImagePromptToEnglish(value = '') {
  const literal = normalizeImagePromptLiteral(value);
  if (!literal) return '';

  const normalizedSource = normalizeIntentText(literal);
  if (!normalizedSource) return '';

  const phraseTranslated = replaceEnglishPatterns(normalizedSource, ENGLISH_PHRASE_REPLACEMENTS);
  const tokenTranslated = replaceEnglishPatterns(phraseTranslated, ENGLISH_TOKEN_REPLACEMENTS);
  return normalizeEnglishText(tokenTranslated);
}

function compileCharacterCountConstraints(rawPrompt = '') {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  if (!basePrompt || isPluralRequested(basePrompt)) return null;

  const palette = extractPalette(basePrompt);
  const relationalPair = extractRelationalPairConstraints(basePrompt, palette);
  if (relationalPair) return relationalPair;
  const versusPair = extractVersusPairConstraints(basePrompt, palette);
  if (versusPair) return versusPair;

  const pairParts = basePrompt
    .split(/\b(?:et|and|&)\b/i)
    .map((entry) => trimSubjectPhrase(entry, palette))
    .filter(Boolean);

  if (pairParts.length !== 2 || !pairParts.every(isSubjectPhraseMeaningful)) return null;
  if (pairParts.some(looksLikeNonSubjectDetailPhrase)) return null;
  if (pairParts.some(looksLikeWorkflowDirectivePhrase)) return null;

  const kind = pairParts.some(looksLikeCharacterSubject) ? 'characters' : 'subjects';
  return {
    count: 2,
    kind,
    subjects: pairParts,
    promptHints: [
      `Montrer clairement ${pairParts[0]} et ${pairParts[1]}.`,
      `Deux ${kind === 'characters' ? 'personnages' : 'sujets'} distincts et lisibles.`,
      'Exactement deux personnages, une seule occurrence de chaque personnage.',
    ],
    negativeHints: ['clone du premier sujet', 'dupliquer le premier personnage', 'collage', 'montage', 'mosaïque de personnages'],
  };
}

function compileSingleSubjectConstraints(rawPrompt = '') {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  if (!basePrompt || isMultiSubjectSceneRequest(basePrompt)) return null;
  if (compileCharacterCountConstraints(basePrompt)) return null;

  const palette = extractPalette(basePrompt);
  const subject = trimSubjectPhrase(basePrompt, palette);
  if (!isSubjectPhraseMeaningful(subject)) return null;

  return {
    count: 1,
    subject,
    promptHints: [
      `Sujet principal : ${subject}.`,
      'Un seul sujet principal bien visible.',
    ],
    negativeHints: [],
  };
}

function buildPositiveInstructions({ palette = [], pair = null, single = null } = {}) {
  const instructions = [
    'Create an image faithful to the request.',
    'Keep the scene simple, readable, and natural.',
  ];

  if (pair?.count === 2) {
    instructions.push('Show the two requested subjects clearly.');
    instructions.push('Keep exactly two characters, with only one instance of each character.');
  } else if (single?.count === 1) {
    instructions.push('Highlight a single clearly visible main subject.');
  }

  if (Array.isArray(palette) && palette.length > 0) {
    instructions.push('Use the requested colors on the main subject.');
  }

  return instructions;
}

function analyzeImagePrompt(rawPrompt = '', options = {}) {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  const pair = compileCharacterCountConstraints(basePrompt);
  const single = pair ? null : compileSingleSubjectConstraints(basePrompt);
  const palette = extractPalette(basePrompt);
  const subjectText = pair?.subjects?.join(' et ')
    || single?.subject
    || trimSubjectPhrase(basePrompt, palette)
    || basePrompt;

  return {
    basePrompt,
    ambiguity: null,
    subjectText,
    subjectPromptEnglish: translateImagePromptToEnglish(subjectText),
    palette,
    styleHints: [],
    compositionHints: [],
    characterCountConstraints: pair,
    singleSubjectConstraints: single,
    floralRequested: false,
    pluralRequested: isPluralRequested(basePrompt),
    semanticBinding: {
      promptLead: subjectText,
      relationAtoms: [],
      styleAtoms: [],
      structuralAtoms: [],
    },
    options,
  };
}

function buildSdPromptBundle(rawPrompt = '', options = {}) {
  const details = analyzeImagePrompt(rawPrompt, options);
  const promptEnglish = translateImagePromptToEnglish(details.basePrompt);
  const subjectEnglish = translateImagePromptToEnglish(details.subjectText);
  const paletteEnglish = details.palette
    .map((entry) => translateImagePromptToEnglish(entry))
    .filter(Boolean);
  const instructions = buildPositiveInstructions({
    palette: details.palette,
    pair: details.characterCountConstraints,
    single: details.singleSubjectConstraints,
  });

  const promptSections = [
    promptEnglish ? `request: ${promptEnglish}` : '',
    subjectEnglish ? `main subject: ${subjectEnglish}` : '',
    paletteEnglish.length ? `colors: ${paletteEnglish.join(', ')}` : '',
    ...instructions,
  ].filter(Boolean);

  return {
    prompt: joinPromptSections(promptSections),
    ambiguity: null,
    negativeHints: [],
    details,
  };
}

function detectImagePromptAmbiguity() {
  return null;
}

module.exports = {
  normalizeImagePromptLiteral,
  detectImagePromptAmbiguity,
  detectPromptLanguageProfile,
  analyzeImagePrompt,
  buildSdPromptBundle,
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  isMultiSubjectSceneRequest,
  translateImagePromptToEnglish,
  bindSemanticAtoms,
};
