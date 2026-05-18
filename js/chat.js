/* ═══════════════════════════════════════════════════════════════
   chat.js — Chat messages, streaming, voice input
   
   TO CONNECT YOUR AI API:
   Replace simulateStreaming() with a real fetch() call.
   Example is in the sendMessage() function comments.
═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('chatArea')) return;

  /* Auth guard — redirect to login if not signed in */
  if (typeof EduVisionAuth !== 'undefined' && !EduVisionAuth.isLoggedIn()) {
    EduVisionAuth.redirectToLogin();
    return;
  }

  /* ── Load & display user info ─────────────────────────────── */
  const user = (typeof EduVisionAuth !== 'undefined') ? EduVisionAuth.getUser() : null;
  if (user) {
    document.getElementById('sidebarUserName')?.setAttribute && (document.getElementById('sidebarUserName').textContent = user.name);
    document.getElementById('sidebarUserEmail').textContent  = user.email;
    document.getElementById('sidebarUserAvatar').src         = user.avatar || `https://i.pravatar.cc/100?u=${user.email}`;
    document.getElementById('welcomeTitle').textContent      = `How can I help you today?`;
    /* Popover */
    document.getElementById('popoverName').textContent       = user.name;
    document.getElementById('popoverEmail').textContent      = user.email;
    document.getElementById('popoverAvatar').src             = user.avatar || `https://i.pravatar.cc/100?u=${user.email}`;
    /* Settings account tab */
    document.getElementById('settingsAvatar').src            = user.avatar || `https://i.pravatar.cc/100?u=${user.email}`;
    document.getElementById('settingsAccountName').textContent  = user.name;
    document.getElementById('settingsAccountEmail').textContent = user.email;
    document.getElementById('settingsNameInput').value          = user.name;
    document.getElementById('settingsEmailInput').value         = user.email;
    document.getElementById('settingsPlanBadge').textContent    = user.plan === 'pro' ? 'Pro Plan' : 'Free Plan';
    document.getElementById('planBadge').textContent            = user.plan === 'pro' ? 'Pro' : 'Free';
  }

  /* ── Elements ─────────────────────────────────────────────── */
  const chatArea    = document.getElementById('chatArea');
  const messagesEl  = document.getElementById('messages');
  const welcomeEl   = document.getElementById('welcomeScreen');
  const chatInput   = document.getElementById('chatInput');
  const sendBtn     = document.getElementById('sendBtn');
  const sendIcon    = document.getElementById('sendIcon');
  const voiceBtn    = document.getElementById('voiceBtn');
  const attachBtn   = document.getElementById('attachBtn');
  const shareBtn    = document.getElementById('shareBtn');

  /* Model selector */
  const modelSelector = document.getElementById('modelSelector');
  const modelDropdown = document.getElementById('modelDropdown');
  const modelNameEl   = document.getElementById('modelName');

  /* ── State ────────────────────────────────────────────────── */
  let isStreaming      = false;
  let streamController = null;
  let isRecording      = false;
  let speechRecognition = null;
  let currentChatId    = 'chat_' + Date.now();
  let enterSendsMessage = true;
  let currentModel     = 'eduvision-standard';

  /* ── Settings sync ────────────────────────────────────────── */
  document.getElementById('enterSendToggle')?.addEventListener('change', (e) => {
    enterSendsMessage = e.target.checked;
  });

  /* ── Model selector ───────────────────────────────────────── */
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
      if ((model === 'eduvision-pro' || model === 'eduvision-research') && user?.plan !== 'pro') {
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

  /* ── Input resize ─────────────────────────────────────────── */
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    updateSendBtn();
  });

  /* ── Send on Enter ────────────────────────────────────────── */
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

  /* ── Handle send ──────────────────────────────────────────── */
  function handleSend() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateSendBtn();
    sendMessage(text);
  }

  /* ── Send message ─────────────────────────────────────────── */
  function sendMessage(text) {
    /* Hide welcome, ensure chat ID */
    welcomeEl.style.display = 'none';

    /* Create chat entry in sidebar if this is first message */
    if (messagesEl.children.length === 0) {
      const autoTitle = text.length > 40 ? text.substring(0, 40) + '…' : text;
      window.dispatchEvent(new CustomEvent('eduvision:chatCreated', {
        detail: { chatId: currentChatId, title: autoTitle }
      }));
    }

    addMessage('user', text);

    /* Show typing indicator */
    const typingEl = addTypingIndicator();

    isStreaming = true;
    updateSendBtn();

    /* ── TODO: Replace simulateStreaming() with real API:
       streamController = new AbortController();
       try {
         const res = await fetch('/api/chat', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             message: text,
             model: currentModel,
             chatId: currentChatId
           }),
           signal: streamController.signal
         });
         // For streaming SSE:
         const reader = res.body.getReader();
         const decoder = new TextDecoder();
         let aiText = '';
         typingEl.remove();
         const msgEl = addMessage('ai', '', true);
         const textEl = msgEl.querySelector('.message-text');
         while (true) {
           const { done, value } = await reader.read();
           if (done) break;
           const chunk = decoder.decode(value);
           aiText += chunk;
           textEl.innerHTML = formatMarkdown(aiText) + '<span class="cursor"></span>';
           scrollToBottom();
         }
         textEl.innerHTML = formatMarkdown(aiText);
         addMessageActions(msgEl, aiText);
       } catch (err) {
         if (err.name !== 'AbortError') showToast('Error: Could not reach AI server');
       } finally {
         isStreaming = false;
         streamController = null;
         updateSendBtn();
       }
    ─────────────────────────────────────────────────────────── */

    streamController = new AbortController();
    const responseText = getAIResponse(text);
    simulateStreaming(responseText, typingEl, streamController.signal)
      .finally(() => {
        isStreaming = false;
        streamController = null;
        updateSendBtn();
        /* Auto-update chat title after first response */
        const firstUserMsg = messagesEl.querySelector('.message.user .message-text');
        if (firstUserMsg) {
          const title = firstUserMsg.textContent.length > 40
            ? firstUserMsg.textContent.substring(0, 40) + '…'
            : firstUserMsg.textContent;
          window.dispatchEvent(new CustomEvent('eduvision:chatTitleUpdate', {
            detail: { chatId: currentChatId, title }
          }));
        }
      });
  }

  /* ── Simulate streaming word-by-word ─────────────────────── */
  async function simulateStreaming(text, typingEl, signal) {
    typingEl.remove();
    const msgEl  = addMessage('ai', '', true);
    const textEl = msgEl.querySelector('.message-text');
    const words  = text.split(' ');
    let displayed = '';

    for (let i = 0; i < words.length; i++) {
      if (signal.aborted) break;
      await sleep(24 + Math.random() * 16);
      displayed += (i === 0 ? '' : ' ') + words[i];
      textEl.innerHTML = formatMarkdown(displayed) + '<span class="cursor"></span>';
      scrollToBottom();
    }
    textEl.innerHTML = formatMarkdown(displayed);
    addMessageActions(msgEl, displayed);
  }

  /* ── Quick prompts ────────────────────────────────────────── */
  document.querySelectorAll('.prompt-card').forEach(card => {
    card.addEventListener('click', () => sendMessage(card.dataset.prompt));
  });

  /* ── Load existing chat ───────────────────────────────────── */
  window.addEventListener('eduvision:loadChat', (e) => {
    const { chatId, title } = e.detail;
    currentChatId = chatId;
    messagesEl.innerHTML = '';
    welcomeEl.style.display = 'none';
    /* Simulate loading a previous conversation */
    setTimeout(() => {
      addMessage('user', title);
      const typingEl = addTypingIndicator();
      isStreaming = true;
      updateSendBtn();
      streamController = new AbortController();
      simulateStreaming(getAIResponse(title), typingEl, streamController.signal)
        .finally(() => { isStreaming = false; streamController = null; updateSendBtn(); });
    }, 120);
  });

  /* ── New chat event ───────────────────────────────────────── */
  window.addEventListener('eduvision:newChat', () => {
    currentChatId = 'chat_' + Date.now();
    messagesEl.innerHTML = '';
    welcomeEl.style.display = 'flex';
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateSendBtn();
    if (streamController) streamController.abort();
    isStreaming = false;
  });

  /* ── Build message elements ───────────────────────────────── */
  function addMessage(role, text, streaming = false) {
    const isAI = role === 'ai';
    const div = document.createElement('div');
    div.className = `message ${role}`;

    const avatarSrc = isAI ? '' : (user?.avatar || `https://i.pravatar.cc/100?u=default`);

    div.innerHTML = `
      <div class="message-avatar">
        ${isAI
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`
          : `<img src="${avatarSrc}" alt="You" />`
        }
      </div>
      <div class="message-content">
        ${isAI ? '<p class="message-author">EduVision AI</p>' : ''}
        <div class="message-text">${
          isAI
            ? (streaming ? '' : formatMarkdown(text))
            : escapeHTML(text)
        }</div>
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
        <p class="message-author">EduVision AI</p>
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
      <button class="msg-action-btn regenerate-btn" title="Regenerate response">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.29"/></svg>
      </button>
    `;
    msgEl.querySelector('.message-content').appendChild(actionsEl);

    /* Copy */
    actionsEl.querySelector('.copy-btn').addEventListener('click', (e) => {
      navigator.clipboard.writeText(text).then(() => {
        const btn = e.currentTarget;
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => { btn.innerHTML = original; }, 2000);
      });
    });

    /* Like */
    actionsEl.querySelector('.like-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const active = btn.dataset.state === '1';
      btn.dataset.state = active ? '0' : '1';
      btn.style.color = active ? '' : 'var(--success)';
      actionsEl.querySelector('.dislike-btn').dataset.state = '0';
      actionsEl.querySelector('.dislike-btn').style.color = '';
      if (!active) showToast('Thanks for the feedback!', 'success');
    });

    /* Dislike */
    actionsEl.querySelector('.dislike-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const active = btn.dataset.state === '1';
      btn.dataset.state = active ? '0' : '1';
      btn.style.color = active ? '' : 'var(--danger)';
      actionsEl.querySelector('.like-btn').dataset.state = '0';
      actionsEl.querySelector('.like-btn').style.color = '';
      if (!active) showToast('Feedback noted. We\'ll improve!');
    });

    /* Regenerate */
    actionsEl.querySelector('.regenerate-btn').addEventListener('click', () => {
      if (isStreaming) return;
      /* Find the last user message and re-send */
      const userMsgs = messagesEl.querySelectorAll('.message.user .message-text');
      const lastUserMsg = userMsgs[userMsgs.length - 1];
      if (!lastUserMsg) return;
      /* Remove this AI message and re-stream */
      msgEl.remove();
      const typingEl = addTypingIndicator();
      isStreaming = true;
      updateSendBtn();
      streamController = new AbortController();
      simulateStreaming(getAIResponse(lastUserMsg.textContent), typingEl, streamController.signal)
        .finally(() => { isStreaming = false; streamController = null; updateSendBtn(); });
    });
  }

  /* ── Attach file (placeholder) ────────────────────────────── */
  attachBtn?.addEventListener('click', () => {
    /* TODO: implement file upload */
    showToast('File upload coming soon!');
  });

  /* ── Share button ─────────────────────────────────────────── */
  shareBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showToast('Chat link copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Could not copy link');
    });
  });

  /* ── Voice Input (Web Speech API) ─────────────────────────── */
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognitionAPI) {
    speechRecognition = new SpeechRecognitionAPI();
    speechRecognition.lang = 'en-US';
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;

    speechRecognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript).join('');
      chatInput.value = transcript;
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
      updateSendBtn();
    };

    speechRecognition.onend = () => {
      isRecording = false;
      voiceBtn.classList.remove('recording');
      voiceBtn.title = 'Voice input';
    };

    speechRecognition.onerror = (e) => {
      isRecording = false;
      voiceBtn.classList.remove('recording');
      if (e.error === 'not-allowed') showToast('Microphone permission denied');
      else showToast('Voice recognition error: ' + e.error);
    };

    voiceBtn?.addEventListener('click', () => {
      if (isRecording) {
        speechRecognition.stop();
        isRecording = false;
        voiceBtn.classList.remove('recording');
        voiceBtn.title = 'Voice input';
      } else {
        speechRecognition.start();
        isRecording = true;
        voiceBtn.classList.add('recording');
        voiceBtn.title = 'Stop recording';
        showToast('Listening… speak now');
      }
    });
  } else {
    voiceBtn?.addEventListener('click', () => {
      showToast('Voice input not supported in this browser');
    });
  }

  /* ── Close dropdowns on outside click ────────────────────── */
  document.addEventListener('click', (e) => {
    if (!modelSelector?.contains(e.target)) {
      modelDropdown?.classList.remove('open');
      modelSelector?.classList.remove('open');
    }
  });

  /* ── Helpers ──────────────────────────────────────────────── */
  function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

  function escapeHTML(t) {
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── AI Response database ─────────────────────────────────── */
  const AI_RESPONSES = {
    gpa: `**NEB GPA Calculation System**

