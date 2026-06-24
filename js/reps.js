const RepsModule = (() => {
  let reps = [];
  let products = [];
  let invoices = [];
  let shops = [];
  let payments = [];

  function visibleReps() {
    if (OpsMeta.isRep()) {
      const current = OpsMeta.currentUser();
      return reps.filter((rep) => rep.id === current?.id);
    }
    if (OpsMeta.isAdmin()) {
      const current = OpsMeta.currentUser();
      const assigned = reps.filter((rep) => {
        const manager = OpsMeta.getRepManager(rep.id);
        return !manager?.id || manager.id === current?.id;
      });
      return assigned.length ? assigned : reps;
    }
    return reps;
  }

  function getAllocatedQtyForProduct(productId, excludeUserId = null) {
    return reps.reduce((sum, rep) => {
      if (excludeUserId !== null && String(rep.id) === String(excludeUserId)) return sum;
      const row = OpsMeta.getRepStock(rep.id).find((item) => String(item.productId) === String(productId));
      return sum + (parseInt(row?.qty, 10) || 0);
    }, 0);
  }

  function todayKey() {
    return Utils.dateKey();
  }

  function monthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function buildInvoicePaymentsMap(paymentRows) {
    const map = {};
    (paymentRows || []).forEach((payment) => {
      const invoiceId = payment.invoiceId || payment.invoice_id;
      if (!invoiceId) return;
      map[invoiceId] = (map[invoiceId] || 0) + (parseFloat(payment.amount) || 0);
    });
    return map;
  }

  function statsForRep(rep) {
    const repInvoices = OpsMeta.getRepInvoices(rep.id, invoices).filter((invoice) => !invoice.isReturn && invoice.status !== 'void');
    const repInvoiceIds = new Set(repInvoices.map((invoice) => String(invoice.id)));
    const repPayments = payments.filter((payment) => repInvoiceIds.has(String(payment.invoiceId || payment.invoice_id)));
    const repPaymentsMap = buildInvoicePaymentsMap(repPayments);
    const repShops = shops.filter((shop) => OpsMeta.getShopOwner(shop.id)?.id === rep.id);
    const today = todayKey();
    const month = monthKey();
    const target = OpsMeta.getRepTarget(rep.id);
    const allocations = OpsMeta.getRepStock(rep.id)
      .map((row) => {
        const product = products.find((item) => String(item.id) === String(row.productId));
        return {
          ...row,
          product: product || {
            id: row.productId,
            name: `صنف #${row.productId}`,
            price: 0,
          },
          missingProduct: !product,
        };
      })
      .filter((row) => (parseInt(row.qty, 10) || 0) > 0);

    const dailySales = repInvoices
      .filter((invoice) => Utils.dateKey(invoice.createdAt) === today)
      .reduce((sum, invoice) => sum + (parseFloat(invoice.total) || 0), 0);

    const dailyCollected = repPayments
      .filter((payment) => Utils.dateKey(payment.paidAt || payment.paid_at || payment.createdAt || payment.created_at) === today)
      .reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);

    const monthlySales = repInvoices
      .filter((invoice) => Utils.monthKey(invoice.createdAt) === month)
      .reduce((sum, invoice) => sum + (parseFloat(invoice.total) || 0), 0);
    const totalSales = repInvoices.reduce((sum, invoice) => sum + (parseFloat(invoice.total) || 0), 0);
    const totalCollected = repPayments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    const paymentRate = totalSales > 0 ? Math.min(100, (totalCollected / totalSales) * 100) : 0;
    const activeCustomers = new Set(
      repInvoices
        .filter((invoice) => invoice.shopId)
        .filter((invoice) => Utils.monthKey(invoice.createdAt) === month)
        .map((invoice) => String(invoice.shopId))
    ).size;

    const allocationsQty = allocations.reduce((sum, row) => sum + row.qty, 0);
    const allocationsValue = allocations.reduce((sum, row) => sum + ((parseFloat(row.product.price) || 0) * row.qty), 0);
    const debtTotal = repShops.reduce((sum, shop) => {
      const shopBalance = parseFloat(shop.balance);
      const fallbackDebt = parseFloat(DebtStore.get(shop.id));
      return sum + (Number.isFinite(shopBalance) ? shopBalance : (Number.isFinite(fallbackDebt) ? fallbackDebt : 0));
    }, 0);
    const recentInvoices = [...repInvoices]
      .sort((a, b) => (Utils.parseStoredDate(b.createdAt)?.getTime() || 0) - (Utils.parseStoredDate(a.createdAt)?.getTime() || 0))
      .slice(0, 8);
    const manager = OpsMeta.getRepManager(rep.id);
    const returnHistory = OpsMeta.getRepStockHistory(rep.id).filter((entry) => entry.type === 'return');
    const returnedQty = returnHistory.reduce((sum, entry) =>
      sum + (entry.rows || []).reduce((entrySum, row) => entrySum + Math.abs(parseInt(row.qtyDelta, 10) || 0), 0), 0);

    return {
      repInvoices,
      totalSales,
      totalCollected,
      paymentRate,
      activeCustomers,
      dailySales,
      dailyCollected,
      monthlySales,
      target,
      targetPct: target > 0 ? Math.min(100, (monthlySales / target) * 100) : 0,
      allocations,
      allocationsQty,
      allocationsValue,
      debtTotal,
      repShops,
      recentInvoices,
      manager,
      repPaymentsMap,
      returnedQty,
      returnHistory,
    };
  }

  function render() {
    const container = document.getElementById('reps-list');
    if (!container) return;
    const current = OpsMeta.currentUser();
    const cards = visibleReps();
    if (!cards.length) {
      container.innerHTML = `<div class="empty-state"><p>لا توجد بيانات مناديب لعرضها.</p></div>`;
      return;
    }

    container.innerHTML = cards.map((rep) => {
      const stats = statsForRep(rep);
      const topAllocations = stats.allocations.slice(0, 4).map((row) => `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <span>${escapeHtml(row.product.name)}${row.missingProduct ? ' (غير محمل)' : ''}</span>
          <span style="font-family:var(--font-mono);color:var(--accent);">${row.qty}</span>
        </div>
      `).join('');
      return `
        <div class="card" style="margin-bottom:12px;border-right:3px solid ${rep.id === current?.id ? 'var(--accent)' : 'rgba(91,156,246,0.45)'};">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
            <div>
              <div style="font-size:18px;font-weight:900;color:var(--text-primary);">${escapeHtml(rep.name)}</div>
              <div style="font-size:11px;color:var(--accent);font-family:var(--font-mono);">${NadirUsers.getRoleLabel(rep.role)} • ${escapeHtml(rep.mobile || '')}</div>
              ${stats.manager?.name ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">المدير المسؤول: ${escapeHtml(stats.manager.name)}</div>` : ''}
              <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">مرتجع من المخزون: ${stats.returnedQty} قطعة</div>
            </div>
            ${OpsMeta.isAdmin() ? `
              <div style="display:flex;gap:8px;">
                <button class="btn btn-primary btn-sm" data-rep-detail="${rep.id}">تفاصيل</button>
                <button class="btn btn-secondary btn-sm" data-rep-target="${rep.id}">تارجت</button>
                <button class="btn btn-secondary btn-sm" data-rep-stock="${rep.id}">مخزون</button>
                <button class="btn btn-secondary btn-sm" data-rep-return="${rep.id}">مرتجع</button>
              </div>` : ''}
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px;">
            <div style="background:rgba(91,156,246,0.08);border:1px solid rgba(91,156,246,0.16);border-radius:12px;padding:12px;">
              <div style="font-size:11px;color:var(--text-muted);">التحصيل اليومي</div>
              <div style="font-size:18px;font-weight:800;color:var(--info);font-family:var(--font-mono);">${Utils.currency(stats.dailyCollected)}</div>
            </div>
            <div style="background:rgba(240,192,64,0.08);border:1px solid rgba(240,192,64,0.16);border-radius:12px;padding:12px;">
              <div style="font-size:11px;color:var(--text-muted);">المبيعات اليومية</div>
              <div style="font-size:18px;font-weight:800;color:var(--accent);font-family:var(--font-mono);">${Utils.currency(stats.dailySales)}</div>
            </div>
            <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.16);border-radius:12px;padding:12px;">
              <div style="font-size:11px;color:var(--text-muted);">التارجت الشهري</div>
              <div style="font-size:18px;font-weight:800;color:#76d49c;font-family:var(--font-mono);">${Utils.currency(stats.target)}</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">المنجز: ${Utils.currency(stats.monthlySales)}</div>
            </div>
            <div style="background:rgba(224,82,82,0.08);border:1px solid rgba(224,82,82,0.16);border-radius:12px;padding:12px;">
              <div style="font-size:11px;color:var(--text-muted);">الجرد التلقائي</div>
              <div style="font-size:18px;font-weight:800;color:var(--danger);font-family:var(--font-mono);">${stats.allocationsQty} قطعة</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">قيمة تقريبية: ${Utils.currency(stats.allocationsValue)}</div>
            </div>
          </div>

          <div style="margin-top:12px;">
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.05);overflow:hidden;">
              <div style="height:100%;width:${stats.targetPct.toFixed(1)}%;background:linear-gradient(90deg,#4caf7d,#f0c040);"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-top:6px;">
              <span>نسبة تحقيق التارجت</span>
              <span>${stats.targetPct.toFixed(1)}%</span>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:12px;">
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px;">
              <div style="font-size:10px;color:var(--text-muted);">عدد الفواتير</div>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary);">${stats.repInvoices.length}</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px;">
              <div style="font-size:10px;color:var(--text-muted);">قيمة المبيعات</div>
              <div style="font-size:14px;font-weight:800;color:var(--accent);font-family:var(--font-mono);">${Utils.currency(stats.totalSales)}</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px;">
              <div style="font-size:10px;color:var(--text-muted);">التحصيل</div>
              <div style="font-size:14px;font-weight:800;color:var(--info);font-family:var(--font-mono);">${Utils.currency(stats.totalCollected)}</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px;">
              <div style="font-size:10px;color:var(--text-muted);">نسبة السداد</div>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary);">${stats.paymentRate.toFixed(1)}%</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px;">
              <div style="font-size:10px;color:var(--text-muted);">العملاء النشطون هذا الشهر</div>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary);">${stats.activeCustomers}</div>
            </div>
          </div>

          <div style="margin-top:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary);">المخزون المخصص</div>
              <div style="font-size:10px;color:var(--text-muted);">${stats.allocationsQty} قطعة</div>
            </div>
            ${topAllocations || `<div style="font-size:11px;color:var(--text-muted);">لا يوجد مخزون مخصص حتى الآن.</div>`}
            ${stats.allocations.length > 4 ? `<div style="font-size:10px;color:var(--text-muted);margin-top:6px;">+ ${stats.allocations.length - 4} أصناف أخرى</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-rep-target]').forEach((button) => {
      button.addEventListener('click', () => editTarget(button.dataset.repTarget));
    });
    container.querySelectorAll('[data-rep-stock]').forEach((button) => {
      button.addEventListener('click', () => openStockEditor(button.dataset.repStock));
    });
    container.querySelectorAll('[data-rep-detail]').forEach((button) => {
      button.addEventListener('click', () => openRepDetail(button.dataset.repDetail));
    });
    container.querySelectorAll('[data-rep-return]').forEach((button) => {
      button.addEventListener('click', () => openRepReturn(button.dataset.repReturn));
    });
  }

  function openRepDetail(userId) {
    const rep = reps.find((item) => String(item.id) === String(userId));
    if (!rep) return;
    const stats = statsForRep(rep);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:flex-end;justify-content:center;padding:0;';
    overlay.innerHTML = `
      <div style="width:min(760px,100%);max-height:88vh;overflow:auto;background:var(--bg-secondary);border:1px solid var(--border);border-radius:22px 22px 0 0;padding:18px;">
        <div style="width:52px;height:5px;border-radius:999px;background:rgba(255,255,255,.12);margin:0 auto 14px;"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div>
            <div style="font-size:20px;font-weight:900;color:var(--text-primary);">${escapeHtml(rep.name)}</div>
            <div style="font-size:12px;color:var(--accent);font-family:var(--font-mono);">${escapeHtml(rep.mobile || '')}</div>
            ${stats.manager?.name ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">المدير المسؤول: ${escapeHtml(stats.manager.name)}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${OpsMeta.isAdmin() ? `<button class="btn btn-secondary btn-sm" data-detail-target="${rep.id}">تعديل التارجت</button>` : ''}
            ${OpsMeta.isAdmin() ? `<button class="btn btn-primary btn-sm" data-detail-stock="${rep.id}">توزيع منتجات</button>` : ''}
            ${OpsMeta.isAdmin() ? `<button class="btn btn-secondary btn-sm" data-detail-return="${rep.id}">مرتجع من المندوب</button>` : ''}
            <button class="btn btn-secondary btn-sm" data-detail-close>إغلاق</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
          <div class="card" style="margin-bottom:0;"><div style="font-size:11px;color:var(--text-muted);">مبيعات اليوم</div><div style="font-size:18px;font-weight:800;color:var(--accent);font-family:var(--font-mono);">${Utils.currency(stats.dailySales)}</div></div>
          <div class="card" style="margin-bottom:0;"><div style="font-size:11px;color:var(--text-muted);">تحصيل اليوم</div><div style="font-size:18px;font-weight:800;color:var(--info);font-family:var(--font-mono);">${Utils.currency(stats.dailyCollected)}</div></div>
          <div class="card" style="margin-bottom:0;"><div style="font-size:11px;color:var(--text-muted);">التارجت الشهري</div><div style="font-size:18px;font-weight:800;color:#76d49c;font-family:var(--font-mono);">${Utils.currency(stats.target)}</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">المنجز ${Utils.currency(stats.monthlySales)}</div></div>
          <div class="card" style="margin-bottom:0;"><div style="font-size:11px;color:var(--text-muted);">الجرد الحالي</div><div style="font-size:18px;font-weight:800;color:var(--danger);font-family:var(--font-mono);">${stats.allocationsQty} قطعة</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${Utils.currency(stats.allocationsValue)}</div></div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
          <div class="card" style="margin-bottom:0;">
            <div class="section-title" style="margin-bottom:10px;">مؤشرات الأداء</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
              <div><div style="font-size:11px;color:var(--text-muted);">عدد الفواتير</div><div style="font-size:16px;font-weight:800;">${stats.repInvoices.length}</div></div>
              <div><div style="font-size:11px;color:var(--text-muted);">قيمة المبيعات</div><div style="font-size:16px;font-weight:800;color:var(--accent);font-family:var(--font-mono);">${Utils.currency(stats.totalSales)}</div></div>
              <div><div style="font-size:11px;color:var(--text-muted);">التحصيل</div><div style="font-size:16px;font-weight:800;color:var(--info);font-family:var(--font-mono);">${Utils.currency(stats.totalCollected)}</div></div>
              <div><div style="font-size:11px;color:var(--text-muted);">نسبة السداد</div><div style="font-size:16px;font-weight:800;color:var(--text-primary);">${stats.paymentRate.toFixed(1)}%</div></div>
              <div><div style="font-size:11px;color:var(--text-muted);">العملاء النشطون هذا الشهر</div><div style="font-size:16px;font-weight:800;">${stats.activeCustomers}</div></div>
              <div><div style="font-size:11px;color:var(--text-muted);">إجمالي عملاء المندوب</div><div style="font-size:16px;font-weight:800;">${stats.repShops.length}</div></div>
              <div><div style="font-size:11px;color:var(--text-muted);">مديونية العملاء</div><div style="font-size:16px;font-weight:800;color:var(--danger);font-family:var(--font-mono);">${Utils.currency(stats.debtTotal)}</div></div>
              <div><div style="font-size:11px;color:var(--text-muted);">تحقيق التارجت</div><div style="font-size:16px;font-weight:800;color:var(--accent);">${stats.targetPct.toFixed(1)}%</div></div>
            </div>
          </div>
          <div class="card" style="margin-bottom:0;">
            <div class="section-title" style="margin-bottom:10px;">المنتجات الموزعة</div>
            ${stats.allocations.length ? stats.allocations.map((row) => `
              <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                <span>${escapeHtml(row.product.name)}</span>
                <span style="font-family:var(--font-mono);color:var(--accent);">${row.qty}</span>
              </div>
            `).join('') : `<div style="font-size:12px;color:var(--text-muted);">لا توجد كميات موزعة حتى الآن.</div>`}
          </div>
        </div>

        <div class="card" style="margin:12px 0 0;">
          <div class="section-title" style="margin-bottom:10px;">مرتجعات المخزون الأخيرة</div>
          ${stats.returnHistory.length ? stats.returnHistory.slice(0, 6).map((entry) => `
            <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <div style="font-size:11px;color:var(--text-secondary);">${escapeHtml(entry.note || 'مرتجع من المندوب')}</div>
              <div style="font-size:11px;color:var(--danger);font-family:var(--font-mono);">${(entry.rows || []).reduce((sum, row) => sum + Math.abs(parseInt(row.qtyDelta, 10) || 0), 0)} قطعة</div>
            </div>
          `).join('') : `<div style="font-size:12px;color:var(--text-muted);">لا توجد مرتجعات مسجلة لهذا المندوب.</div>`}
        </div>

        <div class="card" style="margin:12px 0 0;">
          <div class="section-title" style="margin-bottom:10px;">آخر الفواتير</div>
          ${stats.recentInvoices.length ? stats.recentInvoices.map((invoice) => {
            const total = parseFloat(invoice.total) || 0;
            const amountPaid = Math.max(0, parseFloat(stats.repPaymentsMap[invoice.id] ?? invoice.amountPaid) || 0);
            const remaining = Math.max(0, total - amountPaid);
            const hasRemaining = remaining > 0.01;
            return `
            <div style="display:grid;grid-template-columns:minmax(0,1.2fr) auto auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <div>
                <div style="font-size:12px;font-weight:800;color:var(--text-primary);">${escapeHtml(invoice.number)}</div>
                <div style="font-size:10px;color:var(--text-muted);">${escapeHtml(invoice.shopName || 'زبون عادي')} • ${Utils.formatDateTime(invoice.createdAt)}</div>
              </div>
              <div style="font-size:12px;color:var(--text-secondary);font-family:var(--font-mono);">
                ${Utils.currency(hasRemaining ? remaining : total)}
                <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">إجمالي: ${Utils.currency(total)} | مدفوع: ${Utils.currency(amountPaid)}</div>
              </div>
              <div style="font-size:11px;color:var(--accent);">${invoice.status || 'pending'}</div>
            </div>`;
          }).join('') : `<div style="font-size:12px;color:var(--text-muted);">لا توجد فواتير لهذا المندوب حتى الآن.</div>`}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('[data-detail-close]')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-detail-target]')?.addEventListener('click', () => {
      editTarget(rep.id);
      overlay.remove();
    });
    overlay.querySelector('[data-detail-stock]')?.addEventListener('click', () => {
      openStockEditor(rep.id);
      overlay.remove();
    });
    overlay.querySelector('[data-detail-return]')?.addEventListener('click', () => {
      openRepReturn(rep.id);
      overlay.remove();
    });
  }

  function editTarget(userId) {
    const current = OpsMeta.getRepTarget(userId);
    const rep = reps.find((item) => item.id === userId);
    const next = window.prompt(`تحديد التارجت الشهري للمندوب: ${rep?.name || ''}`, current || '');
    if (next === null) return;
    if (OpsMeta.isAdmin()) OpsMeta.setRepManager(userId, OpsMeta.currentUser());
    OpsMeta.setRepTarget(userId, next);
    OpsMeta.addActivity({
      actor: OpsMeta.currentUser()?.name || 'مستخدم',
      type: 'تعديل تارجت',
      target: rep?.name || '',
    });
    render();
  }

  function openStockEditor(userId) {
    const rep = reps.find((item) => item.id === userId);
    const currentRows = OpsMeta.getRepStock(userId);
    const currentMap = {};
    currentRows.forEach((row) => { currentMap[String(row.productId)] = row.qty; });
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.innerHTML = `
      <div style="width:min(620px,100%);max-height:86vh;overflow:auto;background:var(--bg-secondary);border:1px solid var(--border);border-radius:18px;padding:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="font-size:16px;font-weight:900;color:var(--accent);">مخزون ${escapeHtml(rep?.name || '')}</div>
          <button class="btn btn-secondary btn-sm" id="rep-stock-close">إغلاق</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">حدد الكميات المخصصة لكل منتج. اترك القيمة صفر لحذف التخصيص.</div>
        <form id="rep-stock-form">
          ${products.map((product) => `
            ${(() => {
              const assignedToOthers = getAllocatedQtyForProduct(product.id, userId);
              const currentAssigned = parseInt(currentMap[String(product.id)], 10) || 0;
              const totalQty = parseInt(product.quantity, 10) || 0;
              const maxAllowed = Math.max(0, totalQty - assignedToOthers);
              return `
            <label style="display:grid;grid-template-columns:1fr 110px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span style="font-size:12px;color:var(--text-primary);">
                ${escapeHtml(product.name)}
                <span style="display:block;font-size:10px;color:var(--text-muted);margin-top:3px;">
                  بالمخزن ${totalQty} • مخصص لغيره ${assignedToOthers} • المتاح لهذا المندوب ${maxAllowed}
                </span>
              </span>
              <input
                type="number"
                min="0"
                max="${maxAllowed}"
                step="1"
                data-product-id="${product.id}"
                data-product-name="${escapeHtml(product.name)}"
                data-max-allowed="${maxAllowed}"
                value="${currentAssigned}"
                class="form-control">
            </label>`;
            })()}
          `).join('')}
          <button type="submit" class="btn btn-primary btn-full" style="margin-top:14px;">حفظ المخزون المخصص</button>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#rep-stock-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('#rep-stock-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const rows = [];
      for (const input of [...overlay.querySelectorAll('[data-product-id]')]) {
        const requestedQty = Math.max(0, parseInt(input.value, 10) || 0);
        const maxAllowed = Math.max(0, parseInt(input.dataset.maxAllowed, 10) || 0);
        if (requestedQty > maxAllowed) {
          Toast.error(`"${input.dataset.productName}" — الحد المتاح لهذا المندوب هو ${maxAllowed} فقط`);
          input.focus();
          return;
        }
        rows.push({
          productId: input.dataset.productId,
          qty: requestedQty,
        });
      }
      if (OpsMeta.isAdmin()) OpsMeta.setRepManager(userId, OpsMeta.currentUser());
      OpsMeta.setRepStock(userId, rows);
      OpsMeta.addActivity({
        actor: OpsMeta.currentUser()?.name || 'مستخدم',
        type: 'تخصيص مخزون',
        target: rep?.name || '',
      });
      await OpsMeta.pushRemote().catch((err) => {
        Toast.error(`تم الحفظ على هذا الجهاز فقط وتعذر رفعه للمزامنة: ${err?.message || ''}`);
      });
      overlay.remove();
      await load().catch(() => {});
    });
  }

  function openRepReturn(userId) {
    const rep = reps.find((item) => String(item.id) === String(userId));
    if (!rep) return;

    const allocations = OpsMeta.getRepStock(userId)
      .map((row) => {
        const product = products.find((item) => String(item.id) === String(row.productId));
        return product ? { ...row, product } : null;
      })
      .filter(Boolean);

    if (!allocations.length) {
      Toast.info('لا توجد كميات مع هذا المندوب لعمل مرتجع منها');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.innerHTML = `
      <div style="width:min(620px,100%);max-height:86vh;overflow:auto;background:var(--bg-secondary);border:1px solid var(--border);border-radius:18px;padding:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="font-size:16px;font-weight:900;color:var(--danger);">مرتجع مخزون من ${escapeHtml(rep.name || '')}</div>
          <button class="btn btn-secondary btn-sm" id="rep-return-close">إغلاق</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">هذا المرتجع منفصل عن مرتجع الفواتير، ومخصص فقط للكميات الراجعة من المندوب للإدارة.</div>
        <form id="rep-return-form">
          ${allocations.map((row) => `
            <label style="display:grid;grid-template-columns:1fr 110px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span style="font-size:12px;color:var(--text-primary);">
                ${escapeHtml(row.product.name)}
                <span style="display:block;font-size:10px;color:var(--text-muted);margin-top:3px;">المتاح حاليًا مع المندوب ${row.qty}</span>
              </span>
              <input
                type="number"
                min="0"
                max="${row.qty}"
                step="1"
                value="0"
                data-product-id="${row.productId}"
                data-product-name="${escapeHtml(row.product.name)}"
                data-max-return="${row.qty}"
                class="form-control">
            </label>
          `).join('')}
          <button type="submit" class="btn btn-danger btn-full" style="margin-top:14px;">تسجيل المرتجع</button>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#rep-return-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('#rep-return-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const deltas = [];

      for (const input of [...overlay.querySelectorAll('[data-product-id]')]) {
        const returnQty = Math.max(0, parseInt(input.value, 10) || 0);
        const maxReturn = Math.max(0, parseInt(input.dataset.maxReturn, 10) || 0);
        if (returnQty > maxReturn) {
          Toast.error(`"${input.dataset.productName}" — الحد الأقصى للمرتجع هو ${maxReturn}`);
          input.focus();
          return;
        }
        if (returnQty > 0) {
          deltas.push({
            productId: input.dataset.productId,
            qtyDelta: -returnQty,
          });
        }
      }

      if (!deltas.length) {
        Toast.error('أدخل كمية واحدة على الأقل');
        return;
      }

      OpsMeta.applyRepStockDelta(userId, deltas, {
        actor: OpsMeta.currentUser()?.name || 'مستخدم',
        type: 'return',
        note: `مرتجع مخزون من ${rep?.name || ''}`,
      });
      OpsMeta.addActivity({
        actor: OpsMeta.currentUser()?.name || 'مستخدم',
        type: 'مرتجع من مندوب',
        target: rep?.name || '',
      });
      overlay.remove();
      Toast.success('تم تسجيل مرتجع المخزون للمندوب ✓');
      render();
    });
  }

  async function load() {
    if (typeof OpsMeta !== 'undefined' && typeof OpsMeta.syncFromRemote === 'function') {
      await OpsMeta.syncFromRemote(true).catch(() => {});
    }
    reps = NadirUsers.getAll().filter((user) => user.role === 'cashier');
    const fetchedInvoices = await DB.getAllParsed('invoices');
    invoices = fetchedInvoices;
    products = await DB.getAll('products');
    shops = OpsMeta.filterShops(await DB.getAll('shops'));
    try {
      payments = await DB.req('GET', 'invoice_payments', null, '?order=id.desc');
    } catch (_) {
      payments = [];
    }
    render();
  }

  function init() {
    document.getElementById('reps-refresh-btn')?.addEventListener('click', () => load().catch(() => {}));
  }

  return { init, load };
})();

