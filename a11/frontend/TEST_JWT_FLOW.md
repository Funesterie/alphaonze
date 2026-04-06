# 🧪 JWT Auth Flow - Test Checklist

## ✅ Test Plan

### 1️⃣ **Login → OK?**
- [ ] Open app → `LoginForm` appears
- [ ] Enter: `admin` / `1234`
- [ ] Click "Se connecter"
- [ ] ✅ Chat UI appears
- [ ] ✅ Token stored in `localStorage['a11_jwt_token']`

**Command to verify:**
```powershell
# In browser console:
localStorage.getItem('a11_jwt_token')
# Should output: JWT string starting with "eyJ..."
```

---

### 2️⃣ **Refresh page → Reste connecté?**
- [ ] After login, press `F5` or `Cmd+R`
- [ ] ✅ App loads directly into Chat (NO LoginForm)
- [ ] ✅ Token persisted in `localStorage`
- [ ] ✅ Messages preserved from localStorage

**Why:** `useEffect` checks token on mount, `isAuthenticated` set to true if exists

---

### 3️⃣ **Call IA → OK?**
- [ ] Type message in chat: "Salut, comment ça va?"
- [ ] Press Enter
- [ ] ✅ Message sent to backend
- [ ] ✅ Backend receives `X-NEZ-TOKEN: <JWT>` in header
- [ ] ✅ LLM response appears in chat
- [ ] ✅ No 401 error

**Network tab:** Check Request Headers include:
```
X-NEZ-TOKEN: eyJ...
Content-Type: application/json
```

---

### 4️⃣ **Logout → Revient login?**
- [ ] Click "🔓 Logout" button (top-right)
- [ ] ✅ Page reloads (see refresh spinner)
- [ ] ✅ `LoginForm` appears
- [ ] ✅ `localStorage['a11_jwt_token']` is empty

**Command to verify:**
```powershell
localStorage.getItem('a11_jwt_token')
# Should output: null
```

---

### 5️⃣ **Token supprimé → Bloqué?**
- [ ] After logout, manually set token in console:
  ```js
  localStorage.setItem('a11_jwt_token', 'invalid-token-123')
  ```
- [ ] Reload page
- [ ] Try send message
- [ ] ✅ Backend returns `401 Unauthorized`
- [ ] ✅ App clears token + reloads to LoginForm
- [ ] Browser console shows: `[A11] 🔐 401 Unauthorized - clearing token and reloading`

---

## 🔧 Critical Protections Implemented

| Protection | Location | Status |
|-----------|----------|--------|
| **401 Handler** | `apiPost()` in api.ts | ✅ Clear token + reload |
| **Token Guard** | `apiPost()` throws if no token | ✅ Block API calls |
| **Logout Reset** | App.tsx logout button | ✅ `window.location.reload()` |
| **Token Persistence** | `useEffect` on mount | ✅ Check localStorage |
| **Auth Check** | App.tsx renders LoginForm if `!isAuthenticated` | ✅ Protected UI |

---

## 🚀 What's Protected

```
┌─────────────────────────────┐
│  Frontend                   │
├─────────────────────────────┤
│ ✅ Login UI (LoginForm)      │
│ ✅ Protected routes (if not auth → login)
│ ✅ Token auto-inject in headers
│ ✅ 401 auto-recovery         │
│ ✅ Logout clean              │
├─────────────────────────────┤
│  Backend (d:/a11ba)         │
├─────────────────────────────┤
│ ✅ /api/auth/login           │
│ ✅ JWT verification          │
│ ✅ Middleware on /api/ai     │
│ ✅ 24h expiry               │
└─────────────────────────────┘
```

---

## 🎯 Post-Test Actions

If all 5 ✅:
- [ ] Commit: "test: verify JWT auth flow complete"
- [ ] Push to `a11frontend`
- [ ] Next feature: **User display** (show "Logged in as: admin")

If any ❌:
- [ ] Check backend logs in `d:/a11ba`
- [ ] Verify token in localStorage
- [ ] Check browser Network tab for headers

---

## 📝 Notes

- Token expiry: **24h** (from backend JWT config)
- Default creds: `admin:1234` (update in backend `.env`)
- Token key: `a11_jwt_token` in localStorage
- Auto-logout triggers on: 401 + timeout (implement later)
