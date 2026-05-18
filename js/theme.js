/* ═══════════════════════════════════════════════════════════════
   theme.js — Theme & Accent Color System
   All theme state is persisted to localStorage automatically.
═══════════════════════════════════════════════════════════════ */

const EduVisionTheme = (() => {
  /* Accent color definitions */
  const ACCENTS = {
    cyan:   { accent:'#00d4ff', dim:'rgba(0,212,255,0.12)',  glow:'rgba(0,212,255,0.3)',  text:'#000' },
    violet: { accent:'#7c3aed', dim:'rgba(124,58,237,0.12)', glow:'rgba(124,58,237,0.3)', text:'#fff' },
    green:  { accent:'#10a37f', dim:'rgba(16,163,127,0.12)', glow:'rgba(16,163,127,0.3)', text:'#fff' },
    orange: { accent:'#f97316', dim:'rgba(249,115,22,0.12)', glow:'rgba(249,115,22,0.3)', text:'#000' },
    pink:   { accent:'#ec4899', dim:'rgba(236,72,153,0.12)', glow:'rgba(236,72,153,0.3)', text:'#fff' },
  };

  let currentTheme  = localStorage.getItem('eduvision-theme')  || 'dark';
  let currentAccent = localStorage.getItem('eduvision-accent') || 'cyan';

  /* ── Apply theme ─────────────────────────────────────────── */
  function applyTheme(theme) {
    currentTheme = theme;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

    /* Update topbar icons */
    const sunIcon  = document.getElementById('topbarSunIcon');
    const moonIcon = document.getElementById('topbarMoonIcon');
    if (sunIcon)  sunIcon.style.display  = isDark ? 'none' : '';
    if (moonIcon) moonIcon.style.display = isDark ? ''     : 'none';

    /* Highlight active theme option buttons across all pickers */
    document.querySelectorAll('[data-theme-option]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeOption === theme);
    });

    localStorage.setItem('eduvision-theme', theme);
  }

  /* ── Apply accent color ──────────────────────────────────── */
  function applyAccent(colorKey) {
    const c = ACCENTS[colorKey];
    if (!c) return;
    currentAccent = colorKey;
    const root = document.documentElement;
    root.style.setProperty('--accent',      c.accent);
    root.style.setProperty('--accent-dim',  c.dim);
    root.style.setProperty('--accent-glow', c.glow);
    root.style.setProperty('--accent-text', c.text);

    /* Sync all swatch buttons */
    document.querySelectorAll('.swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === colorKey);
    });

    localStorage.setItem('eduvision-accent', colorKey);
  }

  /* ── Apply font size ─────────────────────────────────────── */
  function applyFontSize(px) {
    document.documentElement.style.setProperty('--font-size', px + 'px');
    document.querySelectorAll('.font-size-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.size) === parseInt(px));
    });
    localStorage.setItem('eduvision-fontsize', px);
  }

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    applyTheme(currentTheme);
    applyAccent(currentAccent);
    const savedFontSize = localStorage.getItem('eduvision-fontsize');
    if (savedFontSize) applyFontSize(savedFontSize);

    /* Listen for system theme changes when using "system" mode */
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentTheme === 'system') applyTheme('system');
    });

    /* Topbar theme toggle button */
    document.getElementById('topbarThemeBtn')?.addEventListener('click', () => {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });

    /* All [data-theme-option] buttons */
    document.addEventListener('click', (e) => {
      const themeBtn = e.target.closest('[data-theme-option]');
      if (themeBtn) applyTheme(themeBtn.dataset.themeOption);

      const swatchBtn = e.target.closest('.swatch');
      if (swatchBtn) applyAccent(swatchBtn.dataset.color);

      const fontBtn = e.target.closest('.font-size-btn');
      if (fontBtn) applyFontSize(fontBtn.dataset.size);
    });
  }

  return { init, applyTheme, applyAccent, applyFontSize, getTheme: () => currentTheme, getAccent: () => currentAccent };
})();

/* Auto-init when DOM is ready */
document.addEventListener('DOMContentLoaded', () => EduVisionTheme.init());
