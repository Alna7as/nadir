(function(global) {
  const KEY = 'nadir_ops_meta_v1';
  const REMOTE_KEY = 'ops_meta_shared_v1';
  let _syncTimer = null;
  let _syncPromise = null;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : {};
      return normalize(data);
    } catch (_) {
      return normalize({});
    }
  }

  function normalize(data) {
    return {
      invoiceOwners: data.invoiceOwners || {},
      shopOwners: data.shopOwners || {},
      repManagers: data.repManagers || {},
      repTargets: data.repTargets || {},
      repStock: data.repStock || {},
      repStockHistory: Array.isArray(data.repStockHistory) ? data.repStockHistory : [],
      storeWhatsapp: data.storeWhatsapp || '',
      activity: Array.isArray(data.activity) ? data.activity : [],
      updatedAt: parseInt(data.updatedAt, 10) || 0,
    };
  }

  function canSyncRemote() {
    return typeof DB !== 'undefined' &&
      typeof DB.hasRemoteConfig === 'function' &&
      typeof DB.getAppSetting === 'function' &&
      typeof DB.saveAppSetting === 'function' &&
      DB.hasRemoteConfig();
  }

  async function pushRemote(snapshot = null) {
    if (!canSyncRemote()) return false;
    const payload = normalize(snapshot || read());
    _syncPromise = DB.saveAppSetting(REMOTE_KEY, payload).catch((err) => {
      console.warn('[OpsMeta] remote sync failed:', err?.message || err);
      throw err;
    }).finally(() => {
      _syncPromise = null;
    });
    return _syncPromise;
  }

  function scheduleRemoteSync(snapshot = null) {
    if (!canSyncRemote()) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
      pushRemote(snapshot).catch(() => {});
    }, 150);
  }

  function write(next, options = {}) {
    const data = normalize(next);
    data.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(data));
    if (!options.skipRemote) scheduleRemoteSync(data);
    return data;
  }

  function mutate(cb) {
    const current = read();
    const next = cb(current) || current;
    return write(next);
  }

  async function syncFromRemote(force = false) {
    if (!canSyncRemote()) return read();
    if (_syncPromise) await _syncPromise.catch(() => {});
    try {
      const remote = await DB.getAppSetting(REMOTE_KEY, null);
      if (!remote || typeof remote !== 'object') return read();
      const remoteData = normalize(remote);
      const localData = read();
      if (!force && remoteData.updatedAt && localData.updatedAt && remoteData.updatedAt <= localData.updatedAt) {
        return localData;
      }
      return write(remoteData, { skipRemote: true });
    } catch (err) {
      console.warn('[OpsMeta] remote fetch failed:', err?.message || err);
      return read();
    }
  }

  function cleanUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email || '',
      mobile: user.mobile || '',
    };
  }

  function getInvoiceOwner(invoiceId) {
    return read().invoiceOwners[String(invoiceId)] || null;
  }

  function setInvoiceOwner(invoiceId, user) {
    return mutate((data) => {
      data.invoiceOwners[String(invoiceId)] = cleanUser(user);
      return data;
    });
  }

  function getShopOwner(shopId) {
    return read().shopOwners[String(shopId)] || null;
  }

  function setShopOwner(shopId, user) {
    return mutate((data) => {
      data.shopOwners[String(shopId)] = cleanUser(user);
      return data;
    });
  }

  function getRepTarget(userId) {
    return parseFloat(read().repTargets[String(userId)]) || 0;
  }

  function getRepManager(userId) {
    return read().repManagers[String(userId)] || null;
  }

  function setRepManager(userId, user) {
    return mutate((data) => {
      data.repManagers[String(userId)] = cleanUser(user);
      return data;
    });
  }

  function setRepTarget(userId, value) {
    return mutate((data) => {
      data.repTargets[String(userId)] = Math.max(0, parseFloat(value) || 0);
      return data;
    });
  }

  function getRepStock(userId) {
    const rows = read().repStock[String(userId)];
    return Array.isArray(rows) ? rows : [];
  }

  function setRepStock(userId, rows) {
    return mutate((data) => {
      data.repStock[String(userId)] = Array.isArray(rows)
        ? rows
            .map((row) => ({
              productId: parseInt(row.productId, 10),
              qty: Math.max(0, parseInt(row.qty, 10) || 0),
            }))
            .filter((row) => row.productId && row.qty > 0)
        : [];
      return data;
    });
  }

  function getRepStockQty(userId, productId) {
    const row = getRepStock(userId).find((item) => String(item.productId) === String(productId));
    return parseInt(row?.qty, 10) || 0;
  }

  function getRepStockHistory(userId = null) {
    const rows = read().repStockHistory;
    if (!userId) return rows;
    return rows.filter((entry) => String(entry.userId) === String(userId));
  }

  function applyRepStockDelta(userId, deltas, meta = {}) {
    return mutate((data) => {
      const key = String(userId || '');
      if (!key) return data;

      const currentRows = Array.isArray(data.repStock[key]) ? data.repStock[key] : [];
      const stockMap = {};
      currentRows.forEach((row) => {
        const productId = parseInt(row.productId, 10);
        if (!productId) return;
        stockMap[String(productId)] = Math.max(0, parseInt(row.qty, 10) || 0);
      });

      const normalizedDeltas = Array.isArray(deltas)
        ? deltas
            .map((row) => ({
              productId: parseInt(row.productId, 10),
              qtyDelta: parseInt(row.qtyDelta, 10) || 0,
            }))
            .filter((row) => row.productId && row.qtyDelta)
        : [];

      normalizedDeltas.forEach((row) => {
        const productKey = String(row.productId);
        const currentQty = stockMap[productKey] || 0;
        stockMap[productKey] = Math.max(0, currentQty + row.qtyDelta);
      });

      data.repStock[key] = Object.entries(stockMap)
        .map(([productId, qty]) => ({
          productId: parseInt(productId, 10),
          qty: Math.max(0, parseInt(qty, 10) || 0),
        }))
        .filter((row) => row.productId && row.qty > 0);

      if (normalizedDeltas.length) {
        data.repStockHistory.unshift({
          id: `repstk_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
          at: new Date().toISOString(),
          userId: key,
          actor: meta.actor || currentUser()?.name || '',
          type: meta.type || 'adjust',
          note: meta.note || '',
          rows: normalizedDeltas,
        });
        data.repStockHistory = data.repStockHistory.slice(0, 300);
      }

      return data;
    });
  }

  function addActivity(entry) {
    return mutate((data) => {
      data.activity.unshift({
        id: `act_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
        at: new Date().toISOString(),
        ...entry,
      });
      data.activity = data.activity.slice(0, 200);
      return data;
    });
  }

  function getActivity() {
    return read().activity;
  }

  function currentUser() {
    if (typeof Session === 'undefined' || typeof NadirUsers === 'undefined') return null;
    return NadirUsers.getById(Session.getUserId?.()) || {
      id: Session.getUserId?.(),
      name: Session.getName?.(),
      role: Session.getRole?.(),
    };
  }

  function isAdmin() {
    return typeof Session !== 'undefined' && Session.getRole?.() === 'admin';
  }

  function isRep() {
    return typeof Session !== 'undefined' && Session.getRole?.() === 'cashier';
  }

  function getInvoiceOwnerName(invoiceId) {
    return getInvoiceOwner(invoiceId)?.name || 'غير محدد';
  }

  function filterInvoices(invoices) {
    if (!isRep()) return invoices;
    const current = currentUser();
    if (!current?.id) return [];
    return invoices.filter((invoice) => {
      const owner = getInvoiceOwner(invoice.id);
      if (owner?.id) return owner.id === current.id;
      const shopOwner = invoice.shopId ? getShopOwner(invoice.shopId) : null;
      return shopOwner?.id === current.id;
    });
  }

  function filterShops(shops) {
    if (!isRep()) return shops;
    const current = currentUser();
    if (!current?.id) return [];
    return shops.filter((shop) => getShopOwner(shop.id)?.id === current.id);
  }

  function attachInvoiceMeta(invoice) {
    const owner = getInvoiceOwner(invoice?.id);
    return owner ? { ...invoice, salesRepId: owner.id, salesRepName: owner.name } : { ...invoice };
  }

  function getRepInvoices(userId, invoices) {
    return invoices.filter((invoice) => getInvoiceOwner(invoice.id)?.id === userId);
  }

  global.OpsMeta = {
    read,
    write,
    pushRemote,
    syncFromRemote,
    getInvoiceOwner,
    setInvoiceOwner,
    getShopOwner,
    setShopOwner,
    getRepManager,
    setRepManager,
    getRepTarget,
    setRepTarget,
    getRepStock,
    getRepStockQty,
    setRepStock,
    applyRepStockDelta,
    getRepStockHistory,
    addActivity,
    getActivity,
    currentUser,
    isAdmin,
    isRep,
    filterInvoices,
    filterShops,
    attachInvoiceMeta,
    getInvoiceOwnerName,
    getRepInvoices,
  };
})(window);
