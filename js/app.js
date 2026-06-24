/**
 * app.js — النواة الرئيسية
 * قاعدة البيانات: Supabase (سحابية)
 */



const SUPABASE_URL      = 'https://ucqqejxlhgeslenowzuk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjcXFlanhsaGdlc2xlbm93enVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDU1MTYsImV4cCI6MjA5NzcyMTUxNn0.__V7JKyd9URygDR5vhgHa7deFyU32n06s8QeiEIvKaY';

function getSupabaseRuntimeConfig() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('nadir_supabase_config') || '{}');
  } catch (_) {}
  const winCfg = typeof window !== 'undefined' ? (window.__NADIR_SUPABASE__ || {}) : {};
  const url = String(winCfg.url || stored.url || SUPABASE_URL || '').trim();
  const anonKey = String(winCfg.anonKey || stored.anonKey || SUPABASE_ANON_KEY || '').trim();
  return { url, anonKey };
}

const LEGACY_DEMO_USER_IDS = new Set([
  'user_mahmoud_admin',
]);
const LEGACY_DEMO_EMAILS = new Set([
  'mahmoud@alhabib.eg',
  'mohamed@alhabib.eg',
  'abdullah@alhabib.eg',
  'ahmed@alhabib.eg',
  'admin@pos.eg',
  'cashier@pos.eg',
  'store@pos.eg',
]);
const LEGACY_DEMO_MOBILES = new Set([
  '01000000001',
  '01000000002',
  '01000000003',
  '01000000004',
  '01000000012',
  '01000000013',
  '01000000014',
]);
const VALID_SESSION_ROLES = new Set(['admin', 'cashier', 'store']);

function getHomePageForRole(role) {
  return ({
    admin: 'dashboard',
    cashier: 'new-invoice',
    store: 'products',
  })[String(role || '').trim()] || 'dashboard';
}

function isLegacyDemoSession(session) {
  if (!session) return false;
  const email = String(session.email || '').trim().toLowerCase();
  const mobile = String(session.mobile || '').replace(/\D/g, '');
  return LEGACY_DEMO_USER_IDS.has(session.id) ||
    LEGACY_DEMO_EMAILS.has(email) ||
    LEGACY_DEMO_MOBILES.has(mobile);
}

function isValidSessionRole(role) {
  return VALID_SESSION_ROLES.has(String(role || '').trim());
}


// ✅ مسح بيانات المناديب القديمة من localStorage
(function cleanupLegacyReps() {
  try {
    const STORAGE_KEY = 'nadir_pos_users_v2';
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const users = JSON.parse(raw);
    if (!Array.isArray(users)) return;
    const cleaned = users.filter(u => u.role === 'admin' || u.role === 'store');
    if (cleaned.length !== users.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    }
    // مسح أي بيانات مخزون مناديب قديمة
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('nadir_rep_stock_') || key.startsWith('nadir_rep_target_')) {
        localStorage.removeItem(key);
      }
    });
  } catch(_) {}
})();

(function checkAuth() {
  const raw = localStorage.getItem('nadir_pos_session');
  if (!raw) { window.location.href = 'login.html'; return; }
  try {
    const sess = JSON.parse(raw);
    if (
      isLegacyDemoSession(sess) ||
      !isValidSessionRole(sess.role) ||
      !sess.expiresAt ||
      Date.now() > sess.expiresAt
    ) {
      localStorage.removeItem('nadir_pos_session');
      window.location.href = 'login.html';
    }
  } catch(e) {
    localStorage.removeItem('nadir_pos_session');
    window.location.href = 'login.html';
  }
})();

