/* ═══════════════════════════════════════════════════════════════
   chat.js — Lexis AI Chat Interface
   ─────────────────────────────────────────────────────────────
   SECURITY FIX: this file no longer talks to OpenRouter directly
   and no longer holds an API key. It calls our own Supabase Edge
   Function (ai-chat) instead, authenticated with the signed-in
   user's session token. The OpenRouter key and the system prompt
   both live server-side now, in supabase/functions/ai-chat/index.ts.
   ─────────────────────────────────────────────────────────────── */
const API_CONFIG = {
  // SUPABASE_URL is declared in auth.js, which loads before this
  // file — classic <script> tags share the same top-level scope,
  // so it's already available here without redeclaring it.
  endpoint: `${SUPABASE_URL}/functions/v1/ai-chat`,
};

/* ─────────────────────────────────────────────────────────────
   Build the request payload for the edge function.
   No system prompt, no API key, no model whitelist here — the
   edge function owns all of that server-side.
─────────────────────────────────────────────────────────────── */
function buildPayload(conversationHistory) {
  return { messages: conversationHistory };
}

/* ─────────────────────────────────────────────────────────────
   Parse the response from the edge function
   (it forwards OpenRouter's OpenAI-compatible response shape)
─────────────────────────────────────────────────────────────── */
function parseResponse(json) {
  return json?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response. Please try again.';
}

/* ─────────────────────────────────────────────────────────────
   Call the AI via our Supabase Edge Function
─────────────────────────────────────────────────────────────── */
async function callAI(conversationHistory, signal) {
  const token = (typeof LexisAuth !== 'undefined') ? await LexisAuth.getAccessToken() : null;
  if (!token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  let res;
  try {
    res = await fetch(API_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body:   JSON.stringify(buildPayload(conversationHistory)),
      signal: signal,
    });
  } catch (networkErr) {
    if (networkErr.name === 'AbortError') throw networkErr;
    throw new Error('Network error — check your internet connection.');
  }

  if (!res.ok) {
    // Our edge function returns { error: "message" } — a plain string,
    // not OpenRouter's nested { error: { message } } shape.
    let errMsg = 'Something went wrong (error ' + res.status + ').';
    try { const j = await res.json(); errMsg = j?.error || errMsg; } catch (_) {}
    if (res.status === 401) errMsg = 'Your session has expired. Please sign in again.';
    if (res.status === 503) errMsg = 'Model temporarily unavailable. Try again shortly.';
    // Note: 429 is left as-is — the edge function already returns a specific
    // "hourly limit of N messages" message, which is more useful than a
    // generic one here.
    throw new Error(errMsg);
  }

  const json = await res.json();
  return parseResponse(json);
}


/* ════════════════════════════════════════════════════════════════
   Chat Storage — per-user chat history in Supabase (chat_messages
   table). Falls back to doing nothing gracefully if not signed in
   or the client isn't ready, so the UI never throws.
════════════════════════════════════════════════════════════════ */
const ChatStorage = (() => {
  function getClient() {
    return (typeof LexisAuth !== 'undefined') ? LexisAuth.getClient() : null;
  }

  async function loadMessages(chatId, userId) {
    const sb = getClient();
    if (!sb || !userId || !chatId) return [];
    const { data, error } = await sb
      .from('chat_messages')
      .select('role, content')
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) { console.warn('loadMessages error:', error.message); return []; }
    return data.map(row => ({ role: row.role, content: row.content }));
  }

  // Appends only the newest message (the one not yet saved) instead of
  // rewriting the whole conversation — cheaper and avoids duplicate rows.
  async function appendMessage(chatId, userId, message) {
    const sb = getClient();
    if (!sb || !userId || !chatId) return;
    const { error } = await sb.from('chat_messages').insert({
      chat_id: chatId,
      user_id: userId,
      role:    message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    });
    if (error) console.warn('appendMessage error:', error.message);
  }

  // Used by "regenerate": removes the most recent assistant reply for
  // this chat so we don't end up with duplicate rows in the table.
  async function deleteLastAssistantMessage(chatId, userId) {
    const sb = getClient();
    if (!sb || !userId || !chatId) return;
    const { data, error } = await sb
      .from('chat_messages')
      .select('id')
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) { console.warn('deleteLastAssistantMessage select error:', error.message); return; }
    if (data?.[0]?.id) {
      const { error: delErr } = await sb.from('chat_messages').delete().eq('id', data[0].id);
      if (delErr) console.warn('deleteLastAssistantMessage delete error:', delErr.message);
    }
  }

  return { loadMessages, appendMessage, deleteLastAssistantMessage };
})();


