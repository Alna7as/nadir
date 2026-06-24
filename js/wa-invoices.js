const WhatsAppInvoicesModule = (() => {
  const TABLE = 'chat_messages';
  const GROUP_KEY = 'management_reps_general';
  const GROUP_NAME = 'جروب الإدارة والمناديب';
  const POLL_MS = 5000;

  let users = [];
  let messages = [];
  let searchQuery = '';
  let pollTimer = null;

  const listEl = () => document.getElementById('wa-list');
  const previewEl = () => document.getElementById('wa-preview-area');
  const summaryEl = () => document.getElementById('wa-summary');
  const titleEl = () => document.getElementById('wa-title-input');
  const textEl = () => document.getElementById('wa-text-input');

  function currentUser() {
    return typeof NadirUsers !== 'undefined' ? NadirUsers.getById(Session.getUserId()) : null;
  }

  function normalizeRow(row) {
    return {
      id: row.id,
      senderId: row.sender_id || row.senderId,
      senderName: row.sender_name || row.senderName || '',
      body: row.body || '',
      groupKey: row.group_key || row.groupKey || '',
      groupName: row.group_name || row.groupName || GROUP_NAME,
      createdAt: row.created_at || row.createdAt || null,
      updatedAt: row.updated_at || row.updatedAt || null,
    };
  }

  function initials(name) {
    return String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase() || 'NA';
  }

  function formatDayLabel(dateLike) {
    if (!dateLike) return '';
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function isLegacyAudioBody(body) {
    return String(body || '').startsWith('__audio__:');
  }

  function canDeleteMessage(message, me) {
    if (!message?.id || !me?.id) return false;
    return String(message.senderId) === String(me.id) || String(me.role || '') === 'admin';
  }

  async function sendPayload(body) {
    const me = currentUser();
    if (!me?.id) {
      Toast.error('تعذر تحديد المستخدم الحالي');
      return false;
    }
    if (!DB.hasRemoteConfig() || !DB.isBrowserOnline()) {
      Toast.error('الشات المتزامن يحتاج اتصالًا بالإنترنت');
      return false;
    }

    const payload = {
      sender_id: me.id,
      sender_name: me.name || '',
      recipient_id: null,
      recipient_name: GROUP_NAME,
      group_key: GROUP_KEY,
      group_name: GROUP_NAME,
      body,
      created_at: Utils.localNow(),
      updated_at: Utils.localNow(),
    };

    await DB.req('POST', TABLE, payload);
    await loadPage();
    return true;
  }

  async function fetchMessages() {
    try {
      const rows = await DB.req(
        'GET',
        TABLE,
        null,
        `?group_key=eq.${encodeURIComponent(GROUP_KEY)}&order=created_at.desc`
      );
      return rows
        .map(normalizeRow)
        .filter((row) => !isLegacyAudioBody(row.body));
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.toLowerCase().includes('chat_messages') || msg.toLowerCase().includes('schema cache')) {
        throw new Error('جدول الشات غير موجود في Supabase بعد. أضف جدول chat_messages أولاً.');
      }
      throw err;
    }
  }

  function renderSummary(errorText = '') {
    const el = summaryEl();
    if (!el) return;

    if (errorText) {
      el.innerHTML = `<div class="wa-preview-empty" style="min-height:auto;width:100%;">${escapeHtml(errorText)}</div>`;
      return;
    }

    const uniqueSenders = new Set(messages.map((message) => String(message.senderId || '')));
    const current = currentUser();
    const lastMessage = messages[0] || null;

    el.innerHTML = `
      <div class="wa-summary-pill is-accent">
        <div class="wa-summary-label">إجمالي الرسائل</div>
        <div class="wa-summary-value mono">${messages.length}</div>
      </div>
      <div class="wa-summary-pill">
        <div class="wa-summary-label">المشاركون</div>
        <div class="wa-summary-value mono">${uniqueSenders.size}</div>
      </div>
      <div class="wa-summary-pill">
        <div class="wa-summary-label">الحساب الحالي</div>
        <div class="wa-summary-value">${escapeHtml(current?.name || '—')}</div>
        <div class="wa-summary-sub">${lastMessage ? `آخر رسالة ${Utils.formatDateTime(lastMessage.createdAt)}` : 'لا توجد رسائل بعد'}</div>
      </div>`;
  }

  function renderMembersList() {
    const container = listEl();
    if (!container) return;

    const grouped = {};
    messages.forEach((message) => {
      const key = String(message.senderId || '');
      if (!key) return;
      if (!grouped[key]) {
        const user = users.find((row) => String(row.id) === key);
        grouped[key] = {
          user,
          count: 0,
          lastAt: 0,
          lastBody: '',
        };
      }
      grouped[key].count += 1;
      grouped[key].lastAt = Math.max(grouped[key].lastAt, new Date(message.createdAt || 0).getTime() || 0);
      if (!grouped[key].lastBody) grouped[key].lastBody = message.body || '';
    });

    const rows = Object.values(grouped)
      .filter((row) => {
        const haystack = `${row.user?.name || ''} ${row.lastBody || ''}`.toLowerCase();
        return !searchQuery || haystack.includes(searchQuery);
      })
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));

    if (!rows.length) {
      container.innerHTML = `<div class="empty-state"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5V4H2v16h5m10 0v-5a3 3 0 00-3-3h-4a3 3 0 00-3 3v5m10 0H7m8-12a3 3 0 11-6 0 3 3 0 016 0z"/></svg><p>لا توجد مشاركات بعد داخل الجروب.</p></div>`;
      return;
    }

    container.innerHTML = rows.map((row) => `
      <div class="wa-member-card">
        <div class="wa-member-avatar">${escapeHtml(initials(row.user?.name || 'مستخدم'))}</div>
        <div class="wa-member-body">
          <div class="wa-member-top">
            <div class="wa-member-name">${escapeHtml(row.user?.name || 'مستخدم')}</div>
            <span class="wa-chip">${escapeHtml(NadirUsers.getRoleLabel(row.user?.role || 'cashier'))}</span>
            <span class="wa-chip" style="background:rgba(34,197,94,0.10);">${row.count} رسالة</span>
          </div>
          <div class="wa-member-meta">آخر رسالة: ${Utils.formatDateTime(row.lastAt ? new Date(row.lastAt).toISOString() : '')}</div>
          <div class="wa-member-snippet">${escapeHtml(String(row.lastBody || '').slice(0, 120) || 'بدون رسائل')}</div>
        </div>
      </div>
    `).join('');
  }

  function scrollPreviewToBottom() {
    const holder = previewEl()?.querySelector('.wa-thread-messages');
    if (!holder) return;
    holder.scrollTop = holder.scrollHeight;
  }

  function renderPreview(errorText = '') {
    const target = previewEl();
    if (!target) return;

    if (errorText) {
      target.className = 'wa-preview-empty';
      target.textContent = errorText;
      return;
    }

    if (!messages.length) {
      target.className = 'wa-preview-empty';
      target.textContent = 'لا توجد رسائل بعد داخل الجروب.';
      return;
    }

    const me = currentUser();
    const ordered = [...messages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    let lastDay = '';

    target.className = 'wa-preview-box';
    target.innerHTML = `
      <div class="wa-thread-wrap">
        <div class="wa-thread-head">
          <div>
            <div class="wa-thread-head-title">${GROUP_NAME}</div>
            <div class="wa-thread-head-sub">تواصل مباشر بين المدير والمناديب داخل النظام</div>
          </div>
          <div class="wa-thread-badge">${otherParticipantCount()} مشارك</div>
        </div>
        <div class="wa-thread-messages">
          ${ordered.map((message) => {
            const isMine = String(message.senderId) === String(me?.id || '');
            const deleteBtn = canDeleteMessage(message, me)
              ? `<div class="wa-bubble-tools"><button class="wa-delete-btn" data-delete-message="${message.id}">حذف</button></div>`
              : '';
            const dayLabel = formatDayLabel(message.createdAt);
            const separator = dayLabel && dayLabel !== lastDay ? `<div class="wa-day-separator">${escapeHtml(dayLabel)}</div>` : '';
            lastDay = dayLabel || lastDay;
            return `
              ${separator}
              <div class="wa-message-row ${isMine ? 'mine' : 'other'}">
                <div class="wa-bubble ${isMine ? 'mine' : 'other'}">
                  <div class="wa-bubble-head">
                    <div class="wa-bubble-name">${escapeHtml(isMine ? 'أنت' : message.senderName || 'مستخدم')}</div>
                  </div>
                  <div class="wa-bubble-text">${escapeHtml(message.body)}</div>
                  <div class="wa-bubble-time">${Utils.formatDateTime(message.createdAt)}</div>
                  ${deleteBtn}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
    scrollPreviewToBottom();
    target.querySelectorAll('[data-delete-message]').forEach((btn) => {
      btn.addEventListener('click', () => deleteMessage(btn.getAttribute('data-delete-message')));
    });
  }

  function otherParticipantCount() {
    return new Set(messages.map((message) => String(message.senderId || ''))).size || 0;
  }

  async function sendMessage() {
    const body = textEl()?.value.trim() || '';
    if (!body) {
      Toast.error('اكتب الرسالة أولاً');
      return;
    }

    try {
      await sendPayload(body);
      if (textEl()) textEl().value = '';
      await loadPage();
      Toast.success('تم إرسال الرسالة للجروب');
    } catch (err) {
      Toast.error(err.message || 'تعذر إرسال الرسالة');
    }
  }

  function clearComposer() {
    if (textEl()) textEl().value = '';
  }

  async function deleteMessage(messageId) {
    const me = currentUser();
    const message = messages.find((item) => String(item.id) === String(messageId));
    if (!message) return;
    if (!canDeleteMessage(message, me)) {
      Toast.error('غير مسموح لك بحذف هذه الرسالة');
      return;
    }
    if (!confirm('هل تريد حذف هذه الرسالة؟')) return;
    try {
      await DB.req('DELETE', TABLE, null, `?id=eq.${encodeURIComponent(messageId)}`);
      messages = messages.filter((item) => String(item.id) !== String(messageId));
      renderSummary();
      renderMembersList();
      renderPreview();
      Toast.success('تم حذف الرسالة');
    } catch (err) {
      Toast.error(err.message || 'تعذر حذف الرسالة');
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (typeof Router !== 'undefined' && Router.getCurrent() !== 'wa-invoices') return;
      try {
        messages = await fetchMessages();
        renderSummary();
        renderMembersList();
        renderPreview();
      } catch (_) {}
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function loadPage() {
    users = typeof NadirUsers !== 'undefined' ? NadirUsers.getAll() : [];
    if (titleEl()) titleEl().value = GROUP_NAME;

    const me = currentUser();
    if (!me?.id) {
      messages = [];
      renderSummary();
      renderMembersList();
      renderPreview();
      return;
    }

    if (!DB.hasRemoteConfig() || !DB.isBrowserOnline()) {
      renderSummary('الجروب يحتاج اتصالًا وقاعدة بيانات مفعلة');
      renderMembersList();
      renderPreview('جروب الشات العام يحتاج اتصالًا بالإنترنت و Supabase.');
      stopPolling();
      return;
    }

    try {
      messages = await fetchMessages();
      renderSummary();
      renderMembersList();
      renderPreview();
      startPolling();
    } catch (err) {
      renderSummary(err.message || 'تعذر تحميل الشات');
      renderMembersList();
      renderPreview(err.message || 'تعذر تحميل الرسائل');
      stopPolling();
    }
  }

  function init() {
    document.getElementById('wa-save-btn')?.addEventListener('click', sendMessage);
    document.getElementById('wa-clear-form-btn')?.addEventListener('click', clearComposer);
    document.getElementById('wa-refresh-btn')?.addEventListener('click', () => loadPage().catch(() => {}));
    document.getElementById('wa-search-input')?.addEventListener('input', Utils.debounce((e) => {
      searchQuery = String(e.target.value || '').trim().toLowerCase();
      renderMembersList();
    }, 150));
    textEl()?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
  }

  return { init, load: loadPage };
})();