const DB = (() => {
  const TABLE_CACHE_KEY = 'nadir_table_cache_v1';
  const OFFLINE_QUEUE_KEY = 'nadir_offline_queue_v1';
  const TEMP_ID_MAP_KEY = 'nadir_temp_id_map_v1';
  const CACHEABLE_TABLES = ['products', 'shops', 'invoices', 'stock_movements', 'invoice_payments', 'payments', 'expenses', 'app_settings'];
  let _flushPromise = null;
  let _preferOfflineCache = false;
  // ✅ in-memory cache لتجنب قراءة localStorage في كل مرة
  let _memCache = null;

  function hasRemoteConfig() {
    const cfg = getSupabaseRuntimeConfig();
    return !!cfg.url &&
      !!cfg.anonKey &&
      cfg.url !== 'YOUR_SUPABASE_URL' &&
      cfg.anonKey !== 'YOUR_SUPABASE_ANON_KEY';
  }

  const h = () => ({
    'Content-Type':  'application/json',
    'apikey':        getSupabaseRuntimeConfig().anonKey,
    'Authorization': 'Bearer ' + getSupabaseRuntimeConfig().anonKey,
    'Prefer':        'return=representation',
  });

  function isBrowserOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  function isOnline() {
    if (!hasRemoteConfig()) return false;
    return isBrowserOnline();
  }

  function isOfflineError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return !isOnline() ||
      !hasRemoteConfig() ||
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('لم يتم إعداد supabase');
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      return await fetch(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (err) {
      if (controller?.signal?.aborted) throw new Error('Request timeout');
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getCachedTables() {
    if (_memCache) return _memCache;
    _memCache = readJson(TABLE_CACHE_KEY, {});
    return _memCache;
  }

  function setCachedTables(data) {
    _memCache = data;
    writeJson(TABLE_CACHE_KEY, data);
  }

  function getCachedTable(table) {
    const all = getCachedTables();
    return Array.isArray(all[table]) ? all[table] : [];
  }

  function shouldCacheTable(table) {
    return CACHEABLE_TABLES.includes(table);
  }

  function setCachedTable(table, rows) {
    const all = getCachedTables();
    all[table] = rows;
    setCachedTables(all);
    return rows;
  }

  function upsertCachedRow(table, row) {
    const rows = getCachedTable(table);
    const idx = rows.findIndex(r => String(r.id) === String(row.id));
    if (idx === -1) rows.unshift(row);
    else rows[idx] = { ...rows[idx], ...row };
    setCachedTable(table, rows);
    return row;
  }

  function removeCachedRow(table, id) {
    setCachedTable(table, getCachedTable(table).filter(r => String(r.id) !== String(id)));
  }

  function mergeCachedRows(table, rows) {
    const merged = [...getCachedTable(table)];
    rows.forEach((row) => {
      if (row?.id === undefined || row?.id === null) return;
      const idx = merged.findIndex(r => String(r.id) === String(row.id));
      if (idx === -1) merged.push(row);
      else merged[idx] = { ...merged[idx], ...row };
    });
    setCachedTable(table, merged);
    return merged;
  }

  function parseQueryParams(params = '') {
    const raw = String(params || '').trim();
    if (!raw.startsWith('?')) return [];
    return raw.slice(1).split('&').filter(Boolean).map(part => {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) return { key: decodeURIComponent(part), value: '' };
      return {
        key: decodeURIComponent(part.slice(0, eqIndex)),
        value: decodeURIComponent(part.slice(eqIndex + 1)),
      };
    });
  }

  function normalizeCompareValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? '1' : '0';
    return String(value);
  }

  function applyCachedQuery(table, params = '') {
    let rows = getCachedTable(table).map(toSnake);
    const queryParts = parseQueryParams(params);
    let selectFields = null;
    let orderSpec = null;
    let limit = null;

    queryParts.forEach(({ key, value }) => {
      if (key === 'select') {
        selectFields = value.split(',').map(v => v.trim()).filter(Boolean);
        return;
      }
      if (key === 'order') {
        const [field, dir = 'asc'] = value.split('.');
        orderSpec = { field, dir: dir.toLowerCase() === 'desc' ? 'desc' : 'asc' };
        return;
      }
      if (key === 'limit') {
        limit = Math.max(0, parseInt(value, 10) || 0);
        return;
      }

      let op = 'eq';
      let rawValue = value;
      if (value.startsWith('not.in.')) {
        op = 'not.in';
        rawValue = value.slice('not.in.'.length);
      } else if (value.startsWith('not.eq.')) {
        op = 'not.eq';
        rawValue = value.slice('not.eq.'.length);
      } else if (value.startsWith('gte.')) {
        op = 'gte';
        rawValue = value.slice('gte.'.length);
      } else if (value.startsWith('lte.')) {
        op = 'lte';
        rawValue = value.slice('lte.'.length);
      } else if (value.startsWith('eq.')) {
        op = 'eq';
        rawValue = value.slice('eq.'.length);
      }

      rows = rows.filter((row) => {
        const cell = row[key];
        const cellStr = normalizeCompareValue(cell);
        switch (op) {
          case 'eq':
            return cellStr === rawValue;
          case 'not.eq':
            return cellStr !== rawValue;
          case 'gte':
            return cellStr >= rawValue;
          case 'lte':
            return cellStr <= rawValue;
          case 'not.in': {
            const options = rawValue.replace(/^\(/, '').replace(/\)$/, '').split(',').map(v => v.trim());
            return !options.includes(cellStr);
          }
          default:
            return true;
        }
      });
    });

    if (orderSpec) {
      const { field, dir } = orderSpec;
      rows.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        if (av === undefined || av === null) return dir === 'asc' ? -1 : 1;
        if (bv === undefined || bv === null) return dir === 'asc' ? 1 : -1;
        return av > bv ? (dir === 'asc' ? 1 : -1) : (dir === 'asc' ? -1 : 1);
      });
    }

    if (limit !== null) rows = rows.slice(0, limit);

    if (selectFields && selectFields.length) {
      rows = rows.map(row => {
        const picked = {};
        selectFields.forEach(field => {
          if (field in row) picked[field] = row[field];
        });
        return picked;
      });
    }

    return rows;
  }

  function cacheRowsFromServer(table, params, rows) {
    if (!shouldCacheTable(table) || !Array.isArray(rows)) return;
    const camelRows = rows.map(toCamel);
    if (!params || params === '?order=id.asc' || params === '?order=id.desc') {
      setCachedTable(table, camelRows);
      return;
    }
    if (!String(params).includes('select=')) {
      mergeCachedRows(table, camelRows);
    }
  }

  function getQueue() {
    return readJson(OFFLINE_QUEUE_KEY, []);
  }

  function setQueue(queue) {
    writeJson(OFFLINE_QUEUE_KEY, queue);
  }

  function enqueue(op) {
    const queue = getQueue();
    queue.push({
      id: `q_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...op,
    });
    setQueue(queue);
    setTimeout(() => { if (typeof StatusUI !== 'undefined') StatusUI.update(); }, 0);
    return queue.length;
  }

  function enqueueAppSetting(key, value) {
    const existing = getCachedTable('app_settings').find(row => row.key === key);
    const row = {
      id: existing?.id || nextTempId('app_settings'),
      key,
      value,
      pendingSync: 1,
      updatedAt: Utils.localNow(),
      createdAt: existing?.createdAt || Utils.localNow(),
    };
    upsertCachedRow('app_settings', row);
    enqueue({ type: 'app_setting_upsert', payload: { key, value, localId: row.id } });
    return row;
  }

  function shiftQueueItem(id) {
    setQueue(getQueue().filter(item => item.id !== id));
    setTimeout(() => { if (typeof StatusUI !== 'undefined') StatusUI.update(); }, 0);
  }

  function getTempIdMap() {
    return readJson(TEMP_ID_MAP_KEY, {});
  }

  function setTempIdMap(map) {
    writeJson(TEMP_ID_MAP_KEY, map);
  }

  function setTempMapping(type, tempId, realId) {
    const map = getTempIdMap();
    map[`${type}:${tempId}`] = realId;
    setTempIdMap(map);
  }

  function resolveTempId(type, id) {
    if (id === null || id === undefined || id === '') return id;
    const map = getTempIdMap();
    return map[`${type}:${id}`] || id;
  }

  function nextTempId(table) {
    const rows = getCachedTable(table);
    const minId = rows.reduce((min, row) => Math.min(min, parseInt(row.id, 10) || 0), 0);
    return Math.min(-1, minId - 1);
  }

  // [إصلاح] retry تلقائي عند 429 أو 503
  async function serverReq(method, table, body, params = '') {
    if (!hasRemoteConfig())
      throw new Error('لم يتم إعداد Supabase — راجع ملف SETUP.md');
    const url = `${getSupabaseRuntimeConfig().url}/rest/v1/${table}${params}`;
    const opts = { method, headers: h() };
    if (body) opts.body = JSON.stringify(body);

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
      try {
        const res = await fetchWithTimeout(url, opts, 4000);
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error(`HTTP ${res.status} — خادم مشغول، جاري إعادة المحاولة...`);
          continue;
        }
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.message || e.hint || `HTTP ${res.status}`);
        }
        const txt = await res.text();
        return txt ? JSON.parse(txt) : [];
      } catch(err) {
        lastErr = err;
        // لا نكرر إذا كان الخطأ من الـ server (4xx عدا 429)
        if (err.message && err.message.includes('HTTP 4') && !err.message.includes('HTTP 429')) throw err;
      }
    }
    throw lastErr;
  }

  async function req(method, table, body, params = '') {
    if (method === 'GET') {
      if (_preferOfflineCache && shouldCacheTable(table)) {
        return applyCachedQuery(table, params);
      }
      try {
        const rows = await serverReq(method, table, body, params);
        cacheRowsFromServer(table, params, rows);
        return rows;
      } catch (err) {
        if (shouldCacheTable(table) && isOfflineError(err)) {
          return applyCachedQuery(table, params);
        }
        throw err;
      }
    }
    return serverReq(method, table, body, params);
  }

  function toSnake(d) {
    const localOnlyFields = new Set([
      'pendingSync',
    ]);
    const map = {
      minStock:       'min_stock',
      createdAt:      'created_at',
      updatedAt:      'updated_at',
      shopId:         'shop_id',
      shopName:       'shop_name',
      isReturn:       'is_return',
      returnOf:       'return_of',
      subtotal:       'subtotal',
      discount:       'discount',
      tax:            'tax',
      taxPct:         'tax_pct',
      total:          'total',
      amountPaid:     'amount_paid',
      productId:      'product_id',
      productName:    'product_name',
      invoiceId:      'invoice_id',
      invoiceNumber:  'invoice_number',
      balanceBefore:  'balance_before',
      balanceAfter:   'balance_after',
      // [إصلاح] حقل جديد لمنع المرتجع المتكرر
      isReturned:     'is_returned',
      returnsTotal:   'returns_total',
      oldDebt:        'old_debt',
      legacyId:       'legacy_id',
      // invoice_payments
      paymentMethod:  'payment_method',
      paidAt:         'paid_at',
      createdBy:      'created_by',
      // audit_log
      entityType:     'entity_type',
      entityId:       'entity_id',
      oldValue:       'old_value',
      newValue:       'new_value',
    };
    const out = {};
    for (const k of Object.keys(d)) {
      if (localOnlyFields.has(k)) continue;
      const nk = map[k] || k;
      let v = d[k];
      if (Array.isArray(v)) {
        v = JSON.stringify(v);
      } else if (typeof v === 'object' && v !== null) {
        v = JSON.stringify(v);
      }
      out[nk] = v;
    }
    return out;
  }

  function toCamel(d) {
    const map = {
      min_stock:      'minStock',
      created_at:     'createdAt',
      updated_at:     'updatedAt',
      shop_id:        'shopId',
      shop_name:      'shopName',
      is_return:      'isReturn',
      return_of:      'returnOf',
      tax_pct:        'taxPct',
      amount_paid:    'amountPaid',
      product_id:     'productId',
      product_name:   'productName',
      invoice_id:     'invoiceId',
      invoice_number: 'invoiceNumber',
      balance_before: 'balanceBefore',
      balance_after:  'balanceAfter',
      returns_total:  'returnsTotal',
      old_debt:       'oldDebt',
      legacy_id:      'legacyId',
      is_returned:    'isReturned',
      payment_method: 'paymentMethod',
      paid_at:        'paidAt',
      created_by:     'createdBy',
      entity_type:    'entityType',
      entity_id:      'entityId',
      old_value:      'oldValue',
      new_value:      'newValue',
    };
    // حقول رقمية — Supabase REST بيرجّعها كـ strings، نحوّلها لـ number هنا مرة واحدة
    const numericFields = new Set([
      'balance','oldDebt','returnsTotal','total','subtotal','discount','tax','taxPct',
      'amountPaid','price','cost','quantity','minStock','amount',
      'balanceBefore','balanceAfter',
    ]);
    const out = {};
    for (const k of Object.keys(d)) {
      const camel = map[k] || k;
      const val   = d[k];
      out[camel]  = (numericFields.has(camel) && val !== null && val !== undefined && val !== '')
                    ? (parseFloat(val) || 0)
                    : val;
    }
    return out;
  }

  async function getAll(table) {
    const rows = await req('GET', table, null, '?order=id.asc');
    return rows.map(toCamel);
  }

  async function getAllParsed(table) {
    const rows = await getAll(table);
    return rows.map(r => {
      if (r.items && typeof r.items === 'string') {
        try { r.items = JSON.parse(r.items); } catch(e) {}
      }
      return r;
    });
  }

  async function get(table, id) {
    try {
      const rows = await serverReq('GET', table, null, `?id=eq.${id}&limit=1`);
      return rows.length ? toCamel(rows[0]) : null;
    } catch (err) {
      if (isOfflineError(err)) {
        return getCachedTable(table).find(r => String(r.id) === String(id)) || null;
      }
      throw err;
    }
  }

  async function add(table, data) {
    if (table === 'products' && !isOnline()) {
      return enqueueProductUpsert(data)?.id;
    }
    if (table === 'shops' && !isOnline()) {
      return enqueueShopUpsert(data)?.id;
    }
    if (table === 'expenses' && !isOnline()) {
      const row = enqueueExpenseCreate({
        ...data,
        date: data.date || new Date().toISOString().slice(0, 10),
        createdAt: data.createdAt || Utils.localNow(),
      });
      return row.id;
    }
    const now = Utils.localNow();
    const d = toSnake({ ...data });
    delete d.id;
    d.created_at = now;
    d.updated_at = now;
    try {
      const rows = await req('POST', table, d);
      return rows[0]?.id;
    } catch (err) {
      if (table === 'products' && isOfflineError(err)) {
        return enqueueProductUpsert(data)?.id;
      }
      if (table === 'shops' && isOfflineError(err)) {
        return enqueueShopUpsert(data)?.id;
      }
      if (table === 'expenses' && isOfflineError(err)) {
        const row = enqueueExpenseCreate({
          ...data,
          date: data.date || now.slice(0, 10),
          createdAt: data.createdAt || now,
        });
        return row.id;
      }
      throw err;
    }
  }

  async function put(table, data) {
    if ((table === 'products' || table === 'shops') && !isOnline()) {
      const cached = getCachedTable(table).find(row => String(row.id) === String(data.id)) || null;
      const row = table === 'products'
        ? enqueueProductUpsert(data, cached)
        : enqueueShopUpsert(data, cached);
      return row?.id || data.id;
    }
    const now = Utils.localNow();
    const d = toSnake({ ...data });
    const id = data.id; delete d.id;
    d.updated_at = now;
    try {
      await req('PATCH', table, d, `?id=eq.${id}`);
      return id;
    } catch (err) {
      if ((table === 'products' || table === 'shops') && isOfflineError(err)) {
        const cached = getCachedTable(table).find(row => String(row.id) === String(data.id)) || null;
        const row = table === 'products'
          ? enqueueProductUpsert(data, cached)
          : enqueueShopUpsert(data, cached);
        return row?.id || data.id;
      }
      throw err;
    }
  }

  async function remove(table, id) {
    if (table === 'products' && !isOnline()) {
      const product = getCachedTable('products').find(row => String(row.id) === String(id));
      return enqueueProductDelete(product || { id });
    }
    if (table === 'shops' && !isOnline()) {
      const shop = getCachedTable('shops').find(row => String(row.id) === String(id));
      return enqueueShopDelete(shop || { id });
    }
    if (table === 'expenses' && !isOnline()) {
      const expense = getCachedTable('expenses').find(row => String(row.id) === String(id));
      return enqueueExpenseDelete(expense || { id });
    }
    try {
      await req('DELETE', table, null, `?id=eq.${id}`);
      return true;
    } catch (err) {
      if (table === 'products' && isOfflineError(err)) {
        const product = getCachedTable('products').find(row => String(row.id) === String(id));
        return enqueueProductDelete(product || { id });
      }
      if (table === 'shops' && isOfflineError(err)) {
        const shop = getCachedTable('shops').find(row => String(row.id) === String(id));
        return enqueueShopDelete(shop || { id });
      }
      if (table === 'expenses' && isOfflineError(err)) {
        const expense = getCachedTable('expenses').find(row => String(row.id) === String(id));
        return enqueueExpenseDelete(expense || { id });
      }
      throw err;
    }
  }

  async function addStockMovement(data) {
    const now = Utils.localNow();
    const d = toSnake({ ...data, createdAt: now });
    delete d.updated_at;
    await req('POST', 'stock_movements', d);
  }

  async function getMovements(productId) {
    const param = productId
      ? `?product_id=eq.${productId}&order=id.desc`
      : '?order=id.desc';
    const rows = await req('GET', 'stock_movements', null, param);
    return rows.map(toCamel);
  }

  async function addPayment(data) {
    const now = Utils.localNow();
    const d = toSnake({ ...data, createdAt: now });
    delete d.updated_at;
    await req('POST', 'payments', d);
  }

  async function getPayments(shopId) {
    const rows = await req('GET', 'payments', null, `?shop_id=eq.${shopId}&order=id.desc`);
    return rows.map(toCamel);
  }

  // ── invoice_payments: دفعات مرتبطة بالفاتورة مباشرة ──

  async function addInvoicePayment(data) {
    // data: { invoiceId, shopId?, amount, paymentMethod, paidAt?, note, createdBy? }
    const now = Utils.localNow();
    const d = toSnake({ ...data, createdAt: now });
    delete d.updated_at;
    const rows = await req('POST', 'invoice_payments', d);
    await syncInvoicePaymentState(data.invoiceId).catch(() => {});
    if (data.shopId) {
      const shop = await get('shops', data.shopId).catch(() => null);
      if (shop) {
        const newBalance = await computeShopBalance(shop.id).catch(() => null);
        if (newBalance !== null && Math.abs((parseFloat(shop.balance) || 0) - newBalance) > 0.009) {
          await put('shops', { ...shop, balance: newBalance }).catch(() => {});
        }
      }
    }
    return rows[0]?.id;
  }

  async function getInvoicePayments(invoiceId) {
    const rows = await req('GET', 'invoice_payments', null,
      `?invoice_id=eq.${invoiceId}&order=paid_at.asc`);
    return rows.map(toCamel);
  }

  async function getShopInvoicePayments(shopId) {
    const rows = await req('GET', 'invoice_payments', null,
      `?shop_id=eq.${shopId}&order=paid_at.desc`);
    return rows.map(toCamel);
  }

  async function getInvoicePaymentsByDateRange(from, to) {
    // from/to: ISO date strings YYYY-MM-DD
    const rows = await req('GET', 'invoice_payments', null,
      `?paid_at=gte.${from}T00:00:00&paid_at=lte.${to}T23:59:59&order=paid_at.desc`);
    return rows.map(toCamel);
  }

  // مجموع الدفعات الحقيقية لفاتورة
  async function getInvoiceAmountPaid(invoiceId) {
    const payments = await getInvoicePayments(invoiceId);
    return payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  }

  function deriveInvoiceStatus(totalPaid, total, currentStatus = '') {
    if (currentStatus === 'void' || currentStatus === 'return') return currentStatus;
    const paid = parseFloat(totalPaid) || 0;
    const totalAmount = parseFloat(total) || 0;
    if (paid <= 0.009) return 'pending';
    if (paid >= totalAmount - 0.01) return 'paid';
    return 'partial';
  }

  async function syncInvoicePaymentState(invoiceId) {
    const invoice = await get('invoices', invoiceId);
    if (!invoice || invoice.isReturn || invoice.status === 'void') return null;

    const totalPaid = parseFloat((await getInvoiceAmountPaid(invoiceId)).toFixed(2));
    const cappedPaid = Math.min(totalPaid, parseFloat(invoice.total) || 0);
    const nextStatus = deriveInvoiceStatus(cappedPaid, invoice.total, invoice.status);

    if (
      Math.abs((parseFloat(invoice.amountPaid) || 0) - cappedPaid) > 0.009 ||
      String(invoice.status || '') !== String(nextStatus || '')
    ) {
      await put('invoices', {
        ...invoice,
        amountPaid: cappedPaid,
        status: nextStatus,
      });
    }

    return { amountPaid: cappedPaid, status: nextStatus };
  }

  function computeCachedShopBalance(shopId) {
    const invoices = getCachedTable('invoices');
    const payments = getCachedTable('invoice_payments');
    const totalInvoiced = invoices
      .filter(inv =>
        String(inv.shopId || '') === String(shopId) &&
        !inv.isReturn &&
        inv.status !== 'void' &&
        inv.status !== 'draft'
      )
      .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
    const totalPaid = payments
      .filter(payment => String(payment.shopId || '') === String(shopId))
      .reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    const totalReturns = invoices
      .filter(inv =>
        String(inv.shopId || '') === String(shopId) &&
        !!inv.isReturn &&
        inv.status !== 'void'
      )
      .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
    return parseFloat((totalInvoiced - totalPaid - totalReturns).toFixed(2));
  }

  // ── audit_log: سجل التدقيق ──

  async function addAuditLog(data) {
    // data: { entityType, entityId, action, oldValue?, newValue?, note?, createdBy? }
    const now = Utils.localNow();
    const d = toSnake({ ...data, createdAt: now });
    delete d.updated_at;
    await req('POST', 'audit_log', d).catch(e => console.warn('audit_log failed:', e));
  }

  // ── helper: حساب رصيد العميل من مصدر واحد ──
  async function computeShopBalance(shopId) {
    const invoiceRows = await req('GET', 'invoices', null,
      `?shop_id=eq.${shopId}&is_return=eq.0&status=not.in.(void,draft)&select=total`);
    const totalInvoiced = invoiceRows.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

    const payRows = await getShopInvoicePayments(shopId);
    const totalPaid = payRows.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

    const retRows = await req('GET', 'invoices', null,
      `?shop_id=eq.${shopId}&is_return=eq.1&status=not.eq.void&select=total`);
    const totalReturns = retRows.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

    return parseFloat((totalInvoiced - totalPaid - totalReturns).toFixed(2));
  }

  async function ping() {
    if (!hasRemoteConfig()) return false;
    if (!isOnline()) return false;
    try {
      await fetchWithTimeout(
        `${getSupabaseRuntimeConfig().url}/rest/v1/products?select=id&limit=1`,
        { method: 'GET', headers: h() },
        2500
      );
      return true;
    }
    catch(e) { return false; }
  }

  async function primeOfflineCache() {
    if (!hasRemoteConfig()) return { ok: false, reason: 'no_remote' };
    if (!isOnline()) return { ok: false, reason: 'offline' };
    await Promise.allSettled(CACHEABLE_TABLES.map((table) => req('GET', table, null, '?order=id.asc')));
    return { ok: true };
  }

  // ── [6] callRpc — استدعاء Supabase RPC في transaction واحدة ──
  // كل العمليات الحساسة (حفظ فاتورة / تسديد / إلغاء) تمر من هنا
  async function callRpc(fnName, params) {
    if (!hasRemoteConfig())
      throw new Error('لم يتم إعداد Supabase — راجع ملف SETUP.md');

    const url  = `${getSupabaseRuntimeConfig().url}/rest/v1/rpc/${fnName}`;
    const runtimeCfg = getSupabaseRuntimeConfig();
    const opts = {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        runtimeCfg.anonKey,
        'Authorization': 'Bearer ' + runtimeCfg.anonKey,
        'Prefer':        'return=representation',
      },
      body: JSON.stringify(params),
    };

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
      try {
        const res = await fetchWithTimeout(url, opts, 6000);
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error(`HTTP ${res.status} — خادم مشغول`);
          continue;
        }
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.message || e.hint || e.details || `HTTP ${res.status}`);
        }
        const txt = await res.text();
        return txt ? JSON.parse(txt) : {};
      } catch(err) {
        if (err.message && !err.message.includes('مشغول')) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // [إصلاح] إعدادات المتجر من localStorage بدل hardcoded
  function getStoreSettings() {
    const cached = localStorage.getItem('nadir_store_settings');
    const defaults = {
      name: 'الحبيب للتجارة والتوزيع',
      address: '',
      phone: '',
      footer: '',
    };
    if (cached) {
      try {
        const parsed = JSON.parse(cached) || {};
        const rawName = String(parsed.name || '').trim();
        return {
          ...defaults,
          ...parsed,
          name: !rawName || /^(mm|mh)\b/i.test(rawName) || rawName === 'نظام المبيعات'
            ? defaults.name
            : rawName,
        };
      } catch(e) {}
    }
    return defaults;
  }

  function saveStoreSettings(settings) {
    const rawName = String(settings?.name || '').trim();
    localStorage.setItem('nadir_store_settings', JSON.stringify({
      name: rawName || 'الحبيب للتجارة والتوزيع',
      address: String(settings?.address || '').trim(),
      phone: String(settings?.phone || '').trim(),
      footer: String(settings?.footer || '').trim(),
    }));
  }

  async function getAppSetting(key, fallback = null) {
    try {
      const rows = await req('GET', 'app_settings', null, `?key=eq.${encodeURIComponent(key)}&limit=1`);
      const row = rows.map(toCamel)[0];
      return row ? row.value : fallback;
    } catch (err) {
      if (isOfflineError(err)) {
        const row = getCachedTable('app_settings').find(item => item.key === key);
        return row ? row.value : fallback;
      }
      throw err;
    }
  }

  async function saveAppSetting(key, value) {
    if (!isOnline()) {
      enqueueAppSetting(key, value);
      return true;
    }
    const rows = await req('GET', 'app_settings', null, `?key=eq.${encodeURIComponent(key)}&limit=1`);
    const existing = rows.map(toCamel)[0];
    if (existing?.id) {
      await put('app_settings', { ...existing, value });
    } else {
      await add('app_settings', { key, value });
    }
    return true;
  }

  async function rawAdd(table, data) {
    const now = Utils.localNow();
    const d = toSnake({ ...data });
    delete d.id;
    d.created_at = now;
    d.updated_at = now;
    const rows = await serverReq('POST', table, d);
    return rows[0]?.id;
  }

  async function rawPut(table, data) {
    const now = Utils.localNow();
    const d = toSnake({ ...data });
    const id = data.id; delete d.id;
    d.updated_at = now;
    await serverReq('PATCH', table, d, `?id=eq.${id}`);
    return id;
  }

  async function rawUpsert(table, data) {
    const id = data?.id;
    if (id === undefined || id === null || id === '') {
      return rawAdd(table, data);
    }

    const rows = await serverReq('GET', table, null, `?id=eq.${id}&select=id&limit=1`);
    if (Array.isArray(rows) && rows.length > 0) {
      return rawPut(table, data);
    }

    const now = Utils.localNow();
    const d = toSnake({ ...data });
    d.created_at = d.created_at || now;
    d.updated_at = d.updated_at || now;
    const inserted = await serverReq('POST', table, d);
    return inserted[0]?.id || id;
  }

  async function reverseStockSnapshot(inv, reason) {
    const items = Utils.normalizeInvoiceItems(inv.items);
    for (const item of items) {
      const prod = await get('products', resolveTempId('product', item.productId));
      if (!prod) continue;
      const b = parseInt(prod.quantity || 0, 10);
      const a = b + (parseInt(item.qty, 10) || 0);
      await rawPut('products', { ...prod, id: prod.id, quantity: a });
      await addStockMovement({
        productId: prod.id,
        productName: item.name,
        type: 'in',
        qty: item.qty,
        reason: `${reason} - ${inv.number}`,
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        balanceBefore: b,
        balanceAfter: a,
      });
    }
  }

  async function deductStockSnapshot(inv, reason) {
    const items = Utils.normalizeInvoiceItems(inv.items);
    for (const item of items) {
      const prod = await get('products', resolveTempId('product', item.productId));
      if (!prod) continue;
      const b = parseInt(prod.quantity || 0, 10);
      const a = Math.max(0, b - (parseInt(item.qty, 10) || 0));
      await rawPut('products', { ...prod, id: prod.id, quantity: a });
      await addStockMovement({
        productId: prod.id,
        productName: item.name,
        type: 'out',
        qty: item.qty,
        reason: `${reason} - ${inv.number}`,
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        balanceBefore: b,
        balanceAfter: a,
      });
    }
  }

  async function processInvoiceDeleteOnline(invoiceId, reason = '') {
    const inv = await get('invoices', invoiceId);
    if (!inv) return;

    if (!inv.isReturn && inv.status !== 'void') {
      await reverseStockSnapshot(inv, reason || 'حذف فاتورة');
    }

    if (inv.isReturn) {
      const items = Utils.normalizeInvoiceItems(inv.items);
      for (const item of items) {
        const prod = await get('products', resolveTempId('product', item.productId));
        if (!prod) continue;
        const before = parseInt(prod.quantity || 0, 10);
        const after = Math.max(0, before - (parseInt(item.qty, 10) || 0));
        await rawPut('products', { ...prod, id: prod.id, quantity: after });
        await addStockMovement({
          productId: prod.id,
          productName: item.name,
          type: 'out',
          qty: item.qty,
          reason: `${reason || 'حذف مرتجع'} - ${inv.number}`,
          invoiceId,
          invoiceNumber: inv.number,
          balanceBefore: before,
          balanceAfter: after,
        });
      }
      if (inv.returnOf) {
        const origInv = await get('invoices', resolveTempId('invoice', inv.returnOf));
        if (origInv) await rawPut('invoices', { ...origInv, isReturned: 0 });
      }
    }

    await serverReq('DELETE', 'invoices', null, `?id=eq.${invoiceId}`);

    if (inv.shopId) {
      const shop = await get('shops', resolveTempId('shop', inv.shopId));
      if (shop) {
        const newBalance = await computeShopBalance(shop.id);
        let newReturns = parseFloat(shop.returnsTotal) || 0;
        if (inv.isReturn) newReturns = Math.max(0, newReturns - (parseFloat(inv.total) || 0));
        await rawPut('shops', { ...shop, balance: newBalance, returnsTotal: newReturns });
      }
    }
  }

  function replaceMappedIds(value, type) {
    if (Array.isArray(value)) return value.map(v => replaceMappedIds(v, type));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = replaceMappedIds(v, type);
      return out;
    }
    if (typeof value === 'number' && value < 0) return resolveTempId(type, value);
    return value;
  }

  async function processQueueItem(item) {
    if (item.type === 'product_upsert') {
      const data = { ...item.payload.data };
      const oldQuantity = parseInt(item.payload.oldQuantity || 0, 10) || 0;
      if (item.payload.isNew) {
        const newId = await rawAdd('products', data);
        if (data.quantity > 0) {
          await addStockMovement({
            productId: newId,
            productName: data.name,
            type: 'in',
            qty: data.quantity,
            reason: 'رصيد أولي',
            invoiceId: null,
            invoiceNumber: null,
            balanceBefore: 0,
            balanceAfter: data.quantity,
          });
        }
        setTempMapping('product', item.payload.tempId, newId);
        removeCachedRow('products', item.payload.tempId);
      } else {
        const realId = resolveTempId('product', data.id);
        await rawPut('products', { ...data, id: realId });
        if (oldQuantity !== data.quantity) {
          const diff = data.quantity - oldQuantity;
          await addStockMovement({
            productId: realId,
            productName: data.name,
            type: diff > 0 ? 'in' : 'out',
            qty: Math.abs(diff),
            reason: 'تعديل يدوي',
            invoiceId: null,
            invoiceNumber: null,
            balanceBefore: oldQuantity,
            balanceAfter: data.quantity,
          });
        }
      }
      return;
    }

    if (item.type === 'shop_upsert') {
      const data = { ...item.payload.data };
      if (item.payload.isNew) {
        const newId = await rawAdd('shops', data);
        setTempMapping('shop', item.payload.tempId, newId);
        removeCachedRow('shops', item.payload.tempId);
      } else {
        const realId = resolveTempId('shop', data.id);
        await rawPut('shops', { ...data, id: realId });
      }
      return;
    }

    if (item.type === 'product_delete') {
      const realId = resolveTempId('product', item.payload.id);
      try {
        await req('PATCH', 'stock_movements', {
          product_id: null,
          product_name: item.payload.name || '',
        }, `?product_id=eq.${realId}`);
      } catch (_) {}
      await remove('products', realId);
      return;
    }

    if (item.type === 'shop_delete') {
      const realId = resolveTempId('shop', item.payload.id);
      await remove('shops', realId);
      return;
    }

    if (item.type === 'expense_create') {
      const data = { ...item.payload.data };
      const newId = await rawAdd('expenses', data);
      setTempMapping('expense', item.payload.tempId, newId);
      removeCachedRow('expenses', item.payload.tempId);
      return;
    }

    if (item.type === 'expense_delete') {
      const realId = resolveTempId('expense', item.payload.id);
      await remove('expenses', realId);
      return;
    }

    if (item.type === 'invoice_delete') {
      const invoiceId = resolveTempId('invoice', item.payload.id);
      await processInvoiceDeleteOnline(invoiceId, item.payload.reason || 'حذف فاتورة');
      return;
    }

    if (item.type === 'invoice_create' || item.type === 'invoice_edit') {
      const payload = JSON.parse(JSON.stringify(item.payload.rpcPayload));
      if (payload.shopId) payload.shopId = String(resolveTempId('shop', parseInt(payload.shopId, 10) || payload.shopId));
      payload.items = (payload.items || []).map(it => ({
        ...it,
        productId: resolveTempId('product', it.productId),
      }));
      if (item.type === 'invoice_edit' && payload.editId) {
        payload.editId = String(payload.editId);
      }
      await callRpc(payload.editId ? 'save_invoice_atomic' : 'save_invoice_atomic', payload);
      if (item.payload.localId) removeCachedRow('invoices', item.payload.localId);
      return;
    }

    if (item.type === 'shop_collect_payment') {
      const shopId = resolveTempId('shop', item.payload.shopId);
      await callRpc('collect_payment_atomic', {
        shopId,
        amount: item.payload.amount,
        paymentMethod: item.payload.paymentMethod || 'cash',
        note: item.payload.note || 'تحصيل أوفلاين',
      });
      return;
    }

    if (item.type === 'invoice_add_payment') {
      const invoiceId = resolveTempId('invoice', item.payload.invoiceId);
      const shopId = item.payload.shopId ? resolveTempId('shop', item.payload.shopId) : null;
      const invoice = await get('invoices', invoiceId);
      if (!invoice || invoice.isReturn || invoice.status === 'void') return;
      const currentPaid = await getInvoiceAmountPaid(invoiceId).catch(() => parseFloat(invoice.amountPaid) || 0);
      const remaining = Math.max(0, (parseFloat(invoice.total) || 0) - (parseFloat(currentPaid) || 0));
      const amountToApply = parseFloat(Math.min(parseFloat(item.payload.amount) || 0, remaining).toFixed(2));
      if (amountToApply <= 0.009) return;
      await addInvoicePayment({
        invoiceId,
        shopId,
        amount: amountToApply,
        paymentMethod: item.payload.paymentMethod || 'cash',
        paidAt: item.payload.paidAt || Utils.localNow(),
        note: item.payload.note || '',
      });
      return;
    }

    if (item.type === 'invoice_status_change') {
      const invoiceId = resolveTempId('invoice', item.payload.invoiceId);
      const inv = await get('invoices', invoiceId);
      if (!inv) return;
      const updatedInv = { ...inv, status: item.payload.newStatus };
      await rawPut('invoices', updatedInv);
      if (item.payload.newStatus === 'void' && item.payload.oldStatus !== 'void' && !inv.isReturn) {
        await reverseStockSnapshot(inv, 'إلغاء فاتورة');
      }
      if (item.payload.oldStatus === 'void' && item.payload.newStatus === 'pending' && !inv.isReturn) {
        await deductStockSnapshot(inv, 'استعادة فاتورة');
      }
      if (inv.shopId) {
        const shop = await get('shops', resolveTempId('shop', inv.shopId));
        if (shop) {
          const newBalance = await computeShopBalance(shop.id);
          await rawPut('shops', { ...shop, balance: newBalance });
        }
      }
      return;
    }

    if (item.type === 'invoice_return_create') {
      const invoiceId = resolveTempId('invoice', item.payload.invoiceId);
      const inv = await get('invoices', invoiceId);
      if (!inv) return;
      const retId = await rawAdd('invoices', {
        number: item.payload.returnNumber,
        shopId: inv.shopId,
        shopName: inv.shopName,
        items: inv.items,
        subtotal: inv.subtotal,
        discount: inv.discount,
        tax: inv.tax,
        taxPct: inv.taxPct,
        total: inv.total,
        amountPaid: 0,
        note: `مرتجع للفاتورة ${inv.number}`,
        status: 'return',
        isReturn: 1,
        returnOf: inv.id,
        isReturned: 0,
      });
      await rawPut('invoices', { ...inv, isReturned: 1 });
      await reverseStockSnapshot(inv, 'مرتجع');
      if (inv.shopId) {
        const shop = await get('shops', resolveTempId('shop', inv.shopId));
        if (shop) {
          const newBalance = await computeShopBalance(shop.id);
          await rawPut('shops', {
            ...shop,
            balance: newBalance,
            returnsTotal: (parseFloat(shop.returnsTotal) || 0) + (parseFloat(inv.total) || 0),
          });
        }
      }
      setTempMapping('invoice', item.payload.localReturnId, retId);
      return;
    }

    if (item.type === 'app_setting_upsert') {
      const payload = item.payload || {};
      const rows = await serverReq('GET', 'app_settings', null, `?key=eq.${encodeURIComponent(payload.key)}&limit=1`);
      if (rows.length > 0) {
        await serverReq('PATCH', 'app_settings', { value: payload.value, updated_at: Utils.localNow() }, `?id=eq.${rows[0].id}`);
      } else {
        await rawAdd('app_settings', { key: payload.key, value: payload.value });
      }
      if (payload.localId) removeCachedRow('app_settings', payload.localId);
      return;
    }
  }

  async function refreshCachedTables(tables = []) {
    for (const table of tables) {
      try { await getAll(table); } catch (_) {}
    }
  }

  async function flushPendingQueue() {
    if (!isOnline()) return { ok: false, reason: 'offline' };
    if (_flushPromise) return _flushPromise;

    _flushPromise = (async () => {
      const queue = [...getQueue()];
      for (const item of queue) {
        await processQueueItem(item);
        shiftQueueItem(item.id);
      }
      await refreshCachedTables(['products', 'shops', 'invoices', 'invoice_payments', 'expenses', 'app_settings']);
      return { ok: true };
    })().finally(() => {
      _flushPromise = null;
    });

    return _flushPromise;
  }

  function enqueueProductUpsert(data, oldRecord = null) {
    const isNew = !oldRecord || !oldRecord.id;
    const tempId = isNew ? nextTempId('products') : null;
    const row = {
      ...(oldRecord || {}),
      ...data,
      id: isNew ? tempId : oldRecord.id,
      pendingSync: 1,
      updatedAt: Utils.localNow(),
      createdAt: oldRecord?.createdAt || Utils.localNow(),
    };
    upsertCachedRow('products', row);
    enqueue({
      type: 'product_upsert',
      payload: {
        isNew,
        tempId,
        oldQuantity: oldRecord?.quantity || 0,
        data: row,
      },
    });
    return row;
  }

  function enqueueProductDelete(product) {
    if (!product?.id) return false;
    removeCachedRow('products', product.id);
    if ((parseInt(product.id, 10) || 0) < 0) {
      const queue = getQueue();
      const nextQueue = queue.filter((item) => !(
        item.type === 'product_upsert' &&
        item.payload?.isNew &&
        String(item.payload?.tempId) === String(product.id)
      ));
      if (nextQueue.length !== queue.length) {
        setQueue(nextQueue);
        setTimeout(() => { if (typeof StatusUI !== 'undefined') StatusUI.update(); }, 0);
        return true;
      }
    }
    enqueue({
      type: 'product_delete',
      payload: {
        id: product.id,
        name: product.name || '',
      },
    });
    return true;
  }

  function enqueueShopUpsert(data, oldRecord = null) {
    const isNew = !oldRecord || !oldRecord.id;
    const tempId = isNew ? nextTempId('shops') : null;
    const row = {
      balance: 0,
      returnsTotal: 0,
      ...(oldRecord || {}),
      ...data,
      id: isNew ? tempId : oldRecord.id,
      pendingSync: 1,
      updatedAt: Utils.localNow(),
      createdAt: oldRecord?.createdAt || Utils.localNow(),
    };
    upsertCachedRow('shops', row);
    enqueue({
      type: 'shop_upsert',
      payload: { isNew, tempId, data: row },
    });
    return row;
  }

  function enqueueShopDelete(shop) {
    if (!shop?.id) return false;
    removeCachedRow('shops', shop.id);
    if ((parseInt(shop.id, 10) || 0) < 0) {
      const queue = getQueue();
      const nextQueue = queue.filter((item) => !(
        item.type === 'shop_upsert' &&
        item.payload?.isNew &&
        String(item.payload?.tempId) === String(shop.id)
      ));
      if (nextQueue.length !== queue.length) {
        setQueue(nextQueue);
        setTimeout(() => { if (typeof StatusUI !== 'undefined') StatusUI.update(); }, 0);
        return true;
      }
    }
    enqueue({
      type: 'shop_delete',
      payload: { id: shop.id },
    });
    return true;
  }

  function enqueueExpenseCreate(data) {
    const tempId = nextTempId('expenses');
    const row = {
      ...data,
      id: tempId,
      amount: parseFloat(data.amount || 0),
      pendingSync: 1,
      createdAt: data.createdAt || Utils.localNow(),
      updatedAt: Utils.localNow(),
    };
    upsertCachedRow('expenses', row);
    enqueue({
      type: 'expense_create',
      payload: { tempId, data: row },
    });
    return row;
  }

  function dropQueuedExpenseCreate(expenseId) {
    const queue = getQueue();
    const nextQueue = queue.filter((item) => !(
      item.type === 'expense_create' &&
      String(item.payload?.tempId) === String(expenseId)
    ));
    if (nextQueue.length === queue.length) return false;
    setQueue(nextQueue);
    setTimeout(() => { if (typeof StatusUI !== 'undefined') StatusUI.update(); }, 0);
    return true;
  }

  function enqueueExpenseDelete(expense) {
    if (!expense?.id) return false;
    removeCachedRow('expenses', expense.id);
    if ((parseInt(expense.id, 10) || 0) < 0) {
      return dropQueuedExpenseCreate(expense.id);
    }
    enqueue({
      type: 'expense_delete',
      payload: { id: expense.id },
    });
    return true;
  }

  function enqueueInvoiceDelete(invoice) {
    if (!invoice?.id) return false;
    removeCachedRow('invoices', invoice.id);
    setCachedTable(
      'invoice_payments',
      getCachedTable('invoice_payments').filter(payment => String(payment.invoiceId) !== String(invoice.id))
    );

    if ((parseInt(invoice.id, 10) || 0) < 0) {
      const queue = getQueue();
      const nextQueue = queue.filter((item) => {
        if (item.type === 'invoice_create' && String(item.payload?.localId) === String(invoice.id)) return false;
        if (item.type === 'invoice_edit' && String(item.payload?.localId) === String(invoice.id)) return false;
        if (item.type === 'invoice_add_payment' && String(item.payload?.invoiceId) === String(invoice.id)) return false;
        if (item.type === 'invoice_status_change' && String(item.payload?.invoiceId) === String(invoice.id)) return false;
        if (item.type === 'invoice_return_create' && String(item.payload?.invoiceId) === String(invoice.id)) return false;
        return true;
      });
      setQueue(nextQueue);
      setTimeout(() => { if (typeof StatusUI !== 'undefined') StatusUI.update(); }, 0);
      return true;
    }

    if (!invoice.isReturn && invoice.status !== 'void') {
      Utils.normalizeInvoiceItems(invoice.items).forEach((item) => {
        const product = getCachedTable('products').find(row => String(row.id) === String(item.productId));
        if (!product) return;
        upsertCachedRow('products', {
          ...product,
          quantity: (parseFloat(product.quantity) || 0) + (parseFloat(item.qty) || 0),
          pendingSync: 1,
          updatedAt: Utils.localNow(),
        });
      });
    }

    if (invoice.isReturn) {
      Utils.normalizeInvoiceItems(invoice.items).forEach((item) => {
        const product = getCachedTable('products').find(row => String(row.id) === String(item.productId));
        if (!product) return;
        upsertCachedRow('products', {
          ...product,
          quantity: Math.max(0, (parseFloat(product.quantity) || 0) - (parseFloat(item.qty) || 0)),
          pendingSync: 1,
          updatedAt: Utils.localNow(),
        });
      });
      if (invoice.returnOf) {
        const original = getCachedTable('invoices').find(row => String(row.id) === String(invoice.returnOf));
        if (original) {
          upsertCachedRow('invoices', {
            ...original,
            isReturned: 0,
            pendingSync: 1,
            updatedAt: Utils.localNow(),
          });
        }
      }
    }

    if (invoice.shopId) {
      const shop = getCachedTable('shops').find(row => String(row.id) === String(invoice.shopId));
      if (shop) {
        const newBalance = computeCachedShopBalance(invoice.shopId);
        const returnInvoicesTotal = getCachedTable('invoices')
          .filter(inv =>
            String(inv.shopId || '') === String(invoice.shopId) &&
            !!inv.isReturn &&
            inv.status !== 'void'
          )
          .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
        upsertCachedRow('shops', {
          ...shop,
          balance: newBalance,
          returnsTotal: returnInvoicesTotal,
          pendingSync: 1,
          updatedAt: Utils.localNow(),
        });
      }
    }

    enqueue({
      type: 'invoice_delete',
      payload: {
        id: invoice.id,
        reason: `حذف الفاتورة ${invoice.number || invoice.id}`,
      },
    });
    return true;
  }

  function enqueueInvoiceCreate(rpcPayload, previewInvoice) {
    const localId = nextTempId('invoices');
    const row = {
      ...previewInvoice,
      id: localId,
      pendingSync: 1,
      createdAt: previewInvoice.createdAt || Utils.localNow(),
      updatedAt: Utils.localNow(),
    };
    upsertCachedRow('invoices', row);
    enqueue({
      type: 'invoice_create',
      payload: { rpcPayload, localId },
    });
    return row;
  }

  function enqueueInvoiceEdit(rpcPayload, previewInvoice) {
    const row = {
      ...previewInvoice,
      pendingSync: 1,
      updatedAt: Utils.localNow(),
    };
    upsertCachedRow('invoices', row);
    enqueue({
      type: 'invoice_edit',
      payload: { rpcPayload, localId: previewInvoice.id },
    });
    return row;
  }

  function cachePendingInvoicePayment(payload) {
    const localPaymentId = nextTempId('invoice_payments');
    upsertCachedRow('invoice_payments', {
      id: localPaymentId,
      invoiceId: payload.invoiceId,
      shopId: payload.shopId || null,
      amount: parseFloat(payload.amount || 0),
      paymentMethod: payload.paymentMethod || 'cash',
      paidAt: payload.paidAt || Utils.localNow(),
      note: payload.note || '',
      pendingSync: 1,
      createdAt: Utils.localNow(),
      updatedAt: Utils.localNow(),
    });
  }

  function enqueueShopCollection(shopId, amount, note = '') {
    const shop = getCachedTable('shops').find(s => String(s.id) === String(shopId));
    if (shop) {
      const newBalance = Math.max(0, (parseFloat(shop.balance) || 0) - (parseFloat(amount) || 0));
      upsertCachedRow('shops', { ...shop, balance: newBalance, pendingSync: 1, updatedAt: Utils.localNow() });
    }
    let remaining = parseFloat(amount || 0);
    const now = Utils.localNow();
    const invoices = getCachedTable('invoices')
      .filter(inv =>
        String(inv.shopId || '') === String(shopId) &&
        !inv.isReturn &&
        inv.status !== 'void' &&
        inv.status !== 'draft'
      )
      .sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));

    for (const inv of invoices) {
      if (remaining <= 0.009) break;
      const currentPaid = parseFloat(inv.amountPaid || 0);
      const invTotal = parseFloat(inv.total || 0);
      const invRemaining = Math.max(0, parseFloat((invTotal - currentPaid).toFixed(2)));
      if (invRemaining <= 0.009) continue;
      const toApply = parseFloat(Math.min(remaining, invRemaining).toFixed(2));
      cachePendingInvoicePayment({
        invoiceId: inv.id,
        shopId,
        amount: toApply,
        paymentMethod: 'cash',
        paidAt: now,
        note,
      });
      const nextPaid = parseFloat((currentPaid + toApply).toFixed(2));
      upsertCachedRow('invoices', {
        ...inv,
        amountPaid: nextPaid,
        status: deriveInvoiceStatus(nextPaid, inv.total, inv.status),
        pendingSync: 1,
        updatedAt: now,
      });
      remaining = parseFloat((remaining - toApply).toFixed(2));
    }
    enqueue({
      type: 'shop_collect_payment',
      payload: { shopId, amount: parseFloat(amount), paymentMethod: 'cash', note },
    });
  }

  function enqueueInvoicePayment(payload) {
    const inv = getCachedTable('invoices').find(i => String(i.id) === String(payload.invoiceId));
    cachePendingInvoicePayment(payload);
    if (inv) {
      const nextPaid = parseFloat((parseFloat(inv.amountPaid || 0) + parseFloat(payload.amount || 0)).toFixed(2));
      const cappedPaid = Math.min(nextPaid, parseFloat(inv.total) || 0);
      upsertCachedRow('invoices', {
        ...inv,
        amountPaid: cappedPaid,
        status: deriveInvoiceStatus(cappedPaid, inv.total, inv.status),
        pendingSync: 1,
        updatedAt: Utils.localNow(),
      });
    }
    enqueue({ type: 'invoice_add_payment', payload });
  }

  function enqueueInvoiceStatusChange(payload) {
    const inv = getCachedTable('invoices').find(i => String(i.id) === String(payload.invoiceId));
    if (inv) {
      upsertCachedRow('invoices', {
        ...inv,
        status: payload.newStatus,
        pendingSync: 1,
        updatedAt: Utils.localNow(),
      });
    }
    enqueue({ type: 'invoice_status_change', payload });
  }

  function enqueueInvoiceReturn(payload) {
    const inv = getCachedTable('invoices').find(i => String(i.id) === String(payload.invoiceId));
    if (inv) {
      upsertCachedRow('invoices', { ...inv, isReturned: 1, pendingSync: 1, updatedAt: Utils.localNow() });
      const localReturnId = nextTempId('invoices');
      upsertCachedRow('invoices', {
        ...inv,
        id: localReturnId,
        number: payload.returnNumber,
        amountPaid: 0,
        status: 'return',
        isReturn: 1,
        returnOf: inv.id,
        pendingSync: 1,
        createdAt: Utils.localNow(),
        updatedAt: Utils.localNow(),
      });
      enqueue({ type: 'invoice_return_create', payload: { ...payload, localReturnId } });
      return localReturnId;
    }
    enqueue({ type: 'invoice_return_create', payload });
    return null;
  }

  return {
    getAll, getAllParsed, get, add, put, remove,
    addStockMovement, getMovements,
    addPayment, getPayments,
    addInvoicePayment, getInvoicePayments, getShopInvoicePayments,
    getInvoicePaymentsByDateRange, getInvoiceAmountPaid,
    addAuditLog,
    computeShopBalance,
    callRpc,
    isOnline,
    isBrowserOnline,
    hasRemoteConfig,
    setPreferOfflineCache: (value) => { _preferOfflineCache = !!value; },
    shouldPreferOfflineCache: () => _preferOfflineCache,
    primeOfflineCache,
    getCachedTable,
    setCachedTable,
      upsertCachedRow,
      removeCachedRow,
      enqueueProductUpsert,
      enqueueProductDelete,
      enqueueShopUpsert,
      enqueueShopDelete,
    enqueueExpenseCreate,
    enqueueExpenseDelete,
    enqueueInvoiceDelete,
    enqueueInvoiceCreate,
    enqueueInvoiceEdit,
    enqueueShopCollection,
    enqueueInvoicePayment,
    enqueueInvoiceStatusChange,
    enqueueInvoiceReturn,
    flushPendingQueue,
    getPendingQueueCount: () => getQueue().length,
    ping, req, rawAdd, rawPut, rawUpsert,
    getStoreSettings, saveStoreSettings,
    getAppSetting, saveAppSetting,
    enqueueAppSetting,
    isOfflineError,
  };
})();

// =============================================
// ROUTER
// =============================================
const Router = (() => {
  const pages   = document.querySelectorAll('.page');
  const navBtns = document.querySelectorAll('.nav-btn');
  let currentPage = 'dashboard';

  function navigate(pageId) {
    if (!AccessControl.guardPage(pageId)) {
      Toast.error('ليست لديك صلاحية لفتح هذه الصفحة');
      pageId = 'dashboard';
    }
    pages.forEach(p => p.classList.remove('active'));
    navBtns.forEach(b => b.classList.remove('active'));
    const target = document.getElementById(`page-${pageId}`);
    const navBtn = document.querySelector(`[data-page="${pageId}"]`);
    if (target) { target.classList.add('active'); currentPage = pageId; }
    if (navBtn)  navBtn.classList.add('active');
    document.dispatchEvent(new CustomEvent('pageenter', { detail: { page: pageId } }));
  }

  function getCurrent() { return currentPage; }

  function init() {
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => { if (btn.dataset.page) navigate(btn.dataset.page); });
    });
    navigate('dashboard');
  }

  return { navigate, getCurrent, init };
})();

window.Router = Router;

{
  const originalNavigate = Router.navigate;
  const originalInit = Router.init;

  Router.navigate = (pageId) => {
    if (!AccessControl.guardPage(pageId)) {
      Toast.error('ليست لديك صلاحية لفتح هذه الصفحة');
      return originalNavigate(getHomePageForRole(Session.getRole()));
    }
    return originalNavigate(pageId);
  };

  Router.init = () => {
    originalInit();
    originalNavigate(getHomePageForRole(Session.getRole()));
  };
}

// =============================================
// TOAST
// =============================================
const Toast = (() => {
  let el = null, timer = null;
  function create() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  function show(message, type = 'info', duration = 2500) {
    create();
    el.textContent = message;
    el.className = `toast ${type}`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), duration);
  }
  return {
    show,
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error', 4000),
    info:    (msg) => show(msg, 'info'),
  };
})();

// =============================================
// UTILITIES
// =============================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const DebtStore = (() => {
  const KEY = 'nadir_old_debts';

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function write(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function get(shopId) {
    if (!shopId) return 0;
    const data = read();
    return parseFloat(data[String(shopId)]) || 0;
  }

  async function persist(shopId, amount) {
    if (!shopId || typeof DB === 'undefined') return;
    try {
      const shop = await DB.get('shops', shopId);
      if (!shop) return;
      await DB.put('shops', { ...shop, oldDebt: amount });
    } catch (err) {
      console.warn('[DebtStore] persist old_debt failed:', err?.message || err);
    }
  }

  function set(shopId, amount, options = {}) {
    if (!shopId) return 0;
    const data = read();
    const normalized = Math.max(0, parseFloat((amount || 0)).toFixed(2));
    data[String(shopId)] = normalized;
    write(data);
    if (options.sync !== false) persist(shopId, normalized);
    return normalized;
  }

  function remove(shopId, options = {}) {
    const data = read();
    delete data[String(shopId)];
    write(data);
    if (options.sync !== false) persist(shopId, 0);
  }

  async function syncFromDatabase() {
    if (typeof DB === 'undefined') return;
    try {
      const shops = await DB.getAll('shops');
      const next = {};
      shops.forEach((shop) => {
        const oldDebt = Math.max(0, parseFloat(shop.oldDebt || 0));
        if (oldDebt > 0) next[String(shop.id)] = parseFloat(oldDebt.toFixed(2));
      });
      write(next);
    } catch (err) {
      console.warn('[DebtStore] syncFromDatabase failed:', err?.message || err);
    }
  }

  return { get, set, remove, syncFromDatabase };
})();

const Session = (() => {
  const KEY = 'nadir_pos_session';

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (isLegacyDemoSession(session)) {
        localStorage.removeItem(KEY);
        return null;
      }
      if (!isValidSessionRole(session.role) || !session.expiresAt || Date.now() > session.expiresAt) {
        localStorage.removeItem(KEY);
        return null;
      }
      return session;
    } catch (_) {
      return null;
    }
  }

  function write(next) {
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function getRole() {
    return read()?.role || '';
  }

  function getUserId() {
    return read()?.id || '';
  }

  function getName() {
    return read()?.name || 'المستخدم';
  }

  return { read, write, getRole, getUserId, getName };
})();

const AccessControl = (() => {
  function isRoleAllowed(rolesText) {
    if (!rolesText) return true;
    const currentRole = Session.getRole();
    const allowed = String(rolesText).split(',').map(v => v.trim()).filter(Boolean);
    return allowed.includes(currentRole);
  }

  function apply(root = document) {
    root.querySelectorAll('[data-roles]').forEach((el) => {
      const allowed = isRoleAllowed(el.dataset.roles);
      el.style.display = allowed ? '' : 'none';
      el.dataset.accessHidden = allowed ? '0' : '1';
    });
  }

  function guardPage(pageId) {
    const page = document.getElementById(`page-${pageId}`);
    if (!page) return true;
    return isRoleAllowed(page.dataset.roles);
  }

  function getRoleLabel() {
    return {
      admin: 'مدير',
      cashier: 'كاشير',
      store: 'مخزن',
    }[Session.getRole()] || 'مستخدم';
  }

  return { apply, guardPage, isRoleAllowed, getRoleLabel };
})();

AccessControl.getRoleLabel = () => ({
  admin: 'مدير',
  cashier: 'مندوب',
  store: 'مخزن',
}[Session.getRole()] || 'مستخدم');

const StatusUI = (() => {
  let timer = null;

  function update() {
    const badge = document.getElementById('sync-status-badge');
    const roleBadge = document.getElementById('user-role-badge');
    if (roleBadge) roleBadge.textContent = `${Session.getName()} • ${AccessControl.getRoleLabel()}`;
    if (!badge) return;

    const pending = DB.getPendingQueueCount();
    if (!DB.isBrowserOnline()) {
      badge.className = 'sync-badge offline';
      badge.textContent = pending > 0 ? `أوفلاين • ${pending} معلقة` : 'أوفلاين';
      return;
    }

    if (!DB.hasRemoteConfig()) {
      badge.className = 'sync-badge online';
      badge.textContent = 'متصل';
      return;
    }

    if (pending > 0) {
      badge.className = 'sync-badge syncing';
      badge.textContent = `مزامنة • ${pending}`;
      return;
    }

    badge.className = 'sync-badge online';
    badge.textContent = 'أونلاين';
  }

  function pulse(duration = 5000) {
    if (timer) clearInterval(timer);
    update();
    timer = setInterval(update, 1200);
    setTimeout(() => {
      if (timer) clearInterval(timer);
      timer = null;
      update();
    }, duration);
  }

  return { update, pulse };
})();

const Utils = {
  cairoParts(value = new Date()) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(parsed).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
  },
  localNow() {
    const d = new Date();
    const parts = this.cairoParts(d);

    const offsetPart = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      timeZoneName: 'longOffset'
    }).formatToParts(d).find((part) => part.type === 'timeZoneName')?.value || 'GMT+02:00';

    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offsetPart.replace('GMT', '')}`;
  },
  parseStoredDate(isoString) {
    if (!isoString) return null;
    const raw = String(isoString).trim();
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;

    // الفواتير القديمة اتخزنت كتوقيت محلي لكن القاعدة اعتبرتها UTC، فبنرجعها للساعة المحلية الصحيحة.
    if (/(Z|[+-]00:00)$/i.test(raw)) {
      return new Date(parsed.getTime() + (parsed.getTimezoneOffset() * 60000));
    }

    return parsed;
  },
  dateKey(value = new Date()) {
    const parsed = value instanceof Date ? value : this.parseStoredDate(value);
    if (!parsed) return '';
    const parts = this.cairoParts(parsed);
    if (!parts) return '';
    return `${parts.year}-${parts.month}-${parts.day}`;
  },
  monthKey(value = new Date()) {
    const parsed = value instanceof Date ? value : this.parseStoredDate(value);
    if (!parsed) return '';
    const parts = this.cairoParts(parsed);
    if (!parts) return '';
    return `${parts.year}-${parts.month}`;
  },
  currency(amount, symbol = 'ج.م') {
    return `${parseFloat(amount || 0).toFixed(2)} ${symbol}`;
  },
  formatDate(isoString) {
    if (!isoString) return '';
    const parsed = this.parseStoredDate(isoString);
    if (!parsed) return '';
    return parsed.toLocaleDateString('ar-EG', {
      timeZone: 'Africa/Cairo',
      hour12: false,
      year:'numeric',
      month:'short',
      day:'numeric'
    });
  },
  formatDateTime(isoString) {
    if (!isoString) return '';
    const parsed = this.parseStoredDate(isoString);
    if (!parsed) return '';
    return parsed.toLocaleString('ar-EG', {
      timeZone: 'Africa/Cairo',
      hour12: false,
      year:'numeric',
      month:'short',
      day:'numeric',
      hour:'2-digit',
      minute:'2-digit',
      second:'2-digit'
    });
  },

  // [إصلاح] رقم الفاتورة باستخدام UUID مقطوع لضمان عدم التكرار حتى مع الاستخدام المتزامن
  // الصيغة: INV-YYYYMMDD-XXXXXXXX  (X = hex عشوائي من UUID)
  async generateInvoiceNumber() {
    const d = new Date();
    const ymd  = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const uid  = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
      : String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 99)).padStart(2,'0');
    return `INV-${ymd}-${uid}`;
  },

  debounce(fn, delay = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => requestAnimationFrame(() => fn(...args)), delay); };
  },
  confirm(message) { return window.confirm(message); },
  padEnd(str, len) { str=String(str); return str.length>=len?str.substring(0,len):str+' '.repeat(len-str.length); },
  padStart(str, len) { str=String(str); return str.length>=len?str.substring(0,len):' '.repeat(len-str.length)+str; },
  normalizeInvoiceItems(items) {
    if (Array.isArray(items)) return items;
    if (!items) return [];
    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  },
  getItemCost(item) {
    return parseFloat(item?.costAtTime) || 0;
  },
  getItemProfit(item) {
    const qty = parseFloat(item?.qty) || 0;
    const price = parseFloat(item?.price) || 0;
    return parseFloat(((price - Utils.getItemCost(item)) * qty).toFixed(2));
  },
  getInvoiceProfit(invoice) {
    if (!invoice || invoice.isReturn || invoice.status === 'void') return 0;
    const items = Utils.normalizeInvoiceItems(invoice.items);
    return parseFloat(items.reduce((sum, item) => sum + Utils.getItemProfit(item), 0).toFixed(2));
  },
};

