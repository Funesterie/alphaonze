// apps/server/tts/download-onnx.js
const fs = require('fs');
const https = require('https');
const path = require('path');

const MODEL_PATH = path.join(__dirname, 'fr_FR-siwis-medium.onnx');
const MODEL_URL = process.env.ONNX_MODEL_URL || 'https://<TON_ENDPOINT_R2>/a11-files/fr_FR-siwis-medium.onnx';

function downloadModel(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, (response) => {
    if (response.statusCode !== 200) {
      cb(new Error(`Failed to get '${url}' (${response.statusCode})`));
      return;
    }
    response.pipe(file);
    file.on('finish', () => file.close(cb));
  }).on('error', (err) => {
    fs.unlink(dest, () => cb(err));
  });
}

if (!fs.existsSync(MODEL_PATH)) {
  console.log('ONNX model not found, downloading from R2...');
  downloadModel(MODEL_URL, MODEL_PATH, (err) => {
    if (err) {
      console.error('Download failed:', err);
      process.exit(1);
    } else {
      console.log('Model downloaded successfully.');
    }
  });
} else {
  console.log('ONNX model already present.');
}