/* ════════════════════════════════════════════════════════════════
   Chat UI — main DOMContentLoaded handler
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('chatArea')) return;

  /* ── Auth guard (fast — reads from localStorage cache) ──── */
  let currentUserId = null;
  let isGuestUser    = false;
  if (typeof LexisAuth !== 'undefined') {
    const user = await LexisAuth.getUser();
    if (!user) { LexisAuth.redirectToLogin(); return; }
    currentUserId = user.id;
    isGuestUser   = !!user.is_anonymous;
  }

  /* ── Guest login-encouragement popup ─────────────────────── */
  const guestPopup      = document.getElementById('guestPopup');
  const guestPopupClose = document.getElementById('guestPopupClose');
  const guestPopupSignIn = document.getElementById('guestPopupSignIn');
  const GUEST_POPUP_DISMISSED_KEY = 'lexis_guest_popup_dismissed';

  if (isGuestUser && guestPopup && localStorage.getItem(GUEST_POPUP_DISMISSED_KEY) !== 'true') {
    setTimeout(() => guestPopup.classList.add('show'), 3000);
  }
  guestPopupClose?.addEventListener('click', () => {
    guestPopup?.classList.remove('show');
    localStorage.setItem(GUEST_POPUP_DISMISSED_KEY, 'true');
  });
  guestPopupSignIn?.addEventListener('click', async () => {
    try {
      if (typeof LexisAuth !== 'undefined') await LexisAuth.upgradeGuestToGoogle();
    } catch (err) {
      console.warn('upgradeGuestToGoogle failed, falling back to a fresh sign-in:', err.message);
      try {
        showToast?.('Signing in — this guest chat history won\'t carry over.', 'error');
        if (typeof LexisAuth !== 'undefined') await LexisAuth.signInWithGoogle();
      } catch (err2) {
        showToast?.(err2.message || 'Sign-in failed. Try again.', 'error');
      }
    }
  });

  /* ── Elements ─────────────────────────────────────────────── */
  const chatArea   = document.getElementById('chatArea');
  const messagesEl = document.getElementById('messages');
  const welcomeEl  = document.getElementById('welcomeScreen');
  const chatInput  = document.getElementById('chatInput');
  const sendBtn    = document.getElementById('sendBtn');
  const sendIcon   = document.getElementById('sendIcon');
  const voiceBtn   = document.getElementById('voiceBtn');
  const attachBtn  = document.getElementById('attachBtn');
  const shareBtn   = document.getElementById('shareBtn');

  const modelSelector = document.getElementById('modelSelector');
  const modelDropdown = document.getElementById('modelDropdown');
  const modelNameEl   = document.getElementById('modelName');

  /* ── State ───────────────────────────────────────────────── */
  let isStreaming       = false;
  let streamController  = null;
  let isRecording       = false;
  let speechRecognition = null;
  let currentChatId     = null;          // null = no active chat yet
  let conversationHistory = [];          // [{role:'user'|'assistant', content:'...'}]
  let currentModel      = 'lexis-standard';
  let enterSendsMessage = true;

  /* ── Settings sync ───────────────────────────────────────── */
  document.getElementById('enterSendToggle')?.addEventListener('change', (e) => {
    enterSendsMessage = e.target.checked;
  });

  /* ── Model selector ──────────────────────────────────────── */
  modelSelector?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = modelDropdown.classList.contains('open');
    modelSelector.classList.toggle('open', !isOpen);
    modelDropdown.classList.toggle('open', !isOpen);
  });

  document.querySelectorAll('.model-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const model = opt.dataset.model;
      // Pro-only models check
      if (model === 'eduvision-pro' || model === 'eduvision-research') {
        showToast('Upgrade to Pro to use this model');
        modelDropdown.classList.remove('open');
        modelSelector.classList.remove('open');
        return;
      }
      document.querySelectorAll('.model-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      modelNameEl.textContent = opt.querySelector('.model-option-name').textContent;
      currentModel = model;
      modelDropdown.classList.remove('open');
      modelSelector.classList.remove('open');
    });
  });

  document.addEventListener('click', (e) => {
    if (!modelSelector?.contains(e.target)) {
      modelDropdown?.classList.remove('open');
      modelSelector?.classList.remove('open');
    }
  });

  /* ── Input auto-resize ───────────────────────────────────── */
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    updateSendBtn();
  });

  /* ── Send on Enter ───────────────────────────────────────── */
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (!enterSendsMessage) return;
      e.preventDefault();
      if (isStreaming) { stopGeneration(); return; }
      if (!sendBtn.disabled) handleSend();
    }
  });

  sendBtn.addEventListener('click', () => {
    if (isStreaming) { stopGeneration(); return; }
    handleSend();
  });

  function updateSendBtn() {
    const hasText = chatInput.value.trim() !== '';
    if (isStreaming) {
      sendBtn.disabled = false;
      sendBtn.classList.add('stop-mode');
      sendIcon.innerHTML = `<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>`;
    } else {
      sendBtn.disabled = !hasText;
      sendBtn.classList.remove('stop-mode');
      sendIcon.innerHTML = `<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>`;
    }
  }

  function stopGeneration() {
    if (streamController) streamController.abort();
    isStreaming = false;
    updateSendBtn();
    showToast('Generation stopped');
  }

  function handleSend() {
    const text = chatInput.value.trim();
    if (!text || isStreaming) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateSendBtn();
    sendMessage(text);
  }

  /* ── Send message + get AI response ─────────────────────── */
  async function sendMessage(text) {
    welcomeEl.style.display = 'none';

    // Create a new chat in the sidebar if this is the first message
    if (!currentChatId) {
      currentChatId = 'chat_' + Date.now();
      const autoTitle = text.length > 45 ? text.slice(0, 45) + '…' : text;

      // Tell sidebar to add it (sidebar.js inserts the row into
      // the `chats` table itself when it receives this event)
      window.dispatchEvent(new CustomEvent('lexis:chatCreated', {
        detail: { chatId: currentChatId, title: autoTitle },
      }));
    }

    // Render user message
    const userAvatar = window._lexisUserAvatar || 'https://i.pravatar.cc/100?u=default';
    addMessage('user', text, false, userAvatar);

    // Add to conversation history for multi-turn context
    conversationHistory.push({ role: 'user', content: text });

    // Save messages to storage
    ChatStorage.appendMessage(currentChatId, currentUserId, { role: 'user', content: text });

    // Show typing indicator while waiting for AI
    const typingEl = addTypingIndicator();
    isStreaming = true;
    updateSendBtn();
    streamController = new AbortController();

    try {
      const aiText = await callAI(conversationHistory, streamController.signal);

      typingEl.remove();
      const msgEl = addMessage('ai', aiText);
      addMessageActions(msgEl, aiText);

      // Add to conversation history
      conversationHistory.push({ role: 'assistant', content: aiText });
      ChatStorage.appendMessage(currentChatId, currentUserId, { role: 'assistant', content: aiText });

      // Update chat title after first exchange if still default
      if (conversationHistory.length === 2) {
        window.dispatchEvent(new CustomEvent('lexis:chatTitleUpdate', {
          detail: { chatId: currentChatId, title: text.slice(0, 45) + (text.length > 45 ? '…' : '') },
        }));
      }

    } catch (err) {
      typingEl.remove();
      if (err.name !== 'AbortError') {
        addMessage('ai', `**Error:** ${err.message}`);
        showToast('Could not reach Lexis AI', 'error');
      }
    } finally {
      isStreaming = false;
      streamController = null;
      updateSendBtn();
    }
  }

  /* ── Quick prompts on welcome screen ─────────────────────── */
  document.querySelectorAll('.prompt-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.dataset.prompt) sendMessage(card.dataset.prompt);
    });
  });

  /* ── Load an existing chat from storage ──────────────────── */
  window.addEventListener('lexis:loadChat', async (e) => {
    const { chatId } = e.detail;
    currentChatId = chatId;

    messagesEl.innerHTML = '';
    welcomeEl.style.display = 'none';
    messagesEl.innerHTML = '<p style="text-align:center;color:var(--text-faint);font-size:13px;padding:24px 8px;">Loading…</p>';

    conversationHistory = await ChatStorage.loadMessages(chatId, currentUserId);
    messagesEl.innerHTML = '';

    if (conversationHistory.length === 0) {
      welcomeEl.style.display = 'flex';
      return;
    }

    const userAvatar = window._lexisUserAvatar || 'https://i.pravatar.cc/100?u=default';
    conversationHistory.forEach(msg => {
      const el = addMessage(msg.role === 'user' ? 'user' : 'ai', msg.content, false, userAvatar);
      if (msg.role === 'assistant') addMessageActions(el, msg.content);
    });
  });

  /* ── New chat ────────────────────────────────────────────── */
  window.addEventListener('lexis:newChat', () => {
    currentChatId = null;
    conversationHistory = [];
    messagesEl.innerHTML = '';
    welcomeEl.style.display = 'flex';
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateSendBtn();
    if (streamController) streamController.abort();
    isStreaming = false;
  });

  // Also handle legacy event names from any un-updated code
  window.addEventListener('eduvision:loadChat',    (e) => window.dispatchEvent(new CustomEvent('lexis:loadChat',    { detail: e.detail })));
  window.addEventListener('eduvision:newChat',     ()  => window.dispatchEvent(new CustomEvent('lexis:newChat')));
  window.addEventListener('eduvision:chatCreated', (e) => window.dispatchEvent(new CustomEvent('lexis:chatCreated', { detail: e.detail })));

  /* ── Build message elements ──────────────────────────────── */
  function addMessage(role, text, _streaming = false, avatarSrc) {
    const isAI = role === 'ai';
    const div  = document.createElement('div');
    div.className = `message ${role}`;

    div.innerHTML = `
      <div class="message-avatar">
        ${isAI
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`
          : `<img src="${escapeAttr(avatarSrc || 'https://i.pravatar.cc/100?u=default')}" alt="You" />`
        }
      </div>
      <div class="message-content">
        ${isAI ? '<p class="message-author">Lexis AI</p>' : ''}
        <div class="message-text">${isAI ? formatMarkdown(text) : escapeHTML(text)}</div>
      </div>
    `;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message ai';
    div.innerHTML = `
      <div class="message-avatar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <div class="message-content">
        <p class="message-author">Lexis AI</p>
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addMessageActions(msgEl, text) {
    const actionsEl = document.createElement('div');
    actionsEl.className = 'message-actions';
    actionsEl.innerHTML = `
      <button class="msg-action-btn copy-btn" title="Copy">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy
      </button>
      <button class="msg-action-btn like-btn" title="Good response" data-state="0">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
      </button>
      <button class="msg-action-btn dislike-btn" title="Bad response" data-state="0">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
      </button>
      <button class="msg-action-btn regenerate-btn" title="Regenerate">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.29"/></svg>
      </button>
    `;
    msgEl.querySelector('.message-content').appendChild(actionsEl);

    actionsEl.querySelector('.copy-btn').addEventListener('click', (e) => {
      navigator.clipboard.writeText(text).then(() => {
        const btn = e.currentTarget;
        const orig = btn.innerHTML;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
      });
    });

    actionsEl.querySelector('.like-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const active = btn.dataset.state === '1';
      btn.dataset.state = active ? '0' : '1';
      btn.style.color = active ? '' : 'var(--success)';
      actionsEl.querySelector('.dislike-btn').dataset.state = '0';
      actionsEl.querySelector('.dislike-btn').style.color = '';
      if (!active) showToast('Thanks for the feedback!', 'success');
    });

    actionsEl.querySelector('.dislike-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const active = btn.dataset.state === '1';
      btn.dataset.state = active ? '0' : '1';
      btn.style.color = active ? '' : 'var(--danger)';
      actionsEl.querySelector('.like-btn').dataset.state = '0';
      actionsEl.querySelector('.like-btn').style.color = '';
      if (!active) showToast("Feedback noted. We'll improve!");
    });

    actionsEl.querySelector('.regenerate-btn').addEventListener('click', async () => {
      if (isStreaming) return;
      // Remove last assistant message from history and re-send
      if (conversationHistory[conversationHistory.length - 1]?.role === 'assistant') {
        conversationHistory.pop();
        await ChatStorage.deleteLastAssistantMessage(currentChatId, currentUserId);
      }
      msgEl.remove();

      const lastUserMsg = conversationHistory[conversationHistory.length - 1];
      if (!lastUserMsg) return;

      const typingEl = addTypingIndicator();
      isStreaming = true;
      updateSendBtn();
      streamController = new AbortController();

      try {
        const aiText = await callAI(conversationHistory, streamController.signal);
        typingEl.remove();
        const newMsgEl = addMessage('ai', aiText);
        addMessageActions(newMsgEl, aiText);
        conversationHistory.push({ role: 'assistant', content: aiText });
        ChatStorage.appendMessage(currentChatId, currentUserId, { role: 'assistant', content: aiText });
      } catch (err) {
        typingEl.remove();
        if (err.name !== 'AbortError') showToast('Regeneration failed', 'error');
      } finally {
        isStreaming = false;
        streamController = null;
        updateSendBtn();
      }
    });
  }

  /* ── Voice input ─────────────────────────────────────────── */
  const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechAPI) {
    speechRecognition = new SpeechAPI();
    speechRecognition.lang = 'en-US';
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;

    speechRecognition.onresult = (e) => {
      chatInput.value = Array.from(e.results).map(r => r[0].transcript).join('');
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
      updateSendBtn();
    };
    speechRecognition.onend  = () => { isRecording = false; voiceBtn?.classList.remove('recording'); };
    speechRecognition.onerror = (e) => {
      isRecording = false;
      voiceBtn?.classList.remove('recording');
      if (e.error === 'not-allowed') showToast('Microphone permission denied');
      else showToast('Voice recognition error: ' + e.error);
    };

    voiceBtn?.addEventListener('click', () => {
      if (isRecording) { speechRecognition.stop(); }
      else { speechRecognition.start(); isRecording = true; voiceBtn.classList.add('recording'); showToast('Listening… speak now'); }
    });
  } else {
    voiceBtn?.addEventListener('click', () => showToast('Voice input not supported in this browser'));
  }

  /* ── Attach / Share ──────────────────────────────────────── */
  attachBtn?.addEventListener('click', () => showToast('File upload coming soon!'));
  shareBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => showToast('Chat link copied!', 'success'));
  });

  /* ── Helpers ─────────────────────────────────────────────── */
  function scrollToBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

  function formatMarkdown(text) {
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code>$1</code>')
      .replace(/^### (.+)$/gm,'<h4 style="font-size:14px;font-weight:700;margin:14px 0 4px">$1</h4>')
      .replace(/^## (.+)$/gm,'<h3 style="font-size:15px;font-weight:700;margin:16px 0 6px">$1</h3>')
      .replace(/^[•\-] (.+)$/gm,'<div style="display:flex;gap:8px;margin:3px 0"><span style="color:var(--accent);flex-shrink:0">•</span><span>$1</span></div>')
      .replace(/^---$/gm,'<hr style="border:none;border-top:1px solid var(--border);margin:14px 0">')
      .replace(/\n/g,'<br>');
  }

  function escapeHTML(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escapeAttr(t) { return t.replace(/"/g,'&quot;'); }

  /* ── Global toast (used by modals.js too) ────────────────── */
  window.showToast = function(msg, type) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className   = 'toast ' + (type || '') + ' show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
  };

  updateSendBtn();
});