Nepal's National Examination Board uses a **4.0 GPA scale**:

- **A+** — 90–100 marks → 4.0 GPA
- **A** — 80–89 marks → 3.6 GPA
- **B+** — 70–79 marks → 3.2 GPA
- **B** — 60–69 marks → 2.8 GPA
- **C+** — 50–59 marks → 2.4 GPA
- **C** — 40–49 marks → 2.0 GPA

**Formula:** GPA = Σ (Grade Point × Credit Hours) ÷ Total Credit Hours

To pass, you need at least **35 marks** in each subject.

Would you like me to calculate your GPA based on your subject marks?`,

    physics: `**Grade 12 Physics — Rotational Dynamics**
*Nepal CDC Curriculum*

**Moment of Inertia (I)**
The rotational equivalent of mass. Formula: \`I = Σmr²\`

**Torque (τ)**
Rotational force. Formula: \`τ = r × F = Iα\`

**Angular Momentum (L)**
Formula: \`L = Iω\`
Conservation law: If net torque = 0, then L is constant.

**NEB Exam Tips:**
- Numerical problems on torque carry 5–10 marks
- Practice rolling motion problems thoroughly
- Understand the parallel axis theorem

Want notes on another chapter?`,

    scholarship: `**Scholarships for Nepalese Students 2024**

**Government Scholarships:**
- **Ministry of Education** — For SEE toppers
- **President Educational Fund** — Merit-based, all levels
- **TU/IOE Entrance Scholarship** — Top 50 rankers: 100% fee waiver

**International Scholarships:**
- **Fulbright Program** — USA (postgraduate)
- **Chevening** — UK (master's programs)
- **MEXT** — Japan (undergrad & graduate)
- **Chinese Government Scholarship** — Full funding

**Application Tips:**
- Keep your SEE and +2 certificates ready
- Apply early — deadlines are strict
- Get a character certificate from your school

Want details on applying for any of these?`,

    study: `**30-Day NEB Exam Preparation Plan**

**Week 1 — Foundation Review**
- Day 1–3: Mathematics (Calculus & Algebra)
- Day 4–5: Physics (Mechanics & Waves)
- Day 6–7: Chemistry (Organic fundamentals)

**Week 2 — Core Chapters**
- Day 8–10: Physics (Electricity & Optics)
- Day 11–12: Chemistry (Inorganic)
- Day 13–14: Biology or optional subject

**Week 3 — Practice**
- Daily: 2 past paper questions per subject
- Focus on weakest topics from Week 1–2
- Practice 3-hour timed sessions

**Week 4 — Final Revision**
- Day 22–25: Formula sheets & quick notes
- Day 26–28: Full mock exams
- Day 29–30: Light review only, rest well

**Pro Tip:** 6–8 focused hours beats 12-hour exhausted sessions every time.`,

    default: `Hello! I'm **EduVision AI**, your personal study assistant for Nepal's education system.

I can help you with:

- **CDC Curriculum** — Notes and explanations for all subjects
- **NEB Exam Prep** — Past papers, topic-wise revision, and strategies
- **GPA Calculator** — Understand and calculate your NEB GPA
- **Scholarship Finder** — Verified opportunities for Nepali students
- **Career Guidance** — Engineering, Medicine, Management & more

What would you like to learn today?`,
  };

  function getAIResponse(message) {
    const lower = message.toLowerCase();
    if (lower.includes('gpa') || lower.includes('grade') || lower.includes('marks') || lower.includes('score'))
      return AI_RESPONSES.gpa;
    if (lower.includes('physics') || lower.includes('newton') || lower.includes('chapter') || lower.includes('note'))
      return AI_RESPONSES.physics;
    if (lower.includes('scholarship') || lower.includes('fund') || lower.includes('opportunity') || lower.includes('abroad'))
      return AI_RESPONSES.scholarship;
    if (lower.includes('study plan') || lower.includes('preparation') || lower.includes('prepare') || lower.includes('schedule'))
      return AI_RESPONSES.study;
    return AI_RESPONSES.default;
  }

  /* ── Toast helper (also used by other modules) ────────────── */
  window.showToast = function(msg, type = '') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + type + ' show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
  };

  /* Initial send button state */
  updateSendBtn();
});
