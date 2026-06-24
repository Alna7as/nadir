const ExpensesModule = (() => {
  const STORAGE_KEY = 'nadir_expenses_v1';

  let allExpenses = [];
  let filters = {
    query: '',
    category: '',
    from: '',
    to: '',
  };

  function readLegacyExpenses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeLegacyExpenses(rows) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }

  function normalizeAmount(value) {
    return Math.max(0, parseFloat((value || 0))).toFixed(2);
  }

  function localToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function monthPrefix(dateStr) {
    return String(dateStr || '').slice(0, 7);
  }

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCompare !== 0) return dateCompare;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  async function migrateLegacyExpenses() {
    if (typeof DB === 'undefined' || !DB.isOnline()) return;
    const legacyRows = readLegacyExpenses();
    if (!legacyRows.length) return;

    let hasChanges = false;
    for (const row of legacyRows) {
      if (row.synced) continue;
      try {
        await DB.add('expenses', {
          title: row.title,
          category: row.category || 'أخرى',
          amount: parseFloat(normalizeAmount(row.amount)),
          date: row.date || localToday(),
          note: row.note || '',
          legacyId: row.id || null,
          createdAt: row.createdAt || new Date().toISOString(),
        });
        row.synced = true;
        hasChanges = true;
      } catch (err) {
        console.warn('[Expenses] migrate legacy failed:', err?.message || err);
      }
    }

    if (hasChanges) writeLegacyExpenses(legacyRows);
  }

  async function fetchExpenses() {
    if (typeof DB === 'undefined') return sortRows(readLegacyExpenses());
    try {
      await migrateLegacyExpenses();
      const rows = await DB.getAll('expenses');
      return sortRows(rows);
    } catch (err) {
      console.warn('[Expenses] fallback to legacy/local:', err?.message || err);
      return sortRows(readLegacyExpenses());
    }
  }

  function getFilteredExpenses() {
    const query = filters.query.trim().toLowerCase();
    return allExpenses.filter((expense) => {
      if (filters.category && expense.category !== filters.category) return false;
      if (filters.from && String(expense.date || '') < filters.from) return false;
      if (filters.to && String(expense.date || '') > filters.to) return false;
      if (!query) return true;
      const haystack = `${expense.title || ''} ${expense.note || ''} ${expense.category || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderSummary(rows = getFilteredExpenses()) {
    const el = document.getElementById('expenses-summary');
    if (!el) return;

    const today = localToday();
    const currentMonth = monthPrefix(today);
    const total = rows.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
    const todayTotal = rows
      .filter((row) => row.date === today)
      .reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
    const monthTotal = rows
      .filter((row) => monthPrefix(row.date) === currentMonth)
      .reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">إجمالي المصاريف</div>
          <div class="stat-value" style="font-size:16px;color:#f87171;">${Utils.currency(total)}</div>
        </div>
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">مصاريف اليوم</div>
          <div class="stat-value" style="font-size:16px;color:#f0c040;">${Utils.currency(todayTotal)}</div>
        </div>
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">مصاريف الشهر</div>
          <div class="stat-value" style="font-size:16px;color:#60a5fa;">${Utils.currency(monthTotal)}</div>
        </div>
      </div>`;
  }

  function renderList() {
    const container = document.getElementById('expenses-list');
    if (!container) return;

    const rows = getFilteredExpenses();
    renderSummary(rows);

    if (!rows.length) {
      container.innerHTML = `
        <div class="empty-state">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <p>لا توجد مصاريف مطابقة.</p>
        </div>`;
      return;
    }

    container.innerHTML = rows.map((expense) => `
      <div class="card" style="border-right:3px solid #f87171;">
        <div class="card-row shop-card-row" style="align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div class="card-title">${escapeHtml(expense.title)}</div>
            <div class="card-sub" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
              <span class="badge badge-yellow">${escapeHtml(expense.category || 'أخرى')}</span>
              <span>${Utils.formatDate(expense.date)}</span>
            </div>
            ${expense.note ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.6;">${escapeHtml(expense.note)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
            <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:#f87171;">${Utils.currency(expense.amount)}</div>
            <button class="btn btn-danger btn-sm" data-expense-delete="${expense.id}">حذف</button>
          </div>
        </div>
      </div>`).join('');

    container.querySelectorAll('[data-expense-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteExpense(btn.dataset.expenseDelete));
    });
  }

  function resetForm() {
    document.getElementById('expense-form')?.reset();
    const dateEl = document.getElementById('expense-date');
    if (dateEl) dateEl.value = localToday();
  }

  async function load() {
    allExpenses = await fetchExpenses();
    if (!document.getElementById('expense-date')?.value) resetForm();
    renderList();
  }

  async function saveExpense(e) {
    e.preventDefault();

    const title = document.getElementById('expense-title')?.value.trim();
    const category = document.getElementById('expense-category')?.value || 'أخرى';
    const amount = parseFloat(document.getElementById('expense-amount')?.value || 0);
    const date = document.getElementById('expense-date')?.value || localToday();
    const note = document.getElementById('expense-note')?.value.trim() || '';

    if (!title) {
      Toast.error('اسم المصروف مطلوب');
      return;
    }
    if (!(amount > 0)) {
      Toast.error('أدخل مبلغًا صحيحًا للمصروف');
      return;
    }

    const nextLegacy = {
      id: `exp_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      title,
      category,
      amount: parseFloat(normalizeAmount(amount)),
      date,
      note,
      createdAt: new Date().toISOString(),
      synced: false,
    };

    let savedExpense = nextLegacy;
    try {
      if (typeof DB !== 'undefined') {
        const newId = await DB.add('expenses', {
          title,
          category,
          amount: parseFloat(normalizeAmount(amount)),
          date,
          note,
          legacyId: nextLegacy.id,
          createdAt: nextLegacy.createdAt,
        });
        savedExpense = await DB.get('expenses', newId) || {
          ...nextLegacy,
          id: newId,
          synced: DB.isOnline(),
          pendingSync: DB.isOnline() ? 0 : 1,
        };
      } else {
        const legacyRows = readLegacyExpenses();
        legacyRows.unshift(nextLegacy);
        writeLegacyExpenses(sortRows(legacyRows));
      }
    } catch (err) {
      console.warn('[Expenses] save fallback to local:', err?.message || err);
      const legacyRows = readLegacyExpenses();
      legacyRows.unshift(nextLegacy);
      writeLegacyExpenses(sortRows(legacyRows));
    }

    try {
      if (typeof DB !== 'undefined' && typeof DB.addAuditLog === 'function') {
        await DB.addAuditLog({
          entityType: 'expense',
          entityId: String(savedExpense.id),
          action: 'create',
          newValue: savedExpense,
          note: `إضافة مصروف ${title}`,
        });
      }
    } catch (_) {}
    try {
      if (typeof OpsMeta !== 'undefined') {
        OpsMeta.addActivity({
          actor: OpsMeta.currentUser()?.name || 'مستخدم',
          type: 'إضافة مصروف',
          target: title,
        });
      }
    } catch (_) {}

    Toast.success('تم حفظ المصروف ✓');
    resetForm();
    await load();
  }

  async function deleteExpense(id) {
    const expense = allExpenses.find((row) => String(row.id) === String(id));
    if (!expense) return;
    if (!Utils.confirm(`هل تريد حذف المصروف "${expense.title}"؟`)) return;

    try {
      if (typeof DB !== 'undefined') {
        await DB.remove('expenses', id);
      } else {
        const legacyRows = readLegacyExpenses().filter((row) => String(row.id) !== String(id));
        writeLegacyExpenses(legacyRows);
      }
    } catch (err) {
      console.warn('[Expenses] delete fallback local:', err?.message || err);
      const legacyRows = readLegacyExpenses().filter((row) => String(row.id) !== String(id));
      writeLegacyExpenses(legacyRows);
    }

    try {
      if (typeof DB !== 'undefined' && typeof DB.addAuditLog === 'function') {
        await DB.addAuditLog({
          entityType: 'expense',
          entityId: String(id),
          action: 'delete',
          oldValue: expense,
          note: `حذف مصروف ${expense.title}`,
        });
      }
    } catch (_) {}
    try {
      if (typeof OpsMeta !== 'undefined') {
        OpsMeta.addActivity({
          actor: OpsMeta.currentUser()?.name || 'مستخدم',
          type: 'حذف مصروف',
          target: expense.title,
        });
      }
    } catch (_) {}

    Toast.success('تم حذف المصروف');
    await load();
  }

  function updateFilters() {
    filters = {
      query: document.getElementById('expenses-search')?.value || '',
      category: document.getElementById('expenses-filter-category')?.value || '',
      from: document.getElementById('expenses-filter-from')?.value || '',
      to: document.getElementById('expenses-filter-to')?.value || '',
    };
    renderList();
  }

  function init() {
    document.getElementById('expense-form')?.addEventListener('submit', saveExpense);
    document.getElementById('expenses-reset-btn')?.addEventListener('click', resetForm);
    document.getElementById('expenses-search')?.addEventListener('input', Utils.debounce(updateFilters, 150));
    document.getElementById('expenses-filter-category')?.addEventListener('change', updateFilters);
    document.getElementById('expenses-filter-from')?.addEventListener('change', updateFilters);
    document.getElementById('expenses-filter-to')?.addEventListener('change', updateFilters);
    resetForm();
  }

  return { init, load };
})();

window.ExpensesModule = ExpensesModule;
