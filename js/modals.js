/* ═══════════════════════════════════════════════════════════════
   modals.js — All modal, popover & settings logic
   Modals: Settings (5 tabs), Billing, Appearance, Confirm
   Popovers: User menu
═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('settingsModal')) return;

  const $ = id => document.getElementById(id);

  /* ── Generic modal helpers ────────────────────────────────── */
  function openModal(id)   { $(id)?.classList.add('open');    }
  function closeModal(id)  { $(id)?.classList.remove('open'); }
  function closeAllModals(){ document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAllModals(); });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

  /* ── Open buttons ─────────────────────────────────────────── */
  $('openSettingsBtn')?.addEventListener('click',    () => openModal('settingsModal'));
  $('openBillingBtn')?.addEventListener('click',     () => openModal('billingModal'));
  $('openThemeBtn')?.addEventListener('click',       () => openModal('themeModal'));
  $('upgradeProBtn')?.addEventListener('click',      () => showToast('Redirecting to payment… (connect eSewa/Khalti)'));
  $('contactSalesBtn')?.addEventListener('click',    () => showToast('Email us at sales@lexis.ai'));

  $('popoverSettingsBtn')?.addEventListener('click', () => { closePopover(); openModal('settingsModal'); });
  $('popoverBillingBtn')?.addEventListener('click',  () => { closePopover(); openModal('billingModal'); });
  $('popoverProfileBtn')?.addEventListener('click',  () => { closePopover(); openModal('settingsModal'); switchSettingsTab('account'); });

  /* ── Close buttons ────────────────────────────────────────── */
  $('settingsCloseBtn')?.addEventListener('click', () => closeModal('settingsModal'));
  $('billingCloseBtn')?.addEventListener('click',  () => closeModal('billingModal'));
  $('themeCloseBtn')?.addEventListener('click',    () => closeModal('themeModal'));

  /* ── Settings tabs ────────────────────────────────────────── */
  function switchSettingsTab(tabName) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-nav-item').forEach(b => b.classList.remove('active'));
    $('tab-' + tabName)?.classList.add('active');
    document.querySelector('.modal-nav-item[data-tab="' + tabName + '"]')?.classList.add('active');
  }

  document.querySelectorAll('.modal-nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });

  /* ── Billing toggle ───────────────────────────────────────── */
  $('billingToggle')?.addEventListener('change', (e) => {
    const yearly = e.target.checked;
    const pro  = $('proPrice');
    const team = $('teamPrice');
    if (pro)  pro.textContent  = yearly ? 'NPR 499'   : 'NPR 799';
    if (team) team.textContent = yearly ? 'NPR 899'   : 'NPR 1,299';
  });

  /* ── User menu popover ────────────────────────────────────── */
  const userMenuBtn = $('userMenuBtn');
  const popover     = $('userMenuPopover');
  const userProfile = $('userProfile');

  function openPopover() {
    if (!popover) return;
    popover.classList.add('open');
    const anchor = userMenuBtn || userProfile;
    if (anchor) {
      const rect  = anchor.getBoundingClientRect();
      const top   = rect.top - 216 - 8;
      const left  = rect.left;
      popover.style.top  = Math.max(8, top) + 'px';
      popover.style.left = Math.min(left, window.innerWidth - 230) + 'px';
    }
  }
  function closePopover() { popover?.classList.remove('open'); }

  userMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    popover?.classList.contains('open') ? closePopover() : openPopover();
  });
  userProfile?.addEventListener('click', (e) => {
    if (e.target.closest('#userMenuBtn')) return;
    openPopover();
  });
  document.addEventListener('click', (e) => {
    if (!popover?.contains(e.target) && !userMenuBtn?.contains(e.target) && !userProfile?.contains(e.target)) {
      closePopover();
    }
  });

  /* ── Sign Out ─────────────────────────────────────────────── */
  async function signOut() {
    if (typeof LexisAuth !== 'undefined') {
      await LexisAuth.signOut();
    } else {
      window.location.href = 'index.html';
    }
  }

  $('settingsSignOutBtn')?.addEventListener('click', signOut);
  $('popoverSignOutBtn')?.addEventListener('click', () => { closePopover(); signOut(); });

  /* ── Account settings save ────────────────────────────────── */
  $('saveAccountBtn')?.addEventListener('click', async () => {
    const nameInput  = $('settingsNameInput');
    const emailInput = $('settingsEmailInput');
    const newName    = nameInput?.value.trim();
    const newEmail   = emailInput?.value.trim();

    if (!newName) { showToast('Name cannot be empty', 'error'); return; }
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('Enter a valid email address', 'error'); return;
    }

    /* Update in Supabase profiles table */
    if (typeof LexisAuth !== 'undefined') {
      try {
        const user = await LexisAuth.getUser();
        if (user) {
          const sb = window._lexisSB || (window.supabase && window.supabase.createClient && null);
          /* Re-fetch getSB from auth.js scope via LexisAuth */
          const profile = await LexisAuth.getUserProfile();
          if (profile) {
            /* Update displayed UI */
            const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
            set('sidebarUserName',        newName  || profile.name);
            set('sidebarUserEmail',       newEmail || profile.email);
            set('settingsAccountName',    newName  || profile.name);
            set('settingsAccountEmail',   newEmail || profile.email);
            set('popoverName',            newName  || profile.name);
            set('popoverEmail',           newEmail || profile.email);
          }
        }
      } catch (err) {
        console.warn('Profile update error:', err);
      }
    }
    showToast('Profile updated!', 'success');
  });

  /* ── Clear chat history ───────────────────────────────────── */
  $('clearHistoryBtn')?.addEventListener('click', () => {
    showConfirm(
      'Clear All Chat History?',
      'This will permanently delete all your chat conversations. This action cannot be undone.',
      async () => {
        if (window.LexisSidebar) {
          await window.LexisSidebar.clearAllChats();
          window.dispatchEvent(new CustomEvent('lexis:newChat'));
        }
        closeModal('settingsModal');
        showToast('All chat history cleared', 'success');
      }
    );
  });

  /* ── Delete account ───────────────────────────────────────── */
  $('deleteAccountBtn')?.addEventListener('click', () => {
    showConfirm(
      'Delete Account?',
      'This will permanently delete your account and all associated data. You will be signed out immediately.',
      async () => {
        localStorage.clear();
        if (typeof LexisAuth !== 'undefined') await LexisAuth.signOut();
        else window.location.href = 'index.html';
      }
    );
  });

  /* ── Confirm dialog ───────────────────────────────────────── */
  let confirmCallback = null;

  function showConfirm(title, message, onConfirm) {
    const titleEl = $('confirmTitle'), msgEl = $('confirmMessage');
    if (titleEl) titleEl.textContent   = title;
    if (msgEl)   msgEl.textContent     = message;
    confirmCallback = onConfirm;
    openModal('confirmModal');
  }

  $('confirmOkBtn')?.addEventListener('click', () => {
    closeModal('confirmModal');
    if (typeof confirmCallback === 'function') confirmCallback();
    confirmCallback = null;
  });
  $('confirmCancelBtn')?.addEventListener('click', () => {
    closeModal('confirmModal');
    confirmCallback = null;
  });

  /* ── Desktop notification toggle ──────────────────────────── */
  $('desktopNotifToggle')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      if (Notification?.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result !== 'granted') {
          e.target.checked = false;
          showToast('Notification permission denied');
        } else {
          showToast('Desktop notifications enabled', 'success');
        }
      } else if (Notification?.permission === 'denied') {
        e.target.checked = false;
        showToast('Notifications blocked — check browser settings');
      }
    } else {
      showToast('Desktop notifications disabled');
    }
  });

  /* ── Expose globally ──────────────────────────────────────── */
  window.showConfirm = showConfirm;

  if (!window.showToast) {
    window.showToast = function(msg, type) {
      const t = $('toast');
      if (!t) return;
      t.textContent = msg;
      t.className   = 'toast ' + (type || '') + ' show';
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
    };
  }
});