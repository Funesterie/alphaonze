const express = require('express');

function createAuthRouter({
  db,
  bcrypt,
  jwt,
  jwtSecret,
  jwtExpiry,
  registerIssuedToken,
  localAuthStore,
  defaultAdminUsername,
  defaultAdminPassword,
  emailService,
  crypto,
  normalizePublicAppUrl,
} = {}) {
  const router = express.Router();

  router.post('/api/auth/register', express.json(), async (req, res) => {
    const { username, email, password } = req.body || {};
    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedUsername || !normalizedEmail || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    if (!db) {
      if (!localAuthStore || typeof localAuthStore.createUser !== 'function') {
        return res.status(503).json({ error: 'auth_store_unavailable' });
      }

      try {
        const hash = await bcrypt.hash(password, 10);
        const user = await localAuthStore.createUser({
          username: normalizedUsername,
          email: normalizedEmail,
          passwordHash: hash,
        });
        const token = jwt.sign(
          { id: user.id, username: user.username, localAuth: true },
          jwtSecret,
          { expiresIn: jwtExpiry }
        );
        registerIssuedToken(token);
        console.log('[AUTH] Local register:', normalizedUsername);
        return res.json({
          ok: true,
          success: true,
          token,
          expiresIn: jwtExpiry,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
          },
        });
      } catch (e) {
        console.warn('[AUTH] Local register failed:', e?.message);
        const code = String(e?.code || e?.message || '').trim();
        if (code === 'username_taken') return res.status(400).json({ error: 'username_taken' });
        if (code === 'email_taken') return res.status(400).json({ error: 'email_taken' });
        if (code === 'missing_fields') return res.status(400).json({ error: 'Missing fields' });
        return res.status(500).json({ error: 'local_auth_register_failed' });
      }
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await db.query(
        'INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username, email',
        [normalizedUsername, normalizedEmail, hash]
      );
      const user = rows[0];
      const token = jwt.sign({ id: user.id, username: user.username }, jwtSecret, { expiresIn: jwtExpiry });
      registerIssuedToken(token);
      console.log('[AUTH] ✅ Register:', normalizedUsername);
      return res.json({
        ok: true,
        success: true,
        token,
        expiresIn: jwtExpiry,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
      });
    } catch (e) {
      console.warn('[AUTH] Register failed:', e?.message);
      const message = String(e?.message || '');
      const detail = String(e?.detail || '');
      const combined = `${message} ${detail}`.toLowerCase();
      let error = 'User already exists';
      if (combined.includes('username')) error = 'username_taken';
      else if (combined.includes('email')) error = 'email_taken';
      return res.status(400).json({ error });
    }
  });

  router.post('/api/auth/login', express.json(), async (req, res) => {
    const { email, username, password } = req.body || {};
    const identifier = String(email || username || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    console.log('[AUTH] Login attempt received');

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Missing credentials' });
    }

    if (!db) {
      if (localAuthStore && typeof localAuthStore.findUserByIdentifier === 'function') {
        try {
          const localUser = await localAuthStore.findUserByIdentifier(identifier);
          if (localUser?.password_hash) {
            const ok = await bcrypt.compare(password, localUser.password_hash);
            if (ok) {
              const token = jwt.sign(
                { id: localUser.id, username: localUser.username, localAuth: true },
                jwtSecret,
                { expiresIn: jwtExpiry }
              );
              registerIssuedToken(token);
              return res.json({
                success: true,
                token,
                user: {
                  id: localUser.id,
                  username: localUser.username,
                  email: localUser.email,
                },
              });
            }
          }
        } catch (e) {
          console.warn('[AUTH] Local login failed:', e?.message);
        }
      }

      const { username: fallbackUsername, password: fallbackPassword } = req.body || {};
      const normalizedFallbackUser = String(fallbackUsername || '').trim().toLowerCase();
      const fallbackDefaultAdmin = String(defaultAdminUsername || '').trim().toLowerCase();
      const isLegacyAdmin = normalizedFallbackUser === 'admin' && fallbackPassword === '1234';
      const isDefaultAdmin = normalizedFallbackUser === fallbackDefaultAdmin && fallbackPassword === defaultAdminPassword;
      if (isLegacyAdmin || isDefaultAdmin) {
        const resolvedUsername = isLegacyAdmin ? 'admin' : defaultAdminUsername;
        const token = jwt.sign({ username: resolvedUsername, id: resolvedUsername.toLowerCase() }, jwtSecret, { expiresIn: jwtExpiry });
        registerIssuedToken(token);
        return res.json({ success: true, token, user: { id: resolvedUsername.toLowerCase(), username: resolvedUsername } });
      }
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    try {
      const { rows } = await db.query(
        'SELECT * FROM users WHERE LOWER(email)=LOWER($1) OR username=$1 LIMIT 1',
        [normalizedEmail || identifier]
      );
      if (!rows.length) return res.status(401).json({ success: false, error: 'Invalid credentials' });
      const user = rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });
      const token = jwt.sign({ id: user.id, username: user.username }, jwtSecret, { expiresIn: jwtExpiry });
      registerIssuedToken(token);
      console.log('[AUTH] ✅ Login réussi');
      return res.json({ success: true, token, user: { id: user.id, username: user.username } });
    } catch (e) {
      console.error('[AUTH] Login error:', e?.message);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  const forgotPasswordHandler = async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Database unavailable' });
    const { email } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ error: 'Missing email' });
    if (!emailService.isConfigured()) {
      console.warn('[AUTH] Forgot requested but email transport is not configured');
      return res.json({ ok: true, mailEnabled: false });
    }

    try {
      const { rows } = await db.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [normalizedEmail]);
      if (!rows.length) {
        console.warn('[AUTH] Forgot requested for unknown email');
        return res.json({ ok: true });
      }

      const user = rows[0];
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await db.query(
        'UPDATE users SET reset_token=$1, reset_token_expires_at=$2 WHERE id=$3',
        [resetToken, expiresAt, user.id]
      );

      const appUrl = emailService.getStatus().appUrl
        || normalizePublicAppUrl(process.env.APP_URL || process.env.FRONT_URL || 'https://alphaonze.funesterie.pro');
      const link = `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
      const mailResult = await emailService.sendPasswordResetEmail({
        to: user.email,
        link,
      });
      if (!mailResult?.ok) throw new Error(mailResult?.reason || 'mail_send_failed');
      console.log('[AUTH] ✅ Reset email envoyé');
      return res.json({ ok: true, mailEnabled: true });
    } catch (e) {
      console.error('[AUTH] Forgot error:', e?.message);
      return res.status(500).json({ error: 'Server error' });
    }
  };

  router.post('/api/auth/forgot', express.json(), forgotPasswordHandler);
  router.post('/api/auth/forgot-password', express.json(), forgotPasswordHandler);

  const resetPasswordHandler = async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Database unavailable' });
    const { token, password, newPassword } = req.body || {};
    const effectivePassword = String(password || newPassword || '');
    if (!token || !effectivePassword) return res.status(400).json({ error: 'Missing fields' });

    try {
      const hash = await bcrypt.hash(effectivePassword, 10);
      const byResetToken = await db.query(
        'SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires_at > NOW() LIMIT 1',
        [token]
      );

      if (byResetToken.rows.length) {
        const userId = byResetToken.rows[0].id;
        await db.query(
          'UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires_at=NULL WHERE id=$2',
          [hash, userId]
        );
        console.log('[AUTH] ✅ Password reset via DB token');
        return res.json({ ok: true });
      }

      const decoded = jwt.verify(token, jwtSecret);
      await db.query(
        'UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires_at=NULL WHERE id=$2',
        [hash, decoded.id]
      );
      console.log('[AUTH] ✅ Password reset via JWT token');
      return res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] Reset error:', e?.message);
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
  };

  router.post('/api/auth/reset', express.json(), resetPasswordHandler);
  router.post('/api/auth/reset-password', express.json(), resetPasswordHandler);

  return router;
}

module.exports = createAuthRouter;
