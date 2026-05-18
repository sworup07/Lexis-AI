/* ═══════════════════════════════════════════════════════════════
   sidebar.js — Sidebar toggle, chat list management
   Features: toggle (desktop + mobile), search, add, rename,
   delete, right-click context menu, active state.
═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Elements ────────────────────────────────────────────── */
  const app              = document.getElementById('app');
  const sidebar          = document.getElementById('sidebar');
  const sidebarOverlay   = document.getElementById('sidebarOverlay');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const sidebarCloseBtn  = document.getElementById('sidebarCloseBtn');
  const chatHistoryEl    = document.getElementById('chatHistory');
  const searchInput      = document.getElementById('searchChats');
  const searchClear      = document.getElementById('searchClear');
  const contextMenu      = document.getElementById('contextMenu');
  const ctxRename        = document.getElementById('ctxRename');
  const ctxDelete        = document.getElementById('ctxDelete');
  if (!app || !sidebar) return;

  /* ── State ───────────────────────────────────────────────── */
  const isMobile = () => window.innerWidth <= 768;

  /* Chat list — seeded with sample history */
  let chatList = JSON.parse(localStorage.getItem('eduvision_chats') || 'null') || [
    { id: '1', title: 'How is NEB GPA calculated?',      group: 'Today'         },
    { id: '2', title: 'Grade 12 Physics Notes',           group: 'Today'         },
    { id: '3', title: 'Scholarship opportunities Nepal', group: 'Today'         },
    { id: '4', title: 'Chemistry Chapter 5 summary',     group: 'Yesterday'     },
    { id: '5', title: 'IOE entrance exam tips',          group: 'Yesterday'     },
    { id: '6', title: 'Career in Computer Engineering',  group: 'Previous 7 Days' },
    { id: '7', title: 'NEB exam schedule 2024',          group: 'Previous 7 Days' },
    { id: '8', title: 'Mathematics integration notes',   group: 'Previous 7 Days' },
  ];
  let activeChatId   = chatList[0]?.id || null;
  let contextTarget  = null; /* nav-entry that was right-clicked */

  /* ── Persist chat list ───────────────────────────────────── */
  function saveChatList() {
    localStorage.setItem('eduvision_chats', JSON.stringify(chatList));
  }

  /* ── Sidebar open / close ────────────────────────────────── */
  function openSidebar() {
    if (isMobile()) {
      app.classList.add('sidebar-open-mobile');
    } else {
      app.classList.remove('sidebar-collapsed');
    }
  }

  function closeSidebar() {
    if (isMobile()) {
      app.classList.remove('sidebar-open-mobile');
    } else {
      app.classList.add('sidebar-collapsed');
    }
  }

  function toggleSidebar() {
    if (isMobile()) {
      app.classList.contains('sidebar-open-mobile') ? closeSidebar() : openSidebar();
    } else {
      app.classList.contains('sidebar-collapsed') ? openSidebar() : closeSidebar();
    }
  }

  /* Default state */
  if (isMobile()) {
    /* Mobile: sidebar always starts hidden (it's a drawer) */
    app.classList.remove('sidebar-open-mobile');
  } else {
    /* Desktop: start open */
    app.classList.remove('sidebar-collapsed');
  }

  /* Re-run on resize to handle orientation changes */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMobile()) {
        /* Switching to desktop: remove mobile-open class */
        app.classList.remove('sidebar-open-mobile');
      }
    }, 150);
  });

  sidebarToggleBtn?.addEventListener('click', toggleSidebar);
  sidebarCloseBtn?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);

  /* ── Render chat list ────────────────────────────────────── */
  function renderChatList(filter = '') {
    chatHistoryEl.innerHTML = '';
    const query = filter.toLowerCase().trim();

    /* Group chats */
    const groups = {};
    chatList.forEach(chat => {
      if (query && !chat.title.toLowerCase().includes(query)) return;
      if (!groups[chat.group]) groups[chat.group] = [];
      groups[chat.group].push(chat);
    });

    if (Object.keys(groups).length === 0) {
      chatHistoryEl.innerHTML = `<p style="text-align:center;color:var(--text-faint);font-size:13px;padding:24px 8px;">No chats found</p>`;
      return;
    }

    const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days'];
    [...groupOrder, ...Object.keys(groups).filter(g => !groupOrder.includes(g))].forEach(group => {
      if (!groups[group]) return;
      const label = document.createElement('p');
      label.className = 'nav-label';
      label.textContent = group;
      chatHistoryEl.appendChild(label);

      groups[group].forEach(chat => {
        chatHistoryEl.appendChild(buildChatEntry(chat));
      });
    });
  }

  /* Build a single chat entry */
  function buildChatEntry(chat) {
    const entry = document.createElement('div');
    entry.className = 'nav-entry';
    entry.dataset.chatId = chat.id;

    const btn = document.createElement('button');
    btn.className = 'nav-item' + (chat.id === activeChatId ? ' active' : '');
    btn.textContent = chat.title;
    btn.title = chat.title;

    const delBtn = document.createElement('button');
    delBtn.className = 'nav-delete-btn';
    delBtn.title = 'Delete chat';
    delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    entry.appendChild(btn);
    entry.appendChild(delBtn);

    /* ── Click: load chat ─────────────────────────── */
    btn.addEventListener('click', () => loadChat(chat.id));

    /* ── Delete button click ──────────────────────── */
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id, entry);
    });

    /* ── Double-click: rename ─────────────────────── */
    btn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(chat.id, entry);
    });

    /* ── Right-click: context menu ────────────────── */
    entry.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, chat.id, entry);
    });

    return entry;
  }

  /* ── Load a chat ─────────────────────────────────────────── */
  function loadChat(chatId) {
    activeChatId = chatId;
    const chat = chatList.find(c => c.id === chatId);
    if (!chat) return;

    /* Update active class */
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const entry = document.querySelector(`[data-chat-id="${chatId}"] .nav-item`);
    if (entry) entry.classList.add('active');

    /* Tell chat.js to load this chat */
    window.dispatchEvent(new CustomEvent('eduvision:loadChat', { detail: { chatId, title: chat.title } }));

    /* Close sidebar on mobile */
    if (isMobile()) closeSidebar();
  }

  /* ── Add a new chat ──────────────────────────────────────── */
  function addNewChat(title) {
    const newChat = {
      id:    'chat_' + Date.now(),
      title: title || 'New Chat',
      group: 'Today',
    };
    chatList.unshift(newChat);
    saveChatList();
    activeChatId = newChat.id;
    renderChatList();
    return newChat;
  }

  /* ── Delete a chat ───────────────────────────────────────── */
  function deleteChat(chatId, entryEl) {
    /* Animate out */
    if (entryEl) {
      entryEl.style.transition = 'opacity 0.2s, transform 0.2s';
      entryEl.style.opacity = '0';
      entryEl.style.transform = 'translateX(-8px)';
    }
    setTimeout(() => {
      chatList = chatList.filter(c => c.id !== chatId);
      saveChatList();
      /* If deleted chat was active, start fresh */
      if (activeChatId === chatId) {
        activeChatId = chatList[0]?.id || null;
        window.dispatchEvent(new CustomEvent('eduvision:newChat'));
      }
      renderChatList();
    }, 200);
  }

  /* ── Rename a chat (inline) ──────────────────────────────── */
  function startRename(chatId, entryEl) {
    const btn = entryEl.querySelector('.nav-item');
    const chat = chatList.find(c => c.id === chatId);
    if (!btn || !chat) return;

    /* Replace button with input */
    const input = document.createElement('input');
    input.className = 'nav-rename-input';
    input.value = chat.title;
    input.maxLength = 80;
    entryEl.replaceChild(input, btn);

    const delBtn = entryEl.querySelector('.nav-delete-btn');
    if (delBtn) delBtn.style.display = 'none';

    input.focus();
    input.select();

    function finishRename() {
      const newTitle = input.value.trim() || chat.title;
      chat.title = newTitle;
      saveChatList();
      renderChatList();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); finishRename(); }
      if (e.key === 'Escape') { renderChatList(); }
    });
    input.addEventListener('blur', finishRename);
  }

  /* ── Context Menu ────────────────────────────────────────── */
  function showContextMenu(x, y, chatId, entryEl) {
    contextTarget = { chatId, entryEl };
    contextMenu.classList.add('open');

    /* Position — keep within viewport */
    const menuW = 170, menuH = 90;
    const finalX = Math.min(x, window.innerWidth  - menuW - 8);
    const finalY = Math.min(y, window.innerHeight - menuH - 8);
    contextMenu.style.left = finalX + 'px';
    contextMenu.style.top  = finalY + 'px';
  }

  function closeContextMenu() {
    contextMenu.classList.remove('open');
    contextTarget = null;
  }

  ctxRename?.addEventListener('click', () => {
    if (contextTarget) startRename(contextTarget.chatId, contextTarget.entryEl);
    closeContextMenu();
  });

  ctxDelete?.addEventListener('click', () => {
    if (contextTarget) deleteChat(contextTarget.chatId, contextTarget.entryEl);
    closeContextMenu();
  });

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) closeContextMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });

  /* ── Search ──────────────────────────────────────────────── */
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value;
    searchClear.style.display = q ? '' : 'none';
    renderChatList(q);
  });
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    renderChatList();
  });

  /* ── New Chat buttons ────────────────────────────────────── */
  document.getElementById('newChatBtn')?.addEventListener('click', () => {
    activeChatId = null;
    window.dispatchEvent(new CustomEvent('eduvision:newChat'));
    if (isMobile()) closeSidebar();
  });
  document.getElementById('topbarNewChatBtn')?.addEventListener('click', () => {
    activeChatId = null;
    window.dispatchEvent(new CustomEvent('eduvision:newChat'));
  });

  /* ── Listen for auto-title event from chat.js ────────────── */
  window.addEventListener('eduvision:chatTitleUpdate', (e) => {
    const { chatId, title } = e.detail;
    const chat = chatList.find(c => c.id === chatId);
    if (chat && chat.title === 'New Chat') {
      chat.title = title;
      saveChatList();
      renderChatList();
    }
  });

  /* ── Listen for new chat created ─────────────────────────── */
  window.addEventListener('eduvision:chatCreated', (e) => {
    const { chatId, title } = e.detail;
    addNewChat(title);
    /* override the generated ID with the one from chat.js */
    if (chatList[0]) { chatList[0].id = chatId; activeChatId = chatId; saveChatList(); renderChatList(); }
  });

  /* ── Expose for other modules ────────────────────────────── */
  window.EduVisionSidebar = { addNewChat, deleteChat, startRename, loadChat, renderChatList, getActiveChatId: () => activeChatId };

  /* Initial render */
  renderChatList();
});
