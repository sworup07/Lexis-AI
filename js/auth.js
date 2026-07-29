/* ═══════════════════════════════════════════════════════════════
   auth.js — Lexis AI · Supabase Authentication
   ─────────────────────────────────────────────────────────────
   FIXES IN THIS VERSION:
   1. Session persistence  — uses Supabase's built-in session
      storage (localStorage) so users stay logged in across tabs
      and browser restarts until they explicitly sign out.
   2. $ declared before use — no more ReferenceError.
   3. Google OAuth fully wired through Supabase (no GIS SDK needed).
   4. Email/password sign-up, sign-in, validation, errors all work.
   5. Real avatar / name / email fetched from Supabase session.
   6. GIS <div> and script removed from HTML — was causing the
      "[GSI_LOGGER]: callback is not a function" console error.
═══════════════════════════════════════════════════════════════ */

/* ── Supabase config ─────────────────────────────────────────
   URL  →  Settings › API › Project URL
   KEY  →  Settings › API › anon / public key
   ⚠  URL must be  https://xxxx.supabase.co  (no /rest/v1/)
─────────────────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://fqrxkcapozyrdysitwfw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxcnhrY2Fwb3p5cmR5c2l0d2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwOTA2MDgsImV4cCI6MjA5NDY2NjYwOH0.Vw1w7-XqTQcGTJUFWXbVwOesIt_DyzFlYstqlluWvTI';

/* ── Singleton Supabase client ───────────────────────────────
   persistSession: true  → stays logged in across browser restarts
   autoRefreshToken: true → refreshes JWT automatically
─────────────────────────────────────────────────────────────── */
let _sb = null;
function getSB() {
  if (_sb) return _sb;
  if (window.supabase && window.supabase.createClient) {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession:   true,   // ← keeps login across browser close/reopen
        autoRefreshToken: true,   // ← silently refreshes JWT before expiry
        detectSessionInUrl: true, // ← picks up OAuth redirect tokens from URL
      },
    });
  }
  return _sb;
}

