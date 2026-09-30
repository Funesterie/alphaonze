// Worker e-mail Cloudflare « tri de Vivy » (30/09/2026).
// À coller dans Cloudflare : Email > Email Routing > Email Workers > Créer, puis la règle
// vivy.funesterie@vivy.funesterie.me (ou contact@funesterie.me) > action « Envoyer à un Worker ».
//
// Règle de tri, dans cet ordre :
//   1. expéditeur en liste blanche          -> transféré à Djeff
//   2. newsletter, pub ou robot « noreply » -> écarté (rejet poli, l'expéditeur est prévenu)
//   3. tout le reste (une vraie personne)   -> transféré à Djeff
// Rien de ce qu'écrit une personne n'est jeté : seul le courrier de masse est écarté.

const DESTINATION = 'cellaurojeffrey@gmail.com'; // doit être une adresse vérifiée dans Email Routing

// Expéditeurs toujours transférés (adresse complète ou domaine après @).
const LISTE_BLANCHE = [
  'openai.com',
  'anthropic.com',
  'soundcloud.com',
  'cellaurojeffrey@gmail.com',
];

// Robots et envois de masse reconnaissables à l'adresse de l'expéditeur.
const ROBOT = /^(no-?reply|do-?not-?reply|newsletter|news|marketing|mailer-daemon|notifications?|bounce)[@+.-]/i;

function enListeBlanche(expediteur) {
  const adresse = expediteur.toLowerCase();
  const domaine = adresse.split('@')[1] || '';
  return LISTE_BLANCHE.some((entree) => {
    const e = entree.toLowerCase();
    return e.includes('@') ? adresse === e : domaine === e || domaine.endsWith(`.${e}`);
  });
}

function estDeMasse(message) {
  const h = message.headers;
  return Boolean(
    ROBOT.test(message.from)
    || h.get('list-unsubscribe')
    || h.get('list-id')
    || /^(bulk|list|junk)$/i.test(h.get('precedence') || '')
  );
}

export default {
  async email(message) {
    if (enListeBlanche(message.from)) {
      await message.forward(DESTINATION);
      return;
    }
    if (estDeMasse(message)) {
      message.setReject('Adresse réservée aux messages personnels. Merci de ne pas y envoyer de courrier de masse.');
      return;
    }
    await message.forward(DESTINATION);
  },
};
