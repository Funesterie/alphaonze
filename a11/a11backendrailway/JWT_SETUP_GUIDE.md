# 🔐 JWT Authentication Setup Guide

## ✅ What's Implemented

- ✅ JWT token generation on `/api/auth/login`
- ✅ JWT verification middleware on `/api/ai` 
- ✅ Frontend token storage & auto-injection
- ✅ User context tracking in logs
- ✅ 24h token expiry

---

## 🚨 CRITICAL: Set JWT_SECRET in Production

### Railway Setup (DO THIS RIGHT NOW!)

1. Go to **Railway Dashboard** → Your Project
2. Click **Variables** tab
3. Add new variable:
   ```
   Key: JWT_SECRET
   Value: [generate a long random string]
   ```

   Example (use a random generator):
   ```
   JWT_SECRET=aB$kL9mN2pQrS7tUvWxYz0C3dEfGhIjKlMnOpQrStUvWxYz0C3dEfGhIjKl
   ```

4. Save & **Redeploy** your service

### Local Dev (Optional)

Create `.env.local` in `apps/server/`:
```env
JWT_SECRET=dev-secret-123
NODE_ENV=development
```

---

## 🔒 Security Notes

### localStorage vs httpOnly Cookies

**Current (localStorage):**
- ✅ Simple, works for dev
- ❌ Vulnerable to XSS attacks

**For Production (Future):**
- ✅ httpOnly cookies: immune to XSS
- ✅ Automatic inclusion in requests
- ❌ Slightly more complex CORS setup

We'll upgrade to httpOnly when adding HTTPS enforcement.

---

## 🧪 Test Login Flow

### 1. Get JWT Token

```bash
curl -X POST https://api.funesterie.pro/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"1234"}'

# Response:
# {"success":true,"token":"eyJhbGc...","user":{"id":"admin","username":"admin"}}
```

### 2. Use Token for Chat

```bash
TOKEN="<paste_token_here>"

curl -X POST https://api.funesterie.pro/api/ai \
  -H "Content-Type: application/json" \
  -H "X-NEZ-TOKEN: $TOKEN" \
  -d '{"messages":[{"role":"user","content":"test"}]}'
```

### 3. Frontend Test

Open browser console:
```js
// Check stored token
localStorage.getItem("a11-auth-token")

// Should auto-inject on /api/ai calls
```

---

## 🔄 Migration from Old System

### What Changed
- ❌ Old: Direct NEZ tokens in header
- ✅ New: Login → JWT → header

### Backward Compatibility
- Old NEZ tokens still work if `process.env.VITE_A11_NEZ_TOKEN` is set
- Frontend tries JWT first, falls back to NEZ token
- **Recommendation**: Remove old NEZ tokens in prod

---

## 📋 Checklist

- [ ] JWT_SECRET set in Railway
- [ ] Service redeployed after env update
- [ ] Login test passed
- [ ] `/api/ai` calls include JWT header
- [ ] User logs show username context
- [ ] localStorage has valid token

---

## 🚨 If Something Breaks

**"JWT invalid or expired"**
- Check: `JWT_SECRET` env var exists
- Check: Token not expired (24h expiry)
- Check: Token format is correct (starts with `eyJ`)

**"No token provided"**
- Check: Frontend storing token in localStorage
- Check: Header being sent correctly
- Open DevTools → Network → check **Request Headers**

**"User can't login"**
- Default: `admin` / `1234`
- Check: Hardcoded credentials in `server.cjs` line ~425

---

## 🔥 Next Steps (Optional)

- [ ] Add multiple users to DB
- [ ] Add refresh token mechanism
- [ ] Migrate to httpOnly cookies
- [ ] Add rate limiting per user
- [ ] Add user roles/permissions