/* ══════════════════════════════════════════════════════════════
   LexisAuth — public API used by every page
══════════════════════════════════════════════════════════════ */
const LexisAuth = (() => {

  /* ── Get the current authenticated user ─────────────────── */
  async function getUser() {
    const sb = getSB();
    if (!sb) return null;
    try {
      // getSession() is synchronous from cache — much faster than getUser()
      const { data: { session } } = await sb.auth.getSession();
      return session?.user || null;
    } catch (e) {
      console.warn('getUser error:', e.message);
      return null;
    }
  }

  /* ── Build profile from session metadata + profiles table ── */
  async function getUserProfile() {
    const sb   = getSB();
    const user = await getUser();
    if (!sb || !user) return null;

    // Guests (anonymous sign-in) have no email/name — handle separately
    if (user.is_anonymous) {
      return {
        id:       user.id,
        name:     'Guest',
        email:    '',
        avatar:   `https://i.pravatar.cc/100?u=${user.id}`,
        plan:     'guest',
        provider: 'anonymous',
        isGuest:  true,
      };
    }

    // OAuth providers (Google) store name/picture in user_metadata
    const meta = user.user_metadata || {};

    // Try fetching extra fields from our profiles table
    const { data } = await sb
      .from('profiles')
      .select('full_name, avatar_url, plan')
      .eq('id', user.id)
      .maybeSingle();

    // Priority: profiles table > OAuth metadata > fallbacks
    return {
      id:       user.id,
      name:     data?.full_name  || meta.full_name  || meta.name    || (user.email ? user.email.split('@')[0] : 'Student'),
      email:    user.email       || '',
      avatar:   data?.avatar_url || meta.avatar_url || meta.picture || `https://i.pravatar.cc/100?u=${user.id}`,
      plan:     data?.plan       || 'free',
      provider: user.app_metadata?.provider || 'email',
      isGuest:  false,
    };
  }

  /* ── Quick logged-in check (uses cached session) ─────────── */
  async function isLoggedIn() {
    return !!(await getUser());
  }

  /* ── Get the current session's access token ───────────────
     Used by chat.js to authenticate to the Supabase Edge Function
     (ai-chat). This replaces any hardcoded API key — the edge
     function verifies this token server-side before calling
     OpenRouter, so no AI provider key ever needs to live in the
     browser. ─────────────────────────────────────────────────── */
  async function getAccessToken() {
    const sb = getSB();
    if (!sb) return null;
    try {
      const { data: { session } } = await sb.auth.getSession();
      return session?.access_token || null;
    } catch (e) {
      console.warn('getAccessToken error:', e.message);
      return null;
    }
  }

  /* ── Get the raw Supabase client ───────────────────────────
     Used by sidebar.js / chat.js to query the chats /
     chat_messages tables directly. Row Level Security on those
     tables (set up in the SQL migration) means each user can only
     ever read/write their own rows, even though the client here
     is shared. ─────────────────────────────────────────────────── */
  function getClient() {
    return getSB();
  }

  /* ── Continue as Guest (Supabase anonymous sign-in) ────────
     Gives the visitor a real (but nameless) Supabase session, so
     all the existing session/token machinery — including the
     ai-chat edge function's auth check — works for them exactly
     the same as a logged-in user. Requires "Allow anonymous
     sign-ins" to be turned on in Supabase Dashboard → Authentication.
  ─────────────────────────────────────────────────────────────── */
  async function continueAsGuest() {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised.');
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) throw error;
    return data;
  }

  /* ── Google Sign-In via Supabase OAuth ───────────────────── */
  async function signInWithGoogle() {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised. Check your URL and key.');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/chat.html',
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) throw error;
    // Browser redirects to Google — no return value needed
  }

  /* ── Email Sign-Up ───────────────────────────────────────── */
  async function signUpWithEmail(email, password, displayName) {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised.');
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: displayName },
        emailRedirectTo: window.location.origin + '/chat.html',
      },
    });
    if (error) throw error;
    // If email confirmation is off in Supabase, user is logged in immediately
    if (data?.user && !data.session) {
      // Email confirmation required — user must check inbox
      return { needsConfirmation: true };
    }
    if (data?.user) await upsertProfile(data.user);
    return { needsConfirmation: false, data };
  }

  /* ── Email Sign-In ───────────────────────────────────────── */
  async function signInWithEmail(email, password) {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised.');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data?.user) await upsertProfile(data.user);
    return data;
  }

  /* ── Forgot Password ─────────────────────────────────────── */
  async function sendPasswordReset(email) {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised.');
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/index.html',
    });
    if (error) throw error;
  }

  /* ── Sign Out ────────────────────────────────────────────── */
  async function signOut() {
    const sb = getSB();
    if (sb) await sb.auth.signOut();
    redirectToLogin();
  }

  /* ── Upsert profile row (called after every login) ───────── */
  async function upsertProfile(user) {
    const sb = getSB();
    if (!sb || !user) return;
    const meta = user.user_metadata || {};
    const { error } = await sb.from('profiles').upsert({
      id:         user.id,
      full_name:  meta.full_name  || meta.name || user.email.split('@')[0],
      avatar_url: meta.avatar_url || meta.picture || null,
      email:      user.email,
      plan:       'free',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) console.warn('upsertProfile error:', error.message);
  }

  /* ── Populate chat.html UI with real user data ───────────── */
  async function populateChatUI() {
    const profile = await getUserProfile();
    if (!profile) { redirectToLogin(); return null; }

    function setEl(id, val, attr) {
      const el = document.getElementById(id);
      if (!el) return;
      if (attr === 'src') { el.src = val; el.alt = profile.name; }
      else el.textContent = val;
    }

    // Sidebar footer
    setEl('sidebarUserName',   profile.name);
    setEl('sidebarUserEmail',  profile.email);
    setEl('sidebarUserAvatar', profile.avatar, 'src');

    // User menu popover
    setEl('popoverName',   profile.name);
    setEl('popoverEmail',  profile.email);
    setEl('popoverAvatar', profile.avatar, 'src');

    // Settings → Account tab
    setEl('settingsAccountName',  profile.name);
    setEl('settingsAccountEmail', profile.email);
    setEl('settingsAvatar', profile.avatar, 'src');
    const ni = document.getElementById('settingsNameInput');
    const ei = document.getElementById('settingsEmailInput');
    if (ni) ni.value = profile.name;
    if (ei) ei.value = profile.email;

    // User message avatar (for new messages)
    window._lexisUserAvatar = profile.avatar;
    window._lexisUserName   = profile.name;
    window._lexisIsGuest    = !!profile.isGuest;

    // Plan badge
    const badge = document.getElementById('planBadge');
    if (badge) badge.textContent = profile.isGuest ? 'Guest' : (profile.plan === 'pro' ? 'Pro' : 'Free');
    const settingsBadge = document.getElementById('settingsPlanBadge');
    if (settingsBadge) settingsBadge.textContent = profile.isGuest ? 'Guest' : (profile.plan === 'pro' ? 'Pro Plan' : 'Free Plan');

    // Personalised welcome
    const wt = document.getElementById('welcomeTitle');
    if (wt) wt.textContent = `Hi ${profile.name.split(' ')[0]}, how can I help?`;

    return profile;
  }

  /* ── Redirect helpers ────────────────────────────────────── */
  function redirectToChat()  { window.location.replace('chat.html');  }
  function redirectToLogin() { window.location.replace('index.html'); }

  /* ── Auth state listener ─────────────────────────────────── */
  function onAuthStateChange(cb) {
    const sb = getSB();
    if (sb) sb.auth.onAuthStateChange((_event, session) => cb(session));
  }

  return {
    getUser, getUserProfile, isLoggedIn, getAccessToken, getClient,
    signInWithGoogle, continueAsGuest, signUpWithEmail, signInWithEmail,
    sendPasswordReset, signOut, upsertProfile,
    populateChatUI, onAuthStateChange,
    redirectToChat, redirectToLogin,
  };
})();

