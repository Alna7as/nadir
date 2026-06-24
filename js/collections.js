/**
 * collections.js — صفحة تحصيلات العملاء (v3)
 *
 * الإصلاحات:
 * [1] التسديد يُسجَّل في invoice_payments فقط — لا تعديل مباشر على amountPaid/status
 * [3] openPayment يستخدم DB.addInvoicePayment + DB.computeShopBalance
 * [4] openDetail يقرأ invoice_payments بدل جدول payments القديم
 * [6] كل عملية تسديد ذرية قدر الإمكان (loop واحدة، ثم تحديث الرصيد)
 */

const CollectionsModule = (() => {

  let allShops    = [];
  let allInvoices = [];
  let searchQuery = '';
  let filterMode  = 'all';

  // ── المتبقي من الدفعات الفعلية (يُحدَّث عند كل load) ──
  // map: invoiceId → totalPaid من invoice_payments
  let _invPaymentsMap = {};

  function isRepUser() {
    return typeof OpsMeta !== 'undefined' && OpsMeta.isRep();
  }

  function currentRepId() {
    return String(OpsMeta.currentUser?.()?.id || '');
  }

  function canViewInvoiceForCurrentUser(invoice) {
    if (!isRepUser()) return true;
    return String(OpsMeta.getInvoiceOwner(invoice?.id)?.id || '') === currentRepId();
  }

  function getVisibleShopInvoices(shopId, invoices = allInvoices) {
    return (Array.isArray(invoices) ? invoices : []).filter(
      (i) => i.shopId == shopId && !i.isReturn && i.status !== 'void' && i.status !== 'draft' && canViewInvoiceForCurrentUser(i)
    );
  }

  function canAccessShopCollections(shop) {
    if (!isRepUser()) return true;
    const oldDebt = parseFloat(DebtStore.get(shop.id)) || 0;
    return oldDebt > 0 || getVisibleShopInvoices(shop.id).length > 0;
  }

  function invoiceRemaining(inv) {
    const total     = parseFloat(inv.total) || 0;
    const realPaid  = _invPaymentsMap[inv.id] ?? (parseFloat(inv.amountPaid) || 0);
    return Math.max(0, parseFloat((total - realPaid).toFixed(2)));
  }

  function shopRemaining(shopId) {
    const shopInvs = getVisibleShopInvoices(shopId);
    return parseFloat(
      shopInvs.reduce((sum, inv) => sum + invoiceRemaining(inv), 0).toFixed(2)
    );
  }

  async function load() {
    const [shops, invoices] = await Promise.all([
      DB.getAll('shops'),
      DB.getAllParsed('invoices'),
    ]);

    allInvoices = OpsMeta.filterInvoices(invoices);
    allShops    = isRepUser() ? shops.filter((shop) => canAccessShopCollections(shop)) : OpsMeta.filterShops(shops);

    // [1] نجلب مجاميع الدفعات لكل فاتورة من invoice_payments
    // (نجلب كل الدفعات مرة واحدة بدل loop على كل فاتورة)
    _invPaymentsMap = {};
    try {
      // نستخدم طلب واحد لكل الدفعات بدون فلتر — للأداء
      const allPayRows = await DB.req('GET', 'invoice_payments', null,
        '?select=invoice_id,amount&order=id.asc');
      for (const row of allPayRows) {
        const iid = row.invoice_id;
        _invPaymentsMap[iid] = (_invPaymentsMap[iid] || 0) + (parseFloat(row.amount) || 0);
      }
    } catch (e) {
      const cachedPayments = typeof DB !== 'undefined' ? DB.getCachedTable('invoice_payments') : [];
      if (cachedPayments.length > 0) {
        cachedPayments.forEach((row) => {
          const iid = row.invoiceId ?? row.invoice_id;
          _invPaymentsMap[iid] = (_invPaymentsMap[iid] || 0) + (parseFloat(row.amount) || 0);
        });
      } else {
        // fallback أخير فقط لو لا توجد دفعات حقيقية حتى في الكاش.
        console.warn('invoice_payments غير متاح، fallback لـ amountPaid', e);
        for (const inv of invoices) {
          _invPaymentsMap[inv.id] = parseFloat(inv.amountPaid) || 0;
        }
      }
    }

    renderSummary();
    render();
  }

  function renderSummary() {
    const isRep = typeof OpsMeta !== 'undefined' && OpsMeta.isRep();
    const currentRepName = OpsMeta.currentUser?.()?.name || 'المندوب';
    const debts = allShops.map(sh => ({
      ...sh,
      liveBalance: shopRemaining(sh.id)
    }));

    const totalDebt  = debts.reduce((s, sh) => s + (parseFloat(sh.liveBalance) || 0), 0);
    const debtCount  = debts.filter(sh => (sh.liveBalance || 0) > 0).length;
    const clearCount = debts.filter(sh => !(sh.liveBalance > 0)).length;

    const el = document.getElementById('collections-summary');
    if (!el) return;

    const debtRows = debts.map(sh => ({
      ...sh,
      oldDebt: DebtStore.get(sh.id),
      totalDebt: (parseFloat(sh.liveBalance) || 0) + (DebtStore.get(sh.id) || 0),
    }));
    const totalOldDebt = debtRows.reduce((s, sh) => s + (parseFloat(sh.oldDebt) || 0), 0);
    const totalNewDebt = debtRows.reduce((s, sh) => s + (parseFloat(sh.liveBalance) || 0), 0);
    const grandDebt    = totalOldDebt + totalNewDebt;
    const debtClients  = debtRows.filter(sh => (sh.totalDebt || 0) > 0).length;

    el.innerHTML = `
      ${isRep ? `<div class="card" style="margin-bottom:12px;padding:12px 14px;background:rgba(103,183,247,0.08);border-color:rgba(103,183,247,0.18);"><div style="font-size:12px;font-weight:700;color:var(--accent);">يتم عرض تحصيل ${escapeHtml(currentRepName)} فقط</div><div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">إجمالي التحصيل لكل المناديب متاح للمدير فقط.</div></div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
        <div style="background:rgba(224,82,82,0.1);border:1px solid rgba(224,82,82,0.3);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#e05252;margin-bottom:4px;font-weight:600;">${isRep ? 'مديونياتك الحالية' : 'إجمالي المديونيات'}</div>
          <div style="font-family:var(--font-mono);font-weight:700;font-size:14px;color:#e05252;">${Utils.currency(grandDebt)}</div>
        </div>
        <div style="background:rgba(91,156,246,0.08);border:1px solid rgba(91,156,246,0.2);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">قديمة</div>
          <div style="font-family:var(--font-mono);font-weight:700;font-size:14px;color:var(--info);">${Utils.currency(totalOldDebt)}</div>
        </div>
        <div style="background:rgba(224,82,82,0.07);border:1px solid rgba(224,82,82,0.2);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">جديدة</div>
          <div style="font-family:var(--font-mono);font-weight:700;font-size:14px;color:var(--danger);">${Utils.currency(totalNewDebt)}</div>
        </div>
        <div style="background:rgba(74,222,128,0.07);border:1px solid rgba(74,222,128,0.2);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">عملاء عليهم دين</div>
          <div style="font-family:var(--font-mono);font-weight:700;font-size:18px;color:var(--accent);">${debtClients}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        <button onclick="CollectionsModule.setFilter('all')" class="btn btn-sm ${filterMode==='all'?'btn-primary':'btn-secondary'}" style="flex:1;font-size:11px;">الكل</button>
        <button onclick="CollectionsModule.setFilter('debt')" class="btn btn-sm ${filterMode==='debt'?'btn-danger':'btn-secondary'}" style="flex:1;font-size:11px;">عليهم دين</button>
        <button onclick="CollectionsModule.setFilter('clear')" class="btn btn-sm ${filterMode==='clear'?'btn-success':'btn-secondary'}" style="flex:1;font-size:11px;">مسددين</button>
      </div>`;
    return;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
        <div style="background:rgba(224,82,82,0.1);border:1px solid rgba(224,82,82,0.3);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#e05252;margin-bottom:4px;font-weight:600;">إجمالي المديونيات</div>
          <div style="font-family:var(--font-mono);font-weight:700;font-size:14px;color:#e05252;">${Utils.currency(totalDebt)}</div>
        </div>
        <div style="background:rgba(224,82,82,0.07);border:1px solid rgba(224,82,82,0.2);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">عملاء عليهم دين</div>
          <div style="font-family:var(--font-mono);font-weight:700;font-size:18px;color:var(--accent);">${debtCount}</div>
        </div>
        <div style="background:rgba(74,222,128,0.07);border:1px solid rgba(74,222,128,0.2);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">عملاء مسددين</div>
          <div style="font-family:var(--font-mono);font-weight:700;font-size:18px;color:#4ade80;">${clearCount}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        <button onclick="CollectionsModule.setFilter('all')"   class="btn btn-sm ${filterMode==='all'  ?'btn-primary':'btn-secondary'}" style="flex:1;font-size:11px;">الكل</button>
        <button onclick="CollectionsModule.setFilter('debt')"  class="btn btn-sm ${filterMode==='debt' ?'btn-danger' :'btn-secondary'}" style="flex:1;font-size:11px;">عليهم دين</button>
        <button onclick="CollectionsModule.setFilter('clear')" class="btn btn-sm ${filterMode==='clear'?'btn-success':'btn-secondary'}" style="flex:1;font-size:11px;">مسددين</button>
      </div>`;
  }

  function setFilter(mode) {
    filterMode = mode;
    renderSummary();
    render();
  }

  function render() {
    const container = document.getElementById('collections-list');
    if (!container) return;

    const q = searchQuery.toLowerCase();

    let filtered = allShops
      .map(s => ({ ...s, liveBalance: shopRemaining(s.id), oldDebt: DebtStore.get(s.id) }))
      .filter(s => {
        if (q && !s.name.toLowerCase().includes(q) && !(s.phone || '').includes(q)) return false;
        const totalDebt = (s.liveBalance || 0) + (s.oldDebt || 0);
        if (filterMode === 'debt'  && !(totalDebt > 0)) return false;
        if (filterMode === 'clear' &&  (totalDebt > 0)) return false;
        return true;
      });

    filtered.sort((a, b) => (((parseFloat(b.liveBalance) || 0) + (parseFloat(b.oldDebt) || 0)) - ((parseFloat(a.liveBalance) || 0) + (parseFloat(a.oldDebt) || 0))));

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg><p>لا يوجد عملاء</p></div>`;
      return;
    }

    container.innerHTML = filtered.map(s => renderDebtCollectionCard(s)).join('');

    container.querySelectorAll('[data-collect-pay]').forEach(btn =>
      btn.addEventListener('click', () => openPayment(parseInt(btn.dataset.collectPay))));
    container.querySelectorAll('[data-collect-print]').forEach(btn =>
      btn.addEventListener('click', () => printStatement(parseInt(btn.dataset.collectPrint))));
    container.querySelectorAll('[data-collect-detail]').forEach(btn =>
      btn.addEventListener('click', () => openDetail(parseInt(btn.dataset.collectDetail))));
    container.querySelectorAll('[data-collect-old-debt]').forEach(btn =>
      btn.addEventListener('click', () => openOldDebtEditor(parseInt(btn.dataset.collectOldDebt))));
  }

  function renderCollectionCard(s) {
    const balance      = parseFloat(s.liveBalance) || 0;
    const hasDebt      = balance > 0;
    const returnsTotal = parseFloat(s.returnsTotal) || 0;
    const hue          = Math.abs(s.name.split('').reduce((a,c) => a + c.charCodeAt(0), 0)) % 360;

    const shopInvs = getVisibleShopInvoices(s.id);
    const totalRemaining = shopInvs.reduce((sum, i) => sum + invoiceRemaining(i), 0);
    const pendingCount   = shopInvs.filter(i => invoiceRemaining(i) > 0).length;

    return `
      <div class="card" style="${hasDebt ? 'border-right:3px solid var(--danger);' : 'border-right:3px solid #4ade80;'}">
        <div class="card-row" style="align-items:flex-start;">
          <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;background:hsl(${hue},40%,25%);border:1px solid hsl(${hue},40%,35%);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:hsl(${hue},70%,70%);">${escapeHtml(s.name.substring(0,2))}</div>
          <div style="flex:1;min-width:0;padding-right:10px;">
            <div class="card-title">${escapeHtml(s.name)}</div>
            ${s.phone ? `<div class="card-sub">📞 ${escapeHtml(s.phone)}</div>` : ''}
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
              <div style="display:flex;justify-content:space-between;align-items:center;background:${hasDebt?'rgba(224,82,82,0.12)':'rgba(74,222,128,0.08)'};border:1px solid ${hasDebt?'rgba(224,82,82,0.3)':'rgba(74,222,128,0.25)'};border-radius:6px;padding:6px 10px;">
                <span style="font-size:11px;color:${hasDebt?'var(--danger)':'#4ade80'};font-weight:700;">${hasDebt ? '💳 المتبقي الحالي' : '✓ لا يوجد دين'}</span>
                <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:${hasDebt?'var(--danger)':'#4ade80'};">${Utils.currency(balance)}</span>
              </div>
              ${pendingCount > 0 ? `<div style="font-size:10px;color:var(--accent);padding:2px 4px;">⏳ ${pendingCount} فاتورة عليها متبقي</div>` : ''}
              ${returnsTotal > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 4px;"><span style="color:#60a5fa;">↩ المرتجعات</span><span style="font-family:var(--font-mono);color:#60a5fa;">${Utils.currency(returnsTotal)}</span></div>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
            ${hasDebt ? `<button class="btn btn-success btn-sm" data-collect-pay="${s.id}" style="font-size:11px;">💰 تسديد</button>` : ''}
            <button class="btn btn-primary btn-sm" data-collect-print="${s.id}" style="font-size:11px;">🖨 طباعة</button>
            <button class="btn btn-secondary btn-sm" data-collect-detail="${s.id}" style="font-size:11px;">📋 سجل</button>
          </div>
        </div>
      </div>`;
  }

  function renderDebtCollectionCard(s) {
    const newDebt      = parseFloat(s.liveBalance) || 0;
    const oldDebt      = parseFloat(s.oldDebt) || 0;
    const totalDebt    = parseFloat((newDebt + oldDebt).toFixed(2));
    const hasDebt      = totalDebt > 0;
    const returnsTotal = parseFloat(s.returnsTotal) || 0;
    const hue          = Math.abs(s.name.split('').reduce((a,c) => a + c.charCodeAt(0), 0)) % 360;

    const shopInvs = getVisibleShopInvoices(s.id);
    const pendingCount = shopInvs.filter(i => invoiceRemaining(i) > 0).length;

    return `
      <div class="card" style="${hasDebt ? 'border-right:3px solid var(--danger);' : 'border-right:3px solid #4ade80;'}">
        <div class="card-row shop-card-row" style="align-items:flex-start;">
          <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;background:hsl(${hue},40%,25%);border:1px solid hsl(${hue},40%,35%);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:hsl(${hue},70%,70%);">${escapeHtml(s.name.substring(0,2))}</div>
          <div style="flex:1;min-width:0;padding-right:10px;">
            <div class="card-title">${escapeHtml(s.name)}</div>
            ${s.phone ? `<div class="card-sub">📞 ${escapeHtml(s.phone)}</div>` : ''}
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
              <div style="background:${hasDebt?'rgba(224,82,82,0.12)':'rgba(74,222,128,0.08)'};border:1px solid ${hasDebt?'rgba(224,82,82,0.3)':'rgba(74,222,128,0.25)'};border-radius:8px;padding:8px 10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:11px;color:${hasDebt?'var(--danger)':'#4ade80'};font-weight:700;">${hasDebt ? 'المديونيات' : '✓ لا يوجد دين'}</span>
                  <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:${hasDebt?'var(--danger)':'#4ade80'};">${Utils.currency(totalDebt)}</span>
                </div>
                ${hasDebt ? `
                  <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);padding-top:6px;">
                    <span>قديمة</span>
                    <span style="font-family:var(--font-mono);">${Utils.currency(oldDebt)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);padding-top:2px;">
                    <span>جديدة</span>
                    <span style="font-family:var(--font-mono);">${Utils.currency(newDebt)}</span>
                  </div>` : ''}
              </div>
              ${pendingCount > 0 ? `<div style="font-size:10px;color:var(--accent);padding:2px 4px;">⏳ ${pendingCount} فاتورة عليها متبقي</div>` : ''}
              ${returnsTotal > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 4px;"><span style="color:#60a5fa;">↩ المرتجعات</span><span style="font-family:var(--font-mono);color:#60a5fa;">${Utils.currency(returnsTotal)}</span></div>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
            ${hasDebt ? `<button class="btn btn-success btn-sm" data-collect-pay="${s.id}" style="font-size:11px;">💰 تسديد</button>` : ''}
            ${OpsMeta.isAdmin() ? `<button class="btn btn-secondary btn-sm" data-collect-old-debt="${s.id}" style="font-size:11px;">✏️ قديم</button>` : ''}
            <button class="btn btn-primary btn-sm" data-collect-print="${s.id}" style="font-size:11px;">🖨 طباعة</button>
            <button class="btn btn-secondary btn-sm" data-collect-detail="${s.id}" style="font-size:11px;">📋 سجل</button>
          </div>
        </div>
      </div>`;
  }

  async function openOldDebtEditor(shopId) {
    if (!OpsMeta.isAdmin()) return;
    const shop = await DB.get('shops', shopId);
    if (!shop) return;
    const currentOldDebt = DebtStore.get(shopId);
    const val = window.prompt(
      `تعديل المديونية القديمة: ${shop.name}\nالقيمة الحالية: ${Utils.currency(currentOldDebt)}\nأدخل القيمة الجديدة:`,
      currentOldDebt
    );
    if (val === null) return;
    const nextDebt = Math.max(0, parseFloat(val) || 0);
    DebtStore.set(shopId, nextDebt);
    Toast.success(`تم تحديث المديونية القديمة إلى ${Utils.currency(nextDebt)} ✓`);
    await load();
    if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
    if (typeof DashboardModule !== 'undefined') DashboardModule.load().catch(() => {});
  }

  // ── [1] [3] [6] openPayment — atomic عبر RPC ──
  async function openPayment(shopId) {
    const shop = await DB.get('shops', shopId);
    if (!shop) return;

    const newDebt = shopRemaining(shopId);
    const oldDebt = parseFloat(DebtStore.get(shopId)) || 0;
    const currentDebt = parseFloat((newDebt + oldDebt).toFixed(2));
    if (currentDebt <= 0) {
      Toast.info('لا يوجد دين على هذا العميل');
      return;
    }

    const amtStr = window.prompt(
      `تسديد مديونية: ${shop.name}\n` +
      `المديونية القديمة: ${Utils.currency(oldDebt)}\n` +
      `المديونية الجديدة: ${Utils.currency(newDebt)}\n` +
      `إجمالي المستحق: ${Utils.currency(currentDebt)}\n` +
      `أدخل المبلغ المسدَّد:`
    );

    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) return;

    const actualAmt = Math.min(parseFloat(amt.toFixed(2)), currentDebt);
    if (amt > currentDebt + 0.01) {
      Toast.info(`تم تعديل المبلغ إلى ${Utils.currency(actualAmt)} (لا يتجاوز إجمالي المستحق)`);
    }

    const paidOldDebt = Math.min(oldDebt, actualAmt);
    const invoiceShare = parseFloat(Math.max(0, actualAmt - paidOldDebt).toFixed(2));
    const nextOldDebt = parseFloat(Math.max(0, oldDebt - paidOldDebt).toFixed(2));

    function commitOldDebtSettlement() {
      if (paidOldDebt <= 0) return;
      if (nextOldDebt > 0) DebtStore.set(shopId, nextOldDebt);
      else DebtStore.remove(shopId);
    }

    if (!DB.isOnline()) {
      if (invoiceShare > 0) {
        DB.enqueueShopCollection(shopId, invoiceShare, `تسديد من صفحة التحصيلات — ${shop.name}`);
      }
      commitOldDebtSettlement();
      const remainingTotal = parseFloat((nextOldDebt + Math.max(0, newDebt - invoiceShare)).toFixed(2));
      const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
      Toast.success(localOnly
        ? `تم حفظ التسديد ${Utils.currency(actualAmt)} على هذا الجهاز • المتبقي ${Utils.currency(remainingTotal)} ✓`
        : `تم حفظ التسديد ${Utils.currency(actualAmt)} محليًا والمتبقي ${Utils.currency(remainingTotal)} ✓`);
      await load();
      if (typeof InvoicesModule  !== 'undefined') InvoicesModule.load().catch(() => {});
      if (typeof ShopsModule     !== 'undefined') ShopsModule.load().catch(() => {});
      if (typeof DashboardModule !== 'undefined') DashboardModule.load().catch(() => {});
      return;
    }

    let collectionCommitted = false;
    let collectionVia = '';
    if (invoiceShare > 0) {
      try {
        if (isRepUser()) throw new Error('rep_manual_scope_only');
        const result = await DB.callRpc('collect_payment_atomic', {
          shopId:        shopId,
          amount:        invoiceShare,
          paymentMethod: 'cash',
          note:          `تسديد من صفحة التحصيلات — ${shop.name}`,
        });

        if (result?.ok) {
          commitOldDebtSettlement();
          collectionCommitted = true;
          collectionVia = 'rpc';
          const newBalance = parseFloat(result.newBalance ?? 0);
          const remainingTotal = parseFloat((nextOldDebt + newBalance).toFixed(2));
          Toast.success(`تم تسجيل تسديد ${Utils.currency(actualAmt)} ✓  |  المتبقي: ${Utils.currency(remainingTotal)}`);
        }
      } catch (rpcErr) {
        console.warn('[collections] collect_payment_atomic فشل — fallback يدوي:', rpcErr.message);
      }
    } else {
      commitOldDebtSettlement();
      collectionCommitted = true;
      collectionVia = 'old_debt_only';
      Toast.success(`تم تسجيل تسديد ${Utils.currency(actualAmt)} ✓  |  المتبقي: ${Utils.currency(nextOldDebt)}`);
    }

    if (!collectionCommitted && invoiceShare > 0) {
      const allInvs = await DB.getAllParsed('invoices');
      const pendingInvs = allInvs
        .filter(i =>
          i.shopId == shopId &&
          !i.isReturn &&
          i.status !== 'void' &&
          i.status !== 'draft' &&
          canViewInvoiceForCurrentUser(i) &&
          invoiceRemaining(i) > 0
        )
        .sort((a, b) => a.id - b.id);

      let leftover = invoiceShare;
      const now = Utils.localNow();
      let anyFailed = false;

      for (const inv of pendingInvs) {
        if (leftover <= 0.005) break;

        const invRemaining = invoiceRemaining(inv);
        if (invRemaining <= 0) continue;

        const toApply = parseFloat(Math.min(leftover, invRemaining).toFixed(2));

        try {
          await DB.addInvoicePayment({
            invoiceId:     inv.id,
            shopId:        shopId,
            amount:        toApply,
            paymentMethod: 'cash',
            paidAt:        now,
            note:          'تسديد من صفحة التحصيلات',
          });

          _invPaymentsMap[inv.id] = (_invPaymentsMap[inv.id] || 0) + toApply;
          leftover = parseFloat((leftover - toApply).toFixed(2));
        } catch (err) {
          Toast.error(`فشل تسجيل دفعة للفاتورة ${inv.number}: ${err.message || ''}`);
          console.error(err);
          anyFailed = true;
          break;
        }
      }

      try {
        const newBalance = await DB.computeShopBalance(shopId);
        await DB.put('shops', { ...shop, balance: newBalance });
        if (!anyFailed && leftover <= 0.005) {
          commitOldDebtSettlement();
          collectionCommitted = true;
          collectionVia = 'fallback';
          const remainingTotal = parseFloat((nextOldDebt + newBalance).toFixed(2));
          Toast.success(`تم تسجيل تسديد ${Utils.currency(actualAmt)} ✓  |  المتبقي: ${Utils.currency(remainingTotal)}`);
        } else {
          const appliedInvoiceShare = parseFloat(Math.max(0, invoiceShare - leftover).toFixed(2));
          Toast.error(`Only ${Utils.currency(appliedInvoiceShare)} of invoice debt was recorded; old debt stayed unchanged to avoid an inconsistent save.`);
          if (false) {
          Toast.error(`تم تسجيل ${Utils.currency(appliedInvoiceShare)} فقط من جزء الفواتير، ولم يُخصم الدين القديم لتجنب حفظ غير مكتمل.`);
          }
        }
      } catch (err) {
        console.error('فشل تحديث رصيد العميل:', err);
      }
    }

    if (collectionCommitted) {
      await DB.addAuditLog({
      entityType: 'shop',
      entityId:   shopId,
      action:     'payment_collected',
      newValue:   { amount: actualAmt, oldDebtPaid: paidOldDebt, invoiceDebtPaid: invoiceShare, via: collectionVia },
      note:       `تسديد ${Utils.currency(actualAmt)} من صفحة التحصيلات`,
      });
    }

    await load();
    if (typeof InvoicesModule  !== 'undefined') InvoicesModule.load().catch(() => {});
    if (typeof ShopsModule     !== 'undefined') ShopsModule.load().catch(() => {});
    if (typeof DashboardModule !== 'undefined') DashboardModule.load().catch(() => {});
  }

  // ── [4] openDetail — يقرأ invoice_payments للسجل الحقيقي ──
  async function openDetail(shopId) {
    const shop = allShops.find(s => s.id === shopId);
    if (!shop) return;

    // جلب الدفعات الحقيقية من invoice_payments
    let invoicePayments = [];
    try {
      invoicePayments = await DB.getShopInvoicePayments(shopId);
    } catch (e) {
      console.warn('invoice_payments غير متاح، fallback للـ payments القديم');
      invoicePayments = await DB.getPayments(shopId);
    }

    let shopInvs = [];
    try {
      const shopInvsRaw = await DB.req('GET', 'invoices', null,
        `?shop_id=eq.${shopId}&order=id.desc`);

      shopInvs = shopInvsRaw.map(r => {
          const c = {};
        const map = {
          shop_id:'shopId', shop_name:'shopName', is_return:'isReturn',
          return_of:'returnOf', amount_paid:'amountPaid', created_at:'createdAt',
          updated_at:'updatedAt', tax_pct:'taxPct', is_returned:'isReturned'
        };
        for (const k of Object.keys(r)) { c[map[k] || k] = r[k]; }
        if (c.items && typeof c.items === 'string') {
          try { c.items = JSON.parse(c.items); } catch(e) {}
        }
        return c;
      }).filter((inv) => canViewInvoiceForCurrentUser(inv));
    } catch (e) {
      console.warn('invoices unavailable, fallback to cached list', e);
      shopInvs = allInvoices
        .filter((inv) => String(inv.shopId) === String(shopId) && canViewInvoiceForCurrentUser(inv))
        .map((inv) => {
          let items = inv.items;
          if (!Array.isArray(items) && typeof items === 'string') {
            try { items = JSON.parse(items || '[]'); } catch (_) { items = []; }
          }
          return { ...inv, items: Array.isArray(items) ? items : [] };
        });
    }

    const visibleInvoiceIds = new Set(shopInvs.map((inv) => String(inv.id)));
    invoicePayments = invoicePayments.filter((payment) => visibleInvoiceIds.has(String(payment.invoiceId || payment.invoice_id)));

    shopInvs.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    const regular  = shopInvs.filter(i => !i.isReturn && i.status !== 'void');
    const returns  = shopInvs.filter(i => i.isReturn);
    const totalCollected = invoicePayments.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
    const totalRemaining = regular.reduce((s,i) => s + invoiceRemaining(i), 0);
    const statusLabels = {
      paid:'مدفوعة', pending:'معلقة', void:'ملغاة',
      return:'مرتجع', partial:'جزئي', draft:'مسودة'
    };

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.8);display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--bg-secondary);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;direction:rtl;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:700;color:var(--accent);">📋 كشف حساب — ${escapeHtml(shop.name)}</div>
          <button onclick="this.closest('div[style*=fixed]').remove()" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--text-primary);font-family:var(--font-main);cursor:pointer;font-size:12px;">✕ إغلاق</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
          <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">إجمالي المتبقي</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);">${Utils.currency(totalRemaining)}</div>
          </div>
          <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">إجمالي المحصّل</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#4ade80;">${Utils.currency(totalCollected)}</div>
          </div>
          <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:#60a5fa;margin-bottom:3px;">المرتجعات</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#60a5fa;">${Utils.currency(returns.reduce((s,i)=>s+(parseFloat(i.total)||0),0))}</div>
          </div>
          <div style="background:${totalRemaining>0?'rgba(224,82,82,0.15)':'rgba(74,222,128,0.1)'};border:1px solid ${totalRemaining>0?'rgba(224,82,82,0.3)':'rgba(74,222,128,0.3)'};border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">الرصيد المستحق</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:${totalRemaining>0?'var(--danger)':'#4ade80'};">${Utils.currency(totalRemaining)}</div>
          </div>
        </div>

        <div style="font-size:13px;font-weight:700;margin-bottom:8px;">الفواتير (${regular.length})</div>
        ${regular.length === 0
          ? '<div style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">لا توجد فواتير</div>'
          : regular.map(inv => {
              const rem  = invoiceRemaining(inv);
              const paid = (_invPaymentsMap[inv.id] || parseFloat(inv.amountPaid) || 0);
              return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
                <div>
                  <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${escapeHtml(inv.number)}</div>
                  <div style="font-size:10px;color:var(--text-muted);">${Utils.formatDate(inv.createdAt)} · ${statusLabels[inv.status]||inv.status}</div>
                  <div style="font-size:10px;color:${rem>0?'#e05252':'#4ade80'};">${rem>0 ? `متبقي: ${Utils.currency(rem)}` : '✓ مسددة'}</div>
                </div>
                <div style="text-align:left;">
                  <div style="font-family:var(--font-mono);font-weight:700;color:${rem>0?'#e05252':'#4ade80'};">${Utils.currency(rem > 0 ? rem : inv.total)}</div>
                  ${paid > 0 ? `<div style="font-size:10px;color:#4ade80;">محصّل: ${Utils.currency(paid)}</div>` : ''}
                </div>
              </div>`;
            }).join('')
        }

        ${invoicePayments.length > 0 ? `
        <div style="font-size:13px;font-weight:700;margin-top:14px;margin-bottom:8px;">سجل التسديدات (${invoicePayments.length})</div>
        ${invoicePayments.map(p => `
          <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);">
            <div>
              <div style="color:#4ade80;font-size:12px;">💰 ${p.paymentMethod === 'cash' ? 'نقدي' : p.paymentMethod === 'transfer' ? 'تحويل' : 'دفع'}</div>
              <div style="font-size:10px;color:var(--text-muted);">${Utils.formatDate(p.paidAt || p.createdAt)} ${p.note?'· '+escapeHtml(p.note):''}</div>
            </div>
            <div style="color:#4ade80;font-family:var(--font-mono);font-weight:700;font-size:13px;">+ ${Utils.currency(p.amount)}</div>
          </div>`).join('')}` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;">
          ${totalRemaining > 0
            ? `<button onclick="CollectionsModule.payFromDetail(${shopId},this)" class="btn btn-success btn-lg">💰 تسديد</button>`
            : '<div></div>'}
          <button onclick="CollectionsModule.printStatement(${shopId})" class="btn btn-primary btn-lg">🖨 طباعة الكشف</button>
        </div>
      </div>`;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  async function payFromDetail(shopId, btn) {
    const overlay = btn.closest('div[style*=fixed]');
    await openPayment(shopId);
    if (overlay) overlay.remove();
  }

  // ── printStatement يستخدم invoice_payments ──
  async function printStatement(shopId) {
    const STORE = DB.getStoreSettings();
    const shop  = allShops.find(s => s.id === shopId) || await DB.get('shops', shopId);
    if (!shop) return;

    let invoicePayments = [];
    try {
      invoicePayments = await DB.getShopInvoicePayments(shopId);
    } catch(e) {
      invoicePayments = await DB.getPayments(shopId);
    }

    const shopInvs = allInvoices
      .filter(i => i.shopId == shopId && !i.isReturn && i.status !== 'void' && canViewInvoiceForCurrentUser(i))
      .sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt));

    const visibleInvoiceIds = new Set(shopInvs.map((inv) => String(inv.id)));
    invoicePayments = invoicePayments.filter((payment) => visibleInvoiceIds.has(String(payment.invoiceId || payment.invoice_id)));

    const totalRemaining = shopInvs.reduce((s,i) => s + invoiceRemaining(i), 0);
    const oldDebt = parseFloat(DebtStore.get(shopId)) || 0;
    const totalDue = parseFloat((oldDebt + totalRemaining).toFixed(2));
    const totalCollected = invoicePayments.reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
    const statusLabels   = {
      paid:'مدفوعة', pending:'معلقة', void:'ملغاة',
      return:'مرتجع', partial:'جزئي', draft:'مسودة'
    };
    const printDate = new Date().toLocaleString('ar-EG');

    const receiptHTML = `
      <div id="receipt-content" style="
        font-family:'Cairo','Courier New',Courier,monospace;
        font-size:13px;
        line-height:1.75;
        color:#000;
        background:#fff;
        width:100%;
        max-width:340px;
        margin:0 auto;
        padding:14px 12px;
        word-break:break-word;
        direction:rtl;
        text-align:right;
      ">
      <div style="text-align:center;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:900;">${escapeHtml(STORE.name)}</div>
        <div style="font-size:9px;color:#444;">${escapeHtml(STORE.address)}</div>
        <div style="font-size:9px;color:#444;">${escapeHtml(STORE.phone)}</div>
      </div>
      <div style="border-top:1px dashed #999;margin:5px 0;"></div>
      <div style="font-size:11px;font-weight:700;text-align:center;margin-bottom:4px;">كشف حساب</div>
      <div style="font-size:10px;margin-bottom:2px;"><b>العميل:</b> ${escapeHtml(shop.name)}</div>
      ${shop.phone ? `<div style="font-size:9px;color:#444;">📞 ${escapeHtml(shop.phone)}</div>` : ''}
      <div style="font-size:9px;color:#444;">التاريخ: ${printDate}</div>
      <div style="border-top:1px dashed #999;margin:5px 0;"></div>
      <div style="font-size:10px;font-weight:700;margin-bottom:3px;">الفواتير (${shopInvs.length})</div>
      ${shopInvs.map(inv => {
        const paid = (_invPaymentsMap[inv.id] || parseFloat(inv.amountPaid) || 0);
        const rem  = invoiceRemaining(inv);
        return `<div style="display:flex;justify-content:space-between;font-size:9px;margin:2px 0;border-bottom:1px dotted #ddd;padding-bottom:2px;">
          <div>
            <div style="font-weight:600;">${escapeHtml(inv.number)}</div>
            <div style="color:#555;">${Utils.formatDate(inv.createdAt)} · ${statusLabels[inv.status]||inv.status}</div>
          </div>
          <div style="text-align:left;">
            <div style="font-weight:700;color:${rem>0?'#dc2626':'#16a34a'};">${Utils.currency(rem)}</div>
            ${paid > 0 ? `<div style="color:#16a34a;font-size:8px;">محصّل: ${Utils.currency(paid)}</div>` : ''}
          </div>
        </div>`;
      }).join('')}
      <div style="border-top:1px dashed #999;margin:5px 0;"></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;margin:2px 0;">
        <span>المديونية القديمة</span><span style="font-weight:700;">${Utils.currency(oldDebt)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;margin:2px 0;">
        <span>إجمالي المتبقي</span><span style="font-weight:700;">${Utils.currency(totalRemaining)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;margin:2px 0;">
        <span>إجمالي المحصّل</span><span style="font-weight:700;color:#16a34a;">${Utils.currency(totalCollected)}</span>
      </div>
      ${(parseFloat(shop.returnsTotal)||0) > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:10px;margin:2px 0;">
        <span>المرتجعات</span><span style="font-weight:700;color:#2563eb;">${Utils.currency(parseFloat(shop.returnsTotal)||0)}</span>
      </div>` : ''}
      <div style="border-top:1px solid #000;margin:5px 0;"></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:900;margin:3px 0;">
        <span>${totalDue > 0 ? '💳 الرصيد المستحق' : '✓ مسدد بالكامل'}</span>
        <span style="color:${totalDue>0?'#dc2626':'#16a34a'};">${Utils.currency(totalDue)}</span>
      </div>
      ${invoicePayments.length > 0 ? `
      <div style="border-top:1px dashed #999;margin:5px 0;"></div>
      <div style="font-size:10px;font-weight:700;margin-bottom:3px;">سجل التسديدات</div>
      ${invoicePayments.map(p => `
        <div style="display:flex;justify-content:space-between;font-size:9px;margin:2px 0;">
          <span>${Utils.formatDate(p.paidAt || p.createdAt)}</span>
          <span style="color:#16a34a;font-weight:700;">+ ${Utils.currency(p.amount)}</span>
        </div>`).join('')}` : ''}
      <div style="border-top:1px dashed #999;margin:6px 0 4px;text-align:center;font-size:9px;color:#777;">
        ${escapeHtml(STORE.name)}<br>${printDate}
      </div>
      </div>`;

    PrintModule.previewCustom(receiptHTML, {
      pageSize: '55mm',
      title: `كشف حساب ${shop.name}`,
    });
  }

  function init() {
    document.getElementById('collections-search')?.addEventListener('input',
      Utils.debounce((e) => { searchQuery = e.target.value; render(); }, 200)
    );
  }

  return { load, init, setFilter, printStatement, payFromDetail, openDetail };
})();

window.CollectionsModule = CollectionsModule;
