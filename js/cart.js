/**
 * cart.js — نظام السلة الدائمة لكل عميل
 *
 * المبدأ:
 *  - كل عميل (shopId) عنده سلة خاصة تتخزن في localStorage
 *  - "زبون عادي" (بدون shopId) عنده سلة خاصة بمفتاح 'guest'
 *  - السلة لا تتمسح عند التنقل بين الصفحات أو إغلاق التبويب
 *  - عند حفظ الفاتورة → السلة تتمسح تلقائياً
 *  - NewInvoiceModule يشتغل من خلال CartStore بدل cartItems المحلي
 *
 * الاستخدام:
 *  CartStore.setClient(shopId)        // اختيار العميل الحالي
 *  CartStore.getItems()               // جلب عناصر السلة الحالية
 *  CartStore.addItem(item)            // إضافة / تحديث عنصر
 *  CartStore.removeItem(productId)    // حذف عنصر
 *  CartStore.updateQty(productId, n)  // تعديل الكمية
 *  CartStore.updatePrice(productId, price) // تعديل السعر
 *  CartStore.clear()                  // مسح السلة الحالية
 *  CartStore.clearAll()               // مسح كل السلال (نادراً)
 *  CartStore.listClients()            // قائمة العملاء الذين عندهم سلال نشطة
 */

const CartStore = (() => {
  const STORAGE_KEY = 'nadir_pos_carts'; // مفتاح localStorage
  let _currentClient = 'guest';          // العميل الحالي

  // ─── قراءة وكتابة localStorage ───────────────────────────
  function _readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function _writeAll(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[CartStore] فشل الحفظ في localStorage:', e);
    }
  }

  // ─── مفتاح العميل ─────────────────────────────────────────
  function _key(clientId) {
    return clientId ? String(clientId) : 'guest';
  }

  // ─── API عام ──────────────────────────────────────────────

  /**
   * تعيين العميل الحالي (يُستدعى عند تغيير الاختيار في القائمة)
   * @param {string|number|null} shopId
   */
  function setClient(shopId) {
    _currentClient = _key(shopId);
  }

  /** العميل الحالي */
  function getClient() {
    return _currentClient;
  }

  /** جلب عناصر سلة العميل الحالي (نسخة — لا تعدّل مباشرة) */
  function getItems() {
    const all = _readAll();
    return JSON.parse(JSON.stringify(all[_currentClient] || []));
  }

  /** جلب عناصر سلة عميل معيّن */
  function getItemsFor(shopId) {
    const all = _readAll();
    return JSON.parse(JSON.stringify(all[_key(shopId)] || []));
  }

  /**
   * إضافة منتج أو زيادة كميته
   * @param {{ productId, name, price, qty, availableQty, costAtTime, originalPrice }} item
   */
  function addItem(item) {
    const all = _readAll();
    const cart = all[_currentClient] || [];
    const idx = cart.findIndex(i => String(i.productId) === String(item.productId));
    if (idx !== -1) {
      cart[idx].qty = Math.min(
        cart[idx].qty + (item.qty || 1),
        item.availableQty ?? cart[idx].availableQty ?? 999
      );
      if (item.availableQty !== undefined) cart[idx].availableQty = item.availableQty;
    } else {
      cart.push({
        productId:     item.productId,
        name:          item.name,
        price:         item.price,
        qty:           item.qty || 1,
        availableQty:  item.availableQty ?? 999,
        costAtTime:    item.costAtTime || 0,
        originalPrice: item.originalPrice ?? item.price,
      });
    }

    all[_currentClient] = cart;
    _writeAll(all);
  }

  /**
   * حذف منتج من السلة
   * @param {number|string} productId
   */
  function removeItem(productId) {
    const all = _readAll();
    all[_currentClient] = (all[_currentClient] || [])
      .filter(i => String(i.productId) !== String(productId));
    _writeAll(all);
  }

  /**
   * تعديل كمية منتج
   * @param {number|string} productId
   * @param {number} qty — القيمة الجديدة (ليست delta)
   */
  function updateQty(productId, qty) {
    const all = _readAll();
    const cart = all[_currentClient] || [];
    const item = cart.find(i => String(i.productId) === String(productId));
    if (item) {
      item.qty = Math.max(1, Math.min(qty, item.availableQty || 999));
      all[_currentClient] = cart;
      _writeAll(all);
    }
  }

  /**
   * تعديل سعر منتج
   * @param {number|string} productId
   * @param {number} price — السعر الجديد
   */
  function updatePrice(productId, price) {
    const all = _readAll();
    const cart = all[_currentClient] || [];
    const item = cart.find(i => String(i.productId) === String(productId));
    if (item) {
      item.price = Math.max(0, parseFloat(price.toFixed(2)));
      all[_currentClient] = cart;
      _writeAll(all);
    }
  }

  /** مسح سلة العميل الحالي (بعد حفظ الفاتورة مثلاً) */
  function clear() {
    const all = _readAll();
    delete all[_currentClient];
    _writeAll(all);
  }

  /** استبدال سلة عميل معيّن بالكامل */
  function replaceItemsFor(shopId, items = []) {
    const all = _readAll();
    const key = _key(shopId);
    const safeItems = JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
    if (safeItems.length > 0) all[key] = safeItems;
    else delete all[key];
    _writeAll(all);
  }

  /** مسح جميع السلال */
  function clearAll() {
    _writeAll({});
  }

  /**
   * قائمة العملاء الذين عندهم سلال نشطة (غير فارغة)
   * @returns {string[]} مصفوفة مفاتيح
   */
  function listClients() {
    const all = _readAll();
    return Object.keys(all).filter(k => (all[k] || []).length > 0);
  }

  /**
   * عدد عناصر سلة عميل معيّن (مفيد لعرض badge)
   * @param {string|number|null} shopId
   * @returns {number}
   */
  function countFor(shopId) {
    const all = _readAll();
    return (all[_key(shopId)] || []).reduce((s, i) => s + i.qty, 0);
  }

  return {
    setClient,
    getClient,
    getItems,
    getItemsFor,
    addItem,
    removeItem,
    updateQty,
    updatePrice,
    clear,
    replaceItemsFor,
    clearAll,
    listClients,
    countFor,
  };
})();

