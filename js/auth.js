/* ═══════════════════════════════════════════════════════════════
   auth.js — Authentication State & Login Page Logic
   
   HOW TO CONNECT YOUR BACKEND:
   1. Replace signInWithGoogle() body with:
        window.location.href = '/api/auth/google';
      Your server handles OAuth and sets a session cookie.
   
   2. After OAuth redirect, your server calls:
        EduVisionAuth.setUser({ name, email, avatar, plan })
      Then redirects to chat.html.
   
   3. On page load in chat.html, your server returns user data
      from GET /api/auth/me which you set via setUser().
═══════════════════════════════════════════════════════════════ */

const EduVisionAuth = (() => {
  const STORAGE_KEY = 'eduvision_user';

  /* ── Get / Set / Clear user ──────────────────────────────── */
  function getUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setUser(userData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
  }

  function clearUser() {
    localStorage.removeItem(STORAGE_KEY);
    /* TODO: also call POST /api/auth/signout to clear server session */
  }

  function isLoggedIn() {
    return !!getUser();
  }

  /* ── Redirect helpers ────────────────────────────────────── */
  function redirectToChat()  { window.location.href = 'chat.html';  }
  function redirectToLogin() { window.location.href = 'index.html'; }

  /* ── Google Sign-In (PLACEHOLDER) ───────────────────────── */
  /* TODO: Replace the mock below with real Google OAuth.
     Option A (server-side OAuth):
       window.location.href = '/api/auth/google';
     Option B (Google Identity Services SDK):
       google.accounts.id.initialize({ client_id: 'YOUR_CLIENT_ID', callback: handleGoogleResponse });
       google.accounts.id.prompt();
  */
  async function signInWithGoogle() {
    await sleep(1100);
    const mockUser = {
      id:     'user_' + Date.now(),
      name:   'New Student',
      email:  'student@example.com',
      avatar: `https://i.pravatar.cc/100?u=${Date.now()}`,
      plan:   'free',
      provider: 'google',
    };
    setUser(mockUser);
    return mockUser;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { getUser, setUser, clearUser, isLoggedIn, signInWithGoogle, redirectToChat, redirectToLogin };
})();

/* ════════════════════════════════════════════════════════════════
   LOGIN PAGE SCRIPT
   (Only runs if we're on index.html — checks for loginApp element)
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('loginApp')) return;

  /* If already logged in, skip login page */
  if (EduVisionAuth.isLoggedIn()) {
    EduVisionAuth.redirectToChat();
    return;
  }

  /* Apply saved theme */
  const savedTheme = localStorage.getItem('eduvision-theme') || 'dark';
  applyLoginTheme(savedTheme);

  let isSignUp = false;

  const googleBtn       = document.getElementById('googleSignInBtn');
  const googleBtnText   = document.getElementById('googleBtnText');
  const googleSpinner   = document.getElementById('googleSpinner');
  const emailForm       = document.getElementById('loginEmailForm');
  const emailInput      = document.getElementById('emailInput');
  const passwordInput   = document.getElementById('passwordInput');
  const emailBtnText    = document.getElementById('emailBtnText');
  const emailSpinner    = document.getElementById('emailSpinner');
  const switchModeBtn   = document.getElementById('switchModeBtn');
  const switchText      = document.getElementById('switchText');
  const loginThemeBtn   = document.getElementById('loginThemeBtn');
  const passwordToggle  = document.getElementById('passwordToggle');
  const eyeIcon         = document.getElementById('eyeIcon');
  const eyeOffIcon      = document.getElementById('eyeOffIcon');
  const forgotLink      = document.getElementById('forgotPasswordLink');

  /* ── Theme toggle ──────────────────────────────────────── */
  function applyLoginTheme(theme) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.getElementById('sunIcon').style.display  = isDark ? 'none' : '';
    document.getElementById('moonIcon').style.display = isDark ? ''     : 'none';
    localStorage.setItem('eduvision-theme', theme);
  }

  loginThemeBtn.addEventListener('click', () => {
    const current = localStorage.getItem('eduvision-theme') || 'dark';
    applyLoginTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ── Password show/hide ─────────────────────────────────── */
  passwordToggle.addEventListener('click', () => {
    const isText = passwordInput.type === 'text';
    passwordInput.type = isText ? 'password' : 'text';
    eyeIcon.style.display    = isText ? '' : 'none';
    eyeOffIcon.style.display = isText ? 'none' : '';
  });

  /* ── Switch sign-in / sign-up ───────────────────────────── */
  switchModeBtn.addEventListener('click', () => {
    isSignUp = !isSignUp;
    switchText.textContent    = isSignUp ? 'Already have an account?' : "Don't have an account?";
    switchModeBtn.textContent = isSignUp ? 'Sign in' : 'Sign up';
    emailBtnText.textContent  = isSignUp ? 'Create Account' : 'Sign In';
    clearErrors();
  });

  /* ── Forgot password ────────────────────────────────────── */
  forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    showToast('Password reset link sent! (Connect your backend to enable this)', 'success');
  });

  /* ── Google Sign-In ─────────────────────────────────────── */
  googleBtn.addEventListener('click', async () => {
    googleBtn.disabled  = true;
    googleBtnText.style.display  = 'none';
    googleSpinner.style.display  = 'block';

    try {
      await EduVisionAuth.signInWithGoogle();
      EduVisionAuth.redirectToChat();
    } catch (err) {
      showToast('Sign-in failed. Please try again.', 'error');
    } finally {
      googleBtn.disabled  = false;
      googleBtnText.style.display  = '';
      googleSpinner.style.display  = 'none';
    }
  });

  /* ── Email Form ─────────────────────────────────────────── */
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const email    = emailInput.value.trim();
    const password = passwordInput.value;
    let valid = true;

    if (!email || !isValidEmail(email)) {
      showFieldError('emailError', 'Please enter a valid email address.');
      emailInput.classList.add('error');
      valid = false;
    }
    if (password.length < 6) {
      showFieldError('passwordError', 'Password must be at least 6 characters.');
      passwordInput.classList.add('error');
      valid = false;
    }
    if (!valid) return;

    /* TODO: Replace with real API call:
       const res = await fetch('/api/auth/' + (isSignUp ? 'signup' : 'login'), {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ email, password })
       });
       const data = await res.json();
       if (!res.ok) { showFieldError('passwordError', data.message); return; }
       EduVisionAuth.setUser(data.user);
       EduVisionAuth.redirectToChat();
    */

    document.getElementById('emailBtnText').style.display = 'none';
    document.getElementById('emailSpinner').style.display = 'block';
    document.getElementById('emailSignInBtn').disabled = true;

    await new Promise(r => setTimeout(r, 1000));

    EduVisionAuth.setUser({
      id:       'user_' + Date.now(),
      name:     email.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),
      email:    email,
      avatar:   `https://i.pravatar.cc/100?u=${email}`,
      plan:     'free',
      provider: 'email',
    });
    EduVisionAuth.redirectToChat();
  });

  /* Clear error style on input */
  [emailInput, passwordInput].forEach(input => {
    input.addEventListener('input', () => input.classList.remove('error'));
  });

  /* ── Helpers ─────────────────────────────────────────────── */
  function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  function showFieldError(id, msg) {
    document.getElementById(id).textContent = msg;
  }
  function clearErrors() {
    document.getElementById('emailError').textContent    = '';
    document.getElementById('passwordError').textContent = '';
    emailInput.classList.remove('error');
    passwordInput.classList.remove('error');
  }

  function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + type + ' show';
    setTimeout(() => { t.className = 'toast'; }, 3500);
  }
});
