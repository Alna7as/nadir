/**
 * products.js — إدارة المنتجات (مُصلح)
 */

const ProductsModule = (() => {
  const PURCHASE_ADJUSTMENT_KEY = 'nadir_products_purchase_adjustment_v1';
  const SALES_ADJUSTMENT_KEY = 'nadir_products_sales_adjustment_v1';
  const PURCHASE_ADJUSTMENT_DB_KEY = 'products_purchase_discount';
  const SALES_ADJUSTMENT_DB_KEY = 'products_sales_discount';

  let allProducts = [];
  let editingId   = null;
  let searchQuery = '';
  let barcodePreviewProduct = null;
  let batchBarcodeQuery = '';
  let batchBarcodeSelection = {};
  let _purchaseAdjustment = 0;
  let _salesAdjustment = 0;

  function getPurchaseAdjustment() {
    return Math.max(0, parseFloat(_purchaseAdjustment) || 0);
  }

  function setPurchaseAdjustmentLocal(value) {
    const safeValue = Math.max(0, parseFloat(value) || 0);
    _purchaseAdjustment = safeValue;
    localStorage.setItem(PURCHASE_ADJUSTMENT_KEY, String(safeValue));
    return safeValue;
  }

  function getSalesAdjustment() {
    return Math.max(0, parseFloat(_salesAdjustment) || 0);
  }

  function setSalesAdjustmentLocal(value) {
    const safeValue = Math.max(0, parseFloat(value) || 0);
    _salesAdjustment = safeValue;
    localStorage.setItem(SALES_ADJUSTMENT_KEY, String(safeValue));
    return safeValue;
  }

  async function loadAdjustments() {
    try {
      const [purchaseValue, salesValue] = await Promise.all([
        typeof DB !== 'undefined' ? DB.getAppSetting(PURCHASE_ADJUSTMENT_DB_KEY, null) : null,
        typeof DB !== 'undefined' ? DB.getAppSetting(SALES_ADJUSTMENT_DB_KEY, null) : null,
      ]);

      if (purchaseValue !== null && purchaseValue !== undefined) {
        setPurchaseAdjustmentLocal(purchaseValue);
      } else {
        setPurchaseAdjustmentLocal(localStorage.getItem(PURCHASE_ADJUSTMENT_KEY));
      }

      if (salesValue !== null && salesValue !== undefined) {
        setSalesAdjustmentLocal(salesValue);
      } else {
        setSalesAdjustmentLocal(localStorage.getItem(SALES_ADJUSTMENT_KEY));
      }
    } catch (_) {
      setPurchaseAdjustmentLocal(localStorage.getItem(PURCHASE_ADJUSTMENT_KEY));
      setSalesAdjustmentLocal(localStorage.getItem(SALES_ADJUSTMENT_KEY));
    }
  }

  async function savePurchaseAdjustment(value) {
    const safeValue = setPurchaseAdjustmentLocal(value);
    if (typeof DB !== 'undefined') {
      await DB.saveAppSetting(PURCHASE_ADJUSTMENT_DB_KEY, safeValue);
    }
    return safeValue;
  }

  async function saveSalesAdjustment(value) {
    const safeValue = setSalesAdjustmentLocal(value);
    if (typeof DB !== 'undefined') {
      await DB.saveAppSetting(SALES_ADJUSTMENT_DB_KEY, safeValue);
    }
    return safeValue;
  }

  function isStoreOwner() {
    return typeof Session !== 'undefined' && Session.getRole() === 'admin';
  }

  async function openPurchaseAdjustmentEditor() {
    if (!isStoreOwner()) return;
    const current = getPurchaseAdjustment();
    const raw = window.prompt(
      `أدخل المبلغ الذي تريد خصمه يدويًا من إجمالي الشراء.\nالقيمة الحالية: ${Utils.currency(current)}`,
      current
    );
    if (raw === null) return;
    const next = await savePurchaseAdjustment(raw);
    Toast.success(`تم تحديث الخصم اليدوي إلى ${Utils.currency(next)} ✓`);
    render();
  }

  async function openSalesAdjustmentEditor() {
    if (!isStoreOwner()) return;
    const current = getSalesAdjustment();
    const raw = window.prompt(
      `أدخل المبلغ الذي تريد خصمه يدويًا من إجمالي البيع.\nالقيمة الحالية: ${Utils.currency(current)}`,
      current
    );
    if (raw === null) return;
    const next = await saveSalesAdjustment(raw);
    Toast.success(`تم تحديث خصم البيع إلى ${Utils.currency(next)} ✓`);
    render();
  }

  function normalizeBarcode(value) {
    if (typeof BarcodeUtils === 'undefined') return String(value || '').trim().toUpperCase();
    return BarcodeUtils.normalize(value);
  }

  function generateUniqueBarcode(excludeId = null) {
    let barcode = '';
    do {
      barcode = typeof BarcodeUtils !== 'undefined'
        ? BarcodeUtils.generate()
        : `P${Date.now()}${Math.floor(Math.random() * 900) + 100}`;
    } while (allProducts.some((p) => p.id !== excludeId && normalizeBarcode(p.barcode) === barcode));
    return barcode;
  }

  function sanitizeProductBarcode(product) {
    const current = normalizeBarcode(product?.barcode || '');
    const hasConflict = allProducts.some((p) => p.id !== product.id && normalizeBarcode(p.barcode) === current);
    if (current && !hasConflict && (!BarcodeUtils || BarcodeUtils.isValid(current))) {
      return current;
    }
    return generateUniqueBarcode(product?.id || null);
  }

  async function ensureProductBarcode(product, options = {}) {
    if (!product) return null;
    const nextBarcode = sanitizeProductBarcode(product);
    if (nextBarcode === (product.barcode || '')) return nextBarcode;

    const updated = { ...product, barcode: nextBarcode };
    if (options.persist !== false) {
      await DB.put('products', updated);
    }
    const idx = allProducts.findIndex((p) => p.id === product.id);
    if (idx !== -1) allProducts[idx] = updated;
    return nextBarcode;
  }

  function buildBarcodeMarkup(product) {
    const barcode = normalizeBarcode(product?.barcode || '');
    if (!barcode || typeof BarcodeUtils === 'undefined') return '';

    return `
      <div style="margin-top:8px;padding:6px;background:#fff;border-radius:8px;border:1px solid var(--border);overflow:hidden;max-width:220px;">
        ${BarcodeUtils.toSVG(barcode, { height: 24, fontSize: 8, quietZone: 8, narrow: 1.2, wide: 3.2 })}
      </div>`;
  }

  function getBatchBarcodeCopies(productId) {
    const raw = parseInt(batchBarcodeSelection[productId], 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  function buildBatchBarcodeLabel(product) {
    const barcode = normalizeBarcode(product?.barcode || '');
    if (!barcode || typeof BarcodeUtils === 'undefined') return '';
    return `
      <div class="label">
        <div class="name">${escapeHtml(product.name)}</div>
        <div class="price">${Utils.currency(product.price || 0)}</div>
        <div class="barcode">${BarcodeUtils.toSVG(barcode, { height: 56, fontSize: 10, quietZone: 8, narrow: 1.7, wide: 4.2 })}</div>
      </div>`;
  }

  function renderBatchBarcodeList() {
    const list = document.getElementById('batch-barcodes-list');
    if (!list) return;

    const query = batchBarcodeQuery.trim().toLowerCase();
    const filtered = query
      ? allProducts.filter((p) =>
          (p.name || '').toLowerCase().includes(query) ||
          normalizeBarcode(p.barcode || '').includes(query)
        )
      : allProducts;

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state" style="padding:20px 10px;"><p>لا توجد منتجات مطابقة.</p></div>`;
      return;
    }

    list.innerHTML = filtered.map((product) => {
      const barcode = normalizeBarcode(product.barcode || '');
      const checked = Object.prototype.hasOwnProperty.call(batchBarcodeSelection, product.id);
      const copies = getBatchBarcodeCopies(product.id);
      return `
        <label style="display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px;">
          <input type="checkbox" data-batch-product="${product.id}" ${checked ? 'checked' : ''}>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;color:var(--text-primary);">${escapeHtml(product.name)}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(barcode || 'بدون باركود')}</div>
          </div>
          <input
            type="number"
            min="1"
            value="${copies}"
            data-batch-copies="${product.id}"
            class="form-control"
            style="width:82px;text-align:center;"
            title="عدد النسخ"
          >
        </label>`;
    }).join('');

    list.querySelectorAll('[data-batch-product]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const id = parseInt(e.target.dataset.batchProduct, 10);
        if (e.target.checked) {
          batchBarcodeSelection[id] = getBatchBarcodeCopies(id);
        } else {
          delete batchBarcodeSelection[id];
        }
      });
    });

    list.querySelectorAll('[data-batch-copies]').forEach((el) => {
      el.addEventListener('input', (e) => {
        const id = parseInt(e.target.dataset.batchCopies, 10);
        const value = Math.max(1, parseInt(e.target.value, 10) || 1);
        e.target.value = value;
        if (Object.prototype.hasOwnProperty.call(batchBarcodeSelection, id)) {
          batchBarcodeSelection[id] = value;
        }
      });
    });
  }

  function buildBarcodePreviewHTML(product) {
    const barcode = normalizeBarcode(product?.barcode || '');
    if (!barcode || typeof BarcodeUtils === 'undefined') {
      return '';
    }

    const svg = BarcodeUtils.toSVG(barcode, { height: 58, fontSize: 11, quietZone: 10, narrow: 1.8, wide: 4.4 });
    return `
      <div style="width:48mm;margin:0 auto;text-align:center;color:#111;">
        <div style="font-size:18px;font-weight:700;line-height:1.3;margin-bottom:2px;">${escapeHtml(product.name)}</div>
        <div style="font-size:10px;margin-bottom:6px;">${Utils.currency(product.price || 0)}</div>
        <div style="display:flex;justify-content:center;">${svg}</div>
      </div>`;
  }

  function openBarcodePrintWindow(product) {
    const barcode = normalizeBarcode(product?.barcode || '');
    if (!barcode || typeof BarcodeUtils === 'undefined') {
      Toast.error('تعذر تجهيز الباركود للطباعة');
      return;
    }

    const svg = BarcodeUtils.toSVG(barcode, { height: 56, fontSize: 10, quietZone: 8, narrow: 1.7, wide: 4.2 });
    const win = window.open('', '_blank', 'width=420,height=620');
    if (!win) {
      Toast.error('افتح السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>باركود ${escapeHtml(product.name)}</title>
  <style>
    @page { size: 50mm 32mm; margin: 0; }
    html, body { margin: 0; padding: 0; width: 50mm; height: 32mm; background: #fff; font-family: Arial, sans-serif; }
    body { padding: 2.5mm 2mm; box-sizing: border-box; overflow: hidden; }
    .label { text-align: center; color: #111; }
    .name { font-size: 11px; font-weight: 700; margin-bottom: 2px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .price { font-size: 9px; margin-bottom: 3px; }
    .barcode { display: flex; justify-content: center; margin: 1px 0 0; }
    .barcode svg { width: 100%; height: auto; }
  </style>
</head>
<body>
  <div class="label">
    <div class="name">${escapeHtml(product.name)}</div>
    <div class="price">${Utils.currency(product.price || 0)}</div>
    <div class="barcode">${svg}</div>
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
        window.onafterprint = function() { window.close(); };
      }, 120);
    };
  </script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  async function openBatchBarcodesModal() {
    try {
      for (const product of [...allProducts]) {
        await ensureProductBarcode(product);
      }
      const modal = document.getElementById('batch-barcodes-modal');
      if (!modal) return;
      batchBarcodeQuery = '';
      const searchInput = document.getElementById('batch-barcodes-search');
      if (searchInput) searchInput.value = '';
      renderBatchBarcodeList();
      modal.classList.add('open');
    } catch (err) {
      console.error(err);
      Toast.error('فشل في تجهيز الباركودات');
    }
  }

  function closeBatchBarcodesModal() {
    document.getElementById('batch-barcodes-modal')?.classList.remove('open');
  }

  function selectAllBatchBarcodes() {
    allProducts.forEach((product) => {
      batchBarcodeSelection[product.id] = getBatchBarcodeCopies(product.id);
    });
    renderBatchBarcodeList();
  }

  function clearBatchBarcodesSelection() {
    batchBarcodeSelection = {};
    renderBatchBarcodeList();
  }

  function printBatchBarcodes() {
    const selectedProducts = allProducts.filter((product) => Object.prototype.hasOwnProperty.call(batchBarcodeSelection, product.id));
    if (!selectedProducts.length) {
      Toast.error('حدد منتجًا واحدًا على الأقل');
      return;
    }

    const labels = [];
    selectedProducts.forEach((product) => {
      const copies = getBatchBarcodeCopies(product.id);
      for (let i = 0; i < copies; i++) {
        labels.push(buildBatchBarcodeLabel(product));
      }
    });

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      Toast.error('افتح السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>طباعة باركودات جماعية</title>
  <style>
    @page { size: A4; margin: 8mm; }
    body { margin: 0; font-family: Arial, sans-serif; background: #fff; }
    .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(50mm, 1fr)); gap: 4mm; align-items: start; }
    .label { width: 50mm; height: 32mm; box-sizing: border-box; padding: 2.5mm 2mm; overflow: hidden; text-align: center; color: #111; break-inside: avoid; border: 1px dashed #ddd; }
    .name { font-size: 11px; font-weight: 700; margin-bottom: 2px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .price { font-size: 9px; margin-bottom: 3px; }
    .barcode { display: flex; justify-content: center; }
    .barcode svg { width: 100%; height: auto; }
  </style>
</head>
<body>
  <div class="sheet">${labels.join('')}</div>
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
        window.onafterprint = function() { window.close(); };
      }, 120);
    };
  </script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  async function printBarcode(productId) {
    try {
      const product = allProducts.find((p) => p.id === productId) || await DB.get('products', productId);
      if (!product) {
        Toast.error('المنتج غير موجود');
        return;
      }
      const barcode = await ensureProductBarcode(product);
      const previewProduct = { ...product, barcode };
      barcodePreviewProduct = previewProduct;

      const modal = document.getElementById('barcode-modal');
      const previewArea = document.getElementById('barcode-preview-area');
      if (!modal || !previewArea) {
        openBarcodePrintWindow(previewProduct);
        return;
      }

      previewArea.innerHTML = buildBarcodePreviewHTML(previewProduct);
      modal.classList.add('open');
    } catch (err) {
      console.error(err);
      Toast.error('فشل في طباعة الباركود');
    }
  }

  function closeBarcodeModal() {
    document.getElementById('barcode-modal')?.classList.remove('open');
    barcodePreviewProduct = null;
  }

  function printBarcodeFromModal() {
    if (!barcodePreviewProduct) {
      Toast.error('لا يوجد باركود جاهز للطباعة');
      return;
    }
    openBarcodePrintWindow(barcodePreviewProduct);
  }

  const listEl       = () => document.getElementById('products-list');
  const modalEl      = () => document.getElementById('product-modal');
  const formEl       = () => document.getElementById('product-form');
  const modalTitleEl = () => document.getElementById('product-modal-title');
  const countEl      = () => document.getElementById('products-count');

  async function load() {
    await loadAdjustments();
    try {
      allProducts = await DB.getAll('products');
    } catch (e) {
      allProducts = DB.getCachedTable('products');
    }

    let movements = [];
    try {
      movements = await DB.getMovements(null);
    } catch (e) {
      movements = DB.getCachedTable('stock_movements');
    }

    // map سريع للمنتجات
    const prodMap = {};
    allProducts.forEach(p => { prodMap[p.id] = p; });

      const purchaseReasons = ['رصيد أولي', 'إضافة يدوية'];
 
     const inQty = {};
    movements.filter(m => m.type === 'in' && (!m.invoiceNumber || purchaseReasons.includes(m.reason))).forEach(m => {
      inQty[m.productId] = (inQty[m.productId] || 0) + (m.qty || 0);
    });
    _fixedTotalCost = allProducts.reduce((sum, p) => {
      const addedQty = inQty[p.id] !== undefined ? inQty[p.id] : (p.quantity || 0);
      return sum + (p.cost || 0) * addedQty;
    }, 0);

    // إجمالي تكلفة المبيعات التاريخية = costAtTime من items الفواتير
    let soldCostTotal = 0;
    _salesByProduct        = {};
    _costAtTimeByProduct   = {};

    try {
      const allInvoices = await DB.getAllParsed('invoices');
      for (const inv of allInvoices) {
        if (inv.isReturn || inv.status === 'void' || inv.status === 'draft') continue;
        let items = inv.items;
        if (typeof items === 'string') {
          try { items = JSON.parse(items); } catch(e) { items = []; }
        }
        for (const item of (items || [])) {
          const pid = item.productId;

          const rawCost = parseFloat(item.costAtTime);
          const cost = (!isNaN(rawCost) && rawCost > 0)
            ? rawCost
            : (prodMap[pid]?.cost || 0);

          const qty = parseInt(item.qty) || 0;
          soldCostTotal += cost * qty;

          if (!_salesByProduct[pid]) _salesByProduct[pid] = [];
          _salesByProduct[pid].push({
            ...item,
            costAtTime: cost,
            invoiceNumber: inv.number,
            createdAt: inv.createdAt
          });

          _costAtTimeByProduct[pid] = (_costAtTimeByProduct[pid] || 0) + cost * qty;
        }
      }
    } catch(e) {
      console.warn('[products] fallback to movements cost:', e);
      movements.filter(m => m.type === 'out' && m.invoiceNumber).forEach(m => {
        const cost = prodMap[m.productId]?.cost || 0;
        soldCostTotal += cost * (m.qty || 0);
        if (!_salesByProduct[m.productId]) _salesByProduct[m.productId] = [];
        _salesByProduct[m.productId].push(m);
      });
    }

    _soldCostTotal = soldCostTotal;
    _statsReady = true;
    for (const product of [...allProducts]) {
      await ensureProductBarcode(product);
    }
    render();
  }

  let _fixedTotalCost        = 0;
  let _soldCostTotal         = 0;
  let _salesByProduct        = {};
  let _costAtTimeByProduct   = {};
  let _statsReady            = false;

  function render() {
    const container = listEl();
    if (!container) return;
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? allProducts.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode || '').includes(q) ||
          (p.category || '').toLowerCase().includes(q)
        )
      : allProducts;

    const salesAdjustment = getSalesAdjustment();
    const totalSoldCost  = _statsReady ? Math.max(0, _soldCostTotal - salesAdjustment) : 0;
    const purchaseAdjustment = getPurchaseAdjustment();
    const totalCostValue = _statsReady ? Math.max(0, _fixedTotalCost - _soldCostTotal - purchaseAdjustment) : 0;
    const totalCount     = allProducts.length;
    if (countEl()) countEl().textContent = totalCount;

    const statsEl = document.getElementById('products-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
          <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">عدد الأصناف</div>
            <div style="font-family:var(--font-mono);font-weight:700;font-size:18px;color:var(--accent);">${totalCount}</div>
          </div>
          <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">إجمالي البيع</div>
            <div style="font-size:9px;color:var(--text-muted);margin-bottom:2px;">(تكلفة ما بِيع على المخزن)</div>
            <div style="font-family:var(--font-mono);font-weight:700;font-size:13px;color:#4ade80;">${Utils.currency(totalSoldCost)}</div>
            ${salesAdjustment > 0 ? `<div style="font-size:10px;color:#f0c040;margin-top:4px;">خصم يدوي: ${Utils.currency(salesAdjustment)}</div>` : ''}
            ${isStoreOwner() ? `
              <button type="button" class="btn btn-secondary btn-sm" id="edit-sales-adjustment-btn" style="margin-top:8px;font-size:10px;padding:6px 10px;">
                خصم يدوي
              </button>` : ''}
          </div>
          <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">إجمالي الشراء</div>
            <div style="font-size:9px;color:var(--text-muted);margin-bottom:2px;">(قيمة المخزون الحالي بالتكلفة)</div>
            <div style="font-family:var(--font-mono);font-weight:700;font-size:13px;color:#60a5fa;">${Utils.currency(totalCostValue)}</div>
            ${purchaseAdjustment > 0 ? `<div style="font-size:10px;color:#f0c040;margin-top:4px;">خصم يدوي: ${Utils.currency(purchaseAdjustment)}</div>` : ''}
            ${isStoreOwner() ? `
              <button type="button" class="btn btn-secondary btn-sm" id="edit-purchase-adjustment-btn" style="margin-top:8px;font-size:10px;padding:6px 10px;">
                خصم يدوي
              </button>` : ''}
          </div>
        </div>`;
      document.getElementById('edit-purchase-adjustment-btn')?.addEventListener('click', openPurchaseAdjustmentEditor);
      document.getElementById('edit-sales-adjustment-btn')?.addEventListener('click', openSalesAdjustmentEditor);
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg><p>${q ? 'لا توجد منتجات تطابق البحث.' : 'لا توجد منتجات بعد!'}</p></div>`;
      return;
    }
    container.innerHTML = filtered.map(p => renderProductCard(p)).join('');
    // ✅ event delegation بدل forEach على كل عنصر
    container.onclick = (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return openEdit(parseInt(edit.dataset.edit));
      const del = e.target.closest('[data-delete]');
      if (del) return deleteProduct(parseInt(del.dataset.delete));
      const qty = e.target.closest('[data-add-qty]');
      if (qty) return openAddQty(parseInt(qty.dataset.addQty));
    };
    container.querySelectorAll('[data-price-up]').forEach(btn => btn.addEventListener('click', () => quickPriceChange(parseInt(btn.dataset.priceUp), +1)));
    container.querySelectorAll('[data-price-down]').forEach(btn => btn.addEventListener('click', () => quickPriceChange(parseInt(btn.dataset.priceDown), -1)));
    container.querySelectorAll('[data-print-barcode]').forEach(btn => btn.addEventListener('click', () => printBarcode(parseInt(btn.dataset.printBarcode, 10))));
  }

  function renderProductCard(p) {
    const minStock = p.minStock || 5;
    const isLow    = p.quantity <= minStock;
    const stockBadge = isLow
      ? `<span class="badge badge-red">منخفض: ${p.quantity}</span>`
      : `<span class="badge badge-green">${p.quantity} وحدة</span>`;

    // ✅ تنبيه: سعر البيع أقل من التكلفة
    const isPriceLow = p.cost > 0 && p.price < p.cost;
    const priceBadge = isPriceLow
      ? `<span class="badge" style="background:rgba(251,191,36,0.15);color:#fbbf24;border:1px solid #fbbf24;border-radius:6px;padding:2px 7px;font-size:10px;">⚠ سعر البيع أقل من التكلفة!</span>`
      : '';

    const sales = (_salesByProduct[p.id] || []).slice().reverse();
    const salesHTML = sales.length > 0 ? `
      <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px;">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;font-weight:600;">عمليات البيع:</div>
        <div style="display:flex;flex-direction:column;gap:3px;max-height:100px;overflow-y:auto;">
          ${sales.slice(0, 8).map(m => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;background:rgba(224,82,82,0.07);border-radius:4px;padding:2px 6px;">
              <span style="color:var(--text-muted);">${m.invoiceNumber || ''}</span>
              <span style="color:#e05252;font-family:var(--font-mono);font-weight:700;">−${m.qty}</span>
              <span style="color:var(--text-muted);">${Utils.formatDate(m.createdAt)}</span>
            </div>`).join('')}
          ${sales.length > 8 ? `<div style="font-size:9px;color:var(--text-muted);text-align:center;">+ ${sales.length - 8} عملية أخرى</div>` : ''}
        </div>
      </div>` : '';
    const barcode = normalizeBarcode(p.barcode || '');
    const barcodeMarkup = buildBarcodeMarkup({ ...p, barcode });

    return `
      <div class="card">
        <div class="card-row">
          <div style="flex:1;min-width:0;">
            <div class="card-title">${escapeHtml(p.name)}</div>
            <div class="card-sub" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
              <span class="text-accent font-mono">${Utils.currency(p.price)}</span>
              ${p.cost > 0 ? `<span style="color:var(--text-muted);font-size:11px;">تكلفة: ${Utils.currency(p.cost)}</span>` : ''}
              ${p.category ? `<span>· ${escapeHtml(p.category)}</span>` : ''}
              ${barcode ? `<span>· #${escapeHtml(barcode)}</span>` : ''}
            </div>
            <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">${stockBadge} ${priceBadge}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
              <span style="font-size:11px;color:var(--text-muted);">السعر:</span>
              <button class="qty-btn" data-price-down="${p.id}" title="تخفيض السعر" style="width:26px;height:26px;font-size:15px;border-radius:6px;">−</button>
              <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--accent);min-width:70px;text-align:center;" id="price-display-${p.id}">${Utils.currency(p.price)}</span>
              <button class="qty-btn" data-price-up="${p.id}" title="رفع السعر" style="width:26px;height:26px;font-size:15px;border-radius:6px;">+</button>
            </div>
            ${barcodeMarkup}
            ${salesHTML}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            <button class="btn btn-success" data-add-qty="${p.id}" title="إضافة كمية" style="width:36px;height:36px;padding:0;font-size:20px;border-radius:50%;line-height:1;">+</button>
            <div class="card-actions">
              <button class="btn btn-secondary btn-icon" data-print-barcode="${p.id}" title="طباعة باركود">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 7v10M7 7v10m3-10v10m4-10v10m3-10v10M4 10h16M4 14h16"/></svg>
              </button>
              <button class="btn btn-secondary btn-icon" data-edit="${p.id}" title="تعديل">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="btn btn-danger btn-icon" data-delete="${p.id}" title="حذف">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  async function quickPriceChange(id, delta) {
    const product = allProducts.find(p => p.id === id);
    if (!product) return;
    const newPrice = Math.max(0, parseFloat((product.price + delta).toFixed(2)));
    product.price = newPrice;
    const display = document.getElementById(`price-display-${id}`);
    if (display) display.textContent = Utils.currency(newPrice);
    debouncedSavePrice(id, newPrice);
  }

  const _priceSaveTimers = {};
  function debouncedSavePrice(id, newPrice) {
    clearTimeout(_priceSaveTimers[id]);
    _priceSaveTimers[id] = setTimeout(async () => {
      try {
        const product = await DB.get('products', id);
        if (!product) return;
        await DB.put('products', { ...product, price: newPrice });
        Toast.success(`تم تحديث السعر: ${Utils.currency(newPrice)} ✓`);
        const idx = allProducts.findIndex(p => p.id === id);
        if (idx !== -1) allProducts[idx].price = newPrice;
        render();
      } catch(err) {
        Toast.error('فشل في حفظ السعر');
      }
    }, 800);
  }

  function openAdd() {
    editingId = null;
    if (modalTitleEl()) modalTitleEl().textContent = 'إضافة منتج';
    if (formEl()) formEl().reset();
    document.getElementById('p-minstock').value = 5;
    openModal();
  }

  async function openEdit(id) {
    editingId = id;
    const product = await DB.get('products', id);
    if (!product) return;
    if (modalTitleEl()) modalTitleEl().textContent = 'تعديل المنتج';
    const f = formEl();
    if (!f) return;
    f.querySelector('#p-name').value     = product.name     || '';
    f.querySelector('#p-barcode').value  = product.barcode  || '';
    f.querySelector('#p-price').value    = product.price    || '';
    f.querySelector('#p-cost').value     = product.cost     || '';
    f.querySelector('#p-quantity').value = product.quantity || '';
    f.querySelector('#p-minstock').value = product.minStock !== undefined ? product.minStock : 5;
    f.querySelector('#p-category').value = product.category || '';
    openModal();
  }

  async function openAddQty(id) {
    const product = await DB.get('products', id);
    if (!product) return;
    const qtyStr = window.prompt(`إضافة كمية لـ: ${product.name}\nالكمية الحالية: ${product.quantity}\nأدخل الكمية المضافة:`);
    const qty = parseInt(qtyStr);
    if (!qty || qty <= 0) return;
    const balBefore = product.quantity;
    const newQty = balBefore + qty;
    await DB.put('products', { ...product, quantity: newQty });
    await DB.addStockMovement({
      productId: product.id, productName: product.name,
      type: 'in', qty, reason: 'إضافة يدوية',
      invoiceId: null, invoiceNumber: null,
      balanceBefore: balBefore, balanceAfter: newQty,
    });
    Toast.success(`تم إضافة ${qty} وحدة ✓`);
    await load();
  }

  function openModal()  { const m = modalEl(); if (m) m.classList.add('open'); }
  function closeModal() { const m = modalEl(); if (m) m.classList.remove('open'); editingId = null; }

  async function saveProduct(e) {
    e.preventDefault();
    const f = formEl();
    if (!f) return;
    const nameVal  = f.querySelector('#p-name').value.trim();
    const priceVal = parseFloat(f.querySelector('#p-price').value) || 0;
    if (!nameVal)    { Toast.error('اسم المنتج مطلوب'); return; }
    if (priceVal < 0){ Toast.error('السعر لا يمكن أن يكون سالباً'); return; }

    const data = {
      name:     nameVal,
      barcode:  normalizeBarcode(f.querySelector('#p-barcode').value.trim() || ''),
      price:    priceVal,
      cost:     parseFloat(f.querySelector('#p-cost').value)    || 0,
      quantity: parseInt(f.querySelector('#p-quantity').value)  || 0,
      minStock: parseInt(f.querySelector('#p-minstock').value)  || 5,
      category: f.querySelector('#p-category').value.trim() || null,
    };

    if (data.barcode && typeof BarcodeUtils !== 'undefined' && !BarcodeUtils.isValid(data.barcode)) {
      Toast.error('الباركود يحتوي على رموز غير مدعومة');
      return;
    }

    if (!data.barcode) {
      data.barcode = generateUniqueBarcode(editingId);
    }

    const duplicate = allProducts.find((p) => p.id !== editingId && normalizeBarcode(p.barcode) === data.barcode);
    if (duplicate) {
      Toast.error(`الباركود مستخدم بالفعل للمنتج: ${duplicate.name}`);
      return;
    }

    const saveBtn = f.querySelector('[type=submit]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'جاري الحفظ...'; }

    try {
      if (!DB.isOnline()) {
        const old = editingId ? await DB.get('products', editingId) : null;
        DB.enqueueProductUpsert(data, editingId ? old : null);
        const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
        Toast.success(localOnly
          ? (editingId ? 'تم حفظ تعديل المنتج على هذا الجهاز ✓' : 'تم حفظ المنتج على هذا الجهاز ✓')
          : (editingId ? 'تم حفظ تعديل المنتج محليًا وسيتم رفعه عند عودة الإنترنت ✓' : 'تم حفظ المنتج محليًا وسيتم رفعه عند عودة الإنترنت ✓'));
        closeModal();
        await load();
        return;
      }

      if (editingId) {
        const old = await DB.get('products', editingId);
        await DB.put('products', { ...data, id: editingId });
        let stockWarning = '';
        if (old && old.quantity !== data.quantity) {
          const diff = data.quantity - old.quantity;
          try {
            await DB.addStockMovement({
              productId: editingId, productName: data.name,
              type: diff > 0 ? 'in' : 'out', qty: Math.abs(diff),
              reason: 'تعديل يدوي', invoiceId: null, invoiceNumber: null,
              balanceBefore: old.quantity, balanceAfter: data.quantity,
            });
          } catch (movementErr) {
            console.warn('تعذر تسجيل حركة مخزون المنتج بعد التعديل:', movementErr);
            stockWarning = ' مع تعذر تسجيل حركة المخزون';
          }
        }
        Toast.success(`تم تحديث المنتج ✓${stockWarning}`);
      } else {
        const newId = await DB.add('products', data);
        let stockWarning = '';
        if (data.quantity > 0) {
          try {
            await DB.addStockMovement({
              productId: newId, productName: data.name,
              type: 'in', qty: data.quantity, reason: 'رصيد أولي',
              invoiceId: null, invoiceNumber: null,
              balanceBefore: 0, balanceAfter: data.quantity,
            });
          } catch (movementErr) {
            console.warn('تعذر تسجيل الرصيد الأولي للمنتج:', movementErr);
            stockWarning = ' مع تعذر تسجيل حركة المخزون';
          }
        }
        Toast.success(`تم إضافة المنتج ✓${stockWarning}`);
      }
      closeModal();
      await load();
    } catch (err) {
      if (typeof DB !== 'undefined' && DB.isOfflineError?.(err)) {
        try {
          const old = editingId ? await DB.get('products', editingId) : null;
          DB.enqueueProductUpsert(data, editingId ? old : null);
          const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
          Toast.success(localOnly
            ? (editingId ? 'تعذر الرفع المباشر، فتم حفظ تعديل المنتج على هذا الجهاز ✓' : 'تعذر الرفع المباشر، فتم حفظ المنتج على هذا الجهاز ✓')
            : (editingId ? 'تعذر الاتصال، فتم حفظ تعديل المنتج محليًا وسيتم رفعه لاحقًا ✓' : 'تعذر الاتصال، فتم حفظ المنتج محليًا وسيتم رفعه لاحقًا ✓'));
          closeModal();
          await load();
          return;
        } catch (fallbackErr) {
          console.error('saveProduct fallback failed:', fallbackErr);
        }
      }
      Toast.error('فشل في حفظ المنتج: ' + (err.message || err));
      console.error(err);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'حفظ المنتج'; }
    }
  }

  async function deleteProduct(id) {
    try {
      const product = allProducts.find(p => p.id === id);
      if (!product) return;

      let movements = [];
      try {
        if (DB.hasRemoteConfig() && DB.isOnline()) {
          movements = await DB.req('GET', 'stock_movements', null,
            `?product_id=eq.${id}&invoice_id=not.is.null&limit=1`);
        }
      } catch (movementErr) {
        if (!DB.isOfflineError?.(movementErr)) throw movementErr;
      }
      if (movements.length > 0) {
        if (!Utils.confirm(
          `⚠ المنتج "${product.name}" مرتبط بفواتير سابقة.\n` +
          `حذفه سيبقي الفواتير القديمة بدون بيانات كاملة.\n\n` +
          `هل تريد المتابعة رغم ذلك؟`
        )) return;
      } else {
        if (!Utils.confirm(`هل تريد حذف "${product.name}" نهائياً؟`)) return;
      }

      if (DB.isOnline()) {
        try {
          // توافق مع قواعد قديمة قد تمنع حذف المنتج لو ما زالت حركات المخزون تشير إليه مباشرة.
          await DB.req('PATCH', 'stock_movements', {
            product_id: null,
          product_name: product.name,
          }, `?product_id=eq.${id}`);
        } catch (_) {}
      }

      if (!DB.hasRemoteConfig() || !DB.isOnline()) {
        DB.enqueueProductDelete(product);
        Toast.success(DB.hasRemoteConfig()
          ? 'تم حذف المنتج محليًا وسيتم مزامنته عند عودة الاتصال ✓'
          : 'تم حذف المنتج على هذا الجهاز ✓');
        await load();
        return;
      }

      await DB.remove('products', id);
      Toast.success('تم حذف المنتج');
      await load();
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('foreign key') || msg.includes('constraint')) {
        Toast.error('تعذر حذف المنتج لأنه ما زال مرتبطًا بسجلات قديمة في قاعدة البيانات');
      } else {
        Toast.error('فشل في حذف المنتج: ' + (msg || 'خطأ غير معروف'));
      }
      console.error(err);
    }
  }

  function init() {
    document.getElementById('add-product-btn')?.addEventListener('click', openAdd);
    document.getElementById('batch-barcodes-btn')?.addEventListener('click', openBatchBarcodesModal);
    document.getElementById('product-modal-close')?.addEventListener('click', closeModal);
    document.getElementById('product-modal')?.addEventListener('click', (e) => { if (e.target.id === 'product-modal') closeModal(); });
    document.getElementById('product-form')?.addEventListener('submit', saveProduct);
    document.getElementById('p-barcode')?.addEventListener('blur', (e) => {
      e.target.value = normalizeBarcode(e.target.value);
    });
    document.getElementById('barcode-modal-close')?.addEventListener('click', closeBarcodeModal);
    document.getElementById('barcode-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'barcode-modal') closeBarcodeModal();
    });
    document.getElementById('barcode-print-btn')?.addEventListener('click', printBarcodeFromModal);
    document.getElementById('batch-barcodes-close')?.addEventListener('click', closeBatchBarcodesModal);
    document.getElementById('batch-barcodes-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'batch-barcodes-modal') closeBatchBarcodesModal();
    });
    document.getElementById('batch-barcodes-search')?.addEventListener('input', Utils.debounce((e) => {
      batchBarcodeQuery = e.target.value || '';
      renderBatchBarcodeList();
    }, 120));
    document.getElementById('batch-barcodes-select-all')?.addEventListener('click', selectAllBatchBarcodes);
    document.getElementById('batch-barcodes-clear-all')?.addEventListener('click', clearBatchBarcodesSelection);
    document.getElementById('batch-barcodes-print-btn')?.addEventListener('click', printBatchBarcodes);
    document.getElementById('products-search')?.addEventListener('input', Utils.debounce((e) => { searchQuery = e.target.value; render(); }, 200));
    document.getElementById('stock-log-btn')?.addEventListener('click', () => Router.navigate('stock-log'));
  }

  return { load, init, getAll: () => allProducts, printBarcode };
})();

// escapeHtml defined globally in app.js
