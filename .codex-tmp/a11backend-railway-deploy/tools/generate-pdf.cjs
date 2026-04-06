// tools/generate-pdf.cjs
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');

/**
 * Génère un PDF riche à partir d'un payload structuré.
 *
 * @param {Object} params
 * @param {string} params.outputPath - Chemin complet du PDF (ex: D:\A12\document.pdf)
 * @param {string} [params.title]    - Titre du document
 * @param {string} [params.summary]  - Résumé global / TL;DR
 * @param {string} [params.analysis] - Analyse détaillée
 * @param {Array<{title:string, body:string}>} [params.sections] - Sections supplémentaires
 * @param {Array<{role:string, content:string}>} [params.conversation] - Historique complet
 * @param {Object} [params.meta]     - Métadonnées (workspace, modèle, date, etc.)
 */
async function generatePdfReport(params) {
  const {
    outputPath,
    title = 'Rapport A-11',
    summary,
    analysis,
    sections = [],
    conversation = [],
    meta = {}
  } = params || {};

  if (!outputPath) {
    throw new Error('generatePdfReport: missing outputPath');
  }

  // Assure le dossier
  const dir = path.dirname(outputPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4'
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // =============== HEADER ===============
    doc
      .fontSize(20)
      .text(title, { align: 'center' })
      .moveDown(0.5);

    doc
      .fontSize(10)
      .text(`Généré par A-11 / Cerbère`, { align: 'center' });

    const dt = new Date();
    doc
      .text(`Date : ${dt.toLocaleString()}`, { align: 'center' })
      .moveDown(1.5);

    // Meta (workspace, modèle…)
    const metaLines = [];
    if (meta.workspaceRoot) metaLines.push(`Workspace : ${meta.workspaceRoot}`);
    if (meta.model) metaLines.push(`Modèle : ${meta.model}`);
    if (meta.backend) metaLines.push(`Backend : ${meta.backend}`);
    if (meta.devMode !== undefined) metaLines.push(`Dev mode : ${meta.devMode ? 'ON' : 'OFF'}`);

    if (metaLines.length) {
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('Informations système')
        .moveDown(0.3);

      doc
        .fontSize(10)
        .font('Helvetica')
        .list(metaLines)
        .moveDown(1);
    }

    // =============== SUMMARY / TL;DR ===============
    if (summary) {
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Résumé', { underline: true })
        .moveDown(0.5);

      doc
        .fontSize(11)
        .font('Helvetica')
        .text(summary, { align: 'left' })
        .moveDown(1);
    }

    // =============== ANALYSE ===============
    if (analysis) {
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Analyse détaillée', { underline: true })
        .moveDown(0.5);

      doc
        .fontSize(11)
        .font('Helvetica')
        .text(analysis, { align: 'left' })
        .moveDown(1);
    }

    // =============== SECTIONS ===============
    if (sections && Array.isArray(sections) && sections.length) {
      sections.forEach((s, idx) => {
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(s.title || `Section ${idx + 1}`, { underline: true })
          .moveDown(0.3);

        if (s.body) {
          doc
            .fontSize(11)
            .font('Helvetica')
            .text(s.body, { align: 'left' })
            .moveDown(0.8);
        }
      });
    }

    // =============== CONVERSATION (optionnelle) ===============
    if (conversation && Array.isArray(conversation) && conversation.length) {
      doc.addPage();

      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Historique de la conversation', { underline: true })
        .moveDown(0.5);

      conversation.forEach((msg) => {
        const roleLabel =
          msg.role === 'user'
            ? 'Utilisateur'
            : msg.role === 'assistant'
            ? 'Assistant'
            : msg.role;

        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .text(`[${roleLabel}]`, { continued: false });

        doc
          .fontSize(10)
          .font('Helvetica')
          .text((msg.content || '').trim(), { align: 'left' })
          .moveDown(0.5);
      });
    }

    // =============== FIN ===============
    doc.end();

    stream.on('finish', () => {
      console.log('[Cerbère] PDF généré avec succès :', outputPath);
      resolve({ ok: true, path: outputPath });
    });
    stream.on('error', (err) => {
      console.error('[Cerbère] Erreur écriture PDF :', err.message);
      reject(err);
    });
  });
}

module.exports = {
  generatePdfReport
};
