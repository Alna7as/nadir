(function(global) {
  const STORAGE_KEY = 'nadir_pos_users_v2';
  const REMEMBER_KEY = 'nadir_pos_remember';
  const SESSION_KEY = 'nadir_pos_session';
  const AUTH_STATE_KEY = 'nadir_pos_auth_state_v1';
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_MS = 5 * 60 * 1000;
  const LEGACY_DEFAULT_USER_IDS = new Set([
    'user_mahmoud_admin', 'user_mahmoud_hassan_admin',
  ]);
  const LEGACY_DEFAULT_EMAILS = new Set([
    'mahmoud@alhabib.eg',
    'mohamed@alhabib.eg',
    'abdullah@alhabib.eg',
    'ahmed@alhabib.eg',
    'admin@pos.eg',
    'cashier@pos.eg',
    'store@pos.eg',
  ]);
  const LEGACY_DEFAULT_MOBILES = new Set([
    '01000000001',
    '01000000002',
    '01000000003',
    '01000000004',
    '01000000012',
    '01000000013',
    '01000000014',
  ]);
  const VALID_ROLES = new Set(['admin', 'cashier', 'store']);
  const INITIAL_USERS = [
    {
      id: 'user_nader_admin',
      name: 'نادر',
      email: 'nader@alhabib.eg',
      mobile: '01000000011',
      role: 'admin',
      passwordHash: '9a7f3c2172deaa0879178329552c132caa4d22a5f6d695df6b0a0f4035a8a032',
      active: true,
    },
  ];
  // كل ما تتغيّر passwordHash بتاع 'user_nader_admin' فوق، لازم نزوّد الرقم ده
  // عشان الباسورد الجديد يتفعّل حتى على متصفح فيه بيانات قديمة محفوظة بالفعل.
  const DEFAULT_ADMIN_PASSWORD_VERSION = 2;
  const DEFAULT_ADMIN_PASSWORD_VERSION_KEY = 'nadir_pos_default_admin_pw_v';

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
    return value;
  }

  function readAuthState() {
    return readJson(AUTH_STATE_KEY, {});
  }

  function writeAuthState(value) {
    return writeJson(AUTH_STATE_KEY, value);
  }

  function normalizeUser(user, fallback = {}) {
    const merged = { ...fallback, ...user };
    return {
      id: merged.id || `user_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      name: String(merged.name || '').trim(),
      email: String(merged.email || '').trim().toLowerCase(),
      mobile: normalizeMobile(merged.mobile || ''),
      role: merged.role === 'admin' ? 'admin' : (merged.role || 'cashier'),
      passwordHash: String(merged.passwordHash || ''),
      active: merged.active !== false,
      createdAt: merged.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeMobile(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function uniqueById(users) {
    const seen = new Set();
    return users.filter((user) => {
      if (!user || !user.id || seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });
  }

  function isLegacyDefaultUser(user) {
    if (!user) return false;
    return LEGACY_DEFAULT_USER_IDS.has(user.id) ||
      LEGACY_DEFAULT_EMAILS.has(user.email) ||
      LEGACY_DEFAULT_MOBILES.has(user.mobile);
  }

  function sanitizeUsers(users) {
    return uniqueById(
      (Array.isArray(users) ? users : [])
        .map((user) => normalizeUser(user))
        .filter((user) => !isLegacyDefaultUser(user))
    );
  }

  function mergeInitialUsers(users) {
    const current = sanitizeUsers(users);
    const seeded = [...current];

    INITIAL_USERS.forEach((user) => {
      const normalized = normalizeUser(user);
      const exists = seeded.some((item) => (
        item.id === normalized.id ||
        item.email === normalized.email ||
        item.mobile === normalized.mobile
      ));
      if (!exists) seeded.push(normalized);
    });

    return uniqueById(seeded);
  }

  function isLegacyDefaultIdentity(data) {
    if (!data) return false;
    const email = String(data.email || '').trim().toLowerCase();
    const mobile = normalizeMobile(data.mobile || '');
    return LEGACY_DEFAULT_USER_IDS.has(data.id) ||
      LEGACY_DEFAULT_EMAILS.has(email) ||
      LEGACY_DEFAULT_MOBILES.has(mobile);
  }

  function applyDefaultAdminPasswordUpdate(users) {
    try {
      const appliedVersion = Number(localStorage.getItem(DEFAULT_ADMIN_PASSWORD_VERSION_KEY) || '0');
      if (appliedVersion >= DEFAULT_ADMIN_PASSWORD_VERSION) return { users, changed: false };
      const defaultAdmin = INITIAL_USERS.find((u) => u.id === 'user_nader_admin');
      if (!defaultAdmin) return { users, changed: false };
      const updated = users.map((user) => (
        user.id === defaultAdmin.id
          ? { ...user, passwordHash: defaultAdmin.passwordHash }
          : user
      ));
      localStorage.setItem(DEFAULT_ADMIN_PASSWORD_VERSION_KEY, String(DEFAULT_ADMIN_PASSWORD_VERSION));
      return { users: updated, changed: true };
    } catch (_) {
      return { users, changed: false };
    }
  }

  function seed(force = false) {
    const existing = force ? [] : readJson(STORAGE_KEY, []);
    const { users: cleaned } = applyDefaultAdminPasswordUpdate(mergeInitialUsers(existing));
    const seeded = cleaned.length > 0
      ? cleaned
      : uniqueById(INITIAL_USERS.map((user) => normalizeUser(user)));
    writeJson(STORAGE_KEY, seeded);
    return seeded;
  }

  function getAll() {
    const users = readJson(STORAGE_KEY, null);
    if (!Array.isArray(users)) {
      return seed();
    }
    const merged = mergeInitialUsers(users);
    if (merged.length === 0) return seed(true);
    const { users: cleaned, changed } = applyDefaultAdminPasswordUpdate(merged);
    if (changed || cleaned.length !== users.length) writeJson(STORAGE_KEY, cleaned);
    return cleaned;
  }

  function saveAll(users) {
    return writeJson(STORAGE_KEY, sanitizeUsers(users));
  }

  function getById(userId) {
    return getAll().find((user) => user.id === userId) || null;
  }

  function getRoleLabel(role) {
    return {
      admin: 'مدير',
      cashier: 'مندوب',
      store: 'مخزن',
    }[role] || 'مستخدم';
  }

  function getInitials(name) {
    const clean = String(name || '').trim();
    return clean.slice(0, 2) || '؟';
  }

  async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(String(password || ''));
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function validatePasswordStrength(password) {
    const raw = String(password || '');
    if (raw.length < 8) {
      return { ok: false, message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' };
    }
    if (!/[A-Za-z]/.test(raw) || !/\d/.test(raw)) {
      return { ok: false, message: 'كلمة المرور يجب أن تحتوي على حروف وأرقام على الأقل' };
    }
    return { ok: true, message: '' };
  }

  function authKey(login) {
    return normalizeMobile(login) || String(login || '').trim().toLowerCase();
  }

  function getAuthMeta(login) {
    const key = authKey(login);
    const state = readAuthState();
    const meta = state[key] || { failedCount: 0, lockedUntil: 0 };
    if (meta.lockedUntil && Date.now() >= meta.lockedUntil) {
      delete state[key];
      writeAuthState(state);
      return { key, failedCount: 0, lockedUntil: 0 };
    }
    return { key, failedCount: meta.failedCount || 0, lockedUntil: meta.lockedUntil || 0 };
  }

  function registerFailedAuth(login) {
    const { key, failedCount } = getAuthMeta(login);
    const nextCount = failedCount + 1;
    const next = {
      failedCount: nextCount,
      lockedUntil: nextCount >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
      updatedAt: Date.now(),
    };
    const state = readAuthState();
    state[key] = next;
    writeAuthState(state);
    return next;
  }

  function clearFailedAuth(login) {
    const key = authKey(login);
    const state = readAuthState();
    if (state[key]) {
      delete state[key];
      writeAuthState(state);
    }
  }

  function findByLogin(login) {
    const normalized = String(login || '').trim().toLowerCase();
    const mobile = normalizeMobile(login);
    return getAll().find((user) => (
      user.active !== false && (
        (normalized && user.email === normalized) ||
        (mobile && user.mobile === mobile)
      )
    )) || null;
  }

  async function authenticate(login, password) {
    const meta = getAuthMeta(login);
    if (meta.lockedUntil && meta.lockedUntil > Date.now()) {
      const remainingMinutes = Math.max(1, Math.ceil((meta.lockedUntil - Date.now()) / 60000));
      throw new Error(`تم إيقاف تسجيل الدخول مؤقتًا. حاول مرة أخرى بعد ${remainingMinutes} دقيقة`);
    }
    const user = findByLogin(login);
    if (!user) {
      registerFailedAuth(login);
      return null;
    }
    const passwordHash = await hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      registerFailedAuth(login);
      return null;
    }
    clearFailedAuth(login);
    return user;
  }

  async function createUser(payload) {
    const nextUser = normalizeUser(payload);
    const users = getAll();

    if (!nextUser.name) throw new Error('الاسم مطلوب');
    if (!nextUser.email) throw new Error('البريد الإلكتروني مطلوب');
    if (!nextUser.mobile) throw new Error('رقم الموبايل مطلوب');
    if (!nextUser.passwordHash) throw new Error('كلمة المرور مطلوبة');

    if (users.some((user) => user.email === nextUser.email)) {
      throw new Error('هذا البريد الإلكتروني مسجل بالفعل');
    }

    if (users.some((user) => user.mobile === nextUser.mobile)) {
      throw new Error('رقم الموبايل مسجل بالفعل');
    }

    users.push(nextUser);
    saveAll(users);
    return nextUser;
  }

  async function updateUser(userId, payload) {
    const users = getAll();
    const index = users.findIndex((user) => user.id === userId);
    if (index === -1) throw new Error('المستخدم غير موجود');

    const current = users[index];
    const nextUser = normalizeUser({
      ...current,
      ...payload,
      id: current.id,
      passwordHash: payload.passwordHash || current.passwordHash,
      createdAt: current.createdAt,
    });

    if (!nextUser.name) throw new Error('الاسم مطلوب');
    if (!nextUser.email) throw new Error('البريد الإلكتروني مطلوب');
    if (!nextUser.mobile) throw new Error('رقم الموبايل مطلوب');
    if (!nextUser.passwordHash) throw new Error('كلمة المرور مطلوبة');

    if (users.some((user) => user.id !== userId && user.email === nextUser.email)) {
      throw new Error('هذا البريد الإلكتروني مسجل بالفعل');
    }

    if (users.some((user) => user.id !== userId && user.mobile === nextUser.mobile)) {
      throw new Error('رقم الموبايل مسجل بالفعل');
    }

    users[index] = nextUser;
    saveAll(users);
    return nextUser;
  }

  function setUserActive(userId, active) {
    const users = getAll();
    const index = users.findIndex((user) => user.id === userId);
    if (index === -1) throw new Error('المستخدم غير موجود');
    users[index] = normalizeUser({
      ...users[index],
      active: active !== false,
      createdAt: users[index].createdAt,
    });
    saveAll(users);
    return users[index];
  }

  function removeUser(userId) {
    const users = getAll();
    const next = users.filter((user) => user.id !== userId);
    if (next.length === users.length) throw new Error('المستخدم غير موجود');
    saveAll(next);
    return true;
  }

  function writeSession(user, options = {}) {
    const sessionHours = options.sessionHours || 8;
    const expiresAt = Date.now() + (sessionHours * 60 * 60 * 1000);
    const session = {
      id: user.id,
      email: user.email,
      mobile: user.mobile,
      name: user.name,
      role: user.role || 'cashier',
      expiresAt,
    };
    writeJson(SESSION_KEY, session);
    return session;
  }

  function readSession() {
    const session = readJson(SESSION_KEY, null);
    if (!session) return null;
    if (isLegacyDefaultIdentity(session)) {
      clearSession();
      return null;
    }
    if (!VALID_ROLES.has(String(session.role || '').trim())) {
      clearSession();
      return null;
    }
    if (!session.expiresAt || Date.now() > session.expiresAt) {
      clearSession();
      return null;
    }
    const user = getById(session.id);
    if (!user || user.active === false || user.role !== session.role) {
      clearSession();
      return null;
    }
    if (user.email !== session.email || user.mobile !== session.mobile || user.name !== session.name) {
      return writeSession(user, {
        sessionHours: Math.max(1, Math.ceil((session.expiresAt - Date.now()) / (60 * 60 * 1000))),
      });
    }
    return session;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function rememberUser(user) {
    writeJson(REMEMBER_KEY, {
      id: user.id,
      email: user.email,
      mobile: user.mobile,
      name: user.name,
      role: user.role,
    });
  }

  function readRemembered() {
    const remembered = readJson(REMEMBER_KEY, null);
    if (isLegacyDefaultIdentity(remembered)) {
      clearRemembered();
      return null;
    }
    return remembered;
  }

  function clearRemembered() {
    localStorage.removeItem(REMEMBER_KEY);
  }

  seed();

  global.NadirUsers = {
    seed,
    getAll,
    saveAll,
    getById,
    findByLogin,
    authenticate,
    createUser,
    updateUser,
    setUserActive,
    removeUser,
    hashPassword,
    validatePasswordStrength,
    normalizeMobile,
    getRoleLabel,
    getInitials,
    writeSession,
    readSession,
    clearSession,
    rememberUser,
    readRemembered,
    clearRemembered,
  };
})(window);
