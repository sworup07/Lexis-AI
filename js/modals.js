/* ═══════════════════════════════════════════════════════════════
   modals.js — All modal, popover & settings logic
   Modals: Settings (5 tabs), Billing, Appearance, Confirm
   Popovers: User menu
═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('settingsModal')) return;

  /* ── Generic modal open/close ────────────────────────────── */
  function openModal(id) {
    document.getElementById(id)?.classList.add('open');
  }
  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  }

  /* Close on overlay click */
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAllModals();
    });
  });

  /* Close on Escape */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  /* ── Open buttons ─────────────────────────────────────────── */
  document.getElementById('openSettingsBtn')?.addEventListener('click',     () => openModal('settingsModal'));
  document.getElementById('openBillingBtn')?.addEventListener('click',      () => openModal('billingModal'));
  document.getElementById('openThemeBtn')?.addEventListener('click',        () => openModal('themeModal'));
  document.getElementById('popoverSettingsBtn')?.addEventListener('click',  () => { closePopover(); openModal('settingsModal'); });
  document.getElementById('popoverBillingBtn')?.addEventListener('click',   () => { closePopover(); openModal('billingModal'); });
  document.getElementById('popoverProfileBtn')?.addEventListener('click',   () => { closePopover(); openModal('settingsModal'); switchSettingsTab('account'); });
  document.getElementById('upgradeProBtn')?.addEventListener('click',       () => showToast('Redirecting to payment… (connect eSewa/Khalti)'));
  document.getElementById('contactSalesBtn')?.addEventListener('click',     () => showToast('Email us at sales@eduvision.ai'));

  /* ── Close buttons ────────────────────────────────────────── */
  document.getElementById('settingsCloseBtn')?.addEventListener('click', () => closeModal('settingsModal'));
  document.getElementById('billingCloseBtn')?.addEventListener('click',  () => closeModal('billingModal'));
  document.getElementById('themeCloseBtn')?.addEventListener('click',    () => closeModal('themeModal'));

  /* ── Settings tabs ────────────────────────────────────────── */
  function switchSettingsTab(tabName) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tabName)?.classList.add('active');
    document.querySelector(`.modal-nav-item[data-tab="${tabName}"]`)?.classList.add('active');
  }

  document.querySelectorAll('.modal-nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });

  /* ── Billing — monthly/yearly toggle ─────────────────────── */
  document.getElementById('billingToggle')?.addEventListener('change', (e) => {
    const isYearly = e.target.checked;
    const proEl   = document.getElementById('proPrice');
    const teamEl  = document.getElementById('teamPrice');
    if (proEl)  proEl.textContent  = isYearly ? 'NPR 499'  : 'NPR 799';
    if (teamEl) teamEl.textContent = isYearly ? 'NPR 899'  : 'NPR 1,299';
  });

  /* ── User menu popover ────────────────────────────────────── */
  const userMenuBtn  = document.getElementById('userMenuBtn');
  const popover      = document.getElementById('userMenuPopover');
  const userProfile  = document.getElementById('userProfile');

  function openPopover() {
    if (!popover) return;
    popover.classList.add('open');
    /* Position above user profile */
    const rect = (userMenuBtn || userProfile)?.getBoundingClientRect();
    if (rect) {
      const menuH = 200;
      const top   = rect.top - menuH - 8;
      const left  = rect.left;
      popover.style.top  = Math.max(8, top) + 'px';
      popover.style.left = Math.min(left, window.innerWidth - 230) + 'px';
    }
  }

  function closePopover() {
    popover?.classList.remove('open');
  }

  userMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    popover?.classList.contains('open') ? closePopover() : openPopover();
  });

  /* Also open when clicking on user profile row */
  userProfile?.addEventListener('click', (e) => {
    if (e.target.closest('#userMenuBtn')) return;
    openPopover();
  });

  document.addEventListener('click', (e) => {
    if (!popover?.contains(e.target) && !userMenuBtn?.contains(e.target) && !userProfile?.contains(e.target)) {
      closePopover();
    }
  });

  /* ── Sign out ─────────────────────────────────────────────── */
  function signOut() {
    if (typeof EduVisionAuth !== 'undefined') {
      EduVisionAuth.clearUser();
      EduVisionAuth.redirectToLogin();
    } else {
      window.location.href = 'index.html';
    }
  }

  document.getElementById('settingsSignOutBtn')?.addEventListener('click', signOut);
  document.getElementById('popoverSignOutBtn')?.addEventListener('click',  () => {
    closePopover();
    signOut();
  });

  /* ── Account settings — save changes ─────────────────────── */
  document.getElementById('saveAccountBtn')?.addEventListener('click', () => {
    const nameInput  = document.getElementById('settingsNameInput');
    const emailInput = document.getElementById('settingsEmailInput');
    const newName    = nameInput?.value.trim();
    const newEmail   = emailInput?.value.trim();

    if (!newName) { showToast('Name cannot be empty', 'error'); return; }
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('Enter a valid email address', 'error');
      return;
    }

    /* Update in auth state */
    if (typeof EduVisionAuth !== 'undefined') {
      const user = EduVisionAuth.getUser();
      if (user) {
        user.name  = newName  || user.name;
        user.email = newEmail || user.email;
        EduVisionAuth.setUser(user);

        /* Update all visible UI */
        document.getElementById('sidebarUserName').textContent   = user.name;
        document.getElementById('sidebarUserEmail').textContent  = user.email;
        document.getElementById('settingsAccountName').textContent  = user.name;
        document.getElementById('settingsAccountEmail').textContent = user.email;
        document.getElementById('popoverName').textContent  = user.name;
        document.getElementById('popoverEmail').textContent = user.email;
      }
    }

    showToast('Profile updated successfully!', 'success');
  });

  /* ── Privacy — Clear all chat history ────────────────────── */
  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
    showConfirm(
      'Clear All Chat History?',
      'This will permanently delete all your chat conversations. This action cannot be undone.',
      () => {
        localStorage.removeItem('eduvision_chats');
        /* Reset chat list in sidebar */
        if (window.EduVisionSidebar) {
          /* Clear and re-render with empty list */
          window.dispatchEvent(new CustomEvent('eduvision:newChat'));
          document.getElementById('chatHistory').innerHTML =
            `<p style="text-align:center;color:var(--text-faint);font-size:13px;padding:24px 8px;">No chats yet. Start a new conversation!</p>`;
        }
        closeModal('settingsModal');
        showToast('All chat history cleared', 'success');
      }
    );
  });

  /* ── Privacy — Delete account ────────────────────────────── */
  document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
    showConfirm(
      'Delete Account?',
      'This will permanently delete your account and all associated data. You will be signed out immediately.',
      () => {
        localStorage.clear();
        showToast('Account deleted');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1500);
      }
    );
  });

  /* ── Confirm dialog ───────────────────────────────────────── */
  let confirmCallback = null;

  function showConfirm(title, message, onConfirm) {
    document.getElementById('confirmTitle').textContent   = title;
    document.getElementById('confirmMessage').textContent = message;
    confirmCallback = onConfirm;
    openModal('confirmModal');
  }

  document.getElementById('confirmOkBtn')?.addEventListener('click', () => {
    closeModal('confirmModal');
    if (typeof confirmCallback === 'function') confirmCallback();
    confirmCallback = null;
  });

  document.getElementById('confirmCancelBtn')?.addEventListener('click', () => {
    closeModal('confirmModal');
    confirmCallback = null;
  });

  /* ── Notification toggles — request browser permission ────── */
  document.getElementById('desktopNotifToggle')?.addEventListener('change', async (e) => {
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

  /* ── Expose showConfirm globally (usable from other files) ── */
  window.showConfirm = showConfirm;

  /* ── Toast (fallback if chat.js hasn't defined it yet) ─────── */
  if (!window.showToast) {
    window.showToast = function(msg, type = '') {
      const t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg;
      t.className = 'toast ' + type + ' show';
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
    };
  }
});
