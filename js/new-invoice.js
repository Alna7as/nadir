/**
 * new-invoice.js — إنشاء وتعديل الفاتورة
 */

const NewInvoiceModule = (() => {
  // ─── cartItems الآن مرتبط بـ CartStore (سلة دائمة لكل عميل) ───
  // لا نحتفظ بـ cartItems كـ local state — نقرأها دائماً من CartStore
  let selectedShop = null;
  let selectedRepId = null;
  let editingInvoice = null;
  let paymentMethod = 'full';
  let customAmount = 0;
  let _savingPromise = null;
  let _editCartBackup = null;

  // getter مريح يجلب السلة الحالية من CartStore
  const cartItems = {
    get length() { return CartStore.getItems().length; },
    [Symbol.iterator]() { return CartStore.getItems()[Symbol.iterator](); },
    find(fn) { return CartStore.getItems().find(fn); },
    filter(fn) { return CartStore.getItems().filter(fn); },
    map(fn) { return CartStore.getItems().map(fn); },
    some(fn) { return CartStore.getItems().some(fn); },
    reduce(fn, init) { return CartStore.getItems().reduce(fn, init); },
    forEach(fn) { CartStore.getItems().forEach(fn); },
    push(item) { CartStore.addItem(item); },
    slice(s, e) { return CartStore.getItems().slice(s, e); },
    get 0() { return CartStore.getItems()[0]; },
  };

  const cartListEl = () => document.getElementById('cart-items-list');
  const totalsEl = () => document.getElementById('invoice-totals');
  const shopSelectEl = () => document.getElementById('invoice-shop-select');
  const discountEl = () => document.getElementById('invoice-discount');
  const noteEl = () => document.getElementById('invoice-note');
  const productModalEl = () => document.getElementById('product-picker-modal');
  const barcodeInputEl = () => document.getElementById('invoice-barcode-input');
  const repSelectEl = () => document.getElementById('invoice-rep-select');

  function normalizeItems(items) {
    if (Array.isArray(items)) return items;
    if (!items) return [];

    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    return [];
  }

  function cleanCart() {
    return CartStore.getItems().map(({ productId, name, price, qty, costAtTime }) => ({
      productId,
      name,
      price,
      qty,
      costAtTime: costAtTime || 0,
    }));
  }

  function getAvailableReps() {
    return NadirUsers.getAll().filter((user) => user.role === 'cashier' && user.active !== false);
  }

  function getScopedRepId(preferredRepId = null) {
    if (preferredRepId) return String(preferredRepId);
    const current = OpsMeta.currentUser();
    if (current?.role === 'cashier') return String(current.id);
    if (selectedRepId) return String(selectedRepId);
    return '';
  }

  function getEditingOwnerId() {
    if (!editingInvoice) return '';
    return String(OpsMeta.getInvoiceOwner(editingInvoice.id)?.id || '');
  }

  function getEditingQtyForProduct(productId, ownerId = '') {
    if (!editingInvoice || !ownerId || String(ownerId) !== getEditingOwnerId()) return 0;
    const oldItems = normalizeItems(editingInvoice.items);
    const row = oldItems.find((item) => String(item.productId) === String(productId));
    return parseInt(row?.qty, 10) || 0;
  }

  function buildScopedProducts(products, preferredRepId = null) {
    const repId = getScopedRepId(preferredRepId);
    if (!repId) {
      return (products || []).map((product) => ({
        ...product,
        availableQty: Math.max(0, parseInt(product.quantity, 10) || 0),
        stockLabel: `${parseInt(product.quantity, 10) || 0} في المخزن`,
      }));
    }

    const repStockMap = {};
    OpsMeta.getRepStock(repId).forEach((row) => {
      repStockMap[String(row.productId)] = Math.max(0, parseInt(row.qty, 10) || 0);
    });

    return (products || [])
      .map((product) => {
        const reservedQty = repStockMap[String(product.id)] || 0;
        const availableQty = reservedQty + getEditingQtyForProduct(product.id, repId);
        return {
          ...product,
          availableQty,
          stockLabel: `${availableQty} مع المندوب`,
        };
      })
      .map((product) => ({
        ...product,
        _outOfStock: product.availableQty <= 0,
      }))
      .sort((a, b) => a._outOfStock - b._outOfStock);
  }

  async function getScopedProducts(preferredRepId = null) {
    return buildScopedProducts(await DB.getAll('products'), preferredRepId);
  }

  async function getScopedProductById(productId, preferredRepId = null) {
    const products = await getScopedProducts(preferredRepId);
    return products.find((product) => String(product.id) === String(productId)) || null;
  }

  function syncCartAvailability() {
    const sourceProducts = typeof ProductsModule !== 'undefined' && typeof ProductsModule.getAll === 'function'
      ? ProductsModule.getAll()
      : [];
    if (!sourceProducts.length) return;
    const scopedProducts = buildScopedProducts(sourceProducts);
    const scopedMap = {};
    scopedProducts.forEach((product) => {
      scopedMap[String(product.id)] = product.availableQty;
    });

    CartStore.getItems().forEach((item) => {
      const fallbackQty = getEditingQtyForProduct(item.productId, getScopedRepId());
      item.availableQty = Object.prototype.hasOwnProperty.call(scopedMap, String(item.productId))
        ? scopedMap[String(item.productId)]
        : (fallbackQty || item.availableQty || 0);
    });
  }

  function applyRepStockForInvoiceChange(oldOwnerId, newOwnerId, oldItems, newItems, note) {
    const actor = OpsMeta.currentUser()?.name || 'مستخدم';
    const normalizedOld = normalizeItems(oldItems);
    const normalizedNew = normalizeItems(newItems);

    if (oldOwnerId) {
      OpsMeta.applyRepStockDelta(oldOwnerId, normalizedOld.map((item) => ({
        productId: item.productId,
        qtyDelta: parseInt(item.qty, 10) || 0,
      })), { actor, type: 'sale_revert', note });
    }

    if (newOwnerId) {
      OpsMeta.applyRepStockDelta(newOwnerId, normalizedNew.map((item) => ({
        productId: item.productId,
        qtyDelta: -(parseInt(item.qty, 10) || 0),
      })), { actor, type: 'sale', note });
    }
  }

  function ensureRepSelect() {
    if (repSelectEl()) return repSelectEl();
    const shopCard = shopSelectEl()?.closest('.card');
    if (!shopCard || !shopCard.parentElement) return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'card';
    wrapper.style.marginBottom = '12px';
    wrapper.innerHTML = `
      <div class="section-title">المندوب المسؤول (اختياري للمدير)</div>
      <select class="form-control" id="invoice-rep-select">
        <option value="">— بدون مندوب / المدير نفسه —</option>
      </select>
    `;
    shopCard.insertAdjacentElement('afterend', wrapper);
    return repSelectEl();
  }

  function currentOwner() {
    const selected = selectedRepId ? NadirUsers.getById(selectedRepId) : null;
    const existing = editingInvoice ? OpsMeta.getInvoiceOwner(editingInvoice.id) : null;
    return selected || existing || OpsMeta.currentUser();
  }

  function getAmountPaid(total) {
    if (paymentMethod === 'full') return total;
    if (paymentMethod === 'none') return 0;
    if (paymentMethod === 'custom') {
      return Math.min(Math.max(0, customAmount), total);
    }
    return total;
  }

  function clearEditCartBackup() {
    _editCartBackup = null;
  }

  function preserveCartBeforeEdit(shopId) {
    const currentClient = CartStore.getClient();
    const targetClient = shopId ? String(shopId) : 'guest';
    _editCartBackup = {
      currentClient,
      currentItems: CartStore.getItemsFor(currentClient === 'guest' ? null : currentClient),
      selectedShopId: shopSelectEl()?.value || '',
      targetClient,
      targetItems: CartStore.getItemsFor(targetClient === 'guest' ? null : targetClient),
    };
  }

  function restoreCartAfterEditCancel() {
    if (!_editCartBackup) return;
    CartStore.replaceItemsFor(_editCartBackup.targetClient === 'guest' ? null : _editCartBackup.targetClient, _editCartBackup.targetItems || []);
    CartStore.replaceItemsFor(_editCartBackup.currentClient === 'guest' ? null : _editCartBackup.currentClient, _editCartBackup.currentItems || []);
    CartStore.setClient(_editCartBackup.currentClient === 'guest' ? null : _editCartBackup.currentClient);
    if (shopSelectEl()) shopSelectEl().value = _editCartBackup.selectedShopId || '';
    selectedShop = _editCartBackup.selectedShopId ? { id: _editCartBackup.selectedShopId } : null;
    clearEditCartBackup();
  }

  async function buildInvoiceDebtSnapshot(shopId, invoiceRemaining = 0, options = {}) {
    if (!shopId) return { oldDebt: 0, newDebt: 0, totalDue: 0 };

    const oldDebt = parseFloat(DebtStore.get(shopId)) || 0;
    let newDebt = 0;

    try {
      const shop = await DB.get('shops', shopId);
      newDebt = parseFloat(shop?.balance) || 0;
    } catch (_) {}

    if (options.mode === 'before-save-create') {
      newDebt += invoiceRemaining;
    } else if (options.mode === 'before-save-edit') {
      const previousRemaining = parseFloat(options.previousRemaining) || 0;
      if (options.sameShop) {
        newDebt = Math.max(0, newDebt - previousRemaining + invoiceRemaining);
      } else {
        newDebt += invoiceRemaining;
      }
    }

    newDebt = parseFloat(newDebt.toFixed(2));
    return {
      oldDebt: parseFloat(oldDebt.toFixed(2)),
      newDebt,
      totalDue: parseFloat((oldDebt + newDebt).toFixed(2)),
    };
  }

  async function getInvoicePaidAmount(invoiceId, fallback = 0) {
    if (!invoiceId) return parseFloat(fallback) || 0;
    try {
      const payments = await DB.getInvoicePayments(invoiceId);
      return payments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    } catch (_) {
      return parseFloat(fallback) || 0;
    }
  }

  async function load() {
    if (typeof OpsMeta !== 'undefined' && typeof OpsMeta.syncFromRemote === 'function') {
      await OpsMeta.syncFromRemote(true).catch(() => {});
    }
    await populateShopSelect();
    populateRepSelect();

    // نزامن العميل الحالي مع CartStore عند تحميل الصفحة
    const sel = shopSelectEl();
    const currentShopId = sel ? sel.value : null;
    CartStore.setClient(currentShopId || null);

    populateRepSelect();
    syncCartAvailability();
    renderCart();

    const banner = document.getElementById('edit-invoice-banner');
    if (banner) banner.style.display = editingInvoice ? 'flex' : 'none';

    if (editingInvoice) {
      const el = document.getElementById('edit-invoice-number');
      if (el) el.textContent = editingInvoice.number;
    }

    const saveBtn = document.getElementById('save-invoice-btn');
    if (saveBtn) saveBtn.textContent = editingInvoice ? 'حفظ التعديلات' : 'حفظ الفاتورة';

    if (barcodeInputEl()) barcodeInputEl().value = '';
    _renderCartBadges();
  }

  async function loadForEdit(invoiceId) {
    const inv = await DB.get('invoices', invoiceId);
    if (!inv) {
      Toast.error('تعذر تحميل الفاتورة');
      return;
    }

    if (inv.isReturn) {
      Toast.error('لا يمكن تعديل فاتورة مرتجع');
      return;
    }

    if (inv.status === 'void') {
      Toast.error('لا يمكن تعديل فاتورة ملغاة');
      return;
    }

    const items = normalizeItems(inv.items);

    const freshProducts = await DB.getAll('products');
    const prodMap = {};
    freshProducts.forEach((p) => {
      prodMap[p.id] = p;
    });

    editingInvoice = inv;
    preserveCartBeforeEdit(inv.shopId || null);
    // نحدد العميل في CartStore أولاً
    CartStore.setClient(inv.shopId || null);
    // نمسح السلة الحالية لهذا العميل ونملأها من الفاتورة
    CartStore.clear();
    items.forEach(item => {
      const mapped = {
        productId:    item.productId,
        name:         item.name,
        price:        item.price,
        qty:          item.qty,
        availableQty: (prodMap[item.productId]?.quantity || 0) + item.qty,
        originalPrice: item.price,
        costAtTime:   item.costAtTime !== undefined
                        ? item.costAtTime
                        : (prodMap[item.productId]?.cost || 0),
      };
      // addItem يبدأ من qty=1، فنصحّح الكمية بعدها
      CartStore.addItem({ ...mapped, qty: 1 });
      if (mapped.qty !== 1) CartStore.updateQty(mapped.productId, mapped.qty);
    });

    Router.navigate('new-invoice');
    await populateShopSelect();
    populateRepSelect(OpsMeta.getInvoiceOwner(inv.id)?.id || null);

    if (inv.shopId) {
      const sel = shopSelectEl();
      if (sel) sel.value = inv.shopId;
    }

    if (discountEl()) discountEl().value = inv.discount || '';
    if (noteEl()) noteEl().value = inv.note || '';

    renderCart();

    const banner = document.getElementById('edit-invoice-banner');
    if (banner) banner.style.display = 'flex';

    const bannerNum = document.getElementById('edit-invoice-number');
    if (bannerNum) bannerNum.textContent = inv.number;

    const saveBtn = document.getElementById('save-invoice-btn');
    if (saveBtn) saveBtn.textContent = 'حفظ التعديلات';

    Toast.info(`جاري تعديل الفاتورة ${inv.number}`);
  }

  async function populateShopSelect() {
    const sel = shopSelectEl();
    if (!sel) return;

    const shops = await DB.getAll('shops');
    sel.innerHTML =
      `<option value="">— زبون عادي (بدون حساب) —</option>` +
      shops.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

    if (selectedShop) sel.value = selectedShop.id;
  }

  function populateRepSelect(preferredRepId = null) {
    const select = ensureRepSelect();
    if (!select) return;

    const reps = getAvailableReps();
    const existingOwner = editingInvoice ? OpsMeta.getInvoiceOwner(editingInvoice.id) : null;
    const current = OpsMeta.currentUser();
    const defaultRepId = preferredRepId ||
      selectedRepId ||
      existingOwner?.id ||
      (current?.role === 'cashier' ? current.id : '') ||
      (reps.length === 1 ? reps[0].id : '');

    select.innerHTML =
      `<option value="">— بدون مندوب / المدير نفسه —</option>` +
      reps.map((rep) => `<option value="${rep.id}">${escapeHtml(rep.name)}</option>`).join('');
    if (select.options[0]) select.options[0].textContent = '— بدون مندوب / المدير نفسه —';

    select.value = defaultRepId || '';
    selectedRepId = select.value || null;
    if (select.closest('.card')) {
      select.closest('.card').style.display = OpsMeta.isAdmin() ? '' : 'none';
    }
    select.style.display = OpsMeta.isAdmin() ? '' : 'none';
    syncCartAvailability();
  }

  function setShop(shopId) {
    selectedShop = { id: shopId };
    // نحدّث العميل الحالي في CartStore عشان السلة تتغير
    CartStore.setClient(shopId || null);
  }

  async function openProductPicker() {
    const modal = productModalEl();
    if (!modal) return;

    const products = await getScopedProducts();
    const grid = modal.querySelector('#product-picker-grid');
    const search = modal.querySelector('#product-picker-search');

    if (search) search.value = '';
    renderProductGrid(grid, products, '');

    if (search) {
      search.oninput = Utils.debounce(() => {
        renderProductGrid(grid, products, search.value.toLowerCase());
      }, 150);
    }

    modal.classList.add('open');
  }

  function renderProductGrid(grid, products, query) {
    if (!grid) return;

    const filtered = query
      ? products.filter(
          (p) => p.name.toLowerCase().includes(query) || (p.barcode || '').includes(query)
        )
      : products;

    if (filtered.length === 0) {
      grid.innerHTML =
        `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">لا توجد منتجات.</div>`;
      return;
    }

    grid.innerHTML = filtered.map((p) => `
      <div class="product-select-card ${isInCart(p.id) ? 'selected' : ''} ${p._outOfStock ? 'out-of-stock-card' : ''}"
           data-product-id="${p.id}"
           data-product-name="${escapeHtml(p.name)}"
           data-product-price="${p.price}"
           data-product-qty="${p.availableQty ?? p.quantity}"
           data-product-cost="${p.cost || 0}"
           data-out-of-stock="${p._outOfStock ? '1' : '0'}"
           style="${p._outOfStock ? 'opacity:0.7;' : ''}">
        <div class="p-name">${escapeHtml(p.name)}</div>
        <div class="p-price">${Utils.currency(p.price)}</div>
        <div class="p-stock" style="${p._outOfStock ? 'color:#e05252;font-weight:700;' : ''}">${p._outOfStock ? '⚠️ نفذ من المخزون' : escapeHtml(p.stockLabel || (p.quantity + ' في المخزن'))}</div>
        ${isInCart(p.id) ? '<div style="color:var(--success);font-size:11px;margin-top:4px;">✓ في السلة</div>' : ''}
        ${p._outOfStock ? ('<button class="btn btn-sm" data-add-qty-product="' + p.id + '" data-add-qty-name="' + escapeHtml(p.name) + '" style="margin-top:6px;width:100%;font-size:11px;background:rgba(34,197,94,0.15);border:1px solid var(--accent);color:var(--accent);border-radius:6px;padding:4px 0;">+ إضافة كمية للمخزن</button>') : ''}
      </div>
    `).join('');

    // زرار إضافة كمية للمنتجات الناقصة
    grid.querySelectorAll('[data-add-qty-product]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = parseInt(btn.dataset.addQtyProduct, 10);
        const productName = btn.dataset.addQtyName;
        const qty = parseInt(window.prompt(`إضافة كمية للمخزن — ${productName}\nأدخل الكمية المراد إضافتها:`, ''), 10);
        if (!qty || qty <= 0) return;
        DB.update('products', productId, { quantity: qty })
          .then(async () => {
            Toast.success(`تمت إضافة ${qty} للمخزون — ${productName}`);
            // تسجيل حركة مخزون
            const fresh = await DB.get('products', productId).catch(() => null);
            const balBefore = (fresh?.quantity || 0) - qty;
            DB.insert('stock_movements', {
              product_id: productId,
              product_name: productName,
              type: 'in',
              qty,
              reason: 'إضافة من صفحة الفاتورة',
              balance_before: Math.max(0, balBefore),
              balance_after: fresh?.quantity || qty,
            }).catch(() => {});
            // تحديث الـ products list
            const updatedProds = await DB.getAll('products').catch(() => products);
            const scopedUpdated = buildScopedProducts(updatedProds);
            renderProductGrid(grid, scopedUpdated, query);
          })
          .catch(() => Toast.error('فشل تحديث المخزون'));
      });
    });

    grid.querySelectorAll('.product-select-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-add-qty-product]')) return;
        if (card.dataset.outOfStock === '1') {
          Toast.error(`${card.dataset.productName} — نفذ من المخزون، أضف كمية أولاً`);
          return;
        }
        addToCart(
          parseInt(card.dataset.productId, 10),
          card.dataset.productName,
          parseFloat(card.dataset.productPrice),
          parseInt(card.dataset.productQty, 10),
          parseFloat(card.dataset.productCost || 0)
        );
        renderProductGrid(grid, products, query);
      });
    });
  }

  function closeProductPicker() {
    const modal = productModalEl();
    if (modal) modal.classList.remove('open');
  }

  async function findProductByBarcode(rawBarcode) {
    const barcode = typeof BarcodeUtils !== 'undefined'
      ? BarcodeUtils.normalize(rawBarcode)
      : String(rawBarcode || '').trim().toUpperCase();
    if (!barcode) return null;

    const products = await getScopedProducts();
    return products.find((p) => {
      const candidate = typeof BarcodeUtils !== 'undefined'
        ? BarcodeUtils.normalize(p.barcode || '')
        : String(p.barcode || '').trim().toUpperCase();
      return candidate === barcode;
    }) || null;
  }

  async function addByBarcode() {
    const input = barcodeInputEl();
    const rawValue = input?.value || '';
    const normalized = typeof BarcodeUtils !== 'undefined'
      ? BarcodeUtils.normalize(rawValue)
      : String(rawValue).trim().toUpperCase();

    if (!normalized) {
      Toast.error('ادخل أو اسكان باركود المنتج');
      return;
    }

    try {
      const product = await findProductByBarcode(normalized);
      if (!product) {
        Toast.error(`الباركود غير مسجل: ${normalized}`);
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }

      addToCart(
        parseInt(product.id, 10),
        product.name,
        parseFloat(product.price) || 0,
        parseInt(product.quantity, 10) || 0,
        parseFloat(product.cost || 0)
      );

      if (input) {
        input.value = '';
        input.focus();
      }
    } catch (err) {
      console.error(err);
      Toast.error('فشل في قراءة الباركود');
    }
  }

  function isInCart(productId) {
    return CartStore.getItems().some((i) => i.productId === productId);
  }

  function addToCart(productId, name, price, availableQty, costAtTime = 0) {
    const existing = CartStore.getItems().find((i) => i.productId === productId);

    if (existing) {
      if (existing.qty >= availableQty) {
        Toast.error(`لا يوجد مخزون كافٍ — المتاح: ${availableQty}`);
        return;
      }
      CartStore.updateQty(productId, existing.qty + 1);
      Toast.info(`${name} × ${existing.qty + 1}`);
    } else {
      if (availableQty <= 0) {
        Toast.error(`${name} — نفذ من المخزون`);
        return;
      }
      CartStore.addItem({
        productId,
        name,
        price,
        qty: 1,
        availableQty,
        originalPrice: price,
        costAtTime,
      });
      Toast.success(`تمت الإضافة: ${name}`);
    }

    syncCartAvailability();
    renderCart();
  }

  function removeFromCart(productId) {
    CartStore.removeItem(productId);
    syncCartAvailability();
    renderCart();
  }

  function openQtyPicker(productId) {
    document.querySelectorAll('.qty-popup').forEach((el) => el.remove());

    const item = cartItems.find((i) => i.productId === productId);
    if (!item) return;

    const maxQty = item.availableQty !== undefined ? item.availableQty : 10;
    const btn = document.querySelector(`[data-qty-pick="${productId}"]`);
    if (!btn) return;

    const popup = document.createElement('div');
    popup.className = 'qty-popup';
    popup.style.cssText = `
      position:absolute; z-index:9999;
      background:var(--bg-card); border:1px solid var(--border);
      border-radius:12px; padding:8px; box-shadow:0 8px 24px rgba(0,0,0,0.35);
      display:grid; grid-template-columns:repeat(5,1fr); gap:5px;
      min-width:160px;
    `;

    for (let n = 1; n <= Math.min(10, maxQty); n++) {
      const cell = document.createElement('button');
      cell.textContent = n;
      cell.style.cssText = `
        padding:7px 0; border:1px solid var(--border); border-radius:7px;
        background:${n === item.qty ? 'var(--accent)' : 'var(--bg-secondary)'};
        color:${n === item.qty ? '#0f1117' : 'var(--text-primary)'};
        font-family:var(--font-mono); font-size:13px; font-weight:700;
        cursor:pointer; transition:background .15s;
        ${n > (item.availableQty || 99) ? 'opacity:0.35;cursor:not-allowed;' : ''}
      `;

      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        if (n > (item.availableQty || 99)) {
          Toast.error(`الحد الأقصى المتاح: ${item.availableQty}`);
          return;
        }
        CartStore.updateQty(productId, n);
        popup.remove();
        renderCart();
      });

      popup.appendChild(cell);
    }

    const rect = btn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 4}px`;

    document.body.appendChild(popup);

    const popupWidth = popup.offsetWidth || 170;
    let rightVal = window.innerWidth - rect.right;
    if (rect.right - popupWidth < 8) {
      rightVal = window.innerWidth - rect.left - popupWidth;
    }
    popup.style.right = `${Math.max(8, rightVal)}px`;

    const close = (e) => {
      if (!popup.contains(e.target) && e.target !== btn) {
        popup.remove();
        document.removeEventListener('click', close);
      }
    };

    setTimeout(() => document.addEventListener('click', close), 0);
  }

  function updateItemPrice(productId, delta) {
    const item = CartStore.getItems().find((i) => i.productId === productId);
    if (!item) return;

    const newPrice = Math.max(0, parseFloat((item.price + delta).toFixed(2)));
    CartStore.updatePrice(productId, newPrice);

    const priceEl = document.getElementById(`cart-price-${productId}`);
    const totalEl = document.getElementById(`item-total-${productId}`);

    if (priceEl) priceEl.textContent = Utils.currency(newPrice);
    if (totalEl) totalEl.textContent = Utils.currency(newPrice * item.qty);

    updateTotals();
  }

  function renderCart() {
    const container = cartListEl();
    if (!container) return;
    syncCartAvailability();

    const items = CartStore.getItems();

    if (items.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:32px 16px;color:var(--text-muted);font-size:13px;">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:36px;height:36px;margin:0 auto 12px;display:block;opacity:0.4;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
          </svg>
          اضغط "إضافة منتج" لبدء الفاتورة
        </div>`;
      updateTotals();
      return;
    }

    container.innerHTML = items.map((item) => `
      <div class="invoice-item-row" style="display:flex;align-items:center;gap:6px;padding:8px 0;border-bottom:1px solid var(--border);">
        <button class="btn btn-danger btn-icon" style="width:26px;height:26px;padding:0;flex-shrink:0;" data-remove="${item.productId}">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <path d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>

       <div style="flex:1;min-width:0;font-size:13px;font-weight:600;white-space:normal;overflow-wrap:break-word;word-break:break-word;line-height:1.4;">
  ${escapeHtml(item.name)}
</div>

        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
          <button class="qty-btn" data-price-minus="${item.productId}" style="width:20px;height:20px;font-size:12px;border-radius:4px;padding:0;">−</button>
          <span id="cart-price-${item.productId}" style="font-family:var(--font-mono);font-size:11px;color:var(--accent);min-width:58px;text-align:center;">${Utils.currency(item.price)}</span>
          <button class="qty-btn" data-price-plus="${item.productId}" style="width:20px;height:20px;font-size:12px;border-radius:4px;padding:0;">+</button>

          <span style="font-size:11px;color:var(--text-muted);margin:0 2px;">×</span>

          <button class="qty-btn" data-qty-pick="${item.productId}"
            style="min-width:32px;height:26px;font-size:13px;font-weight:700;border-radius:6px;padding:0 6px;background:var(--bg-secondary);border:1px solid var(--border);">
            ${item.qty}
          </button>
        </div>

        <div id="item-total-${item.productId}" style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--accent);min-width:64px;text-align:left;flex-shrink:0;">
          ${Utils.currency(item.price * item.qty)}
        </div>
      </div>
      ${item.originalPrice !== undefined && item.price !== item.originalPrice
        ? `<div style="font-size:10px;color:var(--text-muted);padding:0 0 4px 32px;text-decoration:line-through;">${Utils.currency(item.originalPrice)}</div>`
        : ''}
    `).join('');

    container.querySelectorAll('[data-qty-pick]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openQtyPicker(parseInt(btn.dataset.qtyPick, 10));
      })
    );

    container.querySelectorAll('[data-remove]').forEach((btn) =>
      btn.addEventListener('click', () => removeFromCart(parseInt(btn.dataset.remove, 10)))
    );

    container.querySelectorAll('[data-price-minus]').forEach((btn) =>
      btn.addEventListener('click', () => updateItemPrice(parseInt(btn.dataset.priceMinus, 10), -1))
    );

    container.querySelectorAll('[data-price-plus]').forEach((btn) =>
      btn.addEventListener('click', () => updateItemPrice(parseInt(btn.dataset.pricePlus, 10), 1))
    );

    updateTotals();
    _renderCartBadges();
    if (typeof CartDrawer !== "undefined") CartDrawer.updateFab();
  }

  function getSubtotal() {
    return CartStore.getItems().reduce((s, i) => s + i.price * i.qty, 0);
  }

  function updateTotals() {
    const container = totalsEl();
    if (!container) return;

    const disc = Math.max(0, parseFloat(discountEl()?.value || 0) || 0);
    const subtotal = getSubtotal();
    const total = Math.max(0, subtotal - disc);
    const paid = getAmountPaid(total);
    const remaining = Math.max(0, total - paid);
    const canViewProfit = Session.getRole?.() === 'admin';
    const netProfit = parseFloat(
      (CartStore.getItems().reduce((sum, item) => sum + Utils.getItemProfit(item), 0) - disc).toFixed(2)
    );

    const currentPayMethod = container.getAttribute('data-pay-method');
    const currentProfitMode = container.getAttribute('data-can-view-profit');
    const hasLayout = !!container.querySelector('[data-totals-layout]');

    if (!hasLayout || currentPayMethod !== paymentMethod || currentProfitMode !== String(canViewProfit)) {
      container.setAttribute('data-pay-method', paymentMethod);
      container.setAttribute('data-can-view-profit', String(canViewProfit));
      container.innerHTML = `
        <div data-totals-layout="1">
          <div class="totals-row">
            <span>المجموع الجزئي</span>
            <span class="font-mono" id="totals-subtotal">${Utils.currency(subtotal)}</span>
          </div>
          <div id="totals-discount-row" style="${disc > 0 ? '' : 'display:none;'}">
            <div class="totals-row text-danger"><span>الخصم</span><span class="font-mono" id="totals-discount-val">− ${Utils.currency(disc)}</span></div>
          </div>
          <div class="totals-row grand"><span>الإجمالي</span><span id="totals-grand">${Utils.currency(total)}</span></div>
          ${canViewProfit ? `<div class="totals-row" style="color:var(--success);font-size:14px;"><span>صافي الربح</span><span id="totals-profit" class="font-mono">${Utils.currency(netProfit)}</span></div>` : ''}
          <div style="border-top:1px solid var(--border);margin:10px 0 8px;"></div>
          <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">💳 طريقة الدفع</div>
            <div style="display:flex;gap:6px;">
              <button onclick="NewInvoiceModule.setPayment('full')" class="btn btn-sm ${paymentMethod === 'full' ? 'btn-success' : 'btn-secondary'}" style="font-size:11px;flex:1;">كلي</button>
              <button onclick="NewInvoiceModule.setPayment('none')" class="btn btn-sm ${paymentMethod === 'none' ? 'btn-primary' : 'btn-secondary'}" style="font-size:11px;flex:1;">آجل</button>
              <button onclick="NewInvoiceModule.setPayment('custom')" class="btn btn-sm ${paymentMethod === 'custom' ? 'btn-primary' : 'btn-secondary'}" style="font-size:11px;flex:1;">جزئي</button>
            </div>
            ${paymentMethod === 'custom' ? `
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
              <label style="font-size:11px;color:var(--text-muted);white-space:nowrap;">المبلغ:</label>
              <input
                type="number"
                id="custom-payment-input"
                value="${customAmount || ''}"
                placeholder="0.00"
                min="0"
                max="${total}"
                step="0.01"
                style="flex:1;padding:6px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-family:var(--font-mono);font-size:12px;"
                oninput="NewInvoiceModule.setCustomAmount(parseFloat(this.value)||0)">
            </div>` : ''}
          </div>
          <div style="background:var(--bg-secondary);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:var(--text-muted);">المدفوع</span>
              <span id="totals-paid" style="color:#4ade80;font-family:var(--font-mono);font-weight:700;">${Utils.currency(paid)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:var(--text-muted);">المتبقي</span>
              <span id="totals-remaining" style="color:${remaining > 0 ? '#e05252' : '#4ade80'};font-family:var(--font-mono);font-weight:700;">${Utils.currency(remaining)}</span>
            </div>
          </div>
        </div>
      `;

      if (paymentMethod === 'custom') {
        setTimeout(() => document.getElementById('custom-payment-input')?.focus(), 50);
      }
    } else {
      const el = (id) => container.querySelector(`#${id}`);
      if (el('totals-subtotal')) el('totals-subtotal').textContent = Utils.currency(subtotal);
      if (el('totals-grand')) el('totals-grand').textContent = Utils.currency(total);
      if (canViewProfit && el('totals-profit')) el('totals-profit').textContent = Utils.currency(netProfit);
      if (el('totals-paid')) el('totals-paid').textContent = Utils.currency(paid);

      if (el('totals-remaining')) {
        el('totals-remaining').textContent = Utils.currency(remaining);
        el('totals-remaining').style.color = remaining > 0 ? '#e05252' : '#4ade80';
      }

      const discRow = el('totals-discount-row');
      const discVal = el('totals-discount-val');
      if (discRow) discRow.style.display = disc > 0 ? '' : 'none';
      if (discVal) discVal.textContent = `− ${Utils.currency(disc)}`;

      const inputEl = el('custom-payment-input');
      if (inputEl) inputEl.max = total;
    }
  }

  function setPayment(method) {
    paymentMethod = method;
    customAmount = 0;
    updateTotals();
  }

  function setCustomAmount(val) {
    const disc = Math.max(0, parseFloat(discountEl()?.value || 0) || 0);
    const total = Math.max(0, getSubtotal() - disc);
    customAmount = Math.min(Math.max(0, val), total);
    updateTotals();
  }

  function buildInitialPaymentPayload(invNumber, amountPaidRnd) {
    if (amountPaidRnd <= 0.009) {
      return {
        amountPaid: 0,
        paymentMethod: null,
        paymentNote: '',
      };
    }

    return {
      amountPaid: amountPaidRnd,
      paymentMethod: 'cash',
      paymentNote: `دفعة أولية - ${invNumber}`,
    };
  }

  async function saveInvoice() {
    if (CartStore.getItems().length === 0) {
      Toast.error('أضف منتجاً واحداً على الأقل');
      return;
    }

    if (_savingPromise) {
      Toast.info('جاري الحفظ، انتظر لحظة...');
      try {
        await _savingPromise;
      } catch (e) {}
      return;
    }

    const saveBtn = document.getElementById('save-invoice-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'جاري الحفظ...';
    }

    _savingPromise = _doSave().finally(() => {
      _savingPromise = null;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = editingInvoice ? 'حفظ التعديلات' : 'حفظ الفاتورة';
      }
    });

    await _savingPromise;
  }

  async function _doSave() {
    try {
      for (const item of CartStore.getItems()) {
        const fresh = await DB.get('products', item.productId);
        if (!fresh) {
          Toast.error(`المنتج "${item.name}" غير موجود`);
          return;
        }

        const scopedProduct = await getScopedProductById(item.productId);
        const availableQty = scopedProduct ? scopedProduct.availableQty : (parseInt(fresh.quantity, 10) || 0);

        if (!editingInvoice && availableQty < item.qty) {
          Toast.error(`"${item.name}" — المتاح: ${fresh.quantity} فقط`);
          renderCart();
          return;
        }

        if (editingInvoice) {
          const available = scopedProduct
            ? scopedProduct.availableQty
            : ((parseInt(fresh.quantity, 10) || 0) + getEditingQtyForProduct(item.productId, getScopedRepId()));

          if (item.qty > available) {
            Toast.error(`"${item.name}" — المتاح بعد العكس: ${available} فقط`);
            renderCart();
            return;
          }
        }
      }

      const shopEl = shopSelectEl();
      const shopId = shopEl ? parseInt(shopEl.value, 10) || null : null;
      let shopName = 'زبون عادي';

      if (shopId) {
        const s = await DB.get('shops', shopId);
        if (s) shopName = s.name;
      }

      const subtotal = getSubtotal();
      const disc = Math.max(0, parseFloat(discountEl()?.value || 0) || 0);
      const total = Math.max(0, subtotal - disc);
      const invoiceOwner = currentOwner();
      const oldOwnerId = getEditingOwnerId();
      const newOwnerId = invoiceOwner?.role === 'cashier' ? String(invoiceOwner.id) : '';
      const amountPaid = getAmountPaid(total);
      const items = cleanCart();
      const totalRounded = parseFloat(total.toFixed(2));
      const amountPaidRnd = parseFloat(amountPaid.toFixed(2));
      const noteVal = noteEl()?.value?.trim() || '';

      if (!editingInvoice && amountPaidRnd > totalRounded + 0.01) {
        Toast.error(`المبلغ المدفوع (${Utils.currency(amountPaidRnd)}) أكبر من الإجمالي (${Utils.currency(totalRounded)})`);
        return;
      }

      if (!DB.isOnline()) {
        if (editingInvoice) {
          const oldInv = editingInvoice;
          const paidBeforeEdit = parseFloat(oldInv.amountPaid) || 0;
          const previousRemaining = Math.max(0, (parseFloat(oldInv.total) || 0) - paidBeforeEdit);
          const nextRemaining = Math.max(0, totalRounded - paidBeforeEdit);
          const rpcPayload = {
            editId: String(oldInv.id),
            shopId: shopId ? String(shopId) : '',
            shopName,
            items,
            subtotal: parseFloat(subtotal.toFixed(2)),
            discount: parseFloat(disc.toFixed(2)),
            tax: 0,
            taxPct: 0,
            total: totalRounded,
            note: noteVal,
            stockReason: `تعديل فاتورة - ${oldInv.number}`,
          };
          const previewInvoice = {
            ...oldInv,
            shopId,
            shopName,
            items,
            subtotal: parseFloat(subtotal.toFixed(2)),
            discount: parseFloat(disc.toFixed(2)),
            tax: 0,
            taxPct: 0,
            total: totalRounded,
            amountPaid: paidBeforeEdit,
            note: noteVal,
            ...(await buildInvoiceDebtSnapshot(shopId, nextRemaining, {
              mode: 'before-save-edit',
              previousRemaining,
              sameShop: String(oldInv.shopId || '') === String(shopId || ''),
            })),
          };
          DB.enqueueInvoiceEdit(rpcPayload, previewInvoice);
          applyRepStockForInvoiceChange(oldOwnerId, newOwnerId, normalizeItems(oldInv.items), items, `تعديل فاتورة ${oldInv.number}`);
          OpsMeta.setInvoiceOwner(oldInv.id, invoiceOwner);
          if (shopId) OpsMeta.setShopOwner(shopId, invoiceOwner);
          if (OpsMeta.isAdmin() && invoiceOwner?.id) OpsMeta.setRepManager(invoiceOwner.id, OpsMeta.currentUser());
          const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
          Toast.success(localOnly ? 'تم حفظ تعديل الفاتورة على هذا الجهاز ✓' : 'تم حفظ تعديل الفاتورة محليًا وسيتم رفعه عند عودة الإنترنت ✓');
          clearEditCartBackup();
          resetForm({ restoreEditCart: false });
          PrintModule.preview(OpsMeta.attachInvoiceMeta(previewInvoice));
          if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
          if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
          return;
        }

        const invNumber = await Utils.generateInvoiceNumber();
        const initStatus = amountPaidRnd <= 0
          ? 'pending'
          : amountPaidRnd >= totalRounded - 0.01
            ? 'paid'
            : 'partial';
        const initialPayment = buildInitialPaymentPayload(invNumber, amountPaidRnd);
        const rpcPayload = {
          number: invNumber,
          shopId: shopId ? String(shopId) : '',
          shopName,
          items,
          subtotal: parseFloat(subtotal.toFixed(2)),
          discount: parseFloat(disc.toFixed(2)),
          tax: 0,
          taxPct: 0,
          total: totalRounded,
          amountPaid: initialPayment.amountPaid,
          paymentMethod: initialPayment.paymentMethod,
          paymentNote: initialPayment.paymentNote,
          note: noteVal,
          isReturn: '0',
          stockReason: 'فاتورة مبيعات',
        };
        const previewInvoice = {
          number: invNumber,
          shopId,
          shopName,
          items,
          subtotal: parseFloat(subtotal.toFixed(2)),
          discount: parseFloat(disc.toFixed(2)),
          tax: 0,
          taxPct: 0,
          total: totalRounded,
          amountPaid: amountPaidRnd,
          note: noteVal,
          status: initStatus,
          isReturn: 0,
          returnOf: null,
          isReturned: 0,
          createdAt: Utils.localNow(),
          ...(await buildInvoiceDebtSnapshot(shopId, Math.max(0, totalRounded - amountPaidRnd), {
            mode: 'before-save-create',
          })),
        };
        const queuedInvoice = DB.enqueueInvoiceCreate(rpcPayload, previewInvoice);
        applyRepStockForInvoiceChange('', newOwnerId, [], items, `فاتورة ${invNumber}`);
        OpsMeta.setInvoiceOwner(queuedInvoice.id, invoiceOwner);
        if (shopId) OpsMeta.setShopOwner(shopId, invoiceOwner);
        if (OpsMeta.isAdmin() && invoiceOwner?.id) OpsMeta.setRepManager(invoiceOwner.id, OpsMeta.currentUser());
        const localOnly = !DB.hasRemoteConfig() && DB.isBrowserOnline();
        Toast.success(localOnly ? 'تم حفظ الفاتورة على هذا الجهاز ✓' : 'تم حفظ الفاتورة محليًا وسيتم رفعها عند عودة الإنترنت ✓');
        clearEditCartBackup();
        resetForm({ restoreEditCart: false });
        PrintModule.preview(OpsMeta.attachInvoiceMeta(queuedInvoice));
        if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
        if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
        return;
      }

      if (editingInvoice) {
        const oldInv = editingInvoice;
        const paidBeforeEdit = await getInvoicePaidAmount(oldInv.id, oldInv.amountPaid);
        if (false) { // Disabled: stock reversal now happens only in RPC/fallback paths.
        const oldItems = normalizeItems(oldInv.items);

        for (const item of oldItems) {
          const prod = await DB.get('products', item.productId);
          if (prod) {
            const b = prod.quantity;
            const a = b + item.qty;

            await DB.put('products', { ...prod, quantity: a });
            await DB.addStockMovement({
              productId: item.productId,
              productName: item.name,
              type: 'in',
              qty: item.qty,
              reason: `تعديل فاتورة (عكس) - ${oldInv.number}`,
              invoiceId: oldInv.id,
              invoiceNumber: oldInv.number,
              balanceBefore: b,
              balanceAfter: a,
            });
          }
        }
        }

        try {
          await DB.callRpc('save_invoice_atomic', {
            editId: String(oldInv.id),
            number: oldInv.number,
            shopId: shopId ? String(shopId) : '',
            shopName,
            items,
            subtotal: parseFloat(subtotal.toFixed(2)),
            discount: parseFloat(disc.toFixed(2)),
            tax: 0,
            taxPct: 0,
            total: totalRounded,
            note: noteVal,
            stockReason: `تعديل فاتورة - ${oldInv.number}`,
          });
        } catch (rpcErr) {
          console.warn('save_invoice_atomic RPC فشل — fallback يدوي:', rpcErr.message);

          const oldItems = normalizeItems(oldInv.items);
          for (const item of oldItems) {
            const prod = await DB.get('products', item.productId);
            if (prod) {
              const b = prod.quantity;
              const a = b + item.qty;

              await DB.put('products', { ...prod, quantity: a });
              await DB.addStockMovement({
                productId: item.productId,
                productName: item.name,
                type: 'in',
                qty: item.qty,
                reason: `Invoice edit revert - ${oldInv.number}`,
                invoiceId: oldInv.id,
                invoiceNumber: oldInv.number,
                balanceBefore: b,
                balanceAfter: a,
              });
            }
          }

          const existingPayments = await DB.getInvoicePayments(oldInv.id);
          const realPaid = existingPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
          const cappedPaid = Math.min(realPaid, totalRounded);

          let derivedStatus = cappedPaid <= 0
            ? 'pending'
            : cappedPaid >= totalRounded - 0.01
              ? 'paid'
              : 'partial';

          if (oldInv.status === 'void') derivedStatus = 'void';

          await DB.put('invoices', {
            ...oldInv,
            shopId,
            shopName,
            items,
            subtotal: parseFloat(subtotal.toFixed(2)),
            discount: parseFloat(disc.toFixed(2)),
            tax: 0,
            taxPct: 0,
            total: totalRounded,
            amountPaid: parseFloat(cappedPaid.toFixed(2)),
            note: noteVal,
            status: derivedStatus,
          });

          for (const item of items) {
            const prod = await DB.get('products', item.productId);
            if (prod) {
              const b = prod.quantity;
              const a = Math.max(0, b - item.qty);

              await DB.put('products', { ...prod, quantity: a });
              await DB.addStockMovement({
                productId: item.productId,
                productName: item.name,
                type: 'out',
                qty: item.qty,
                reason: `تعديل فاتورة - ${oldInv.number}`,
                invoiceId: oldInv.id,
                invoiceNumber: oldInv.number,
                balanceBefore: b,
                balanceAfter: a,
              });
            }
          }

          if (shopId) {
            const shop = await DB.get('shops', shopId);
            if (shop) {
              await DB.put('shops', {
                ...shop,
                balance: await DB.computeShopBalance(shopId)
              });
            }
          }

          if (oldInv.shopId && oldInv.shopId !== shopId) {
            const oldShop = await DB.get('shops', oldInv.shopId);
            if (oldShop) {
              await DB.put('shops', {
                ...oldShop,
                balance: await DB.computeShopBalance(oldInv.shopId)
              });
            }
          }
        }

        applyRepStockForInvoiceChange(oldOwnerId, newOwnerId, normalizeItems(oldInv.items), items, `تعديل فاتورة ${oldInv.number}`);

        await DB.addAuditLog({
          entityType: 'invoice',
          entityId: oldInv.id,
          action: 'edit',
          oldValue: { total: oldInv.total, status: oldInv.status, shopId: oldInv.shopId },
          newValue: { total: totalRounded, shopId },
          note: `تعديل الفاتورة ${oldInv.number}`,
        });

        Toast.success('تم حفظ التعديلات ✓');
        OpsMeta.setInvoiceOwner(oldInv.id, invoiceOwner);
        if (shopId) OpsMeta.setShopOwner(shopId, invoiceOwner);
        if (OpsMeta.isAdmin() && invoiceOwner?.id) OpsMeta.setRepManager(invoiceOwner.id, OpsMeta.currentUser());
        const freshInv = await DB.get('invoices', oldInv.id);
        const previewInvoice = freshInv
          ? {
              ...freshInv,
              amountPaid: parseFloat((await getInvoicePaidAmount(freshInv.id, freshInv.amountPaid)).toFixed(2)),
              items: normalizeItems(freshInv.items),
              ...(await buildInvoiceDebtSnapshot(freshInv.shopId, 0, { mode: 'after-save' })),
            }
          : {
              ...oldInv,
              total: totalRounded,
              amountPaid: parseFloat(paidBeforeEdit.toFixed(2)),
              items: normalizeItems(oldInv.items),
              ...(await buildInvoiceDebtSnapshot(shopId, Math.max(0, totalRounded - paidBeforeEdit), {
                mode: 'before-save-edit',
                previousRemaining: Math.max(0, (parseFloat(oldInv.total) || 0) - paidBeforeEdit),
                sameShop: String(oldInv.shopId || '') === String(shopId || ''),
              })),
            };

        clearEditCartBackup();
        resetForm({ restoreEditCart: false });
        PrintModule.preview(OpsMeta.attachInvoiceMeta(previewInvoice));

        if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
        if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
      } else {
        const invNumber = await Utils.generateInvoiceNumber();
        let newId = null;
        const initialPayment = buildInitialPaymentPayload(invNumber, amountPaidRnd);

        try {
          const result = await DB.callRpc('save_invoice_atomic', {
            number: invNumber,
            shopId: shopId ? String(shopId) : '',
            shopName,
            items,
            subtotal: parseFloat(subtotal.toFixed(2)),
            discount: parseFloat(disc.toFixed(2)),
            tax: 0,
            taxPct: 0,
            total: totalRounded,
            amountPaid: initialPayment.amountPaid,
            paymentMethod: initialPayment.paymentMethod,
            paymentNote: initialPayment.paymentNote,
            note: noteVal,
            isReturn: '0',
            stockReason: 'فاتورة مبيعات',
          });

          if (!result?.ok) throw new Error(result?.error || 'RPC returned not ok');
          newId = result.invoiceId;
          applyRepStockForInvoiceChange('', newOwnerId, [], items, `فاتورة ${invNumber}`);
        } catch (rpcErr) {
          console.warn('save_invoice_atomic RPC فشل — fallback يدوي:', rpcErr.message);

          if (typeof DB !== 'undefined' && typeof DB.isOfflineError === 'function' && DB.isOfflineError(rpcErr)) {
            const queuedPreview = {
              number: invNumber,
              shopId,
              shopName,
              items,
              subtotal: parseFloat(subtotal.toFixed(2)),
              discount: parseFloat(disc.toFixed(2)),
              tax: 0,
              taxPct: 0,
              total: totalRounded,
              amountPaid: amountPaidRnd,
              note: noteVal,
              status: amountPaidRnd <= 0 ? 'pending' : amountPaidRnd >= totalRounded - 0.01 ? 'paid' : 'partial',
              isReturn: 0,
              returnOf: null,
              isReturned: 0,
              createdAt: Utils.localNow(),
              ...(await buildInvoiceDebtSnapshot(shopId, Math.max(0, totalRounded - amountPaidRnd), {
                mode: 'before-save-create',
              })),
            };
            const queuedInvoice = DB.enqueueInvoiceCreate({
              number: invNumber,
              shopId: shopId ? String(shopId) : '',
              shopName,
              items,
              subtotal: parseFloat(subtotal.toFixed(2)),
              discount: parseFloat(disc.toFixed(2)),
              tax: 0,
              taxPct: 0,
              total: totalRounded,
              amountPaid: initialPayment.amountPaid,
              paymentMethod: initialPayment.paymentMethod,
              paymentNote: initialPayment.paymentNote,
              note: noteVal,
              isReturn: '0',
              stockReason: 'فاتورة مبيعات',
            }, queuedPreview);
            applyRepStockForInvoiceChange('', newOwnerId, [], items, `فاتورة ${invNumber}`);
            OpsMeta.setInvoiceOwner(queuedInvoice.id, invoiceOwner);
            if (shopId) OpsMeta.setShopOwner(shopId, invoiceOwner);
            if (OpsMeta.isAdmin() && invoiceOwner?.id) OpsMeta.setRepManager(invoiceOwner.id, OpsMeta.currentUser());
            Toast.success('تم حفظ الفاتورة محليًا بعد انقطاع الاتصال وسيتم رفعها عند عودة الإنترنت ✓');
            clearEditCartBackup();
            resetForm({ restoreEditCart: false });
            PrintModule.preview(OpsMeta.attachInvoiceMeta(queuedInvoice));
            if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
            if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
            return;
          }

          const initStatus = amountPaidRnd <= 0
            ? 'pending'
            : amountPaidRnd >= totalRounded - 0.01
              ? 'paid'
              : 'partial';

          newId = await DB.add('invoices', {
            number: invNumber,
            shopId,
            shopName,
            items,
            subtotal: parseFloat(subtotal.toFixed(2)),
            discount: parseFloat(disc.toFixed(2)),
            tax: 0,
            taxPct: 0,
            total: totalRounded,
            amountPaid: amountPaidRnd,
            note: noteVal,
            status: initStatus,
            isReturn: 0,
            returnOf: null,
            isReturned: 0,
          });

          if (amountPaidRnd > 0) {
            await DB.addInvoicePayment({
              invoiceId: newId,
              shopId: shopId || null,
              amount: amountPaidRnd,
              paymentMethod: 'cash',
              paidAt: Utils.localNow(),
              note: `دفعة أولية - ${invNumber}`,
            });
          }

          for (const item of items) {
            const prod = await DB.get('products', item.productId);
            if (prod) {
              const b = prod.quantity;
              const a = Math.max(0, b - item.qty);

              await DB.put('products', { ...prod, quantity: a });
              await DB.addStockMovement({
                productId: item.productId,
                productName: item.name,
                type: 'out',
                qty: item.qty,
                reason: 'فاتورة مبيعات',
                invoiceId: newId,
                invoiceNumber: invNumber,
                balanceBefore: b,
                balanceAfter: a,
              });
            }
          }

          if (shopId) {
            const shop = await DB.get('shops', shopId);
            if (shop) {
              await DB.put('shops', {
                ...shop,
                balance: await DB.computeShopBalance(shopId)
              });
            }
          }

          applyRepStockForInvoiceChange('', newOwnerId, [], items, `فاتورة ${invNumber}`);
        }

        await DB.addAuditLog({
          entityType: 'invoice',
          entityId: newId,
          action: 'create',
          newValue: { number: invNumber, total: totalRounded, amountPaid: amountPaidRnd },
          note: `إنشاء فاتورة ${invNumber}`,
        });

        Toast.success('تم حفظ الفاتورة ✓');
        OpsMeta.setInvoiceOwner(newId, invoiceOwner);
        if (shopId) OpsMeta.setShopOwner(shopId, invoiceOwner);
        if (OpsMeta.isAdmin() && invoiceOwner?.id) OpsMeta.setRepManager(invoiceOwner.id, OpsMeta.currentUser());
        const savedInv = await DB.get('invoices', newId);
        const previewInvoice = savedInv
          ? {
              ...savedInv,
              items: normalizeItems(savedInv.items),
              ...(await buildInvoiceDebtSnapshot(savedInv.shopId, 0, { mode: 'after-save' })),
            }
          : {
              number: invNumber,
              total: totalRounded,
              id: newId,
              items,
              ...(await buildInvoiceDebtSnapshot(shopId, Math.max(0, totalRounded - amountPaidRnd), {
                mode: 'before-save-create',
              })),
            };

        clearEditCartBackup();
        resetForm({ restoreEditCart: false });
        PrintModule.preview(OpsMeta.attachInvoiceMeta(previewInvoice));

        if (typeof CollectionsModule !== 'undefined') CollectionsModule.load().catch(() => {});
        if (typeof ShopsModule !== 'undefined') ShopsModule.load().catch(() => {});
      }
    } catch (err) {
      Toast.error('فشل في حفظ الفاتورة: ' + (err.message || 'خطأ غير معروف'));
      console.error('saveInvoice error:', err);
    }
  }

  function resetForm(options = {}) {
    const shouldRestoreEditCart = options.restoreEditCart !== false;
    if (editingInvoice && shouldRestoreEditCart && _editCartBackup) {
      restoreCartAfterEditCancel();
    } else {
      CartStore.clear(); // مسح سلة العميل الحالي
      clearEditCartBackup();
    }
    selectedShop = null;
    selectedRepId = null;
    editingInvoice = null;
    paymentMethod = 'full';
    customAmount = 0;

    if (shopSelectEl()) shopSelectEl().value = '';
    if (repSelectEl()) repSelectEl().value = '';
    if (discountEl()) discountEl().value = '';
    if (noteEl()) noteEl().value = '';
    if (barcodeInputEl()) barcodeInputEl().value = '';

    CartStore.setClient(null); // رجوع للزبون العادي
    syncCartAvailability();

    const banner = document.getElementById('edit-invoice-banner');
    if (banner) banner.style.display = 'none';

    const saveBtn = document.getElementById('save-invoice-btn');
    if (saveBtn) saveBtn.textContent = 'حفظ الفاتورة';

    renderCart();
    _renderCartBadges();
  }

  /**
   * عرض badges على العملاء اللي عندهم سلال نشطة
   * (تبحث عن عناصر data-shop-cart-badge في الـ DOM وتحدثها)
   */
  function _renderCartBadges() {
    // badge على زر "فاتورة جديدة" في الشريط الجانبي
    const navBadge = document.getElementById('new-invoice-cart-badge');
    if (navBadge) {
      const activeClients = CartStore.listClients();
      if (activeClients.length > 0) {
        const totalItems = activeClients.reduce((s, k) => s + CartStore.countFor(k), 0);
        navBadge.textContent = totalItems;
        navBadge.style.display = 'inline-flex';
      } else {
        navBadge.style.display = 'none';
      }
    }

    // badges على قائمة العملاء (لو موجودة)
    document.querySelectorAll('[data-shop-cart-badge]').forEach(el => {
      const shopId = el.dataset.shopCartBadge;
      const count = CartStore.countFor(shopId);
      el.textContent = count;
      el.style.display = count > 0 ? 'inline-flex' : 'none';
    });
  }

  function init() {
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
      if (Utils.confirm('هل تريد إلغاء التعديل؟')) {
        resetForm();
        Router.navigate('invoices');
      }
    });

    document.getElementById('add-product-to-invoice')?.addEventListener('click', openProductPicker);
    document.getElementById('product-picker-close')?.addEventListener('click', closeProductPicker);

    document.getElementById('product-picker-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'product-picker-modal') closeProductPicker();
    });

    document.getElementById('product-picker-done')?.addEventListener('click', closeProductPicker);
    document.getElementById('invoice-barcode-add-btn')?.addEventListener('click', addByBarcode);
    document.getElementById('invoice-barcode-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addByBarcode();
      }
    });
    document.getElementById('invoice-discount')?.addEventListener('input', updateTotals);
    document.getElementById('save-invoice-btn')?.addEventListener('click', saveInvoice);
    document.addEventListener('change', (e) => {
      if (e.target?.id === 'invoice-rep-select') {
        selectedRepId = e.target.value || null;
        syncCartAvailability();
        renderCart();
      }
    });

    // ← مهم: عند تغيير العميل نحمّل سلته المحفوظة
    document.getElementById('invoice-shop-select')?.addEventListener('change', (e) => {
      const shopId = e.target.value || null;
      CartStore.setClient(shopId);
      selectedShop = shopId ? { id: shopId } : null;
      syncCartAvailability();
      renderCart(); // يعرض السلة المحفوظة للعميل الجديد
    });

    document.getElementById('reset-invoice-btn')?.addEventListener('click', () => {
      if (CartStore.getItems().length > 0 && !Utils.confirm('هل تريد مسح جميع العناصر؟')) return;
      resetForm();
    });

    document.getElementById('reset-invoice-btn-2')?.addEventListener('click', () => {
      if (CartStore.getItems().length > 0 && !Utils.confirm('هل تريد الخروج؟')) return;
      resetForm();
      Router.navigate('invoices');
    });
  }

  return {
    load,
    init,
    setShop,
    loadForEdit,
    setPayment,
    setCustomAmount
  };
})();

window.NewInvoiceModule = NewInvoiceModule;
