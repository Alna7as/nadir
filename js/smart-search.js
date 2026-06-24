const SmartSearch = (() => {
  let cache = { products: [], shops: [], invoices: [] };

  async function prime() {
    cache.products = await DB.getAll('products');
    cache.shops = OpsMeta.filterShops(await DB.getAll('shops'));
    cache.invoices = OpsMeta.filterInvoices(await DB.getAllParsed('invoices'));
  }

  function resultRow(type, id, title, meta) {
    return `
      <button type="button" data-search-type="${type}" data-search-id="${id}" style="width:100%;text-align:right;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px;color:var(--text-primary);font-family:var(--font-main);cursor:pointer;">
        <div style="font-size:13px;font-weight:800;">${escapeHtml(title)}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${escapeHtml(meta)}</div>
      </button>
    `;
  }

  function applyNavigation(type, id, label) {
    if (type === 'product') {
      Router.navigate('products');
      const input = document.getElementById('products-search');
      if (input) {
        input.value = label;
        input.dispatchEvent(new Event('input'));
      }
      return;
    }

    if (type === 'shop') {
      Router.navigate('shops');
      const input = document.getElementById('shops-search');
      if (input) {
        input.value = label;
        input.dispatchEvent(new Event('input'));
      }
      return;
    }

    Router.navigate('invoices');
    const input = document.getElementById('invoices-search');
    if (input) {
      input.value = label;
      input.dispatchEvent(new Event('input'));
    }
  }

  async function open() {
    await prime();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="width:min(680px,100%);background:var(--bg-secondary);border:1px solid var(--border);border-radius:18px;padding:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="font-size:18px;font-weight:900;color:var(--accent);">البحث الذكي</div>
          <button class="btn btn-secondary btn-sm" id="smart-search-close">إغلاق</button>
        </div>
        <input id="smart-search-input" class="form-control" placeholder="ابحث عن منتج أو فاتورة أو عميل..." style="margin-bottom:14px;">
        <div id="smart-search-results"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#smart-search-close').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

    const input = overlay.querySelector('#smart-search-input');
    const results = overlay.querySelector('#smart-search-results');

    function render(query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) {
        results.innerHTML = `<div style="font-size:12px;color:var(--text-muted);">اكتب كلمة بحث لعرض النتائج.</div>`;
        return;
      }

      const rows = [];
      cache.products
        .filter((item) => (item.name || '').toLowerCase().includes(q) || String(item.barcode || '').toLowerCase().includes(q))
        .slice(0, 4)
        .forEach((item) => rows.push(resultRow('product', item.id, item.name, `منتج • ${Utils.currency(item.price || 0)}`)));

      cache.shops
        .filter((item) => (item.name || '').toLowerCase().includes(q) || String(item.phone || '').includes(q))
        .slice(0, 4)
        .forEach((item) => rows.push(resultRow('shop', item.id, item.name, `عميل • ${item.phone || 'بدون رقم'}`)));

      cache.invoices
        .filter((item) => String(item.number || '').toLowerCase().includes(q) || String(item.shopName || '').toLowerCase().includes(q))
        .slice(0, 5)
        .forEach((item) => rows.push(resultRow('invoice', item.id, item.number, `فاتورة • ${item.shopName || 'زبون عادي'}`)));

      results.innerHTML = rows.length ? rows.join('') : `<div style="font-size:12px;color:var(--text-muted);">لا توجد نتائج مطابقة.</div>`;
      results.querySelectorAll('[data-search-type]').forEach((button) => {
        button.addEventListener('click', () => {
          applyNavigation(button.dataset.searchType, button.dataset.searchId, button.querySelector('div')?.textContent || '');
          close();
        });
      });
    }

    input.addEventListener('input', (event) => render(event.target.value));
    input.focus();
    render('');
  }

  return { open };
})();