window.CartStore = CartStore;

// ═══════════════════════════════════════════════════════════
// CartDrawer — واجهة السلة المرئية (Drawer)
// ═══════════════════════════════════════════════════════════
const CartDrawer = (() => {

  let _activeTab = null; // العميل المعروض حالياً في الـ drawer

  // ─── فتح الـ drawer ──────────────────────────────────────
  function open() {
    // نحدد التاب الافتراضي: العميل الحالي في NewInvoiceModule لو موجود، وإلا أول عميل عنده سلة
    const clients = CartStore.listClients();
    if (clients.length === 0) {
      // سلة فارغة — نفتح بردو ونعرض رسالة
      _activeTab = CartStore.getClient();
    } else {
      // نختار العميل الحالي لو عنده سلة، وإلا أول واحد
      const current = CartStore.getClient();
      _activeTab = clients.includes(current) ? current : clients[0];
    }

    _render();
    document.getElementById('cart-drawer-overlay')?.classList.add('open');
    document.getElementById('cart-drawer')?.classList.add('open');
  }

  // ─── إغلاق الـ drawer ────────────────────────────────────
  function close() {
    document.getElementById('cart-drawer-overlay')?.classList.remove('open');
    document.getElementById('cart-drawer')?.classList.remove('open');
  }

  // ─── الانتقال لصفحة الفاتورة بالعميل المحدد ──────────────
  function goToInvoice() {
    close();
    // نحدد العميل في CartStore
    CartStore.setClient(_activeTab === 'guest' ? null : _activeTab);

    // نطلب من NewInvoiceModule تحديث نفسه
    if (typeof Router !== 'undefined') {
      Router.navigate('new-invoice');
    }

    // نحدث قائمة العملاء في new-invoice
    setTimeout(() => {
      const sel = document.getElementById('invoice-shop-select');
      if (sel && _activeTab && _activeTab !== 'guest') {
        sel.value = _activeTab;
        sel.dispatchEvent(new Event('change'));
      }
    }, 120);
  }

  // ─── Render كل محتوى الـ drawer ──────────────────────────
  function _render() {
    _renderTabs();
    _renderBody();
    _updateFab();
  }

  function _renderTabs() {
    const container = document.getElementById('cart-drawer-clients');
    if (!container) return;

    const clients = CartStore.listClients();

    if (clients.length <= 1) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = clients.map(k => {
      const label = _clientLabel(k);
      const isActive = k === _activeTab;
      return `<button class="cart-client-tab ${isActive ? 'active' : ''}" onclick="CartDrawer._switchTab('${k}')">${label}</button>`;
    }).join('');
  }

  function _renderBody() {
    const body   = document.getElementById('cart-drawer-body');
    const client = document.getElementById('cart-drawer-client');
    const totalEl = document.getElementById('cart-drawer-total-val');
    const footer  = document.getElementById('cart-drawer-footer');
    if (!body) return;

    // عنوان العميل
    if (client) client.textContent = _clientLabel(_activeTab);

    // جلب سلة العميل المحدد مباشرة
    const all = (() => {
      try { return JSON.parse(localStorage.getItem('nadir_pos_carts') || '{}'); } catch(e) { return {}; }
    })();
    const items = all[_activeTab || 'guest'] || [];

    if (items.length === 0) {
      body.innerHTML = `
        <div id="cart-drawer-empty">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
          </svg>
          السلة فارغة
        </div>`;
      if (totalEl) totalEl.textContent = '٠.٠٠ ج.م';
      if (footer) footer.style.display = 'none';
      return;
    }

    if (footer) footer.style.display = 'block';

    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    if (totalEl) totalEl.textContent = parseFloat(total.toFixed(2)).toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';

    body.innerHTML = items.map(item => `
      <div class="cart-drawer-item">
        <div class="cart-drawer-qty-badge">${item.qty}</div>
        <div style="flex:1;min-width:0;">
          <div class="cart-drawer-item-name">${_escape(item.name)}</div>
          <div class="cart-drawer-item-meta">${parseFloat(item.price).toFixed(2)} ج.م × ${item.qty}</div>
        </div>
        <div class="cart-drawer-item-total">${parseFloat(item.price * item.qty).toFixed(2)} ج.م</div>
        <button onclick="CartDrawer._removeItem('${item.productId}')"
          style="width:24px;height:24px;border-radius:50%;background:rgba(224,82,82,0.12);border:1px solid rgba(224,82,82,0.25);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
          <svg fill="none" viewBox="0 0 24 24" stroke="#e05252" stroke-width="2.5" style="width:11px;height:11px;"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`).join('');
  }

  // ─── تبديل التاب ──────────────────────────────────────────
  function _switchTab(clientKey) {
    _activeTab = clientKey;
    _render();
  }

  // ─── حذف عنصر من الـ drawer مباشرة ──────────────────────
  function _removeItem(productId) {
    // نحفظ العميل الحالي في CartStore مؤقتاً
    const prev = CartStore.getClient();
    CartStore.setClient(_activeTab === 'guest' ? null : _activeTab);
    CartStore.removeItem(String(productId));
    CartStore.setClient(prev === 'guest' ? null : prev);

    // لو كنا في صفحة new-invoice نحدّث العرض
    if (typeof NewInvoiceModule !== 'undefined' && CartStore.getClient() === (_activeTab === 'guest' ? null : _activeTab)) {
      // إعادة رسم السلة في صفحة الفاتورة لو مفتوحة
      const page = document.getElementById('page-new-invoice');
      if (page && page.classList.contains('active')) {
        NewInvoiceModule.load().catch(() => {});
      }
    }

    _render();
  }

  // ─── تحديث الـ FAB badge ───────────────────────────────────
  function _updateFab() {
    const fab   = document.getElementById('cart-fab');
    const badge = document.getElementById('cart-fab-badge');
    if (!fab || !badge) return;

    const clients = CartStore.listClients();
    const total = clients.reduce((s, k) => {
      try {
        const all = JSON.parse(localStorage.getItem('nadir_pos_carts') || '{}');
        return s + (all[k] || []).reduce((ss, i) => ss + i.qty, 0);
      } catch(e) { return s; }
    }, 0);

    if (total > 0) {
      fab.classList.add('has-items');
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.display = 'inline-flex';
    } else {
      fab.classList.remove('has-items');
      badge.style.display = 'none';
    }
  }

  // ─── helpers ──────────────────────────────────────────────
  function _clientLabel(key) {
    if (!key || key === 'guest' || key === 'null') return '👤 زبون عادي';
    // نحاول نجيب اسم العميل من DOM (قائمة invoice-shop-select)
    const sel = document.getElementById('invoice-shop-select');
    if (sel) {
      const opt = sel.querySelector(`option[value="${key}"]`);
      if (opt && opt.textContent.trim()) return '🏪 ' + opt.textContent.trim();
    }
    return '🏪 عميل #' + key;
  }

  function _escape(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── API عام ──────────────────────────────────────────────
  return { open, close, goToInvoice, _switchTab, _removeItem, refresh: _render, updateFab: _updateFab };
})();

window.CartDrawer = CartDrawer;

// تحديث الـ FAB عند أي تغيير في localStorage (تابات متعددة)
window.addEventListener('storage', (e) => {
  if (e.key === 'nadir_pos_carts') CartDrawer.updateFab();
});
