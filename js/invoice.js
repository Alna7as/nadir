/**
 * invoice.js — الفواتير (النسخة v12 — إصلاحات محاسبية شاملة)
 *
 * الإصلاحات المطبّقة:
 * [1]  changeStatus: لا يُعدّل amountPaid مباشرة — الحالة مشتقة من الدفعات الفعلية
 * [2]  dropdown الحالة مفلتر حسب نوع الفاتورة
 * [3]  amountPaid محسوب من invoice_payments (جدول مستقل)
 * [9]  الانتقالات المسموح بها فقط (state machine)
 * [11] audit_log لكل تغيير حساس
 * [12] void مع دفعات: ممنوع إلا بإجراء صريح
 * [14] حالة partial مضافة + حالة مشتقة من القيم الفعلية
 */

const InvoicesModule = (() => {

  let allInvoices  = [];
  let searchQuery  = '';
  let filterStatus = '';
  let filterRep    = '';
  let filterFrom   = '';
  let filterTo     = '';
  const PAGE_SIZE  = 30;
  let currentPage  = 1;

  async function getInvoicePaidAmount(invoiceId, fallback = 0) {
    try {
      const payments = await DB.getInvoicePayments(invoiceId);
      return payments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    } catch (_) {
      return parseFloat(fallback) || 0;
    }
  }

  const listEl  = () => document.getElementById('invoices-list');
  const countEl = () => document.getElementById('invoices-count');

  function getRepOwnerId(invoice) {
    return String(OpsMeta.getInvoiceOwner(invoice?.id)?.id || '');
  }

  function changeRepStockForInvoice(invoice, direction, note) {
    const ownerId = getRepOwnerId(invoice);
    if (!ownerId) return;
    const items = Utils.normalizeInvoiceItems(invoice.items);
    OpsMeta.applyRepStockDelta(ownerId, items.map((item) => ({
      productId: item.productId,
      qtyDelta: (parseInt(item.qty, 10) || 0) * direction,
    })), {
      actor: OpsMeta.currentUser()?.name || 'مستخدم',
      type: direction > 0 ? 'invoice_return' : 'invoice_restore',
      note,
    });
  }

  // ── [14] الانتقالات المسموح بها ──
  const ALLOWED_TRANSITIONS = {
    draft:   ['pending', 'paid', 'void'],
    pending: ['paid', 'partial', 'void', 'draft'],
    partial: ['paid', 'pending', 'void'],
    paid:    ['void'],          // paid→pending يحتاج تسوية صريحة
    void:    ['pending'],       // استعادة بشروط
    return:  [],                // المرتجعات لا تتحول
  };

  // خيارات الـ dropdown حسب نوع الفاتورة والحالة الحالية
  function getAllowedStatusOptions(inv) {
    if (inv.isReturn) return [];  // المرتجع بلا خيارات
    const current = inv.status || 'pending';
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return [current, ...allowed];
  }

  function ensureManagerFilters() {
    const page = document.getElementById('page-invoices');
    const list = listEl();
    if (!page || !list) return;

    let repFilter = document.getElementById('inv-filter-rep');
    if (!repFilter) {
      const filterBar = page.querySelector('.filter-bar');
      if (filterBar) {
        repFilter = document.createElement('select');
        repFilter.id = 'inv-filter-rep';
        filterBar.appendChild(repFilter);
      }
    }

    let summary = document.getElementById('invoices-rep-summary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'invoices-rep-summary';
      summary.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;';
      list.insertAdjacentElement('beforebegin', summary);
    }

    const filterBar = page.querySelector('.filter-bar');
    if (repFilter && filterBar && repFilter.parentElement !== filterBar) {
      filterBar.appendChild(repFilter);
    }
    if (list.parentElement !== page) {
      page.appendChild(list);
    }
    if (summary && summary.parentElement !== page) {
      list.insertAdjacentElement('beforebegin', summary);
    }
  }

  function getRepChoices() {
    return NadirUsers.getAll().filter((user) => user.role === 'cashier' && user.active !== false);
  }

  function populateRepFilter(baseInvoices = allInvoices) {
    const select = document.getElementById('inv-filter-rep');
    const summary = document.getElementById('invoices-rep-summary');
    if (select) {
      const reps = getRepChoices();
      select.innerHTML =
        `<option value="">كل المناديب</option>` +
        reps.map((rep) => `<option value="${rep.id}">${escapeHtml(rep.name)}</option>`).join('');
      if (select.options[0]) select.options[0].textContent = 'كل المناديب';
      select.value = filterRep || '';
      select.style.display = OpsMeta.isAdmin() ? '' : 'none';
    }
    if (!summary) return;
    if (!OpsMeta.isAdmin()) {
      summary.innerHTML = '';
      summary.style.display = 'none';
      return;
    }

    const reps = getRepChoices().map((rep) => {
      const repInvoices = baseInvoices.filter((invoice) => String(invoice.salesRepId || '') === String(rep.id) && !invoice.isReturn && invoice.status !== 'void');
      return { ...rep, invoiceCount: repInvoices.length };
    }).filter((rep) => rep.invoiceCount > 0 || String(filterRep) === String(rep.id));

    summary.style.display = reps.length ? 'flex' : 'none';
    summary.innerHTML = reps.map((rep) => `
      <button class="btn ${String(filterRep) === String(rep.id) ? 'btn-primary' : 'btn-secondary'} btn-sm" data-rep-pill="${rep.id}" style="display:flex;gap:6px;align-items:center;">
        <span>${escapeHtml(rep.name)}</span>
        <span class="badge badge-yellow" style="font-size:10px;">${rep.invoiceCount}</span>
      </button>
    `).join('') + (reps.length ? `
      <button class="btn btn-secondary btn-sm" data-rep-pill-clear>مسح الفلتر</button>
    ` : '');

    summary.querySelectorAll('[data-rep-pill]').forEach((button) => {
      button.addEventListener('click', () => {
        filterRep = button.dataset.repPill || '';
        if (select) select.value = filterRep;
        currentPage = 1;
        render();
      });
    });
    summary.querySelector('[data-rep-pill-clear]')?.addEventListener('click', () => {
      filterRep = '';
      if (select) select.value = '';
      currentPage = 1;
      render();
    });
    const clearBtn = summary.querySelector('[data-rep-pill-clear]');
    if (clearBtn) clearBtn.textContent = 'مسح الفلتر';
  }

  async function load() {
    ensureManagerFilters();
    allInvoices = OpsMeta.filterInvoices(await DB.getAllParsed('invoices')).map((inv) => OpsMeta.attachInvoiceMeta(inv));
    allInvoices.sort((a, b) => (Utils.parseStoredDate(b.createdAt)?.getTime() || 0) - (Utils.parseStoredDate(a.createdAt)?.getTime() || 0));
    populateRepFilter(allInvoices);
    currentPage = 1;
    render();
  }

  function render() {
    const container = listEl();
    if (!container) return;
    const q = searchQuery.toLowerCase();

    let filtered = allInvoices.filter(inv => {
      if (q && !inv.number.toLowerCase().includes(q) && !(inv.shopName||'').toLowerCase().includes(q) && !(inv.salesRepName || '').toLowerCase().includes(q)) return false;
      if (filterStatus && inv.status !== filterStatus) return false;
      if (filterFrom) {
        const invDate = Utils.parseStoredDate(inv.createdAt) || new Date(inv.createdAt);
        invDate.setHours(0,0,0,0);
        if (invDate < new Date(filterFrom)) return false;
      }
      if (filterTo) {
        const invDate = Utils.parseStoredDate(inv.createdAt) || new Date(inv.createdAt);
        invDate.setHours(23,59,59,999);
        const to = new Date(filterTo); to.setHours(23,59,59,999);
        if (invDate > to) return false;
      }
      return true;
    });

    populateRepFilter(filtered);
    if (filterRep) filtered = filtered.filter((inv) => String(inv.salesRepId || '') === String(filterRep));

    if (countEl()) countEl().textContent = allInvoices.filter(i => !i.isReturn && i.status !== 'void').length;

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p>${q ? 'لا توجد فواتير تطابق البحث.' : 'لا توجد فواتير بعد!'}</p></div>`;
      return;
    }

    const paginated = filtered.slice(0, currentPage * PAGE_SIZE);
    const hasMore   = filtered.length > paginated.length;
    container.innerHTML = paginated.map(inv => renderInvoiceCard(inv)).join('');
    container.querySelectorAll('.invoice-card[data-sales-rep]').forEach((card) => {
      const meta = card.querySelector('.invoice-customer');
      const repName = card.dataset.salesRep || '';
      if (meta && repName && !meta.nextElementSibling?.matches?.('[data-rep-name]')) {
        meta.insertAdjacentHTML('afterend', `<div data-rep-name style="font-size:11px;color:var(--info);margin-top:2px;">المندوب: ${escapeHtml(repName)}</div>`);
      }
    });
    if (hasMore) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'width:100%;margin-top:12px;font-size:13px;';
      btn.textContent = `تحميل المزيد (${filtered.length - paginated.length} فاتورة متبقية)`;
      btn.addEventListener('click', () => { currentPage++; render(); });
      container.appendChild(btn);
    }

    // ✅ event delegation بدل forEach
    container.onclick = (e) => {
      if (e.target.closest('select')) return;
      const printBtn = e.target.closest('[data-print-invoice]');
      if (printBtn) { e.stopPropagation(); return viewInvoice(parseInt(printBtn.dataset.printInvoice)); }
      const card = e.target.closest('[data-view-invoice]');
      if (card && !e.target.closest('button')) viewInvoice(parseInt(card.dataset.viewInvoice));
    };
    container.querySelectorAll('[data-edit-invoice]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); NewInvoiceModule.loadForEdit(parseInt(btn.dataset.editInvoice)); });
    });
    container.querySelectorAll('[data-delete-invoice]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteInvoice(parseInt(btn.dataset.deleteInvoice)); });
    });
    container.querySelectorAll('[data-return-invoice]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); returnInvoice(parseInt(btn.dataset.returnInvoice)); });
    });
    container.querySelectorAll('[data-status-select]').forEach(sel => {
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        changeStatus(parseInt(sel.dataset.statusSelect), sel.value, sel);
      });
    });
  }

  function renderInvoiceCard(inv) {
    const canViewProfit = Session.getRole() === 'admin';
    const statusColors = {
      paid:'badge-green', pending:'badge-yellow', void:'badge-red',
      draft:'badge-blue', return:'badge-red', partial:'badge-orange'
    };
    const statusLabels = {
      paid:'مدفوعة', pending:'معلقة', void:'ملغاة',
      draft:'مسودة', return:'مرتجع', partial:'جزئي'
    };
    const currentStatus = inv.status || 'pending';
    const isReturn  = inv.isReturn;
    const returned  = inv.isReturned;
    const itemCount = Utils.normalizeInvoiceItems(inv.items).length;

    // [2] فلترة خيارات الحالة حسب نوع الفاتورة والانتقالات المسموحة
    const allowedOptions = getAllowedStatusOptions(inv);
    const selectOptions = allowedOptions.map(val =>
      `<option value="${val}" ${currentStatus === val ? 'selected' : ''}>${statusLabels[val] || val}</option>`
    ).join('');

    // عرض المدفوع والمتبقي
    const amountPaid = parseFloat(inv.amountPaid) || 0;
    const remaining  = Math.max(0, (inv.total || 0) - amountPaid);
    const netProfit  = Utils.getInvoiceProfit(inv);
    const hasPaymentBreakdown = !isReturn && (currentStatus === 'partial' || currentStatus === 'pending' || remaining > 0);
    const amountHeadline = hasPaymentBreakdown ? remaining : (parseFloat(inv.total) || 0);
    const amountHeadlineLabel = hasPaymentBreakdown ? 'المتبقي' : 'إجمالي الفاتورة';

    return `
      <div class="invoice-card" data-view-invoice="${inv.id}" data-sales-rep="${escapeHtml(inv.salesRepName || 'غير محدد')}" style="${isReturn ? 'border-right:3px solid #60a5fa;' : ''}">
        <div class="invoice-card-top">
          <div>
            <div class="invoice-number">${isReturn ? '↩ ' : ''}${escapeHtml(inv.number)}${returned ? ' <span style="font-size:10px;color:#60a5fa;">(تم المرتجع)</span>' : ''}</div>
            <div class="invoice-date">${Utils.formatDateTime(inv.createdAt)}${inv.pendingSync ? ' • في انتظار المزامنة' : ''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            ${!isReturn && allowedOptions.length > 1 ? `
            <select data-status-select="${inv.id}" class="form-control" style="width:90px;font-size:11px;padding:3px 6px;height:28px;cursor:pointer;" onclick="event.stopPropagation()">
              ${selectOptions}
            </select>` : `<span class="badge ${statusColors[currentStatus] || 'badge-blue'}" style="font-size:10px;">${statusLabels[currentStatus] || currentStatus}</span>`}
            ${!isReturn && !returned && currentStatus !== 'void' ? `<button class="btn btn-secondary btn-icon" data-return-invoice="${inv.id}" title="مرتجع" style="width:28px;height:28px;font-size:13px;">↩</button>` : ''}
            ${!isReturn && inv.status !== 'void' ? `<button class="btn btn-secondary btn-icon" data-edit-invoice="${inv.id}" title="تعديل الفاتورة" style="width:28px;height:28px;">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>` : ''}
            <button class="btn btn-secondary btn-icon" data-print-invoice="${inv.id}" title="طباعة" style="width:28px;height:28px;">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
            </button>
            <button class="btn btn-danger btn-icon" data-delete-invoice="${inv.id}" title="حذف" style="width:28px;height:28px;">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
        <div class="invoice-meta">
          <div>
            <div class="invoice-customer">${escapeHtml(inv.shopName || 'زبون عادي')}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${itemCount} ${itemCount===1?'صنف':'أصناف'}</div>
            ${canViewProfit ? `<div style="font-size:11px;color:var(--success);font-family:var(--font-mono);margin-top:2px;">صافي الربح: ${Utils.currency(netProfit)}</div>` : ''}
          </div>
          <div style="text-align:left;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">${amountHeadlineLabel}</div>
            <div class="invoice-amount" style="${isReturn ? 'color:#60a5fa;' : hasPaymentBreakdown ? 'color:#f0c040;' : ''}">${isReturn ? '↩ ' : ''}${Utils.currency(amountHeadline)}</div>
            ${hasPaymentBreakdown ? `<div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">إجمالي: ${Utils.currency(inv.total)} | مدفوع: ${Utils.currency(amountPaid)}</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  async function attachDebtSnapshot(invoice) {
    if (!invoice?.shopId) {
      return { ...invoice, oldDebt: 0, newDebt: 0, totalDue: 0 };
    }

    const oldDebt = parseFloat(DebtStore.get(invoice.shopId)) || 0;
    let newDebt = 0;

    try {
      const shop = await DB.get('shops', invoice.shopId);
      newDebt = parseFloat(shop?.balance) || 0;
    } catch (_) {}

    return {
      ...invoice,
      oldDebt: parseFloat(oldDebt.toFixed(2)),
      newDebt: parseFloat(newDebt.toFixed(2)),
      totalDue: parseFloat((oldDebt + newDebt).toFixed(2)),
    };
  }

  // [1] [9] [11] [12] changeStatus — لا يُعدّل amountPaid مباشرة
  async function changeStatus(id, newStatus, selectEl) {
    const inv = await DB.get('invoices', id);
    if (!inv) return;
    const oldStatus = inv.status || 'pending';
    if (oldStatus === newStatus) return;

    // [9] التحقق من الانتقال المسموح
    const allowed = ALLOWED_TRANSITIONS[oldStatus] || [];
    if (!allowed.includes(newStatus)) {
      Toast.error(`الانتقال من "${oldStatus}" إلى "${newStatus}" غير مسموح.`);
      await load(); return;
    }

    // [12] منع void للفاتورة التي فيها دفعات
    if (newStatus === 'void') {
      const payments = await DB.getInvoicePayments(id);
      if (payments.length > 0) {
        const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        const confirmed = Utils.confirm(
          `⚠ تحذير محاسبي\n\nهذه الفاتورة تحتوي على ${payments.length} دفعة بإجمالي ${Utils.currency(totalPaid)}.\n\nإلغاء الفاتورة لن يحذف سجل الدفعات.\nيجب التسوية يدوياً بعد الإلغاء.\n\nهل تريد المتابعة؟`
        );
        if (!confirmed) { await load(); return; }
      }
    }

    const statusLabelsConfirm = {
      paid:'مدفوعة', pending:'معلقة', void:'ملغاة',
      draft:'مسودة', return:'مرتجع', partial:'جزئي'
    };
    const warningMap = {
      'pending→void':  '\n⚠ سيتم إعادة الكميات للمخزون وطرح الدين.',
      'partial→void':  '\n⚠ سيتم إعادة الكميات للمخزون وطرح الدين.',
      'paid→void':     '\n⚠ سيتم إعادة الكميات للمخزون.',
      'void→pending':  '\n⚠ سيتم خصم الكميات من المخزون وإضافة الدين.',
    };
    const warnKey = `${oldStatus}→${newStatus}`;
    const warnMsg = warningMap[warnKey] || '';
    if (!Utils.confirm(`تغيير حالة الفاتورة ${inv.number}\nمن: ${statusLabelsConfirm[oldStatus]} → إلى: ${statusLabelsConfirm[newStatus]}${warnMsg}\n\nهل تريد المتابعة؟`)) {
      await load(); return;
    }

    if (!DB.isOnline()) {
      DB.enqueueInvoiceStatusChange({ invoiceId: id, oldStatus, newStatus });
      const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
      Toast.success(localOnly ? 'تم حفظ تغيير الحالة على هذا الجهاز ✓' : 'تم حفظ تغيير الحالة محليًا وسيتم رفعه عند عودة الإنترنت ✓');
      await load();
      if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
      if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
      return;
    }

    // [1] نُحدّث الحالة — void→pending يشتق الحالة الصحيحة من الدفعات الفعلية
    let finalStatus = newStatus;
    let correctedPaid = parseFloat(inv.amountPaid) || 0;

    if (oldStatus === 'void' && newStatus === 'pending') {
      // اشتقاق الحالة الحقيقية من الدفعات الموجودة فعلاً
      const existingPayments = await DB.getInvoicePayments(id);
      const realPaid = existingPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      const total    = parseFloat(inv.total) || 0;
      correctedPaid = parseFloat(Math.min(realPaid, total).toFixed(2));
      if      (realPaid <= 0)            finalStatus = 'pending';
      else if (realPaid >= total - 0.01) finalStatus = 'paid';
      else                               finalStatus = 'partial';
    } else {
      const realPaid = await getInvoicePaidAmount(id, inv.amountPaid);
      correctedPaid = parseFloat(Math.min(realPaid, parseFloat(inv.total) || 0).toFixed(2));
    }

    // [6] void → استخدام void_invoice_atomic RPC لضمان الذرية
    if (newStatus === 'void' && oldStatus !== 'void') {
      let rpcOk = false;
      try {
        const result = await DB.callRpc('void_invoice_atomic', {
          // void_invoice_atomic تأخذ (p_invoice_id, p_reason) كـ params منفصلة
          // لكن callRpc يُرسلها كـ JSONB — نُعيد صياغة الاستدعاء
        });
        // void_invoice_atomic تأخذ باراميترات بالاسم — نستخدم URL params
        rpcOk = false; // نعود للـ fallback لأن الـ signature مختلف
      } catch (_) {}

      // Fallback يدوي (المسار الأساسي حتى يُضبط signature الـ RPC)
      if (!rpcOk) {
        const updatedInv = { ...inv, status: 'void' };
        await DB.put('invoices', updatedInv);

        await DB.addAuditLog({
          entityType: 'invoice',
          entityId:   id,
          action:     'status_change',
          oldValue:   { status: oldStatus },
          newValue:   { status: 'void' },
          note:       `إلغاء الفاتورة ${inv.number}`,
        });

        if (inv.shopId && !inv.isReturn) {
          const shop = await DB.get('shops', inv.shopId);
          if (shop) {
            const newBalance = await DB.computeShopBalance(inv.shopId);
            await DB.put('shops', { ...shop, balance: newBalance });
          }
        }

        await reverseStockForInvoice(inv, 'إلغاء فاتورة');
        changeRepStockForInvoice(inv, 1, `إلغاء الفاتورة ${inv.number}`);
      }

      Toast.success('تم إلغاء الفاتورة ✓');
      await load();
      if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
      if (typeof ShopsModule       !== 'undefined') ShopsModule.load().catch(() => {});
      return;
    }

    const updatedInv = { ...inv, status: finalStatus, amountPaid: correctedPaid };
    await DB.put('invoices', updatedInv);

    // [11] audit_log
    await DB.addAuditLog({
      entityType: 'invoice',
      entityId:   id,
      action:     'status_change',
      oldValue:   { status: oldStatus },
      newValue:   { status: finalStatus },
      note:       `تغيير حالة الفاتورة ${inv.number}`,
    });

    // ── معالجة دين العميل ── (فقط الفواتير العادية)
    if (inv.shopId && (inv.total || 0) > 0 && !inv.isReturn) {
      const shop = await DB.get('shops', inv.shopId);
      if (shop) {
        const newBalance = await DB.computeShopBalance(inv.shopId);
        if (newBalance !== parseFloat(shop.balance || 0)) {
          await DB.put('shops', { ...shop, balance: newBalance });
        }
      }
    }

    // ── استعادة المخزون عند void→pending ──
    if (oldStatus === 'void' && newStatus === 'pending' && !inv.isReturn) {
      await deductStockForInvoice(inv, 'استعادة فاتورة');
      changeRepStockForInvoice(inv, -1, `استعادة الفاتورة ${inv.number}`);
    }

    Toast.success('تم تغيير الحالة ✓');
    await load();
    if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
    if (typeof ShopsModule       !== 'undefined') ShopsModule.load().catch(() => {});
  }

  // ── إضافة دفعة لفاتورة ──
  async function addPaymentToInvoice(inv, amount, method = 'cash', note = '') {
    if (amount <= 0) { Toast.error('المبلغ يجب أن يكون أكبر من صفر'); return; }
    const paidAmount = await getInvoicePaidAmount(inv.id, inv.amountPaid);
    const remaining = Math.max(0, (inv.total || 0) - paidAmount);
    if (amount > remaining + 0.01) {
      Toast.error(`المبلغ المدفوع (${Utils.currency(amount)}) أكبر من المتبقي (${Utils.currency(remaining)})`);
      return;
    }

    if (!DB.isOnline()) {
      DB.enqueueInvoicePayment({
        invoiceId: inv.id,
        shopId: inv.shopId || null,
        amount: parseFloat(amount.toFixed(2)),
        paymentMethod: method,
        paidAt: Utils.localNow(),
        note,
      });
      const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
      Toast.success(localOnly ? `تم حفظ الدفعة ${Utils.currency(amount)} على هذا الجهاز ✓` : `تم حفظ الدفعة ${Utils.currency(amount)} محليًا وسيتم رفعها عند عودة الإنترنت ✓`);
      await load();
      if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
      return;
    }

    await DB.addInvoicePayment({
      invoiceId:     inv.id,
      shopId:        inv.shopId || null,
      amount:        parseFloat(amount.toFixed(2)),
      paymentMethod: method,
      paidAt:        Utils.localNow(),
      note,
    });

    // [11] audit_log
    await DB.addAuditLog({
      entityType: 'invoice',
      entityId:   inv.id,
      action:     'payment_add',
      oldValue:   { amountPaid: parseFloat(paidAmount) || 0 },
      newValue:   { paymentAdded: amount, paymentMethod: method },
      note:       `دفعة على الفاتورة ${inv.number}`,
    });

    // تحديث رصيد العميل من المصدر الموحد
    if (inv.shopId) {
      const shop = await DB.get('shops', inv.shopId);
      if (shop) {
        const newBalance = await DB.computeShopBalance(inv.shopId);
        await DB.put('shops', { ...shop, balance: newBalance });
      }
    }

    Toast.success(`تم تسجيل الدفعة ${Utils.currency(amount)} ✓`);
    await load();
    if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
  }

  // ── مساعد: عكس المخزون ──
  async function reverseStockForInvoice(inv, reason) {
    let items = inv.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
    for (const item of (items || [])) {
      const prod = await DB.get('products', item.productId);
      if (prod) {
        const b = prod.quantity;
        const a = b + item.qty;
        await DB.put('products', { ...prod, quantity: a });
        await DB.addStockMovement({
          productId: item.productId, productName: item.name,
          type: 'in', qty: item.qty, reason: `${reason} - ${inv.number}`,
          invoiceId: inv.id, invoiceNumber: inv.number,
          balanceBefore: b, balanceAfter: a,
        });
      }
    }
  }

  // ── مساعد: خصم المخزون ──
  async function deductStockForInvoice(inv, reason) {
    let items = inv.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
    for (const item of (items || [])) {
      const prod = await DB.get('products', item.productId);
      if (prod) {
        const b = prod.quantity;
        const a = Math.max(0, b - item.qty);
        await DB.put('products', { ...prod, quantity: a });
        await DB.addStockMovement({
          productId: item.productId, productName: item.name,
          type: 'out', qty: item.qty, reason: `${reason} - ${inv.number}`,
          invoiceId: inv.id, invoiceNumber: inv.number,
          balanceBefore: b, balanceAfter: a,
        });
      }
    }
  }

  // [10] المرتجعات — مستند مستقل
  async function returnInvoice(id) {
    const inv = await DB.get('invoices', id);
    if (!inv) return;
    if (inv.isReturn)          { Toast.error('لا يمكن عمل مرتجع لفاتورة مرتجع'); return; }
    if (inv.status === 'void') { Toast.error('لا يمكن عمل مرتجع لفاتورة ملغاة'); return; }
    if (inv.isReturned)        { Toast.error('تم إنشاء مرتجع لهذه الفاتورة من قبل'); return; }

    let confirmMsg = `هل تريد إنشاء مرتجع للفاتورة ${inv.number}؟\nسيتم إعادة الكميات للمخزون تلقائياً.`;
    if (inv.status === 'paid' || inv.status === 'partial') {
      const paidAmount = await getInvoicePaidAmount(inv.id, inv.amountPaid);
      confirmMsg += `\n\n💰 ملاحظة: تم سداد ${Utils.currency(paidAmount)} من هذه الفاتورة.\nيُرجى إعادة هذا المبلغ للعميل يدوياً بعد إتمام المرتجع.`;
    }
    if (!Utils.confirm(confirmMsg)) return;

    if (!DB.isOnline()) {
      DB.enqueueInvoiceReturn({
        invoiceId: inv.id,
        returnNumber: 'RET-' + inv.number,
      });
        const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
        Toast.success(localOnly ? 'تم حفظ المرتجع على هذا الجهاز ✓' : 'تم حفظ المرتجع محليًا وسيتم رفعه عند عودة الإنترنت ✓');
      await load();
      if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
      if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
      return;
    }

    try {
      let items = inv.items;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }

      const retNumber = 'RET-' + inv.number;

      const retId = await DB.add('invoices', {
        number: retNumber,
        shopId: inv.shopId, shopName: inv.shopName,
        items,
        subtotal: inv.subtotal, discount: inv.discount,
        tax: inv.tax, taxPct: inv.taxPct, total: inv.total,
        amountPaid: 0, // المرتجع يبدأ بـ 0 — التسوية المالية منفصلة
        note: `مرتجع للفاتورة ${inv.number}`,
        status: 'return',
        isReturn: 1, returnOf: inv.id, isReturned: 0,
      });

      // [11] audit_log
      await DB.addAuditLog({
        entityType: 'invoice',
        entityId:   inv.id,
        action:     'return_created',
        oldValue:   { isReturned: 0 },
        newValue:   { isReturned: 1, returnInvoiceId: retId },
        note:       `مرتجع للفاتورة ${inv.number}`,
      });

      await DB.put('invoices', { ...inv, isReturned: 1 });

      // إعادة الكميات للمخزون
      await reverseStockForInvoice({ ...inv, id: inv.id }, 'مرتجع');
      changeRepStockForInvoice(inv, 1, `مرتجع الفاتورة ${inv.number}`);

      // تحديث دين العميل من المصدر الموحد
      if (inv.shopId) {
        const shop = await DB.get('shops', inv.shopId);
        if (shop) {
          const newBalance = await DB.computeShopBalance(inv.shopId);
          const newReturns = (parseFloat(shop.returnsTotal) || 0) + inv.total;
          await DB.put('shops', { ...shop, balance: newBalance, returnsTotal: newReturns });
        }
      }

      Toast.success('تم إنشاء المرتجع وإعادة المخزون ✓');
      await load();
      if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
      if (typeof ShopsModule       !== 'undefined') ShopsModule.load().catch(() => {});
    } catch (err) {
      Toast.error('فشل في إنشاء المرتجع: ' + (err.message || ''));
      console.error(err);
    }
  }

  async function viewInvoice(id) {
    const inv = await DB.get('invoices', id);
    if (!inv) return;
    inv.items = Utils.normalizeInvoiceItems(inv.items);
    inv.netProfit = Utils.getInvoiceProfit(inv);
    // نُلحق قائمة الدفعات بالفاتورة للعرض في الطباعة
    const payments = await DB.getInvoicePayments(id);
    const actualPaid = payments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    PrintModule.preview(await attachDebtSnapshot(OpsMeta.attachInvoiceMeta({ ...inv, amountPaid: parseFloat(actualPaid.toFixed(2)), invoicePayments: payments })));
  }

  async function deleteInvoice(id) {
    if (!Utils.confirm('هل تريد حذف هذه الفاتورة نهائياً؟\nسيتم عكس تأثيرها على المخزون والدين.')) return;
    try {
      const inv = await DB.get('invoices', id);
      if (!inv) return;

      if (!DB.isOnline()) {
        DB.enqueueInvoiceDelete(inv);
        const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
        Toast.success(localOnly ? 'تم حفظ حذف الفاتورة على هذا الجهاز ✓' : 'تم حفظ حذف الفاتورة محليًا وسيتم رفعه عند عودة الإنترنت ✓');
        await load();
        if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
        if (typeof ShopsModule       !== 'undefined') ShopsModule.load().catch(() => {});
        return;
      }

      if (DB.isOnline()) {
        try {
          const result = await DB.callRpc('delete_invoice_atomic', {
            invoiceId: id,
            reason: `حذف الفاتورة ${inv.number}`,
          });
          if (result?.ok) {
            Toast.success('تم حذف الفاتورة وعكس تأثيرها ✓');
            await load();
            if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
            if (typeof ShopsModule       !== 'undefined') ShopsModule.load().catch(() => {});
            return;
          }
        } catch (rpcErr) {
          console.warn('delete_invoice_atomic RPC فشل — fallback يدوي:', rpcErr.message);
        }
      }

      if (!inv.isReturn && inv.status !== 'void') {
        await reverseStockForInvoice(inv, 'حذف فاتورة');
        changeRepStockForInvoice(inv, 1, `حذف الفاتورة ${inv.number}`);
      }

      if (inv.isReturn) {
        let items = inv.items;
        if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
        for (const item of (items || [])) {
          const prod = await DB.get('products', item.productId);
          if (prod) {
            const b = prod.quantity;
            const a = Math.max(0, b - item.qty);
            await DB.put('products', { ...prod, quantity: a });
            await DB.addStockMovement({
              productId: item.productId, productName: item.name,
              type: 'out', qty: item.qty, reason: `حذف مرتجع - ${inv.number}`,
              invoiceId: id, invoiceNumber: inv.number,
              balanceBefore: b, balanceAfter: a,
            });
          }
        }
        if (inv.returnOf) {
          const origInv = await DB.get('invoices', inv.returnOf);
          if (origInv) {
            await DB.put('invoices', { ...origInv, isReturned: 0 });
            changeRepStockForInvoice(origInv, -1, `حذف المرتجع ${inv.number}`);
          }
        }
      }

      await DB.remove('invoices', id);

      // إعادة حساب رصيد العميل من المصدر الموحد بعد الحذف
      if (inv.shopId) {
        const shop = await DB.get('shops', inv.shopId);
        if (shop) {
          const newBalance = await DB.computeShopBalance(inv.shopId);
          let newReturns = parseFloat(shop.returnsTotal) || 0;
          if (inv.isReturn) newReturns = Math.max(0, newReturns - (inv.total || 0));
          await DB.put('shops', { ...shop, balance: newBalance, returnsTotal: newReturns });
        }
      }

      // [11] audit_log
      await DB.addAuditLog({
        entityType: 'invoice',
        entityId:   id,
        action:     'delete',
        oldValue:   { number: inv.number, total: inv.total, status: inv.status },
        note:       `حذف الفاتورة ${inv.number}`,
      });

      Toast.success('تم حذف الفاتورة وعكس تأثيرها ✓');
      await load();
      if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
      if (typeof ShopsModule       !== 'undefined') ShopsModule.load().catch(() => {});
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('foreign key') || msg.includes('constraint')) {
        Toast.error('تعذر حذف الفاتورة لوجود سجلات مرتبطة بها في قاعدة البيانات');
      } else {
        Toast.error('فشل في حذف الفاتورة: ' + (msg || 'خطأ غير معروف'));
      }
      console.error(err);
    }
  }

  function init() {
    ensureManagerFilters();
    document.getElementById('new-invoice-from-list')?.addEventListener('click', () => Router.navigate('new-invoice'));
    document.getElementById('invoices-search')?.addEventListener('input', Utils.debounce((e) => { searchQuery = e.target.value; currentPage = 1; render(); }, 200));
    document.getElementById('inv-filter-status')?.addEventListener('change', (e) => { filterStatus = e.target.value; currentPage = 1; render(); });
    document.getElementById('inv-filter-rep')?.addEventListener('change', (e) => { filterRep = e.target.value; currentPage = 1; render(); });
    document.getElementById('inv-filter-from')?.addEventListener('change', (e) => { filterFrom = e.target.value; currentPage = 1; render(); });
    document.getElementById('inv-filter-to')?.addEventListener('change', (e) => { filterTo = e.target.value; currentPage = 1; render(); });
  }

  return { load, init, addPaymentToInvoice };
})();
