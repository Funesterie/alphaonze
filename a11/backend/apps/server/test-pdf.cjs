'use strict';
const fs = require('fs');
const { extractPdfText, formatPdfPreview } = require('./lib/pdf-extractor.cjs');

const pdfPath = process.argv[2] || 'D:/projets/Invoice-HM1UXWTV-0002.pdf';
const buf = fs.readFileSync(pdfPath);

extractPdfText(buf, { maxChars: 3000 }).then(result => {
  if (!result) {
    console.log('❌ Aucun texte extrait');
    return;
  }
  console.log('✅ Méthode:', result.method);
  console.log('Pages:', result.pages);
  console.log('Tronqué:', result.truncated);
  console.log('\n=== TEXTE EXTRAIT ===');
  console.log(result.text);
  console.log('\n=== PREVIEW LLM ===');
  console.log(formatPdfPreview(result, pdfPath));
}).catch(e => console.error('Erreur:', e.message));
