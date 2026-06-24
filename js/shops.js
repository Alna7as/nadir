/**
 * shops.js — إدارة العملاء (v3 — إصلاحات محاسبية شاملة)
 *
 * الإصلاحات المطبّقة:
 * [1]  openPayment: لا تعديل مباشر على inv.amountPaid أو inv.status
 * [2]  لا استخدام لجدول payments القديم في أي عملية سداد
 * [3]  كل دفعة تُسجَّل في invoice_payments فقط
 * [4]  amountPaid و status مشتقان من مجموع invoice_payments الفعلية
 * [5]  منع السداد على فاتورة void مع رسالة واضحة
 * [6]  openShopLog يقرأ من invoice_payments كمصدر موحد
 * [7]  collect_payment_atomic RPC للذرية — مع fallback يدوي آمن
 * [8]  رصيد العميل من computeShopBalance (مصدر موحد)
 * [9]  audit_log لكل تسديد
 */

const ShopsModule = (() => {

  let allShops    = [];
  let editingId   = null;
  let searchQuery = '';

  const listEl       = () => document.getElementById('shops-list');
  const modalEl      = () => document.getElementById('shop-modal');
  const formEl       = () => document.getElementById('shop-form');
  const modalTitleEl = () => document.getElementById('shop-modal-title');
  const countEl      = () => document.getElementById('shops-count');

  // ── [4] اشتقاق status من totalPaid و total ──
  function deriveStatus(totalPaid, total) {
    const paid = parseFloat(totalPaid) || 0;
    const tot  = parseFloat(total)     || 0;
    if (paid <= 0)           return 'pending';
    if (paid >= tot - 0.01) return 'paid';
    return 'partial';
  }

  function buildInvoicePaymentsMap(payments) {
    const map = {};
    (payments || []).forEach((payment) => {
      const invoiceId = payment.invoiceId || payment.invoice_id;
      if (!invoiceId) return;
      map[invoiceId] = (map[invoiceId] || 0) + (parseFloat(payment.amount) || 0);
    });
    return map;
  }

  // ── [4] sync فاتورة من invoice_payments (المصدر الحقيقي) ──
  async function syncInvoiceFromPayments(inv) {
    try {
      const payments  = await DB.getInvoicePayments(inv.id);
      const totalPaid = parseFloat(payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0).toFixed(2));
      const newStatus = deriveStatus(totalPaid, inv.total);

      const currentPaid   = parseFloat(inv.amountPaid) || 0;
      const currentStatus = inv.status;

      if (Math.abs(totalPaid - currentPaid) > 0.009 || newStatus !== currentStatus) {
        await DB.put('invoices', { ...inv, amountPaid: totalPaid, status: newStatus });
      }
      return { amountPaid: totalPaid, status: newStatus };
    } catch (e) {
      console.warn('[shops] syncInvoiceFromPayments failed:', e);
      return null;
    }
  }

  async function load() {
    try {
      allShops = OpsMeta.filterShops(await DB.getAll('shops'));
    } catch (e) {
      allShops = OpsMeta.filterShops(DB.getCachedTable('shops'));
    }
    render();
  }

  function render() {
    const container = listEl();
    if (!container) return;
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? allShops.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.contact || '').toLowerCase().includes(q) ||
          (s.phone   || '').includes(q)
        )
      : allShops;
    if (countEl()) countEl().textContent = allShops.length;

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg><p>${q ? 'لا يوجد عملاء يطابقون البحث.' : 'لا يوجد عملاء بعد!'}</p></div>`;
      return;
    }

    container.innerHTML = filtered.map(s => renderDebtAwareShopCard(s)).join('');

    container.querySelectorAll('[data-edit]').forEach(btn =>
      btn.addEventListener('click', () => openEdit(parseInt(btn.dataset.edit))));
    container.querySelectorAll('[data-delete]').forEach(btn =>
      btn.addEventListener('click', () => deleteShop(parseInt(btn.dataset.delete))));
    container.querySelectorAll('[data-invoice]').forEach(btn =>
      btn.addEventListener('click', () => {
        NewInvoiceModule.setShop(parseInt(btn.dataset.invoice));
        Router.navigate('new-invoice');
      }));
    container.querySelectorAll('[data-pay]').forEach(btn =>
      btn.addEventListener('click', () => openPayment(parseInt(btn.dataset.pay))));
    container.querySelectorAll('[data-log]').forEach(btn =>
      btn.addEventListener('click', () => openShopLog(parseInt(btn.dataset.log))));
    container.querySelectorAll('[data-old-debt]').forEach(btn =>
      btn.addEventListener('click', () => openOldDebtEditor(parseInt(btn.dataset.oldDebt))));
  }

  function renderShopCard(s) {
    const hue          = Math.abs(s.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
    const initials     = s.name.substring(0, 2);
    const newDebt      = parseFloat(s.balance) || 0;
    const oldDebt      = DebtStore.get(s.id);
    const totalDebt    = parseFloat((oldDebt + newDebt).toFixed(2));
    const hasDebt      = totalDebt > 0;
    const returnsTotal = parseFloat(s.returnsTotal) || 0;

    return `
      <div class="card">
        <div class="card-row" style="align-items:flex-start;">
          <div style="width:42px;height:42px;border-radius:10px;flex-shrink:0;background:hsl(${hue},40%,25%);border:1px solid hsl(${hue},40%,35%);display:flex;align-items:center;justify-content:center;font-family:var(--font-main);font-weight:700;font-size:13px;color:hsl(${hue},70%,70%);">${escapeHtml(initials)}</div>
          <div style="flex:1;min-width:0;padding-right:12px;">
            <div class="card-title">${escapeHtml(s.name)}</div>
            ${s.contact ? `<div class="card-sub" style="margin-top:2px;">👤 ${escapeHtml(s.contact)}</div>` : ''}
            ${s.phone   ? `<div class="card-sub">📞 ${escapeHtml(s.phone)}</div>` : ''}
            ${s.email   ? `<div class="card-sub">✉ ${escapeHtml(s.email)}</div>` : ''}
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;">
              ${hasDebt
                ? `<div style="background:rgba(224,82,82,0.15);border:1px solid rgba(224,82,82,0.3);border-radius:6px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--danger);font-size:12px;font-weight:700;">💳 الدين الحالي</span>
                    <span style="color:var(--danger);font-family:var(--font-mono);font-size:13px;font-weight:700;">${Utils.currency(totalDebt)}</span>
                   </div>`
                : `<div style="display:inline-block;"><span class="badge badge-green" style="font-size:10px;">✓ لا يوجد دين</span></div>`
              }
              ${returnsTotal > 0
                ? `<div style="background:rgba(96,165,250,0.12);border:1px solid rgba(96,165,250,0.25);border-radius:6px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#60a5fa;font-size:12px;font-weight:700;">↩ إجمالي المرتجعات</span>
                    <span style="color:#60a5fa;font-family:var(--font-mono);font-size:13px;font-weight:700;">${Utils.currency(returnsTotal)}</span>
                   </div>`
                : ''
              }
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
            <button class="btn btn-primary btn-sm" data-invoice="${s.id}" title="فاتورة جديدة">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              فاتورة
            </button>
            ${hasDebt ? `<button class="btn btn-success btn-sm" data-pay="${s.id}">💰 تسديد</button>` : ''}
            <div style="display:flex;gap:5px;">
              <button class="btn btn-secondary btn-icon btn-sm" data-log="${s.id}" title="سجل">📋</button>
              <button class="btn btn-secondary btn-icon btn-sm" data-edit="${s.id}" title="تعديل">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="btn btn-danger btn-icon btn-sm" data-delete="${s.id}" title="حذف">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderDebtAwareShopCard(s) {
    const hue          = Math.abs(s.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
    const initials     = s.name.substring(0, 2);
    const newDebt      = parseFloat(s.balance) || 0;
    const oldDebt      = DebtStore.get(s.id);
    const totalDebt    = parseFloat((oldDebt + newDebt).toFixed(2));
    const hasDebt      = totalDebt > 0;
    const returnsTotal = parseFloat(s.returnsTotal) || 0;

    return `
      <div class="card">
        <div class="card-row shop-card-row" style="align-items:flex-start;">
          <div style="width:42px;height:42px;border-radius:10px;flex-shrink:0;background:hsl(${hue},40%,25%);border:1px solid hsl(${hue},40%,35%);display:flex;align-items:center;justify-content:center;font-family:var(--font-main);font-weight:700;font-size:13px;color:hsl(${hue},70%,70%);">${escapeHtml(initials)}</div>
          <div style="flex:1;min-width:0;padding-right:12px;">
            <div class="card-title">${escapeHtml(s.name)}</div>
            ${s.contact ? `<div class="card-sub" style="margin-top:2px;">👤 ${escapeHtml(s.contact)}</div>` : ''}
            ${s.phone ? `<div class="card-sub">📞 ${escapeHtml(s.phone)}</div>` : ''}
            ${s.email ? `<div class="card-sub">✉ ${escapeHtml(s.email)}</div>` : ''}
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;">
              ${hasDebt ? `
                <div style="background:rgba(224,82,82,0.12);border:1px solid rgba(224,82,82,0.25);border-radius:10px;padding:8px 10px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="color:var(--danger);font-size:12px;font-weight:700;">المديونيات</span>
                    <span style="color:var(--danger);font-family:var(--font-mono);font-size:14px;font-weight:800;">${Utils.currency(totalDebt)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);padding:2px 0;">
                    <span>قديمة</span>
                    <span style="font-family:var(--font-mono);">${Utils.currency(oldDebt)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);padding:2px 0;">
                    <span>جديدة من الفواتير</span>
                    <span style="font-family:var(--font-mono);">${Utils.currency(newDebt)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--danger);font-weight:700;padding-top:4px;margin-top:4px;border-top:1px solid rgba(224,82,82,0.18);">
                    <span>الإجمالي النهائي</span>
                    <span style="font-family:var(--font-mono);">${Utils.currency(totalDebt)}</span>
                  </div>
                </div>` : `<div style="display:inline-block;"><span class="badge badge-green" style="font-size:10px;">✓ لا يوجد دين</span></div>`}
              ${returnsTotal > 0
                ? `<div style="background:rgba(96,165,250,0.12);border:1px solid rgba(96,165,250,0.25);border-radius:6px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#60a5fa;font-size:12px;font-weight:700;">↩ إجمالي المرتجعات</span>
                    <span style="color:#60a5fa;font-family:var(--font-mono);font-size:13px;font-weight:700;">${Utils.currency(returnsTotal)}</span>
                  </div>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
            <button class="btn btn-primary btn-sm" data-invoice="${s.id}" title="فاتورة جديدة">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              فاتورة
            </button>
            ${hasDebt ? `<button class="btn btn-success btn-sm" data-pay="${s.id}">💰 تسديد</button>` : ''}
            ${OpsMeta.isAdmin() ? `<button class="btn btn-secondary btn-sm" data-old-debt="${s.id}">✏️ دين قديم</button>` : ''}
            <div style="display:flex;gap:5px;">
              <button class="btn btn-secondary btn-icon btn-sm" data-log="${s.id}" title="سجل">📋</button>
              <button class="btn btn-secondary btn-icon btn-sm" data-edit="${s.id}" title="تعديل">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              ${OpsMeta.isAdmin() ? `<button class="btn btn-danger btn-icon btn-sm" data-delete="${s.id}" title="حذف">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  async function openOldDebtEditor(shopId) {
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
    if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
    if (typeof DashboardModule !== 'undefined') DashboardModule.load().catch(() => {});
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // [1][2][3][4][5][7][8][9] openPayment — المسار الرئيسي
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function openPayment(shopId) {
    const shop = await DB.get('shops', shopId);
    if (!shop) return;

    // [8] الدين من المصدر الموحد + المديونية القديمة
    let newDebt;
    try {
      newDebt = await DB.computeShopBalance(shopId);
    } catch (e) {
      newDebt = parseFloat(shop.balance) || 0;
    }
    const oldDebt = parseFloat(DebtStore.get(shopId)) || 0;
    const currentDebt = parseFloat((oldDebt + newDebt).toFixed(2));

    if (currentDebt <= 0.009) {
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

    const actualAmt = parseFloat(Math.min(amt, currentDebt).toFixed(2));
    if (amt > currentDebt + 0.01) {
      Toast.info(`تم تعديل المبلغ إلى ${Utils.currency(actualAmt)} (لا يتجاوز الدين الحالي)`);
    }

    const paidOldDebt = Math.min(oldDebt, actualAmt);
    const invoiceShare = parseFloat(Math.max(0, actualAmt - paidOldDebt).toFixed(2));
    const nextOldDebt = parseFloat(Math.max(0, oldDebt - paidOldDebt).toFixed(2));
    if (nextOldDebt > 0) DebtStore.set(shopId, nextOldDebt);
    else DebtStore.remove(shopId);

    if (!DB.isOnline()) {
      if (invoiceShare > 0) {
        DB.enqueueShopCollection(shopId, invoiceShare, `تسديد من شاشة العميل — ${shop.name}`);
      }
      const remainingTotal = parseFloat((nextOldDebt + Math.max(0, newDebt - invoiceShare)).toFixed(2));
      const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
      Toast.success(localOnly
        ? `تم حفظ التسديد ${Utils.currency(actualAmt)} على هذا الجهاز • المتبقي ${Utils.currency(remainingTotal)} ✓`
        : `تم حفظ التسديد ${Utils.currency(actualAmt)} محليًا والمتبقي ${Utils.currency(remainingTotal)} ✓`);
      await load();
      if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
      if (typeof DashboardModule   !== 'undefined') DashboardModule.load().catch(() => {});
      if (typeof InvoicesModule    !== 'undefined') InvoicesModule.load().catch(() => {});
      return;
    }

    // [7] محاولة atomic عبر RPC أولاً
    let rpcOk = false;
    try {
      if (invoiceShare > 0) {
        const result = await DB.callRpc('collect_payment_atomic', {
          shopId:        shopId,
          amount:        invoiceShare,
          paymentMethod: 'cash',
          note:          `تسديد من شاشة العميل — ${shop.name}`,
        });
        if (result?.ok) {
          rpcOk = true;
          const newBalance = parseFloat(result.newBalance ?? 0);
          const remainingTotal = parseFloat((nextOldDebt + newBalance).toFixed(2));
          Toast.success(`تم تسجيل تسديد ${Utils.currency(actualAmt)} ✓  |  المتبقي: ${Utils.currency(remainingTotal)}`);
        }
      } else {
        rpcOk = true;
        Toast.success(`تم تسجيل تسديد ${Utils.currency(actualAmt)} ✓  |  المتبقي: ${Utils.currency(nextOldDebt)}`);
      }
    } catch (rpcErr) {
      console.warn('[shops] collect_payment_atomic فشل — fallback يدوي:', rpcErr.message);
    }

    // [7] Fallback يدوي كامل
    if (!rpcOk) {
      const allInvs = await DB.getAllParsed('invoices');
      let pendingPaymentsMap = {};
      try {
        pendingPaymentsMap = buildInvoicePaymentsMap(await DB.getShopInvoicePayments(shopId));
      } catch (_) {}
      const pendingInvs = allInvs
        .filter(i =>
          i.shopId == shopId &&
          !i.isReturn &&
          i.status !== 'void' &&
          i.status !== 'draft' &&
          i.status !== 'return' &&
          (parseFloat(i.total) - (parseFloat(pendingPaymentsMap[i.id] ?? i.amountPaid) || 0)) > 0.009
        )
        .sort((a, b) => a.id - b.id); // الأقدم أولاً FIFO

      let leftover  = invoiceShare;
      let anyFailed = false;
      const paidAt  = Utils.localNow();

      for (const inv of pendingInvs) {
        if (leftover <= 0.009) break;

        // [5] منع السداد على void
        if (inv.status === 'void') {
          Toast.error(`الفاتورة ${inv.number} ملغاة — تخطي`);
          continue;
        }

        const invTotal     = parseFloat(inv.total) || 0;
        const currentPaid  = parseFloat(pendingPaymentsMap[inv.id] ?? inv.amountPaid) || 0;
        const invRemaining = parseFloat(Math.max(0, invTotal - currentPaid).toFixed(2));
        if (invRemaining <= 0.009) continue;

        const toApply = parseFloat(Math.min(leftover, invRemaining).toFixed(2));

        try {
          // [3] insert في invoice_payments فقط — لا DB.addPayment
          await DB.addInvoicePayment({
            invoiceId:     inv.id,
            shopId:        shopId,
            amount:        toApply,
            paymentMethod: 'cash',
            paidAt,
            note: `تسديد من شاشة العميل — ${shop.name}`,
          });

          // [4] اشتقاق amountPaid و status من invoice_payments
          await syncInvoiceFromPayments(inv);
          pendingPaymentsMap[inv.id] = currentPaid + toApply;
          leftover = parseFloat((leftover - toApply).toFixed(2));
        } catch (err) {
          Toast.error(`فشل تسجيل دفعة للفاتورة ${inv.number}: ${err.message || ''}`);
          console.error(err);
          anyFailed = true;
          break;
        }
      }

      // [8] رصيد العميل من المصدر الموحد
      try {
        const newBalance = await DB.computeShopBalance(shopId);
        await DB.put('shops', { ...shop, balance: newBalance });
        if (!anyFailed) {
          const remainingTotal = parseFloat((nextOldDebt + newBalance).toFixed(2));
          Toast.success(`تم تسجيل تسديد ${Utils.currency(actualAmt)} ✓  |  المتبقي: ${Utils.currency(remainingTotal)}`);
        }
      } catch (e) {
        console.error('[shops] تحديث رصيد العميل فشل:', e);
      }
    }

    // [9] audit_log
    await DB.addAuditLog({
      entityType: 'shop',
      entityId:   shopId,
      action:     'payment_collected',
      newValue:   { amount: actualAmt, oldDebtPaid: paidOldDebt, invoiceDebtPaid: invoiceShare, via: rpcOk ? 'rpc' : 'fallback' },
      note:       `تسديد ${Utils.currency(actualAmt)} من شاشة العميل — ${shop.name}`,
    }).catch(() => {});

    await load();
    if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
    if (typeof DashboardModule   !== 'undefined') DashboardModule.load().catch(() => {});
    if (typeof InvoicesModule    !== 'undefined') InvoicesModule.load().catch(() => {});
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // [6] openShopLog — invoice_payments كمصدر موحد
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function openShopLog(shopId) {
    const shop = await DB.get('shops', shopId);
    if (!shop) return;

    const rawInvoices = await DB.req('GET', 'invoices', null, `?shop_id=eq.${shopId}&order=id.desc`);
    const invoices = rawInvoices.map(r => {
      const c   = {};
      const map = {
        shop_id:'shopId', shop_name:'shopName', is_return:'isReturn', return_of:'returnOf',
        amount_paid:'amountPaid', created_at:'createdAt', updated_at:'updatedAt',
        tax_pct:'taxPct', is_returned:'isReturned',
      };
      for (const k of Object.keys(r)) { c[map[k] || k] = r[k]; }
      if (c.items && typeof c.items === 'string') { try { c.items = JSON.parse(c.items); } catch(e) {} }
      return c;
    });

    // [6] دفعات من invoice_payments أولاً، payments القديم كـ fallback فقط
    let invoicePayments = [];
    let paymentsSource  = 'invoice_payments';
    try {
      invoicePayments = await DB.getShopInvoicePayments(shopId);
    } catch (e) {
      console.warn('[shops] invoice_payments غير متاح — fallback للـ payments القديم');
      try {
        invoicePayments = await DB.getPayments(shopId);
        paymentsSource  = 'payments_legacy';
      } catch (_) {}
    }
    const invoicePaymentsMap = buildInvoicePaymentsMap(invoicePayments);

    const regularInvs    = invoices.filter(i => !i.isReturn);
    const returnInvs     = invoices.filter(i => i.isReturn);
    const activeInvs     = regularInvs.filter(i => i.status !== 'void');
    const totalInvoiced  = activeInvs.reduce((s, i)  => s + (parseFloat(i.total)  || 0), 0);
    const totalReturns   = returnInvs.reduce((s, i)  => s + (parseFloat(i.total)  || 0), 0);
    const totalCollected = invoicePayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

    let liveBalance = parseFloat(shop.balance) || 0;
    try { liveBalance = await DB.computeShopBalance(shopId); } catch (_) {}

    const statusLabels = {
      paid:'مدفوعة', pending:'معلقة', partial:'جزئي',
      void:'ملغاة', draft:'مسودة', return:'مرتجع',
    };
    const statusColors = {
      paid:'#4ade80', pending:'#f0c040', partial:'#fb923c',
      void:'#e05252', draft:'#60a5fa', return:'#60a5fa',
    };

    let html = `
      <div style="background:var(--bg-secondary);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;direction:rtl;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:700;color:var(--accent);">📋 سجل حساب — ${escapeHtml(shop.name)}</div>
          <button onclick="this.closest('.log-overlay').remove()" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--text-primary);font-family:var(--font-main);cursor:pointer;font-size:12px;">✕ إغلاق</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
          <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">إجمالي الفواتير</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);">${Utils.currency(totalInvoiced)}</div>
          </div>
          <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">إجمالي التحصيل</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#4ade80;">${Utils.currency(totalCollected)}</div>
            ${paymentsSource === 'payments_legacy' ? '<div style="font-size:9px;color:#f0c040;">⚠ بيانات قديمة</div>' : ''}
          </div>
          <div style="background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.25);border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:#60a5fa;margin-bottom:3px;">↩ المرتجعات</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#60a5fa;">${Utils.currency(totalReturns)}</div>
          </div>
          <div style="background:${liveBalance > 0 ? 'rgba(224,82,82,0.12)' : 'rgba(74,222,128,0.1)'};border:1px solid ${liveBalance > 0 ? 'rgba(224,82,82,0.3)' : 'rgba(74,222,128,0.3)'};border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">الدين الحالي</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:${liveBalance > 0 ? 'var(--danger)' : '#4ade80'};">${Utils.currency(liveBalance)}</div>
          </div>
        </div>`;

    // قائمة الفواتير
    html += `<div style="font-size:13px;font-weight:700;margin-bottom:8px;">الفواتير (${regularInvs.length})</div>`;
    if (regularInvs.length === 0) {
      html += `<div style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">لا توجد فواتير</div>`;
    } else {
      html += regularInvs.map(inv => {
        const paid      = parseFloat(invoicePaymentsMap[inv.id] ?? inv.amountPaid) || 0;
        const remaining = Math.max(0, (parseFloat(inv.total) || 0) - paid);
        const stColor   = statusColors[inv.status] || 'var(--text-muted)';
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${escapeHtml(inv.number)}</div>
              <div style="font-size:10px;color:var(--text-muted);">${Utils.formatDate(inv.createdAt)}</div>
              <div style="font-size:10px;color:${stColor};font-weight:600;">${statusLabels[inv.status] || inv.status}</div>
              ${inv.status !== 'void' && remaining > 0.009
                ? `<div style="font-size:10px;color:#e05252;">متبقي: ${Utils.currency(remaining)}</div>`
                : inv.status !== 'void' ? '<div style="font-size:10px;color:#4ade80;">✓ مسددة</div>' : ''
              }
            </div>
            <div style="text-align:left;">
              <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);">${Utils.currency(inv.total)}</div>
              ${paid > 0 ? `<div style="font-size:10px;color:#4ade80;">مدفوع: ${Utils.currency(paid)}</div>` : ''}
            </div>
          </div>`;
      }).join('');
    }

    // المرتجعات
    if (returnInvs.length > 0) {
      html += `<div style="font-size:13px;font-weight:700;margin-top:12px;margin-bottom:8px;color:#60a5fa;">↩ المرتجعات (${returnInvs.length})</div>`;
      html += returnInvs.map(inv => `
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <div>
            <div style="font-family:var(--font-mono);font-weight:600;color:#60a5fa;">${escapeHtml(inv.number)}</div>
            <div style="color:var(--text-muted);">${Utils.formatDate(inv.createdAt)}</div>
          </div>
          <div style="font-family:var(--font-mono);font-weight:700;color:#60a5fa;">↩ ${Utils.currency(inv.total)}</div>
        </div>`).join('');
    }

    // [6] سجل التحصيلات من invoice_payments
    if (invoicePayments.length > 0) {
      html += `
        <div style="font-size:13px;font-weight:700;margin-top:12px;margin-bottom:8px;">
          سجل التحصيلات (${invoicePayments.length})
          <span style="font-size:10px;color:${paymentsSource === 'invoice_payments' ? '#4ade80' : '#f0c040'};font-weight:400;">
            • ${paymentsSource === 'invoice_payments' ? 'invoice_payments ✓' : 'بيانات قديمة ⚠'}
          </span>
        </div>`;
      html += invoicePayments.map(p => {
        const paidDate    = p.paidAt || p.createdAt;
        const method      = p.paymentMethod || 'cash';
        const methodLabel = { cash:'نقداً', credit:'آجل', transfer:'تحويل', other:'أخرى' }[method] || method;
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
            <div>
              <div style="color:#4ade80;font-weight:600;">💰 ${methodLabel}</div>
              <div style="font-size:10px;color:var(--text-muted);">${Utils.formatDate(paidDate)}</div>
              ${p.note ? `<div style="font-size:10px;color:var(--text-muted);">${escapeHtml(p.note)}</div>` : ''}
              ${p.invoiceId ? `<div style="font-size:10px;color:var(--text-muted);">فاتورة #${p.invoiceId}</div>` : ''}
            </div>
            <div style="color:#4ade80;font-family:var(--font-mono);font-weight:700;">+ ${Utils.currency(p.amount)}</div>
          </div>`;
      }).join('');
    }

    html += `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;">
          ${liveBalance > 0.009
            ? `<button onclick="ShopsModule._payFromLog(${shopId}, this)" class="btn btn-success btn-lg">💰 تسديد</button>`
            : '<div></div>'
          }
          <button onclick="this.closest('.log-overlay').remove()" style="padding:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font-main);cursor:pointer;">إغلاق</button>
        </div>
      </div>`;

    const overlay = document.createElement('div');
    overlay.className = 'log-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = html;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  async function _payFromLog(shopId, btn) {
    const overlay = btn.closest('.log-overlay');
    await openPayment(shopId);
    if (overlay) overlay.remove();
  }

  function openAdd() {
    editingId = null;
    if (modalTitleEl()) modalTitleEl().textContent = 'إضافة متجر / عميل';
    if (formEl()) formEl().reset();
    openModal();
  }

  async function openEdit(id) {
    editingId = id;
    const shop = await DB.get('shops', id);
    if (!shop) return;
    if (modalTitleEl()) modalTitleEl().textContent = 'تعديل بيانات العميل';
    const f = formEl();
    if (!f) return;
    f.querySelector('#s-name').value    = shop.name    || '';
    f.querySelector('#s-contact').value = shop.contact || '';
    f.querySelector('#s-phone').value   = shop.phone   || '';
    f.querySelector('#s-email').value   = shop.email   || '';
    f.querySelector('#s-address').value = shop.address || '';
    openModal();
  }

  function openModal()  { const m = modalEl(); if (m) m.classList.add('open'); }
  function closeModal() { const m = modalEl(); if (m) m.classList.remove('open'); editingId = null; }

  async function saveShop(e) {
    e.preventDefault();
    const f = formEl();
    if (!f) return;
    const data = {
      name:    f.querySelector('#s-name').value.trim(),
      contact: f.querySelector('#s-contact').value.trim() || null,
      phone:   f.querySelector('#s-phone').value.trim()   || null,
      email:   f.querySelector('#s-email').value.trim()   || null,
      address: f.querySelector('#s-address').value.trim() || null,
    };
    if (!data.name) { Toast.error('اسم المتجر / العميل مطلوب'); return; }
    const saveBtn = f.querySelector('[type=submit]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'جاري الحفظ...'; }
    try {
      if (!DB.isOnline()) {
        const old = editingId ? await DB.get('shops', editingId) : null;
        DB.enqueueShopUpsert(data, editingId ? old : null);
        if (editingId) OpsMeta.setShopOwner(editingId, OpsMeta.currentUser());
        const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
        Toast.success(localOnly
          ? (editingId ? 'تم حفظ تعديل العميل على هذا الجهاز ✓' : 'تم حفظ العميل على هذا الجهاز ✓')
          : (editingId ? 'تم حفظ تعديل العميل محليًا وسيتم رفعه عند عودة الإنترنت ✓' : 'تم حفظ العميل محليًا وسيتم رفعه عند عودة الإنترنت ✓'));
        closeModal();
        await load();
        return;
      }

      if (editingId) {
        const old = await DB.get('shops', editingId);
        await DB.put('shops', { ...old, ...data, id: editingId });
        OpsMeta.setShopOwner(editingId, OpsMeta.currentUser());
        Toast.success('تم تحديث بيانات العميل ✓');
      } else {
        const newId = await DB.add('shops', { ...data, balance: 0, returnsTotal: 0 });
        OpsMeta.setShopOwner(newId, OpsMeta.currentUser());
        Toast.success('تم إضافة العميل ✓');
      }
      closeModal();
      await load();
    } catch (err) {
      Toast.error('فشل في حفظ بيانات العميل: ' + (err.message || ''));
      console.error(err);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'حفظ العميل'; }
    }
  }

  async function deleteShop(id) {
    try {
      const shop = await DB.get('shops', id);
      if (!shop) return;

      let liveBalance = parseFloat(shop.balance) || 0;
      try { liveBalance = await DB.computeShopBalance(id); } catch (_) {}

      if (liveBalance > 0.009) {
        Toast.error(`لا يمكن حذف "${shop.name}" — لديه دين: ${Utils.currency(liveBalance)}`);
        return;
      }

      const pendingInvs = await DB.req('GET', 'invoices', null,
        `?shop_id=eq.${id}&status=in.(pending,partial)&limit=1`);
      if (pendingInvs.length > 0) {
        Toast.error(`لا يمكن حذف "${shop.name}" — يوجد فواتير غير مسددة`);
        return;
      }

      if (!Utils.confirm(`هل تريد حذف العميل "${shop.name}" نهائياً؟`)) return;

      await DB.remove('shops', id);
      DebtStore.remove(id);
      Toast.success('تم حذف العميل');
      await load();
    } catch (err) {
      Toast.error('فشل في حذف العميل');
    }
  }

  function init() {
    document.getElementById('add-shop-btn')?.addEventListener('click', openAdd);
    document.getElementById('shop-modal-close')?.addEventListener('click', closeModal);
    document.getElementById('shop-modal')?.addEventListener('click', (e) => { if (e.target.id === 'shop-modal') closeModal(); });
    document.getElementById('shop-form')?.addEventListener('submit', saveShop);
    document.getElementById('shops-search')?.addEventListener('input',
      Utils.debounce((e) => { searchQuery = e.target.value; render(); }, 200));
  }

  return { load, init, getAll: () => allShops, _payFromLog };
})();

window.ShopsModule = ShopsModule;
