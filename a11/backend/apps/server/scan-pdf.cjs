'use strict';
const { PDFParse } = require('pdf-parse');

const fs = require('fs');
const path = require('path');

const pdfPath = process.argv[2] || 'D:/projets/Invoice-HM1UXWTV-0002.pdf';
const buf = fs.readFileSync(pdfPath);

const parser = new PDFParse();
parser.parse(buf).then(data => {
  console.log('=== FACTURE PDF ===');
  console.log('Fichier :', path.basename(pdfPath));
  console.log('Pages   :', data.numpages);
  console.log('');
  console.log('=== CONTENU EXTRAIT ===');
  const clean = data.text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  console.log(clean.slice(0, 6000));
}).catch(e => {
  console.error('Erreur extraction PDF:', e.message);
  process.exit(1);
});
