// Script Node.js pour tester l'API de génération d'image Stable Diffusion
// Place ce fichier dans a11backendrailway/apps/server/scripts/test_sd_api.js

const axios = require('axios');

async function testGenerateSD() {
  const apiUrl = 'http://127.0.0.1:3000/api/tools/generate_sd'; // adapte si besoin
  const prompt = 'Un chat cyberpunk dans une ville futuriste, style illustration';
  try {
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
