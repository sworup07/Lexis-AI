/* ═══════════════════════════════════════════════════════════════
   theme.js — Theme & Accent Color System
   All theme state is persisted to localStorage automatically.
═══════════════════════════════════════════════════════════════ */

const LexisTheme = (() => {

  const ACCENTS = {
    cyan:   { accent:'#00d4ff', dim:'rgba(0,212,255,0.12)',  glow:'rgba(0,212,255,0.3)',  text:'#000' },
    violet: { accent:'#7c3aed', dim:'rgba(124,58,237,0.12)', glow:'rgba(124,58,237,0.3)', text:'#fff' },
    green:  { accent:'#10a37f', dim:'rgba(16,163,127,0.12)', glow:'rgba(16,163,127,0.3)', text:'#fff' },
    orange: { accent:'#f97316', dim:'rgba(249,115,22,0.12)', glow:'rgba(249,115,22,0.3)', text:'#000' },
    pink:   { accent:'#ec4899', dim:'rgba(236,72,153,0.12)', glow:'rgba(236,72,153,0.3)', text:'#fff' },
  };

  let currentTheme  = localStorage.getItem('lexis-theme')  || 'dark';
  let currentAccent = localStorage.getItem('lexis-accent') || 'cyan';

  function applyTheme(theme) {
    currentTheme = theme;
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

    const sun  = document.getElementById('topbarSunIcon');
    const moon = document.getElementById('topbarMoonIcon');
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? '' : 'none';

    document.querySelectorAll('[data-theme-option]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeOption === theme);
    });

    localStorage.setItem('lexis-theme', theme);
  }

  function applyAccent(colorKey) {
    const c = ACCENTS[colorKey];
    if (!c) return;
    currentAccent = colorKey;
    const root = document.documentElement;
    root.style.setProperty('--accent',      c.accent);
    root.style.setProperty('--accent-dim',  c.dim);
    root.style.setProperty('--accent-glow', c.glow);
    root.style.setProperty('--accent-text', c.text);

    document.querySelectorAll('.swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === colorKey);
    });

    localStorage.setItem('lexis-accent', colorKey);
  }

  function applyFontSize(px) {
    document.documentElement.style.setProperty('--font-size', px + 'px');
    document.querySelectorAll('.font-size-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.size) === parseInt(px));
    });
    localStorage.setItem('lexis-fontsize', px);
  }

  function init() {
    applyTheme(currentTheme);
    applyAccent(currentAccent);
    const savedSize = localStorage.getItem('lexis-fontsize');
    if (savedSize) applyFontSize(savedSize);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentTheme === 'system') applyTheme('system');
    });

    document.getElementById('topbarThemeBtn')?.addEventListener('click', () => {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });

    document.querySelectorAll('[data-toggle-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
      });
    });

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

/* Alias for any legacy references */
const EduVisionTheme = LexisTheme;

document.addEventListener('DOMContentLoaded', () => LexisTheme.init());