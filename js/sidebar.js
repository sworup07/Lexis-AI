/* ═══════════════════════════════════════════════════════════════
   sidebar.js — Sidebar toggle & real chat history management
   CHANGES: No fake seed data. Loads real chats from ChatStorage.
            Uses lexis: events. Syncs per-user chat list.
═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {

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

  const isMobile = () => window.innerWidth <= 768;

  /* ── Get userId for per-user storage ───────────────────────── */
  let currentUserId = null;
  if (typeof LexisAuth !== 'undefined') {
    const user = await LexisAuth.getUser();
    currentUserId = user?.id || null;
  }

  function storageKey() { return `lexis_chats_${currentUserId || 'guest'}`; }

  /* ── Load real chats (no fake seed data) ───────────────────── */
  let chatList = [];
  try {
    chatList = JSON.parse(localStorage.getItem(storageKey()) || '[]');
  } catch { chatList = []; }

  let activeChatId  = null;
  let contextTarget = null;

  function saveChatList() {
    localStorage.setItem(storageKey(), JSON.stringify(chatList));
  }

  /* ── Sidebar open / close ──────────────────────────────────── */
  function openSidebar() {
    if (isMobile()) app.classList.add('sidebar-open-mobile');
    else            app.classList.remove('sidebar-collapsed');
  }
  function closeSidebar() {
    if (isMobile()) app.classList.remove('sidebar-open-mobile');
    else            app.classList.add('sidebar-collapsed');
  }
  function toggleSidebar() {
    if (isMobile()) app.classList.toggle('sidebar-open-mobile');
    else            app.classList.toggle('sidebar-collapsed');
  }

  if (!isMobile()) app.classList.remove('sidebar-collapsed');

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMobile()) app.classList.remove('sidebar-open-mobile');
    }, 150);
  });

  sidebarToggleBtn?.addEventListener('click', toggleSidebar);
  sidebarCloseBtn?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);

  /* ── Helpers ────────────────────────────────────────────────── */
  function getChatGroup(createdAt) {
    const now  = Date.now();
    const diff = now - (createdAt || now);
    const days = diff / (1000 * 60 * 60 * 24);
    if (days < 1)   return 'Today';
    if (days < 2)   return 'Yesterday';
    if (days < 7)   return 'Previous 7 Days';
    if (days < 30)  return 'Previous 30 Days';
    return 'Older';
  }

  /* ── Render chat list ────────────────────────────────────────── */
  function renderChatList(filter) {
    chatHistoryEl.innerHTML = '';
    const query = (filter || '').toLowerCase().trim();

    if (chatList.length === 0 && !query) {
      chatHistoryEl.innerHTML = '<p style="text-align:center;color:var(--text-faint);font-size:13px;padding:24px 8px">No chats yet. Start a new conversation!</p>';
      return;
    }

    const groups = {};
    chatList.forEach(chat => {
      if (query && !chat.title.toLowerCase().includes(query)) return;
      const group = getChatGroup(chat.createdAt);
      if (!groups[group]) groups[group] = [];
      groups[group].push(chat);
    });

    if (Object.keys(groups).length === 0) {
      chatHistoryEl.innerHTML = '<p style="text-align:center;color:var(--text-faint);font-size:13px;padding:24px 8px">No chats found</p>';
      return;
    }

    const order = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'];
    [...order, ...Object.keys(groups).filter(g => !order.includes(g))].forEach(group => {
      if (!groups[group]) return;
      const label = document.createElement('p');
      label.className = 'nav-label';
      label.textContent = group;
      chatHistoryEl.appendChild(label);
      groups[group].forEach(chat => chatHistoryEl.appendChild(buildChatEntry(chat)));
    });
  }

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
    delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    entry.appendChild(btn);
    entry.appendChild(delBtn);

    btn.addEventListener('click', () => loadChat(chat.id));
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(chat.id, entry); });
    btn.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(chat.id, entry); });
    entry.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, chat.id, entry); });

    return entry;
  }

  function loadChat(chatId) {
    activeChatId = chatId;
    const chat = chatList.find(c => c.id === chatId);
    if (!chat) return;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const entry = document.querySelector('[data-chat-id="' + chatId + '"] .nav-item');
    if (entry) entry.classList.add('active');
    window.dispatchEvent(new CustomEvent('lexis:loadChat', { detail: { chatId, title: chat.title } }));
    if (isMobile()) closeSidebar();
  }

  function addNewChat(title, chatId, createdAt) {
    const newChat = {
      id:        chatId || ('chat_' + Date.now()),
      title:     title || 'New Chat',
      createdAt: createdAt || Date.now(),
    };
    // Avoid duplicates
    if (!chatList.find(c => c.id === newChat.id)) {
      chatList.unshift(newChat);
      saveChatList();
    }
    activeChatId = newChat.id;
    renderChatList();
    return newChat;
  }

  function deleteChat(chatId, entryEl) {
    if (entryEl) {
      entryEl.style.transition = 'opacity 0.2s, transform 0.2s';
      entryEl.style.opacity    = '0';
      entryEl.style.transform  = 'translateX(-8px)';
    }
    setTimeout(() => {
      // Remove messages from storage too
      localStorage.removeItem('lexis_msgs_' + (currentUserId || 'guest') + '_' + chatId);
      chatList = chatList.filter(c => c.id !== chatId);
      saveChatList();
      if (activeChatId === chatId) {
        activeChatId = null;
        window.dispatchEvent(new CustomEvent('lexis:newChat'));
      }
      renderChatList();
    }, 200);
  }

  function startRename(chatId, entryEl) {
    const btn  = entryEl.querySelector('.nav-item');
    const chat = chatList.find(c => c.id === chatId);
    if (!btn || !chat) return;

    const input = document.createElement('input');
    input.className = 'nav-rename-input';
    input.value     = chat.title;
    input.maxLength = 80;
    entryEl.replaceChild(input, btn);
    const delBtn = entryEl.querySelector('.nav-delete-btn');
    if (delBtn) delBtn.style.display = 'none';
    input.focus(); input.select();

    function finish() {
      chat.title = input.value.trim() || chat.title;
      saveChatList();
      renderChatList();
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(); }
      if (e.key === 'Escape') renderChatList();
    });
    input.addEventListener('blur', finish);
  }

  /* ── Context menu ─────────────────────────────────────────── */
  function showContextMenu(x, y, chatId, entryEl) {
    contextTarget = { chatId, entryEl };
    contextMenu.classList.add('open');
    contextMenu.style.left = Math.min(x, window.innerWidth  - 178) + 'px';
    contextMenu.style.top  = Math.min(y, window.innerHeight - 100) + 'px';
  }
  function closeContextMenu() { contextMenu.classList.remove('open'); contextTarget = null; }

  ctxRename?.addEventListener('click', () => { if (contextTarget) startRename(contextTarget.chatId, contextTarget.entryEl); closeContextMenu(); });
  ctxDelete?.addEventListener('click', () => { if (contextTarget) deleteChat(contextTarget.chatId, contextTarget.entryEl); closeContextMenu(); });
  document.addEventListener('click',   (e) => { if (!contextMenu.contains(e.target)) closeContextMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });

  /* ── Search ───────────────────────────────────────────────── */
  searchInput?.addEventListener('input', () => {
    if (searchClear) searchClear.style.display = searchInput.value ? '' : 'none';
    renderChatList(searchInput.value);
  });
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';
    renderChatList();
  });

  /* ── New chat buttons ─────────────────────────────────────── */
  document.getElementById('newChatBtn')?.addEventListener('click', () => {
    activeChatId = null;
    window.dispatchEvent(new CustomEvent('lexis:newChat'));
    if (isMobile()) closeSidebar();
  });
  document.getElementById('topbarNewChatBtn')?.addEventListener('click', () => {
    activeChatId = null;
    window.dispatchEvent(new CustomEvent('lexis:newChat'));
  });

  /* ── Events from chat.js ──────────────────────────────────── */
  window.addEventListener('lexis:chatCreated', (e) => {
    const { chatId, title } = e.detail;
    addNewChat(title, chatId, Date.now());
  });

  window.addEventListener('lexis:chatTitleUpdate', (e) => {
    const { chatId, title } = e.detail;
    const chat = chatList.find(c => c.id === chatId);
    if (chat) { chat.title = title; saveChatList(); renderChatList(); }
  });

  /* ── Expose globally ──────────────────────────────────────── */
  window.LexisSidebar    = { addNewChat, deleteChat, startRename, loadChat, renderChatList, getActiveChatId: () => activeChatId };
  window.EduVisionSidebar = window.LexisSidebar;

  renderChatList();
});