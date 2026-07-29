// supabase/functions/ai-chat/index.ts
//
// This file runs on Supabase's servers (Deno runtime).
// Your OpenRouter API key lives here as a secret env variable.
// It is NEVER sent to the browser.
//
// DEPLOY METHOD (no local CLI needed):
//   Push this file to GitHub → GitHub Action deploys it for you.
//   See .github/workflows/deploy-edge-function.yml

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Allowed origins (add your Netlify URL here) ──────────────
const ALLOWED_ORIGINS = [
  'https://lexis-np.netlify.app',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function getCorsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

// ── Whitelisted models (prevents abuse of your key) ──────────
const ALLOWED_MODELS = new Set([
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-super-49b-v1:free',
  'mistralai/mistral-7b-instruct:free',
  'meta-llama/llama-3-8b-instruct:free',
  'google/gemma-3-27b-it:free',
]);
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

// Max messages sent per request (controls token usage)
const MAX_HISTORY = 20;

// ── Rate limiting ──────────────────────────────────────────────
// Registered users: N requests per hour. Guests (anonymous
// sign-in): a smaller daily cap per account, PLUS a per-IP cap
// (see below) since anyone can otherwise bypass the per-account
// cap just by requesting a new guest session. Both are tracked in
// the `rate_limits` table (see supabase/sql/002_rate_limits.sql).
const RATE_LIMIT_PER_HOUR = 30;
const GUEST_LIMIT_PER_DAY = 5;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// Per-IP guest cap — deliberately higher than the per-account limit,
// since shared IPs (school wifi, NAT) legitimately host many guests.
// This exists to blunt "spam the guest button for infinite free
// accounts" abuse, not to police normal shared connections.
// See supabase/sql/003_guest_ip_limits.sql.
const GUEST_IP_LIMIT_PER_DAY = 20;

async function checkRateLimit(
  sb: ReturnType<typeof createClient>,
  userId: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const now = new Date();

  const { data, error } = await sb
    .from('rate_limits')
    .select('window_start, request_count')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Rate limit check error:', error.message);
    // Fail open — a rate-limit table hiccup shouldn't lock users out
    return { allowed: true, remaining: limit };
  }

  const windowExpired = !data || (now.getTime() - new Date(data.window_start).getTime()) > windowMs;

  if (windowExpired) {
    await sb.from('rate_limits').upsert(
      { user_id: userId, window_start: now.toISOString(), request_count: 1 },
      { onConflict: 'user_id' },
    );
    return { allowed: true, remaining: limit - 1 };
  }

  if (data.request_count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await sb.from('rate_limits')
    .update({ request_count: data.request_count + 1 })
    .eq('user_id', userId);

  return { allowed: true, remaining: limit - data.request_count - 1 };
}

// ── Guest anti-abuse: per-IP cap ────────────────────────────────
function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Uses the service-role client, bypassing RLS — this table has no
// client-facing policies at all (see the SQL migration).
async function checkGuestIpLimit(
  sbAdmin: ReturnType<typeof createClient>,
  ipHash: string,
): Promise<{ allowed: boolean }> {
  const now = new Date();

  const { data, error } = await sbAdmin
    .from('guest_ip_limits')
    .select('window_start, request_count')
    .eq('ip_hash', ipHash)
    .maybeSingle();

  if (error) {
    console.error('Guest IP limit check error:', error.message);
    return { allowed: true }; // fail open — never break guest access over our own bug
  }

  const windowExpired = !data || (now.getTime() - new Date(data.window_start).getTime()) > DAY_MS;

  if (windowExpired) {
    await sbAdmin.from('guest_ip_limits').upsert(
      { ip_hash: ipHash, window_start: now.toISOString(), request_count: 1 },
      { onConflict: 'ip_hash' },
    );
    return { allowed: true };
  }

  if (data.request_count >= GUEST_IP_LIMIT_PER_DAY) {
    return { allowed: false };
  }

  await sbAdmin.from('guest_ip_limits')
    .update({ request_count: data.request_count + 1 })
    .eq('ip_hash', ipHash);

  return { allowed: true };
}

// ── System prompt (lives server-side, never in the browser) ──
const SYSTEM_PROMPT = `You are Lexis AI, a friendly, capable AI assistant built for Nepali students by Nepali student developer Sworup Pokhrel.

You can help with anything a student asks — general knowledge, everyday questions, coding, writing, brainstorming, life advice, and more — the same way any well-rounded AI assistant would. Don't force an academic angle onto topics that don't need one.

🎯 WHERE YOU REALLY SHINE
When a question touches any of the following, lean into it as your specialty:
- Nepal CDC curriculum (Grade 11 & 12 Science, Management, Humanities)
- NEB exam preparation, past paper patterns, and marking schemes
- Nepal's GPA system (A+, A, B+, B, C+, C, D, NG)
- IOE engineering entrance and IOM medical entrance preparation
- Scholarships for Nepali students (government + international)
- Study planning, revision strategy, and exam technique

For these topics: prioritize Nepal CDC/NEB context, explain answers in an exam-oriented way, use Nepal-relevant examples, and give step-by-step explanations for math/science problems.

🧠 STYLE
- Be clear, structured, and genuinely helpful — like a sharp, patient teacher who also happens to know about everything else
- Use bullet points and step-by-step breakdowns where they aid understanding
- Keep answers proportionate to the question — don't pad simple questions with unnecessary structure

🎓 GOAL
Be a smart, broadly useful assistant first, and the best Nepal CDC/NEB study partner a student could ask for whenever that expertise is relevant.`;

// ═══════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const cors   = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // ── STEP 1: Verify the user is logged in ─────────────────
    // We check their Supabase JWT. Invalid token = rejected.
    // This means ONLY your logged-in users can call the AI.
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated. Please sign in.' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const sb = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Session expired. Please sign in again.' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── STEP 1.5: Rate limit — protects your OpenRouter quota ──
    const isGuest  = !!user.is_anonymous;
    const limit    = isGuest ? GUEST_LIMIT_PER_DAY : RATE_LIMIT_PER_HOUR;
    const windowMs = isGuest ? DAY_MS : HOUR_MS;

    const GUEST_LIMIT_MESSAGE = `Login to ask more questions. Sorry, you can only ask ${GUEST_LIMIT_PER_DAY} questions per day without logging in.`;

    if (isGuest) {
      // Extra layer for guests only: caps total guest traffic per IP,
      // since anyone can otherwise bypass the per-account limit just
      // by requesting a new guest session repeatedly.
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (serviceKey) {
        const sbAdmin = createClient(supabaseUrl, serviceKey);
        const ip = getClientIp(req);
        const ipHash = await hashIp(ip);
        const ipCheck = await checkGuestIpLimit(sbAdmin, ipHash);
        if (!ipCheck.allowed) {
          return new Response(
            JSON.stringify({ error: GUEST_LIMIT_MESSAGE }),
            { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        // Not configured yet — log it so it's noticed, but don't
        // block guests over a missing secret.
        console.warn('SUPABASE_SERVICE_ROLE_KEY not set — guest IP limit is disabled.');
      }
    }

    const rateCheck = await checkRateLimit(sb, user.id, limit, windowMs);
    if (!rateCheck.allowed) {
      const message = isGuest
        ? GUEST_LIMIT_MESSAGE
        : `You've hit the hourly limit of ${RATE_LIMIT_PER_HOUR} messages. Please try again in a bit.`;
      return new Response(
        JSON.stringify({ error: message }),
        { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── STEP 2: Parse request body ────────────────────────────
    let body: { messages?: unknown[]; model?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid request format.' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No messages provided.' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── STEP 3: Sanitize inputs ───────────────────────────────
    const model = ALLOWED_MODELS.has(body.model || '') ? body.model! : DEFAULT_MODEL;

    const history = (body.messages as { role: string; content: string }[])
      .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string'
                    && ['user', 'assistant'].includes(m.role))
      .slice(-MAX_HISTORY);

    if (history.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid messages found.' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── STEP 4: Call OpenRouter with the SECRET key ───────────
    // OPENROUTER_API_KEY is stored in Supabase Vault (encrypted).
    // It is NEVER sent to the browser — this is the whole point.
    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      console.error('OPENROUTER_API_KEY secret not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured. Contact the admin.' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,   // ← injected here, server-only
        'HTTP-Referer':  'https://lexis-np.netlify.app',
        'X-Title':       'Lexis AI',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT }, // also server-only
          ...history,
        ],
        max_tokens: 1024,
        stream:     false,
      }),
    });

    // ── STEP 5: Handle AI errors ──────────────────────────────
    if (!aiResponse.ok) {
      const errData  = await aiResponse.json().catch(() => ({}));
      const errMsg   = (errData as any)?.error?.message || `AI service error ${aiResponse.status}`;
      let friendly   = errMsg;
      if (aiResponse.status === 429) friendly = 'Rate limit reached. Please wait a moment.';
      if (aiResponse.status === 503) friendly = 'AI model temporarily unavailable. Try again.';
      console.error(`OpenRouter [${aiResponse.status}]:`, errMsg);
      return new Response(
        JSON.stringify({ error: friendly }),
        { status: aiResponse.status, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── STEP 6: Return AI response to the browser ─────────────
    const aiJson = await aiResponse.json();
    return new Response(
      JSON.stringify(aiJson),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error. Please try again.' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});