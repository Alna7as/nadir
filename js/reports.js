/**
 * reports.js
 * وحدة التقارير المالية والمبيعات
 */

const ReportsModule = (() => {
  let reportChart = null;
  let currentPeriod = 'today';
  let allInvoices = [];
  let allProducts = [];
  let allPayments = [];
  let allExpenses = [];

  function readLocalExpenses() {
    try {
      const raw = localStorage.getItem('nadir_expenses_v1');
      const rows = raw ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  async function load() {
    allInvoices = await DB.getAllParsed('invoices');
    allProducts = await DB.getAll('products');
    try {
      allExpenses = await DB.getAll('expenses');
    } catch (_) {
      allExpenses = readLocalExpenses();
    }

    try {
      allPayments = await DB.getAll('invoice_payments');
    } catch (_) {
      allPayments = [];
    }

    renderReport(currentPeriod);
  }

  window.addEventListener('nadir:chart-ready', () => {
    if (allInvoices.length > 0 || allPayments.length > 0) {
      renderReport(currentPeriod);
    }
  });

  function getDateRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (period) {
      case 'today':
        return { from: today, to: new Date(today.getTime() + 86400000 - 1) };
      case '7days':
        return { from: new Date(today.getTime() - 6 * 86400000), to: new Date(today.getTime() + 86400000 - 1) };
      case 'month':
        return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
      case 'year':
        return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
      case 'all':
      default:
        return { from: new Date(0), to: new Date(9999, 0) };
    }
  }

  function filterInvoices(period) {
    const { from, to } = getDateRange(period);
    return allInvoices.filter((inv) => {
      const d = Utils.parseStoredDate(inv.createdAt);
      if (!d) return false;
      return d >= from && d <= to && !inv.isReturn && inv.status !== 'void';
    });
  }

  function filterReturns(period) {
    const { from, to } = getDateRange(period);
    return allInvoices.filter((inv) => {
      const d = Utils.parseStoredDate(inv.createdAt);
      if (!d) return false;
      return d >= from && d <= to && inv.isReturn;
    });
  }

  function getItemCost(item, productMap) {
    if (item.costAtTime !== undefined && item.costAtTime !== null) {
      return parseFloat(item.costAtTime) || 0;
    }
    const product = productMap[item.productId];
    return product ? (parseFloat(product.cost) || 0) : 0;
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
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

  function renderReport(period) {
    currentPeriod = period;
    const invoices = filterInvoices(period);
    const returns = filterReturns(period);
    const { from, to } = getDateRange(period);

    const totalSales = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
    const totalReturns = returns.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
    const netSales = totalSales - totalReturns;

    const invoiceIds = new Set(invoices.map((inv) => String(inv.id)));
    const periodPayments = allPayments.filter((payment) => {
      const d = Utils.parseStoredDate(payment.paidAt || payment.createdAt);
      const invoiceId = payment.invoiceId || payment.invoice_id;
      if (!d) return false;
      return d >= from && d <= to && invoiceIds.has(String(invoiceId || ''));
    });
    const totalCollected = periodPayments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    const totalRemaining = Math.max(0, netSales - totalCollected);

    const periodExpenses = allExpenses.filter((expense) => {
      const d = Utils.parseStoredDate(expense.date || expense.createdAt);
      if (!d) return false;
      return d >= from && d <= to;
    });
    const totalExpenses = periodExpenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);

    const productMap = {};
    allProducts.forEach((product) => {
      productMap[product.id] = product;
    });

    let totalCost = 0;
    let returnsCost = 0;

    invoices.forEach((inv) => {
      let items = inv.items;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (_) {
          items = [];
        }
      }
      (items || []).forEach((item) => {
        totalCost += getItemCost(item, productMap) * item.qty;
      });
    });

    returns.forEach((inv) => {
      let items = inv.items;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (_) {
          items = [];
        }
      }
      (items || []).forEach((item) => {
        returnsCost += getItemCost(item, productMap) * item.qty;
      });
    });

    const netCost = totalCost - returnsCost;
    const netProfit = netSales - netCost;
    const operatingProfit = netProfit - totalExpenses;
    const avgInvoice = invoices.length > 0 ? totalSales / invoices.length : 0;
    const profitMargin = netSales > 0 ? (netProfit / netSales) * 100 : 0;
    const returnRate = totalSales > 0 ? (totalReturns / totalSales) * 100 : 0;

    setEl('rep-net-sales', Utils.currency(netSales));
    setEl('rep-total-cost', Utils.currency(netCost));
    setEl('rep-net-profit', Utils.currency(netProfit));
    setEl('rep-invoice-count', invoices.length);
    setEl('rep-returns-count', returns.length);
    setEl('rep-avg-invoice', Utils.currency(avgInvoice));
    setEl('rep-collected', Utils.currency(totalCollected));
    setEl('rep-remaining', Utils.currency(totalRemaining));
    setEl('rep-expenses', Utils.currency(totalExpenses));
    setEl('rep-operating-profit', Utils.currency(operatingProfit));
    setEl('rep-profit-margin', `${profitMargin.toFixed(1)}%`);
    setEl('rep-return-rate', `${returnRate.toFixed(1)}%`);

    const profitEl = document.getElementById('rep-net-profit');
    if (profitEl) profitEl.style.color = netProfit >= 0 ? '#4ade80' : '#e05252';

    const operatingProfitEl = document.getElementById('rep-operating-profit');
    if (operatingProfitEl) operatingProfitEl.style.color = operatingProfit >= 0 ? '#4ade80' : '#e05252';

    renderChart(invoices, period, periodPayments);
    renderTopProducts(invoices, productMap);
  }

  function renderChart(invoices, period, periodPayments) {
    const canvas = document.getElementById('reports-chart');
    if (!canvas || !window.Chart) return;

    const usePayments = periodPayments && periodPayments.length > 0;
    let labels = [];
    let dataMap = {};

    if (period === 'today') {
      for (let h = 0; h < 24; h++) {
        const label = `${String(h).padStart(2, '0')}:00`;
        labels.push(label);
        dataMap[h] = 0;
      }
      if (usePayments) {
        periodPayments.forEach((payment) => {
          const h = parseInt(Utils.cairoParts(payment.paidAt || payment.createdAt)?.hour || '', 10);
          if (Number.isNaN(h)) return;
          dataMap[h] = (dataMap[h] || 0) + (parseFloat(payment.amount) || 0);
        });
      } else {
        invoices.forEach((inv) => {
          const h = parseInt(Utils.cairoParts(inv.createdAt)?.hour || '', 10);
          if (Number.isNaN(h)) return;
          dataMap[h] = (dataMap[h] || 0) + (parseFloat(inv.total) || 0);
        });
      }
    } else if (period === '7days') {
      const arDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        labels.push(arDays[d.getDay()]);
        dataMap[d.toDateString()] = 0;
      }
      if (usePayments) {
        periodPayments.forEach((payment) => {
          const d = Utils.parseStoredDate(payment.paidAt || payment.createdAt);
          if (!d) return;
          d.setHours(0, 0, 0, 0);
          if (dataMap[d.toDateString()] !== undefined) {
            dataMap[d.toDateString()] += parseFloat(payment.amount) || 0;
          }
        });
      } else {
        invoices.forEach((inv) => {
          const d = Utils.parseStoredDate(inv.createdAt);
          if (!d) return;
          d.setHours(0, 0, 0, 0);
          if (dataMap[d.toDateString()] !== undefined) {
            dataMap[d.toDateString()] += parseFloat(inv.total) || 0;
          }
        });
      }
    } else if (period === 'month') {
      const now = new Date();
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        labels.push(String(d));
        dataMap[d] = 0;
      }
      if (usePayments) {
        periodPayments.forEach((payment) => {
          const d = parseInt(Utils.cairoParts(payment.paidAt || payment.createdAt)?.day || '', 10);
          if (!d) return;
          dataMap[d] = (dataMap[d] || 0) + (parseFloat(payment.amount) || 0);
        });
      } else {
        invoices.forEach((inv) => {
          const d = parseInt(Utils.cairoParts(inv.createdAt)?.day || '', 10);
          if (!d) return;
          dataMap[d] = (dataMap[d] || 0) + (parseFloat(inv.total) || 0);
        });
      }
    } else {
      const arMonths = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      arMonths.forEach((month, i) => {
        labels.push(month);
        dataMap[i] = 0;
      });
      if (usePayments) {
        periodPayments.forEach((payment) => {
          const m = parseInt(Utils.cairoParts(payment.paidAt || payment.createdAt)?.month || '', 10) - 1;
          if (Number.isNaN(m)) return;
          dataMap[m] = (dataMap[m] || 0) + (parseFloat(payment.amount) || 0);
        });
      } else {
        invoices.forEach((inv) => {
          const m = parseInt(Utils.cairoParts(inv.createdAt)?.month || '', 10) - 1;
          if (Number.isNaN(m)) return;
          dataMap[m] = (dataMap[m] || 0) + (parseFloat(inv.total) || 0);
        });
      }
    }

    const chartData = labels.map((_, i) => {
      let key;
      if (period === 'today') {
        key = i;
      } else if (period === '7days') {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        d.setHours(0, 0, 0, 0);
        key = d.toDateString();
      } else if (period === 'month') {
        key = i + 1;
      } else {
        key = i;
      }
      return parseFloat((dataMap[key] || 0).toFixed(2));
    });

    if (reportChart) {
      reportChart.destroy();
      reportChart = null;
    }

    const ctx = canvas.getContext('2d');
    reportChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: usePayments ? 'التحصيل' : 'المبيعات',
          data: chartData,
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
              label: (ctx2) => ` ${Utils.currency(ctx2.parsed.y)}`,
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
            ticks: { color: '#8892a4', font: { family: 'Cairo', size: 9 } },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#8892a4',
              font: { family: 'IBM Plex Mono', size: 9 },
              callback: (v) => `${v} ج`,
            },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function renderTopProducts(invoices, productMap) {
    const el = document.getElementById('rep-top-products');
    if (!el) return;

    const productSales = {};
    invoices.forEach((inv) => {
      let items = inv.items;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (_) {
          items = [];
        }
      }
      (items || []).forEach((item) => {
        if (!productSales[item.productId]) {
          productSales[item.productId] = {
            name: item.name,
            qty: 0,
            revenue: 0,
            profit: 0,
          };
        }
        const cost = getItemCost(item, productMap);
        productSales[item.productId].qty += item.qty;
        productSales[item.productId].revenue += item.price * item.qty;
        productSales[item.productId].profit += (item.price - cost) * item.qty;
      });
    });

    const sorted = Object.values(productSales).sort((a, b) => b.qty - a.qty).slice(0, 10);

    if (!sorted.length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px 0;">لا توجد بيانات مبيعات في هذه الفترة</div>';
      return;
    }

    el.innerHTML = sorted.map((product, index) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:24px;height:24px;border-radius:50%;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--accent);">${index + 1}</div>
          <div>
            <div style="font-size:13px;font-weight:600;">${escapeHtml(product.name)}</div>
            <div style="font-size:11px;color:var(--text-muted);">ربح: ${Utils.currency(product.profit)}</div>
          </div>
        </div>
        <div style="text-align:left;">
          <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);">${Utils.currency(product.revenue)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${product.qty} وحدة</div>
        </div>
      </div>
    `).join('');
  }

  function buildInvoiceAmountCell(inv, paymentsMap = {}) {
    const total = parseFloat(inv.total) || 0;
    const amountPaid = Math.max(0, parseFloat(paymentsMap[inv.id] ?? inv.amountPaid) || 0);
    const isPartial = String(inv.status || '').toLowerCase() === 'partial' && amountPaid > 0 && amountPaid < total - 0.01;
    return `${Utils.currency(total)}${isPartial ? `<div style="font-size:11px;color:#666;margin-top:4px;">المدفوع: ${Utils.currency(amountPaid)}</div>` : ''}`;
  }

  function printReport() {
    const period = currentPeriod;
    const invoices = filterInvoices(period);
    const returns = filterReturns(period);
    const periodLabels = {
      today: 'اليوم',
      '7days': 'آخر 7 أيام',
      month: 'هذا الشهر',
      year: 'هذه السنة',
      all: 'الكل',
    };

    const totalSales = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
    const totalReturns = returns.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
    const netSales = totalSales - totalReturns;
    const { from, to } = getDateRange(period);
    const invoiceIds = new Set(invoices.map((inv) => String(inv.id)));
    const paymentsMap = buildInvoicePaymentsMap(allPayments);

    const productMap = {};
    allProducts.forEach((product) => {
      productMap[product.id] = product;
    });

    const periodExpenses = allExpenses.filter((expense) => {
      const expenseDate = String(expense.date || expense.createdAt || '').slice(0, 10);
      if (!expenseDate) return false;
      const d = new Date(expenseDate);
      return d >= from && d <= to;
    });
    const totalExpenses = periodExpenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);

    let totalCost = 0;
    let returnsCost = 0;

    invoices.forEach((inv) => {
      let items = inv.items;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (_) {
          items = [];
        }
      }
      (items || []).forEach((item) => {
        totalCost += getItemCost(item, productMap) * item.qty;
      });
    });

    returns.forEach((inv) => {
      let items = inv.items;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (_) {
          items = [];
        }
      }
      (items || []).forEach((item) => {
        returnsCost += getItemCost(item, productMap) * item.qty;
      });
    });

    const netCost = totalCost - returnsCost;
    const netProfit = netSales - netCost;
    const operatingProfit = netProfit - totalExpenses;
    const periodCollected = allPayments
      .filter((payment) => {
        const d = Utils.parseStoredDate(payment.paidAt || payment.createdAt);
        const invoiceId = payment.invoiceId || payment.invoice_id;
        return d && d >= from && d <= to && invoiceIds.has(String(invoiceId || ''));
      })
      .reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    const periodRemaining = Math.max(0, netSales - periodCollected);

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
    <title>تقرير - ${periodLabels[period]}</title>
    <style>
      body{font-family:Cairo,sans-serif;padding:30px;color:#111;font-size:14px;}
      h1{font-size:20px;margin-bottom:4px;}
      .sub{color:#666;font-size:12px;margin-bottom:20px;}
      table{width:100%;border-collapse:collapse;margin-top:16px;}
      th,td{padding:8px 10px;border:1px solid #ddd;text-align:right;vertical-align:top;}
      th{background:#f5f5f5;font-weight:700;}
      .stat{display:inline-block;min-width:160px;background:#f9f9f9;border:1px solid #ddd;border-radius:8px;padding:12px;margin:6px;text-align:center;}
      .stat-val{font-size:20px;font-weight:700;}
      .profit{color:${netProfit >= 0 ? '#16a34a' : '#dc2626'};}
      @media print{button{display:none}}
    </style></head><body>
    <button onclick="window.print()" style="margin-bottom:16px;padding:8px 20px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;cursor:pointer;">طباعة</button>
    <h1>تقرير المبيعات - ${periodLabels[period]}</h1>
    <div class="sub">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</div>
    <div>
      <div class="stat"><div>صافي المبيعات</div><div class="stat-val">${Utils.currency(netSales)}</div></div>
      <div class="stat"><div>تحصيل الفترة</div><div class="stat-val">${Utils.currency(periodCollected)}</div></div>
      <div class="stat"><div>متبقي الفترة</div><div class="stat-val">${Utils.currency(periodRemaining)}</div></div>
      <div class="stat"><div>إجمالي التكلفة</div><div class="stat-val">${Utils.currency(netCost)}</div></div>
      <div class="stat profit"><div>صافي الربح</div><div class="stat-val">${Utils.currency(netProfit)}</div></div>
      <div class="stat ${operatingProfit >= 0 ? 'profit' : ''}"><div>الربح بعد المصاريف</div><div class="stat-val">${Utils.currency(operatingProfit)}</div></div>
      <div class="stat"><div>مصاريف الفترة</div><div class="stat-val">${Utils.currency(totalExpenses)}</div></div>
      <div class="stat"><div>عدد الفواتير</div><div class="stat-val">${invoices.length}</div></div>
      <div class="stat"><div>المرتجعات</div><div class="stat-val">${returns.length}</div></div>
      <div class="stat"><div>متوسط الفاتورة</div><div class="stat-val">${Utils.currency(invoices.length > 0 ? totalSales / invoices.length : 0)}</div></div>
    </div>
    <h2 style="margin-top:24px;">تفاصيل الفواتير</h2>
    <table>
      <thead><tr><th>#</th><th>رقم الفاتورة</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
      <tbody>${invoices.map((inv, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(inv.number)}</td><td>${escapeHtml(inv.shopName || 'زبون عادي')}</td><td>${Utils.formatDate(inv.createdAt)}</td><td>${buildInvoiceAmountCell(inv, paymentsMap)}</td><td>${inv.status}</td></tr>`).join('')}</tbody>
    </table>
    </body></html>`);
    win.document.close();
  }

  function init() {
    document.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-period]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderReport(btn.dataset.period);
      });
    });

    document.getElementById('print-report-btn')?.addEventListener('click', printReport);
  }

  return { load, init };
})();