// Backward-compat alias (keeps chat.js working without changes)
const EduVisionAuth = LexisAuth;


/* ════════════════════════════════════════════════════════════════
   LOGIN PAGE  (index.html only)
   ── All helpers declared BEFORE first use — no ReferenceError ──
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('loginApp')) return;

  // ── Helpers declared first ─────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function showToast(msg, type) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className   = 'toast ' + (type || '') + ' show';
    clearTimeout(t._toastTimer);
    t._toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
  }

  function showFieldError(id, msg) {
    const el = $(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function clearErrors() {
    ['emailError', 'passwordError'].forEach(id => {
      const el = $(id);
      if (el) { el.textContent = ''; el.style.display = 'none'; }
    });
    $('emailInput')?.classList.remove('error');
    $('passwordInput')?.classList.remove('error');
  }

  function validEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  function setLoading(which, on) {
    if (which === 'google') {
      const btn  = $('googleSignInBtn');
      const txt  = $('googleBtnText');
      const spin = $('googleSpinner');
      if (btn)  btn.disabled       = on;
      if (txt)  txt.style.display  = on ? 'none'  : '';
      if (spin) spin.style.display = on ? 'block' : 'none';
    } else {
      const btn  = $('emailSignInBtn');
      const txt  = $('emailBtnText');
      const spin = $('emailSpinner');
      if (btn)  btn.disabled       = on;
      if (txt)  txt.style.display  = on ? 'none'  : '';
      if (spin) spin.style.display = on ? 'block' : 'none';
    }
  }

  // ── Apply theme ────────────────────────────────────────────
  function applyLoginTheme(theme) {
    const dark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const sun  = $('sunIcon');
    const moon = $('moonIcon');
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? ''     : 'none';
    localStorage.setItem('lexis-theme', theme);
  }

  // Apply saved theme immediately (called after helpers are defined)
  applyLoginTheme(localStorage.getItem('lexis-theme') || 'dark');

  // ── Session check — skip login if already authenticated ────
  // Using getSession() so it reads from localStorage cache (fast, no network)
  const sb = getSB();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      LexisAuth.redirectToChat();
      return;
    }
  }

  let isSignUp = false;

  // ── Theme toggle ───────────────────────────────────────────
  $('loginThemeBtn')?.addEventListener('click', () => {
    const cur = localStorage.getItem('lexis-theme') || 'dark';
    applyLoginTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // ── Password visibility toggle ─────────────────────────────
  $('passwordToggle')?.addEventListener('click', () => {
    const pi = $('passwordInput');
    if (!pi) return;
    const isText = pi.type === 'text';
    pi.type = isText ? 'password' : 'text';
    const eye    = $('eyeIcon');
    const eyeOff = $('eyeOffIcon');
    if (eye)    eye.style.display    = isText ? '' : 'none';
    if (eyeOff) eyeOff.style.display = isText ? 'none' : '';
  });

  // ── Switch Sign In ↔ Sign Up mode ──────────────────────────
  $('switchModeBtn')?.addEventListener('click', () => {
    isSignUp = !isSignUp;
    const st = $('switchText');
    const sm = $('switchModeBtn');
    const eb = $('emailBtnText');
    if (st) st.textContent = isSignUp ? 'Already have an account?' : "Don't have an account?";
    if (sm) sm.textContent = isSignUp ? 'Sign in' : 'Sign up';
    if (eb) eb.textContent = isSignUp ? 'Create Account' : 'Sign In';
    clearErrors();
  });

  // ── Forgot password ────────────────────────────────────────
  $('forgotPasswordLink')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('emailInput')?.value.trim();
    if (!email || !validEmail(email)) {
      showToast('Enter your email address first.', 'error');
      return;
    }
    try {
      await LexisAuth.sendPasswordReset(email);
      showToast('Password reset email sent! Check your inbox.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not send reset email.', 'error');
    }
  });

  // ── Google Sign-In ─────────────────────────────────────────
  $('googleSignInBtn')?.addEventListener('click', async () => {
    setLoading('google', true);
    try {
      await LexisAuth.signInWithGoogle();
      // Supabase redirects the browser — loader stays on until redirect
    } catch (err) {
      showToast(err.message || 'Google sign-in failed. Try again.', 'error');
      setLoading('google', false);
    }
  });

  // ── Continue as Guest ────────────────────────────────────────
  $('guestContinueBtn')?.addEventListener('click', async () => {
    const btn  = $('guestContinueBtn');
    const txt  = $('guestBtnText');
    const spin = $('guestSpinner');
    if (btn)  btn.disabled       = true;
    if (txt)  txt.style.display  = 'none';
    if (spin) spin.style.display = 'block';
    try {
      await LexisAuth.continueAsGuest();
      LexisAuth.redirectToChat();
    } catch (err) {
      showToast(err.message || 'Could not start a guest session. Try again.', 'error');
      if (btn)  btn.disabled       = false;
      if (txt)  txt.style.display  = '';
      if (spin) spin.style.display = 'none';
    }
  });

  // ── Email / Password form ──────────────────────────────────
  $('loginEmailForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const email    = $('emailInput')?.value.trim()  || '';
    const password = $('passwordInput')?.value      || '';
    let valid = true;

    if (!validEmail(email)) {
      showFieldError('emailError', 'Please enter a valid email address.');
      $('emailInput')?.classList.add('error');
      valid = false;
    }
    if (password.length < 6) {
      showFieldError('passwordError', 'Password must be at least 6 characters.');
      $('passwordInput')?.classList.add('error');
      valid = false;
    }
    if (!valid) return;

    setLoading('email', true);
    try {
      if (isSignUp) {
        const displayName = email.split('@')[0]
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        const result = await LexisAuth.signUpWithEmail(email, password, displayName);
        if (result.needsConfirmation) {
          showToast('Account created! Check your email to confirm before signing in.', 'success');
        } else {
          LexisAuth.redirectToChat();
        }
      } else {
        await LexisAuth.signInWithEmail(email, password);
        LexisAuth.redirectToChat();
      }
    } catch (err) {
      const msg = err.message || 'Authentication failed.';
      // Route error to the right field
      if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('user')) {
        showFieldError('emailError', msg);
        $('emailInput')?.classList.add('error');
      } else {
        showFieldError('passwordError', msg);
        $('passwordInput')?.classList.add('error');
      }
    } finally {
      setLoading('email', false);
    }
  });

  // Clear red border as user types
  [$('emailInput'), $('passwordInput')].forEach(el => {
    el?.addEventListener('input', () => {
      el.classList.remove('error');
      // Also clear the corresponding error text
      const errId = el.id === 'emailInput' ? 'emailError' : 'passwordError';
      const errEl = $(errId);
      if (errEl) errEl.textContent = '';
    });
  });
});


/* ════════════════════════════════════════════════════════════════
   CHAT PAGE  (chat.html only)
   Guards access and populates UI with real Supabase profile data
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('app')) return;

  // Fast session check from localStorage cache
  const sb = getSB();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { LexisAuth.redirectToLogin(); return; }
  }

  // Populate sidebar, popover, settings with real user data
  await LexisAuth.populateChatUI();

  // Sign out if session expires or is revoked in another tab
  LexisAuth.onAuthStateChange((session) => {
    if (!session) LexisAuth.redirectToLogin();
  });
});