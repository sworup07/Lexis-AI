/* ═══════════════════════════════════════════════════════════════
   auth.js — Lexis AI Authentication (Supabase)
══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://fqrxkcapozyrdysitwfw.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxcnhrY2Fwb3p5cmR5c2l0d2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwOTA2MDgsImV4cCI6MjA5NDY2NjYwOH0.Vw1w7-XqTQcGTJUFWXbVwOesIt_DyzFlYstqlluWvTI';

let _sb = null;

function getSB() {
  if (_sb) return _sb;

  if (window.supabase && window.supabase.createClient) {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  return _sb;
}

/* ══════════════════════════════════════════════════════════════
   LexisAuth — public auth API
══════════════════════════════════════════════════════════════ */
const LexisAuth = (() => {

  async function getUser() {
    const sb = getSB();
    if (!sb) return null;

    const { data, error } = await sb.auth.getUser();
    if (error || !data) return null;

    return data.user || null;
  }

  async function getUserProfile() {
    const sb = getSB();
    const user = await getUser();

    if (!sb || !user) return null;

    const meta = user.user_metadata || {};

    const { data, error } = await sb
      .from('profiles')
      .select('full_name, avatar_url, plan')
      .eq('id', user.id)
      .maybeSingle(); // 🔥 FIX: avoids crash if row doesn't exist

    if (error) console.warn("Profile fetch error:", error.message);

    return {
      id: user.id,
      name: data?.full_name || meta.full_name || meta.name || user.email?.split('@')[0] || "User",
      email: user.email || "",
      avatar: data?.avatar_url || meta.avatar_url || meta.picture || `https://i.pravatar.cc/100?u=${user.id}`,
      plan: data?.plan || 'free',
      provider: user.app_metadata?.provider || 'email',
    };
  }

  async function isLoggedIn() {
    const user = await getUser();
    return !!user;
  }

  async function signInWithGoogle() {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised');

    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/chat.html' },
    });

    if (error) throw error;
  }

  async function signUpWithEmail(email, password, displayName) {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised');

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: displayName },
        emailRedirectTo: window.location.origin + '/chat.html',
      },
    });

    if (error) throw error;
    return data;
  }

  async function signInWithEmail(email, password) {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised');

    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data?.user) {
      await upsertProfile(data.user);
    }

    return data;
  }

  async function sendPasswordReset(email) {
    const sb = getSB();
    if (!sb) throw new Error('Supabase not initialised');

    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/index.html',
    });

    if (error) throw error;
  }

  async function signOut() {
    const sb = getSB();
    if (sb) await sb.auth.signOut();
    redirectToLogin();
  }

  async function upsertProfile(user) {
    const sb = getSB();
    if (!sb || !user) return;

    const meta = user.user_metadata || {};

    await sb.from('profiles').upsert({
      id: user.id,
      full_name: meta.full_name || meta.name || user.email?.split('@')[0],
      avatar_url: meta.avatar_url || meta.picture || null,
      email: user.email,
      plan: 'free',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
  }

  async function populateChatUI() {
    const profile = await getUserProfile();

    if (!profile) {
      redirectToLogin();
      return null;
    }

    const set = (id, val, prop) => {
      const el = document.getElementById(id);
      if (!el) return;

      if (prop === 'src') {
        el.src = val;
        el.alt = profile.name;
      } else {
        el.textContent = val;
      }
    };

    set('sidebarUserName', profile.name);
    set('sidebarUserEmail', profile.email);
    set('sidebarUserAvatar', profile.avatar, 'src');

    set('popoverName', profile.name);
    set('popoverEmail', profile.email);
    set('popoverAvatar', profile.avatar, 'src');

    set('settingsAccountName', profile.name);
    set('settingsAccountEmail', profile.email);

    const nameInput = document.getElementById('settingsNameInput');
    const emailInput = document.getElementById('settingsEmailInput');

    if (nameInput) nameInput.value = profile.name;
    if (emailInput) emailInput.value = profile.email;

    const planBadge = document.getElementById('planBadge');
    if (planBadge) planBadge.textContent = profile.plan === 'pro' ? 'Pro' : 'Free';

    const welcomeTitle = document.getElementById('welcomeTitle');
    if (welcomeTitle) {
      const first = profile.name.split(' ')[0];
      welcomeTitle.textContent = `Hi ${first}, how can I help?`;
    }

    return profile;
  }

  function redirectToChat() {
    window.location.href = 'chat.html';
  }

  function redirectToLogin() {
    window.location.href = 'index.html';
  }

  function onAuthStateChange(cb) {
    const sb = getSB();
    if (!sb) return;

    sb.auth.onAuthStateChange((_event, session) => {
      cb(session);
    });
  }

  return {
    getUser,
    getUserProfile,
    isLoggedIn,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    sendPasswordReset,
    signOut,
    upsertProfile,
    populateChatUI,
    onAuthStateChange,
    redirectToChat,
    redirectToLogin,
  };
})();

const EduVisionAuth = LexisAuth;

/* ═══════════════════════════════════════════════════════════════
   LOGIN PAGE
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('loginApp')) return;

  let isSignUp = false;

  const $ = id => document.getElementById(id);

  const applyLoginTheme = (theme) => {
    const dark =
      theme === 'dark' ||
      (theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

    localStorage.setItem('lexis-theme', theme);
  };

  $('loginThemeBtn')?.addEventListener('click', () => {
    const current = localStorage.getItem('lexis-theme') || 'dark';
    applyLoginTheme(current === 'dark' ? 'light' : 'dark');
  });

  $('passwordToggle')?.addEventListener('click', () => {
    const pi = $('passwordInput');
    if (!pi) return;

    pi.type = pi.type === 'text' ? 'password' : 'text';
  });

  $('switchModeBtn')?.addEventListener('click', () => {
    isSignUp = !isSignUp;

    const st = $('switchText');
    const eb = $('emailBtnText');

    if (st) st.textContent = isSignUp ? 'Already have account?' : 'Don’t have account?';
    if (eb) eb.textContent = isSignUp ? 'Create Account' : 'Sign In';
  });

  $('forgotPasswordLink')?.addEventListener('click', async (e) => {
    e.preventDefault();

    const email = $('emailInput')?.value?.trim();
    if (!email) return;

    try {
      await LexisAuth.sendPasswordReset(email);
      alert("Reset email sent!");
    } catch (err) {
      alert(err.message);
    }
  });

  $('googleSignInBtn')?.addEventListener('click', async () => {
    try {
      await LexisAuth.signInWithGoogle();
    } catch (err) {
      alert(err.message);
    }
  });

  $('loginEmailForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = $('emailInput')?.value?.trim();
    const password = $('passwordInput')?.value;

    if (!email || !password) return;

    try {
      if (isSignUp) {
        await LexisAuth.signUpWithEmail(email, password, email.split('@')[0]);
        alert("Check your email to confirm!");
      } else {
        await LexisAuth.signInWithEmail(email, password);
        LexisAuth.redirectToChat();
      }
    } catch (err) {
      alert(err.message);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   CHAT PAGE
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('app')) return;

  const loggedIn = await LexisAuth.isLoggedIn();

  if (!loggedIn) {
    LexisAuth.redirectToLogin();
    return;
  }

  await LexisAuth.populateChatUI();

  LexisAuth.onAuthStateChange((session) => {
    if (!session) LexisAuth.redirectToLogin();
  });
});