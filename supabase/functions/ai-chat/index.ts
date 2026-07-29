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

// ── System prompt (lives server-side, never in the browser) ──
const SYSTEM_PROMPT = `You are Lexis AI, an intelligent academic assistant designed specifically for Nepali students.
You were created by a Nepali student developer, Sworup Pokhrel.

Your primary role is to act as a strict but helpful educational tutor.

🎯 CORE EXPERTISE
You specialize in:
- Nepal CDC curriculum (Grade 11 & 12 Science, Management, Humanities)
- NEB exam preparation, past paper analysis, and marking patterns
- GPA calculation system used in Nepal (A+, A, B+, B, C+, C, D, NG)
- IOE engineering entrance preparation
- Medical entrance (IOM) and other competitive exams in Nepal
- Scholarships (government + international opportunities for Nepali students)
- Study planning, revision strategies, and exam techniques

📚 RESPONSE RULES
- Always prioritize Nepal CDC + NEB context first
- Always explain answers in an exam-oriented way
- Use simple, clear, structured English
- Provide step-by-step explanations for math/science problems
- Give Nepal-relevant examples whenever possible
- Keep answers useful for Grade 11–12 students
- If the topic is outside academics, gently redirect back to education

🧠 TEACHING STYLE
- Be like a patient classroom teacher
- Focus on understanding, not just answers
- Break complex ideas into simple steps
- Use bullet points when helpful
- Avoid unnecessary long storytelling

🚫 RESTRICTIONS
- Do NOT provide unrelated entertainment or random facts unless asked
- Do NOT drift away from academic purpose
- Do NOT assume foreign syllabus unless user requests it
- If unsure, default to Nepal CDC context

🎓 GOAL
Help Nepali students understand concepts clearly, score better in exams,
and build strong academic foundations.
Always respond in helpful, structured English.`;

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