'use strict';

/**
 * pdf-extractor.cjs
 * Extracteur de texte PDF robuste pour A11.
 *
 * Stratégie en cascade :
 *  1. pdf-parse (PDFParse class) — extraction vectorielle complète
 *  2. Heuristique zlib+BT/ET — fallback si pdf-parse indisponible
 *  3. OCR via Tesseract — dernier recours pour PDFs scannés
 *
 * Retourne un objet { text, pages, method, truncated }
 */

const path = require('node:path');
const zlib = require('node:zlib');

// ---------------------------------------------------------------------------
// Méthode 1 : pdf-parse (PDFParse class)
// ---------------------------------------------------------------------------

async function extractWithPdfParse(buffer) {
  try {
    const mod = require('pdf-parse');
    const PDFParseClass = mod.PDFParse;
    if (typeof PDFParseClass !== 'function') {
      throw new Error('PDFParse class not found in pdf-parse module');
    }

    const parser = new PDFParseClass({
      data: buffer,
      verbosity: 0,
    });

    // pdf-parse v2 utilise getText() et non parse()
    const data = await parser.getText();
    const text = String(data.text || '').trim();
    if (!text) throw new Error('pdf-parse returned empty text');

    return {
      text,
      pages: data.total || 1,
      method: 'pdf-parse',
      truncated: false,
    };
  } catch (err) {
    return null; // passer au fallback
  }
}

// ---------------------------------------------------------------------------
// Méthode 2 : Heuristique zlib + opérateurs PDF BT/ET
// ---------------------------------------------------------------------------

function decodePdfLiteralString(raw) {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(.)/g, '$1');
}

function decodePdfHexString(hex) {
  const clean = hex.replace(/\s/g, '');
  let result = '';
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16);
    if (!isNaN(byte)) result += String.fromCharCode(byte);
  }
  return result;
}

function extractTextFromPdfSource(source) {
  const chunks = [];
  const seen = new Set();

  const pushChunk = (value) => {
    const cleaned = value
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    if (!cleaned || cleaned.length < 2) return;
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    chunks.push(cleaned);
  };

  const parseScope = (scope) => {
    // Tj operator (literal string)
    for (const m of scope.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj\b/g)) {
      pushChunk(decodePdfLiteralString(m[1]));
    }
    // Tj operator (hex string)
    for (const m of scope.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj\b/g)) {
      pushChunk(decodePdfHexString(m[1]));
    }
    // TJ operator (array)
    for (const m of scope.matchAll(/\[(.*?)\]\s*TJ\b/gs)) {
      for (const p of m[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
        pushChunk(decodePdfLiteralString(p[1]));
      }
      for (const p of m[1].matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
        pushChunk(decodePdfHexString(p[1]));
      }
    }
  };

  const textBlocks = Array.from(source.matchAll(/BT[\s\S]*?ET/g)).map((m) => m[0]);
  if (textBlocks.length) {
    for (const block of textBlocks) parseScope(block);
  } else {
    parseScope(source);
  }

  return chunks;
}

function extractWithHeuristic(buffer) {
  try {
    const sources = [];
    const raw = buffer.toString('latin1');
    sources.push(raw);

    // Décompresser les streams FlateDecode
    for (const m of raw.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs)) {
      const dict = String(m[1] || '');
      const streamText = String(m[2] || '');
      if (dict.includes('/FlateDecode')) {
        try {
          const inflated = zlib.inflateSync(Buffer.from(streamText, 'latin1'));
          sources.push(inflated.toString('latin1'));
        } catch {
          // stream corrompu ou non supporté
        }
      } else {
        sources.push(streamText);
      }
    }

    const allChunks = [];
    const globalSeen = new Set();
    for (const source of sources) {
      const chunks = extractTextFromPdfSource(source);
      for (const chunk of chunks) {
        if (!globalSeen.has(chunk)) {
          globalSeen.add(chunk);
          allChunks.push(chunk);
        }
      }
    }

    if (!allChunks.length) return null;

    const text = allChunks.join('\n');
    return {
      text,
      pages: 1,
      method: 'heuristic',
      truncated: false,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Méthode 3 : OCR via Tesseract (pour PDFs scannés)
// ---------------------------------------------------------------------------

async function extractWithOcr(buffer) {
  try {
    // Convertir le PDF en image via sharp (si disponible) ou retourner null
    // Pour l'instant on retourne null — l'OCR sur PDF nécessite pdftoppm
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fonction principale
// ---------------------------------------------------------------------------

/**
 * Extrait le texte d'un buffer PDF.
 *
 * @param {Buffer} buffer
 * @param {{ maxChars?: number }} [options]
 * @returns {Promise<{ text: string, pages: number, method: string, truncated: boolean } | null>}
 */
async function extractPdfText(buffer, options = {}) {
  const maxChars = options.maxChars || 4000;

  // Cascade : pdf-parse → heuristique → OCR
  let result = await extractWithPdfParse(buffer);
  if (!result) result = extractWithHeuristic(buffer);
  if (!result) result = await extractWithOcr(buffer);
  if (!result) return null;

  // Tronquer si nécessaire
  if (result.text.length > maxChars) {
    result.text = result.text.slice(0, maxChars - 1) + '…';
    result.truncated = true;
  }

  return result;
}

/**
 * Formate le résultat d'extraction en preview lisible pour le contexte LLM.
 *
 * @param {{ text: string, pages: number, method: string }} result
 * @param {string} filename
 * @returns {string}
 */
function formatPdfPreview(result, filename) {
  const name = path.basename(filename || 'document.pdf');
  const header = `[PDF: ${name} | ${result.pages} page(s) | méthode: ${result.method}]`;
  return `${header}\n\n${result.text}`;
}

module.exports = { extractPdfText, formatPdfPreview };
