// Script Node.js pour tester l'API de génération d'image Stable Diffusion
// Place ce fichier dans backend/apps/server/scripts/test_sd_api.js

const axios = require('axios');

async function testGenerateSD() {
  const apiUrl = process.env.A11_SD_TEST_URL || 'https://sd.funesterie.me/api/tools/generate_sd';
  const prompt = 'Un chat cyberpunk dans une ville futuriste, style illustration';
  try {
    console.log('[A11 SD TEST] POST', apiUrl);
    const response = await axios.post(apiUrl, { prompt });
    if (response.data && response.data.url) {
      console.log('✅ Image générée ! URL :', response.data.url);
    } else {
      console.error('❌ Réponse inattendue :', response.data);
    }
  } catch (err) {
    if (err.response) {
      console.error('Erreur API:', err.response.status, err.response.data);
    } else {
      console.error('Erreur réseau ou serveur:', err.message);
    }
  }
}

testGenerateSD();
