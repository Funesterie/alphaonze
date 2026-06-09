# Voice Catalog Consent v1

Version: `voice-catalog-song-v1`

But par défaut: permettre à un utilisateur Funesterie Premium, Fondateur, Famille ou Admin de sélectionner une voix nommée du catalogue pour une pré-écoute chanson ou une génération chanson, uniquement si le propriétaire de la voix a explicitement donné son accord.

Language contract: every UI, LLM response, legal copy, technical detail and ASCII/Zen label that exposes this consent must be rendered in the connected account language. If the account has no language, use French.

## Localized Purpose

| Language | Purpose |
| --- | --- |
| fr | Permettre à un utilisateur Funesterie Premium, Fondateur, Famille ou Admin de sélectionner une voix nommée du catalogue pour une pré-écoute chanson ou une génération chanson, uniquement si le propriétaire de la voix a explicitement donné son accord. |
| en | Allow a Funesterie Premium, Founder, Family or Admin user to select a named voice from the voice catalog for song preview or song generation, only when the voice owner has explicitly opted in. |
| it | Consentire a un utente Funesterie Premium, Fondatore, Famiglia o Admin di selezionare una voce nominata dal catalogo per l’anteprima o la generazione di una canzone, solo quando il proprietario della voce ha dato consenso esplicito. |

## Consent

The voice owner confirms that:

- the uploaded audio contains their own voice or a voice they are allowed to license;
- they choose a public catalog name for the voice;
- they authorize Funesterie premium, founder, family and admin accounts to use this named voice for song preview and song creation;
- the raw reference audio must remain private and must not be served as a public asset;
- the generated song must stay an original Funesterie creation and must not be used to imitate a celebrity or a protected character;
- they can later request removal of the voice from the catalog.

## Platform Rules

- Catalog names must be unique among active catalog voices.
- Raw voice files stay in private runtime storage.
- Public API responses may expose the catalog name, consent version and allowed uses, but not the raw file path.
- Non-premium accounts cannot publish or consume catalog voices.
- This consent reduces operational risk but is not a replacement for legal review before commercial launch.
