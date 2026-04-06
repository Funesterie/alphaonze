// Route avatar pour A11
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// lastGifPath doit être partagé avec le serveur principal (idéalement via runtime ou mémoire partagée)
let lastGifPath = null;
let runtimeConfig = null;

function setAvatarRuntime(config, gifPathRef) {
	runtimeConfig = config;
	if (gifPathRef) lastGifPath = gifPathRef;
}

function _find_idle_asset() {
	const cand = [
		path.join(__dirname, '../../public/assets/a11_static.png'),
		path.join(__dirname, '../../public/assets/A11_idle.png'),
		path.join(__dirname, '../../public/assets/A11_talking_smooth_8s.gif'),
		path.resolve(__dirname, '../../../tts/A11_talking_smooth_8s.gif')
	];
	for (const p of cand) {
		try { if (fs.existsSync(p)) return p; } catch {}
	}
	return null;
}

function getAvatarRedirectUrl(candidate) {
	const raw = String(candidate || '').trim();
	if (!raw) return null;
	if (/^https?:\/\//i.test(raw)) {
		return raw;
	}
	const basename = path.basename(raw);
	const publicTtsBaseUrl = String(runtimeConfig?.tts?.publicBaseUrl || '').trim();
	if (!publicTtsBaseUrl || !basename) {
		return null;
	}
	return `${publicTtsBaseUrl.replace(/\/$/, '')}/out/${encodeURIComponent(basename)}`;
}

// Avatar update API
router.post('/api/avatar/update', express.json(), (req, res) => {
	try {
		const gifPath = String(req.body?.gif_path || req.body?.gifPath || req.body?.gif_url || req.body?.gifUrl || '').trim();
		if (!gifPath) {
			return res.status(400).json({ error: 'gif_path missing' });
		}
		lastGifPath = gifPath;
		console.log('[A11][AVATAR] lastGifPath updated:', lastGifPath);
		return res.json({
			ok: true,
			gifPath: lastGifPath,
			redirectUrl: getAvatarRedirectUrl(lastGifPath),
		});
	} catch (e) {
		console.error('[A11][AVATAR] update error:', e && e.message);
		return res.status(500).json({ error: String(e && e.message) });
	}
});

// Serve the current avatar GIF
router.get('/avatar.gif', (req, res) => {
	try {
		const redirectUrl = getAvatarRedirectUrl(lastGifPath);
		if (redirectUrl) {
			console.log('[A11][AVATAR] redirecting avatar.gif to TTS server ->', redirectUrl);
			return res.redirect(307, redirectUrl);
		}
		if (!lastGifPath || !fs.existsSync(lastGifPath)) {
			const idle = _find_idle_asset();
			if (idle) {
				console.warn('[A11][AVATAR] lastGifPath empty/unavailable, serving idle asset:', idle);
				return res.sendFile(idle);
			}
			return res.status(404).send('no avatar available');
		}
		const st = fs.statSync(lastGifPath);
		res.setHeader('Content-Type', 'image/gif');
		res.setHeader('Content-Length', String(st.size));
		res.setHeader('Accept-Ranges', 'bytes');
		res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
		res.setHeader('Pragma', 'no-cache');
		res.setHeader('Expires', '0');
		res.setHeader('Last-Modified', st.mtime.toUTCString());
		res.setHeader('ETag', `W/"${st.size}-${st.mtimeMs}"`);
		const stream = fs.createReadStream(lastGifPath);
		stream.on('error', (err) => {
			console.error('[A11][AVATAR] error reading GIF:', err && err.message);
			const idle = _find_idle_asset();
			if (idle) return res.sendFile(idle);
			return res.status(500).send('avatar read error');
		});
		stream.pipe(res);
	} catch (e) {
		console.error('[A11][AVATAR] avatar.gif handler error:', e && e.message);
		const idle = _find_idle_asset();
		if (idle) return res.sendFile(idle);
		return res.status(500).send('avatar handler error');
	}
});

module.exports = { router, setAvatarRuntime };
