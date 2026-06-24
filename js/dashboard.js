/**
 * dashboard.js - dashboard and quick KPIs
 * [Fix 4] Collections are calculated from invoice_payments by paid_at
 */

const DashboardModule = (() => {

  let salesChart = null;
  let latestInvoices = [];
  let latestPayments = null;

  function buildInvoicePaymentsMap(payments) {
    const map = {};
    (payments || []).forEach((payment) => {
      const invoiceId = payment.invoiceId || payment.invoice_id;
      if (!invoiceId) return;
      map[invoiceId] = (map[invoiceId] || 0) + (parseFloat(payment.amount) || 0);
    });
    return map;
  }

  async function load() {
    const [products, rawShops, rawInvoices] = await Promise.all([
      DB.getAll('products'),
      DB.getAll('shops'),
      DB.getAllParsed('invoices'),
    ]);
    const isRep = typeof OpsMeta !== 'undefined' && OpsMeta.isRep();
    const shops = typeof OpsMeta !== 'undefined' ? OpsMeta.filterShops(rawShops) : rawShops;
    const invoices = (typeof OpsMeta !== 'undefined' ? OpsMeta.filterInvoices(rawInvoices) : rawInvoices)
      .map((invoice) => typeof OpsMeta !== 'undefined' ? OpsMeta.attachInvoiceMeta(invoice) : invoice);
    const visibleInvoiceIds = new Set(invoices.map((invoice) => String(invoice.id)));
    const currentRep = typeof OpsMeta !== 'undefined' ? OpsMeta.currentUser() : null;

    const todayStr = Utils.dateKey();
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    let allPayments = null;
    let paymentsError = false;
    try {
      allPayments = await DB.getInvoicePaymentsByDateRange(monthStart, todayStr);
      if (isRep) {
        allPayments = allPayments.filter((payment) => {
          const invoiceId = payment.invoiceId || payment.invoice_id;
          return visibleInvoiceIds.has(String(invoiceId || ''));
        });
      }
    } catch (e) {
      console.error('[dashboard] invoice_payments unavailable:', e);
      paymentsError = true;
    }

    const regularInvoices = invoices.filter((inv) => !inv.isReturn && inv.status !== 'void');
    latestInvoices = regularInvoices;

    let todayCollected = 0;
    if (allPayments !== null) {
      todayCollected = allPayments
        .filter((payment) => Utils.dateKey(payment.paidAt || payment.createdAt) === todayStr)
        .reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    }
    const collectionDisplay = paymentsError ? '--' : Utils.currency(todayCollected);

    let totalCollected = 0;
    let allTimePaymentsMap = {};
    try {
      let allTimePayments = await DB.req('GET', 'invoice_payments', null, '?select=amount,invoice_id');
      if (isRep) {
        allTimePayments = allTimePayments.filter((payment) => {
          const invoiceId = payment.invoiceId || payment.invoice_id;
          return visibleInvoiceIds.has(String(invoiceId || ''));
        });
      }
      allTimePaymentsMap = buildInvoicePaymentsMap(allTimePayments);
      totalCollected = allTimePayments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    } catch (e) {
      allTimePaymentsMap = regularInvoices.reduce((acc, inv) => {
        acc[inv.id] = parseFloat(inv.amountPaid) || 0;
        return acc;
      }, {});
      totalCollected = regularInvoices.reduce((sum, inv) => sum + (parseFloat(inv.amountPaid) || 0), 0);
    }

    const pendingInvoices = regularInvoices.filter((inv) => {
      const paid = parseFloat(allTimePaymentsMap[inv.id] ?? inv.amountPaid) || 0;
      return Math.max(0, (parseFloat(inv.total) || 0) - paid) > 0.009;
    });
    const totalRemaining = pendingInvoices.reduce((sum, inv) => {
      const paid = parseFloat(allTimePaymentsMap[inv.id] ?? inv.amountPaid) || 0;
      return sum + Math.max(0, (parseFloat(inv.total) || 0) - paid);
    }, 0);

    setEl('dash-total-sales', Utils.currency(totalCollected));
    setEl('dash-today-collected', collectionDisplay);
    setEl('dash-total-remaining', Utils.currency(totalRemaining));
    setEl('dash-pending-count', pendingInvoices.length);
    setEl('dash-total-invoices', regularInvoices.length);
    setEl('dash-total-products', isRep ? '—' : products.length);
    setEl('dash-total-shops', shops.length);

    const repTargetCard = document.getElementById('dash-rep-target-card');
    const repTargetVal = document.getElementById('dash-rep-target');
    const repTargetLabel = document.getElementById('dash-rep-target-label');
    const repTargetProgress = document.getElementById('dash-rep-target-progress');
    const repTargetBar = document.getElementById('dash-rep-target-bar');
    if (repTargetCard) {
      if (isRep && currentRep?.id) {
        const monthKey = Utils.monthKey();
        const monthlySales = regularInvoices
          .filter((invoice) => Utils.monthKey(invoice.createdAt) === monthKey)
          .reduce((sum, invoice) => sum + (parseFloat(invoice.total) || 0), 0);
        const target = parseFloat(OpsMeta.getRepTarget(currentRep.id)) || 0;
        const targetPct = target > 0 ? Math.min(100, (monthlySales / target) * 100) : 0;
        repTargetCard.style.display = '';
        if (repTargetLabel) repTargetLabel.textContent = 'التارجت الشهري على مبيعاتك';
        if (repTargetVal) repTargetVal.textContent = Utils.currency(target);
        if (repTargetProgress) {
          repTargetProgress.textContent = target > 0
            ? `المنجز: ${Utils.currency(monthlySales)} • ${targetPct.toFixed(1)}%`
            : `المنجز: ${Utils.currency(monthlySales)}`;
        }
        if (repTargetBar) repTargetBar.style.width = `${targetPct.toFixed(1)}%`;
      } else {
        repTargetCard.style.display = 'none';
      }
    }

    const pendingClientsEl = document.getElementById('dash-pending-clients');
    if (pendingClientsEl) {
      const debtShops = shops.filter((shop) => (parseFloat(shop.balance) || 0) > 0)
        .sort((a, b) => (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0));
      if (debtShops.length > 0) {
        pendingClientsEl.innerHTML = `
          <div style="background:rgba(240,192,64,0.08);border:1px solid rgba(240,192,64,0.25);border-radius:10px;padding:12px 14px;">
            <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:8px;">
              💳 ديون معلقة — ${debtShops.length} عميل
              <span style="float:left;font-family:var(--font-mono);">
                ${Utils.currency(debtShops.reduce((sum, shop) => sum + (parseFloat(shop.balance) || 0), 0))}
              </span>
            </div>
            ${debtShops.slice(0, 5).map((shop) => `
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span>${escapeHtml(shop.name)}</span>
                <span style="font-family:var(--font-mono);color:#f0c040;font-weight:700;">${Utils.currency(parseFloat(shop.balance) || 0)}</span>
              </div>`).join('')}
            ${debtShops.length > 5 ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;text-align:center;">+ ${debtShops.length - 5} عملاء آخرين</div>` : ''}
          </div>`;
      } else {
        pendingClientsEl.innerHTML = '';
      }
    }

    const lowStock = isRep ? [] : products.filter((product) => product.quantity <= (product.minStock !== undefined ? product.minStock : 5));
    const alertEl = document.getElementById('dash-low-stock');
    if (alertEl) {
      let alertHtml = '';
      if (lowStock.length > 0) {
        alertHtml += `<div style="background:rgba(224,82,82,0.1);border:1px solid rgba(224,82,82,0.3);border-radius:8px;padding:12px 14px;margin-bottom:12px;">
          <div style="font-family:var(--font-main);font-size:13px;color:var(--danger);font-weight:700;margin-bottom:6px;">⚠ مخزون منخفض (${lowStock.length} ${lowStock.length === 1 ? 'صنف' : 'أصناف'})</div>
          ${lowStock.map((product) => `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);padding:2px 0;"><span>${escapeHtml(product.name)}</span><span style="font-family:var(--font-mono);color:var(--danger);">متبقي: ${product.quantity} / حد: ${product.minStock || 5}</span></div>`).join('')}
        </div>`;
      }
      const debtShops = shops.filter((shop) => (shop.balance || 0) > 0);
      if (debtShops.length > 0) {
        const totalDebt = debtShops.reduce((sum, shop) => sum + (shop.balance || 0), 0);
        alertHtml += `<div style="background:rgba(240,192,64,0.1);border:1px solid rgba(240,192,64,0.3);border-radius:8px;padding:12px 14px;margin-bottom:12px;">
          <div style="font-size:13px;color:var(--accent);font-weight:700;margin-bottom:6px;">💳 مديونيات العملاء — إجمالي: ${Utils.currency(totalDebt)}</div>
          ${debtShops.map((shop) => `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);padding:2px 0;"><span>${escapeHtml(shop.name)}</span><span style="font-family:var(--font-mono);color:var(--accent);">${Utils.currency(shop.balance)}</span></div>`).join('')}
        </div>`;
      }
      alertEl.innerHTML = alertHtml;
    }

    const recentEl = document.getElementById('dash-recent-invoices');
    if (recentEl) {
      const recent = [...regularInvoices]
        .sort((a, b) => (Utils.parseStoredDate(b.createdAt)?.getTime() || 0) - (Utils.parseStoredDate(a.createdAt)?.getTime() || 0))
        .slice(0, 5);

      if (recent.length === 0) {
        recentEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px 0;">لا توجد فواتير بعد.</div>`;
      } else {
        recentEl.innerHTML = recent.map((inv) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;">${escapeHtml(inv.number)}</div>
              <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(inv.shopName || 'زبون عادي')} · ${Utils.formatDate(inv.createdAt)}</div>
            </div>
            <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);">${Utils.currency(inv.total)}</div>
          </div>`).join('');
      }
    }

    latestPayments = allPayments;
    renderChart(invoices, allPayments);
  }

  window.addEventListener('nadir:chart-ready', () => {
    if (latestInvoices.length > 0 || latestPayments !== null) {
      renderChart(latestInvoices, latestPayments);
    }
  });

  function renderChart(invoices, paymentsData) {
    const canvas = document.getElementById('sales-chart');
    if (!canvas || !window.Chart) return;

    const months = [];
    const now = new Date();
    const arMonths = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: arMonths[d.getMonth()],
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        total: 0,
      });
    }

    if (paymentsData !== null && paymentsData !== undefined) {
      paymentsData.forEach((payment) => {
        const d = Utils.parseStoredDate(payment.paidAt || payment.createdAt) || new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const month = months.find((entry) => entry.key === key);
        if (month) month.total += parseFloat(payment.amount) || 0;
      });
    }

    if (salesChart) {
      salesChart.destroy();
      salesChart = null;
    }

    const ctx = canvas.getContext('2d');
    salesChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map((month) => month.label),
        datasets: [{
          label: 'المبيعات',
          data: months.map((month) => parseFloat(month.total.toFixed(2))),
          backgroundColor: 'rgba(240,192,64,0.6)',
          borderColor: 'rgba(240,192,64,1)',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${Utils.currency(ctx.parsed.y)}`,
            },
            backgroundColor: '#1e2435',
            titleColor: '#eef0f5',
            bodyColor: '#f0c040',
            borderColor: '#252d42',
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#8892a4', font: { family: 'Cairo', size: 11 } },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#8892a4',
              font: { family: 'IBM Plex Mono', size: 10 },
              callback: (value) => `${value} ج`,
            },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function setEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  return { load };
})();
