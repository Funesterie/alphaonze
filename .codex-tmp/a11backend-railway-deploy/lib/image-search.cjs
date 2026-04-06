// lib/image-search.cjs
// Recherche une image sur DuckDuckGo Images (pas d'API clé requise)
const https = require('https');

function duckduckgoImageSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    // 1. On doit d'abord récupérer le vqd token
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    }, (res) => {
      let html = '';
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', () => {
        const vqdMatch = html.match(/vqd=(['"])([^'"]+)\1/i) || html.match(/vqd=([^&"'\s]+)/i);
        if (!vqdMatch) return reject(new Error('No vqd token found'));
        const vqd = vqdMatch[2] || vqdMatch[1];
        // 2. On appelle l'API images JSON
        const apiUrl = `https://duckduckgo.com/i.js?l=fr-fr&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`;
        https.get(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'application/json,text/javascript,*/*;q=0.9',
            'Referer': url,
          },
        }, (apiRes) => {
          let data = '';
          apiRes.on('data', (chunk) => { data += chunk; });
          apiRes.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.results && json.results.length > 0) {
                const img = json.results[0];
                resolve({
                  image_url: img.image,
                  source_url: img.url,
                  title: img.title || '',
                  width: img.width,
                  height: img.height
                });
              } else {
                reject(new Error('No image found'));
              }
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      });
    }).on('error', reject);
  });
}

module.exports = { duckduckgoImageSearch };