// =============================================
// APP BOOTSTRAP
// =============================================
async function initApp() {
  const loadingEl  = document.getElementById('app-loading');
  const loadingMsg = document.getElementById('loading-msg');
  async function handlePageEnter(page) {
    if (typeof OpsMeta !== 'undefined' && typeof OpsMeta.syncFromRemote === 'function') {
      await OpsMeta.syncFromRemote().catch(() => {});
    }
    switch (page) {
      case 'dashboard':   await DashboardModule.load();   break;
      case 'products':    await ProductsModule.load();    break;
      case 'shops':       await ShopsModule.load();       break;
      case 'invoices':    await InvoicesModule.load();    break;
      case 'new-invoice': await NewInvoiceModule.load();  break;
      case 'wa-invoices': await WhatsAppInvoicesModule.load(); break;
      case 'expenses':    await ExpensesModule.load();    break;
      case 'reports':     await ReportsModule.load();     break;
      case 'stock-log':   await StockLogModule.load();    break;
      case 'collections': await CollectionsModule.load(); break;
      case 'reps':        await RepsModule.load();        break;
      case 'settings':    await SettingsModule.load();    break;
    }
  }
  try {
    if (loadingEl) loadingEl.style.display = 'flex';
    if (loadingMsg) loadingMsg.textContent = 'جاري الاتصال بقاعدة البيانات...';

    const hasOfflineCache = ['products', 'shops', 'invoices'].some(table => DB.getCachedTable(table).length > 0);
    const browserOnline = DB.isBrowserOnline();
    let bootOffline = !browserOnline || hasOfflineCache;
    DB.setPreferOfflineCache(bootOffline && hasOfflineCache);

    if (browserOnline && !DB.hasRemoteConfig() && loadingMsg) {
      loadingMsg.textContent = 'جارٍ فتح النظام...';
    }

    if (!bootOffline && DB.hasRemoteConfig()) {
      const ok = await DB.ping();
      if (!ok) {
        bootOffline = true;
        DB.setPreferOfflineCache(hasOfflineCache);
        if (loadingMsg) loadingMsg.textContent = hasOfflineCache
          ? 'تعذر الوصول للسيرفر، جاري فتح آخر بيانات محفوظة محليًا...'
          : 'جارٍ فتح النظام...';
      }
    }

    if (bootOffline && loadingMsg) {
      loadingMsg.textContent = browserOnline ? 'جارٍ فتح النظام...' : hasOfflineCache
        ? 'أوفلاين: جاري فتح آخر بيانات محفوظة محليًا...'
        : 'جارٍ فتح النظام...';
    }

    // فحص وجود جدول invoice_payments (يشير إلى تطبيق migration_v12)
    if (bootOffline && loadingMsg && hasOfflineCache) {
      loadingMsg.textContent = 'جاري فتح البيانات المحلية المحفوظة...';
    }

    let migrationApplied = true;
    if (!bootOffline) {
      try {
        await DB.req('GET', 'invoice_payments', null, '?limit=1');
      } catch (e) {
        migrationApplied = false;
      }
    }

    if (!bootOffline && !migrationApplied) {
      if (loadingEl) loadingEl.innerHTML = `
        <div style="max-width:360px;text-align:center;padding:24px;direction:rtl;font-family:Cairo,sans-serif;">
          <div style="font-size:36px;margin-bottom:14px;">🗄️</div>
          <div style="font-size:16px;font-weight:700;color:#f0c040;margin-bottom:12px;">مطلوب تحديث قاعدة البيانات</div>
          <div style="font-size:13px;color:#ccc;line-height:2.2;text-align:right;">
            الاتصال بـ Supabase يعمل ✓<br>
            لكن جدول <code style="color:#f0c040;background:rgba(240,192,64,0.15);padding:1px 6px;border-radius:4px;">invoice_payments</code> غير موجود.<br><br>
            <b style="color:#fff;">الحل:</b><br>
            1. افتح <b>Supabase → SQL Editor</b><br>
            2. شغّل ملف <code style="color:#4ade80;">supabase_schema.sql</code><br>
            &nbsp;&nbsp;&nbsp;(أو <code style="color:#4ade80;">migration_v12.sql</code> للمشاريع الموجودة)<br>
            3. أعد تحميل الصفحة
          </div>
          <button onclick="location.reload()" style="margin-top:20px;padding:10px 28px;background:#f0c040;color:#0f1117;border:none;border-radius:8px;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">إعادة المحاولة</button>
        </div>`;
      return;
    }

    if (!bootOffline) {
      if (loadingMsg) loadingMsg.textContent = 'جارٍ تحميل البيانات الأساسية للعمل أوفلاين...';
      await DB.primeOfflineCache().catch(() => {});
    }

    if (loadingEl) loadingEl.style.display = 'none';

    ProductsModule.init();
    ShopsModule.init();
    InvoicesModule.init();
    NewInvoiceModule.init();
    PrintModule.init();
    WhatsAppInvoicesModule.init();
    ExpensesModule.init();
    ReportsModule.init();
    StockLogModule.init();
    CollectionsModule.init();
    RepsModule.init();
    SettingsModule.init();
    BackupModule.init();

    document.addEventListener('pageenter', async (e) => {
      await handlePageEnter(e.detail.page);
    });

    Router.init();
    await DebtStore.syncFromDatabase();
    if (typeof OpsMeta !== 'undefined' && typeof OpsMeta.syncFromRemote === 'function') {
      await OpsMeta.syncFromRemote().catch(() => {});
    }
    if (DB.hasRemoteConfig()) {
      if (bootOffline && hasOfflineCache) {
        DB.ping().then((ok) => {
          if (!ok) return;
          DB.setPreferOfflineCache(false);
          return DB.flushPendingQueue()
            .catch(() => {})
            .then(() => DB.primeOfflineCache().catch(() => {}))
            .then(() => DebtStore.syncFromDatabase().catch(() => {}))
            .finally(() => StatusUI.update());
        }).catch(() => {});
      } else {
        DB.setPreferOfflineCache(false);
        DB.primeOfflineCache().catch(() => {});
        DB.flushPendingQueue().catch(() => {});
      }
    }
    AccessControl.apply();
    StatusUI.update();

    window.addEventListener('online', () => {
      if (!DB.hasRemoteConfig()) {
        StatusUI.update();
        return;
      }
      DB.setPreferOfflineCache(false);
      StatusUI.pulse();
      Toast.success('عاد الاتصال بالإنترنت، جاري مزامنة البيانات...');
      DB.flushPendingQueue()
        .then(() => {
          DB.primeOfflineCache().catch(() => {});
          DebtStore.syncFromDatabase().catch(() => {});
          if (typeof OpsMeta !== 'undefined' && typeof OpsMeta.syncFromRemote === 'function') {
            OpsMeta.syncFromRemote(true).catch(() => {});
          }
          StatusUI.update();
          if (DB.getPendingQueueCount() === 0) Toast.success('تمت مزامنة البيانات المعلقة ✓');
          handlePageEnter(Router.getCurrent()).catch(() => {});
        })
        .catch((err) => Toast.error('تعذرت مزامنة بعض البيانات: ' + (err.message || '')));
    });
    window.addEventListener('offline', () => {
      StatusUI.update();
      Toast.info('أنت الآن في وضع أوفلاين، أي إدخال جديد سيُحفَظ محليًا لحين عودة الإنترنت');
    });

    document.getElementById('logout-btn')?.addEventListener('click', () => {
      if (Utils.confirm('هل تريد تسجيل الخروج؟')) {
        localStorage.removeItem('nadir_pos_session');
        window.location.href = 'login.html';
      }
    });

    const SESSION_HOURS = 8;
    function renewSession() {
      const raw = localStorage.getItem('nadir_pos_session');
      if (!raw) return;
      try {
        const sess = JSON.parse(raw);
        sess.expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
        localStorage.setItem('nadir_pos_session', JSON.stringify(sess));
      } catch(e) {}
    }
    ['click', 'keydown', 'touchstart'].forEach(evt =>
      document.addEventListener(evt, Utils.debounce(renewSession, 5000), { passive: true })
    );
    setInterval(() => {
      const raw = localStorage.getItem('nadir_pos_session');
      if (!raw) { window.location.href = 'login.html'; return; }
      try {
        const sess = JSON.parse(raw);
        if (!sess.expiresAt || Date.now() > sess.expiresAt) {
          Toast.error('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً');
          setTimeout(() => {
            localStorage.removeItem('nadir_pos_session');
            window.location.href = 'login.html';
          }, 2500);
        }
      } catch(e) {
        window.location.href = 'login.html';
      }
    }, 60 * 1000);

  } catch (err) {
    console.error('App init error:', err);
    const hasOfflineCache = ['products', 'shops', 'invoices'].some(table => DB.getCachedTable(table).length > 0);
    const isOfflineBootFailure = !DB.isOnline() || DB.isOfflineError?.(err) || String(err?.message || '').toLowerCase().includes('تعذر الاتصال');
    if (hasOfflineCache && isOfflineBootFailure) {
      try {
        if (loadingMsg) loadingMsg.textContent = 'تعذر الاتصال بالسيرفر، جاري فتح النسخة المحلية...';
        if (loadingEl) loadingEl.style.display = 'none';

        ProductsModule.init();
        ShopsModule.init();
        InvoicesModule.init();
        NewInvoiceModule.init();
        PrintModule.init();
        WhatsAppInvoicesModule.init();
        ExpensesModule.init();
        ReportsModule.init();
        StockLogModule.init();
        CollectionsModule.init();
        RepsModule.init();
        SettingsModule.init();
        BackupModule.init();

        document.addEventListener('pageenter', async (e) => {
          await handlePageEnter(e.detail.page);
        });

        Router.init();
        await DebtStore.syncFromDatabase();
        AccessControl.apply();
        StatusUI.update();
        Toast.info('تم فتح النظام من البيانات المحلية بدون إنترنت');
        return;
      } catch (offlineErr) {
        console.error('Offline fallback boot failed:', offlineErr);
      }
    }
    const _isNet = err.message?.includes('fetch') || err.message?.includes('network') || err.message?.includes('Failed');
    const _hint  = _isNet ? 'تحقق من اتصال الإنترنت أو من إعدادات Supabase في js/app.js' : (err.message || 'خطأ غير معروف');
    let _title = 'فشل الاتصال بقاعدة البيانات';
    let _displayHint = _hint;
    if (isOfflineBootFailure && !hasOfflineCache) {
      _title = 'لا توجد بيانات محفوظة للعمل أوفلاين';
      _displayHint = 'التطبيق يحتاج مرة واحدة أونلاين لحفظ آخر بيانات محليًا، وبعدها سيفتح أوفلاين بشكل طبيعي.';
    } else if (isOfflineBootFailure && hasOfflineCache) {
      _title = 'تعذر فتح الوضع الأوفلاين';
      _displayHint = 'توجد بيانات محفوظة محليًا، لكن حدث خطأ أثناء تحميلها. جرّب إعادة المحاولة.';
    }
    if (loadingEl) {
      loadingEl.style.display = 'flex';
      loadingEl.innerHTML = `
        <div style="color:#e05252;font-size:14px;text-align:center;padding:24px;direction:rtl;max-width:340px;font-family:Cairo,sans-serif;">
          <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
          <div style="font-weight:700;margin-bottom:8px;">${_title}</div>
          <div style="font-size:12px;color:#aaa;background:rgba(255,255,255,0.05);border-radius:8px;padding:10px;margin-bottom:16px;text-align:right;line-height:1.8;">${_displayHint}</div>
          <button onclick="location.reload()" style="padding:10px 28px;background:#f0c040;color:#0f1117;border:none;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">إعادة المحاولة</button>
        </div>`;
      }
    }
  }

  async function processInvoiceDeleteOnline(invoiceId, reason = '') {
    const inv = await get('invoices', invoiceId);
    if (!inv) return;

    if (!inv.isReturn && inv.status !== 'void') {
      await reverseStockSnapshot(inv, reason || 'حذف فاتورة');
    }

    if (inv.isReturn) {
      const items = Utils.normalizeInvoiceItems(inv.items);
      for (const item of items) {
        const prod = await get('products', item.productId);
        if (!prod) continue;
        const before = parseFloat(prod.quantity) || 0;
        const after = Math.max(0, before - (parseFloat(item.qty) || 0));
        await rawPut('products', { ...prod, quantity: after });
        await addStockMovement({
          productId: item.productId,
          productName: item.name,
          type: 'out',
          qty: item.qty,
          reason: `${reason || 'حذف مرتجع'} - ${inv.number}`,
          invoiceId,
          invoiceNumber: inv.number,
          balanceBefore: before,
          balanceAfter: after,
        });
      }
      if (inv.returnOf) {
        const origInv = await get('invoices', inv.returnOf);
        if (origInv) await rawPut('invoices', { ...origInv, isReturned: 0 });
      }
    }

    await serverReq('DELETE', 'invoices', null, `?id=eq.${invoiceId}`);

    if (inv.shopId) {
      const shop = await get('shops', inv.shopId);
      if (shop) {
        const newBalance = await computeShopBalance(inv.shopId);
        let newReturns = parseFloat(shop.returnsTotal) || 0;
        if (inv.isReturn) newReturns = Math.max(0, newReturns - (parseFloat(inv.total) || 0));
        await rawPut('shops', { ...shop, balance: newBalance, returnsTotal: newReturns });
      }
    }
  }

document.addEventListener('DOMContentLoaded', initApp);
