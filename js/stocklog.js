/**
 * stocklog.js — وحدة سجل حركة المخزون
 */

const StockLogModule = (() => {
  let allMovements = [];
  let filterProduct = '';

  async function load() {
    allMovements = await DB.getMovements(null);
    renderFilter();
    renderSummary();
    render();
  }

  async function renderFilter() {
    const sel = document.getElementById('stocklog-product-filter');
    if (!sel) return;
    const products = await DB.getAll('products');
    sel.innerHTML = '<option value="">كل المنتجات</option>' +
      products.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    sel.value = filterProduct;
  }

  function render() {
    const container = document.getElementById('stocklog-list');
    if (!container) return;

    let filtered = filterProduct
      ? allMovements.filter(m => String(m.productId) === String(filterProduct))
      : allMovements;

    if (filtered.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;font-size:13px;">لا توجد حركات مخزون مسجلة</div>';
      return;
    }

    container.innerHTML = filtered.map(m => {
      const isIn = m.type === 'in';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${isIn?'rgba(74,222,128,0.15)':'rgba(224,82,82,0.15)'};font-size:14px;">${isIn?'↑':'↓'}</div>
            <div>
              <div style="font-size:13px;font-weight:600;">${escapeHtml(m.productName||'منتج محذوف')}</div>
              <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(m.reason||'')} ${m.invoiceNumber?'· '+escapeHtml(m.invoiceNumber):''}</div>
              <div style="font-size:10px;color:var(--text-muted);">${Utils.formatDateTime(m.createdAt)}</div>
            </div>
          </div>
          <div style="text-align:left;">
            <div style="font-family:var(--font-mono);font-weight:700;color:${isIn?'#4ade80':'#e05252'};">${isIn?'+':'-'}${m.qty}</div>
            <div style="font-size:10px;color:var(--text-muted);">قبل: ${m.balanceBefore} → بعد: ${m.balanceAfter}</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderSummary() {
    const container = document.getElementById('stocklog-summary');
    if (!container) return;

    const today = Utils.dateKey();
    const movements = filterProduct
      ? allMovements.filter(m => String(m.productId) === String(filterProduct))
      : allMovements;
    const inbound = movements
      .filter((m) => m.type === 'in')
      .reduce((sum, m) => sum + (parseFloat(m.qty) || 0), 0);
    const outbound = movements
      .filter((m) => m.type === 'out')
      .reduce((sum, m) => sum + (parseFloat(m.qty) || 0), 0);
    const todayCount = movements.filter((m) => Utils.dateKey(m.createdAt) === today).length;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">إجمالي الداخل</div>
          <div class="stat-value" style="font-size:16px;color:#4ade80;">${inbound}</div>
        </div>
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">إجمالي الخارج</div>
          <div class="stat-value" style="font-size:16px;color:#f87171;">${outbound}</div>
        </div>
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">حركات اليوم</div>
          <div class="stat-value" style="font-size:16px;color:#60a5fa;">${todayCount}</div>
        </div>
      </div>`;
  }

  function init() {
    document.getElementById('stocklog-product-filter')?.addEventListener('change', (e) => {
      filterProduct = e.target.value;
      renderSummary();
      render();
    });
  }

  return { load, init };
})();
