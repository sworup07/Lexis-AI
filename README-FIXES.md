# Lexis AI — Fixed Project

## What I changed

**`js/chat.js`**
- Removed the hardcoded OpenRouter API key and the direct
  `fetch()` call to `openrouter.ai`.
- It now calls your own Supabase Edge Function
  (`${SUPABASE_URL}/functions/v1/ai-chat`) instead, and sends the
  signed-in user's Supabase session token in the `Authorization`
  header — the same token your edge function (`index.ts`) already
  checks.
- Removed the duplicate `SYSTEM_PROMPT` (it already lives
  server-side in `index.ts` — no need for two copies).
- Fixed the error-message parsing to match what your edge function
  actually returns (`{ error: "..." }`), and removed the leftover
  "check your API key in chat.js" message shown to users.

**`js/auth.js`**
- Added one small function, `getAccessToken()`, exposed on
  `LexisAuth`. That's what `chat.js` now calls to get the token it
  sends to the edge function.

Nothing else was touched — `index.ts`, your CSS, HTML structure,
sidebar/modals/theme logic are all exactly as you had them, since
those were already fine.

## Folder structure (matters for the `<link>`/`<script>` paths)

```
index.html
chat.html
css/  → shared.css, login.css, chat.css
js/   → auth.js, theme.js, sidebar.js, chat.js, modals.js
images/ → purnima.JPG
supabase/functions/ai-chat/index.ts
```
Your HTML already references `css/...`, `js/...`, `images/...`, so
keep this structure when you upload/push — don't flatten the folders.

## What's left to do (in order)

1. **Confirm the OpenRouter key you put in Supabase is a NEW one** —
   not the one that was hardcoded in the old `chat.js`
   (`sk-or-v1-ef29...`). That one is burned; if you haven't already,
   go to OpenRouter and revoke it.
2. **Redeploy the edge function** so Supabase is running the latest
   `index.ts` (same file as before, unchanged) — see "Supabase
   confirm" below for exact steps.
3. **Push this whole folder to GitHub.** With no real key in any
   file, push protection has nothing to block.
4. **Deploy `index.html` / `chat.html` / `css/` / `js/` / `images/`
   to Netlify** (static hosting — no build step needed).
5. **Test end-to-end:** open the live Netlify URL, sign in, send a
   message, confirm you get a reply back.

## If Netlify's URL differs from `lexis-np.netlify.app`

Open `supabase/functions/ai-chat/index.ts`, find `ALLOWED_ORIGINS`,
add your real URL, then redeploy the function. Otherwise the
browser's requests will be blocked by CORS.
