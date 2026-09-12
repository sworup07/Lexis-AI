# Lexis AI

**Nepal's AI-powered educational chatbot** — helping students master the CDC curriculum, prepare for NEB exams, and find scholarships through personalized AI tutoring.

🔗 Live site: [lexis-np.netlify.app](https://lexis-np.netlify.app)

---

## What it does

- 🤖 **AI-Powered Tutoring** — chat-based help aligned with the Nepali CDC curriculum
- 📚 **CDC Curriculum Notes** — subject notes for NEB exam preparation
- 🎓 **Scholarship Finder** — helps students discover scholarship opportunities
- 🔐 **Google Sign-In** — with a limited free tier (5 questions/day) for users without an account

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Static HTML/CSS/JS (no build step) |
| Auth | Supabase Auth (Google OAuth) |
| Backend | Supabase Edge Functions (Deno) |
| AI | OpenRouter API (called server-side only) |
| Hosting | Netlify |

## Project structure

```
index.html               # Landing / sign-in page
chat.html                 # Main chat interface
css/                       # shared.css, login.css, chat.css
js/                        # auth.js, theme.js, sidebar.js, chat.js, modals.js
images/                    # Static assets
supabase/functions/ai-chat/index.ts   # Edge Function that proxies AI calls
```

The HTML files reference `css/...`, `js/...`, and `images/...` as relative paths — keep this folder structure when deploying (don't flatten it).

## How the AI chat works

The browser **never** talks to OpenRouter directly. `chat.js` sends the signed-in user's Supabase session token to a Supabase Edge Function (`/functions/v1/ai-chat`), which validates the token and makes the OpenRouter call server-side. This keeps the AI API key off the client entirely.

## Setup

### 1. Clone and configure Supabase

```bash
git clone https://github.com/sworup07/Lexis-AI.git
cd Lexis-AI
```

Create a Supabase project, then set the following **as Edge Function secrets** (never in client code):

```bash
supabase secrets set OPENROUTER_API_KEY=your_key_here
```

### 2. Configure allowed origins

In `supabase/functions/ai-chat/index.ts`, update `ALLOWED_ORIGINS` to include your deployed URL (e.g. your Netlify domain), or the Edge Function will reject browser requests with a CORS error.

### 3. Deploy the Edge Function

```bash
supabase functions deploy ai-chat
```

### 4. Deploy the frontend

This is a static site — no build step. Deploy `index.html`, `chat.html`, `css/`, `js/`, and `images/` directly to Netlify (or any static host).

## Security notes

- API keys live only in Supabase Edge Function secrets — **never** commit them to this repo.
- If you ever hardcode a key locally for testing, make sure it's covered by `.gitignore` before committing.
- Auth is handled via Supabase session tokens; the Edge Function verifies the token before calling the AI provider.

## License

MIT — see [LICENSE](https://github.com/sworup07/Lexis-AI/blob/main/LICENSE).
