const SettingsModule = (() => {
  let editingUserId = null;

  function currentSession() {
    return typeof NadirUsers !== 'undefined' ? NadirUsers.readSession() : null;
  }

  function syncCurrentSession(user) {
    const session = currentSession();
    if (!session || session.id !== user.id) return;
    NadirUsers.writeSession(user);
    const remembered = NadirUsers.readRemembered();
    if (remembered?.id === user.id) NadirUsers.rememberUser(user);
    if (typeof StatusUI !== 'undefined') StatusUI.update();
  }

  function applyBranding() {
    const store = DB.getStoreSettings();
    const name = String(store.name || '').trim() || 'نظام المبيعات';
    const sub = String(store.address || '').trim() || 'جاهز للعمل';

    const headerTitle = document.getElementById('app-brand-title');
    const loadingName = document.getElementById('loading-brand-name');
    const loadingSub = document.getElementById('loading-brand-sub');

    if (headerTitle) headerTitle.textContent = name;
    if (loadingName) loadingName.textContent = name;
    if (loadingSub) loadingSub.textContent = sub;
    document.title = name;
  }

  function loadStoreForm() {
    const store = DB.getStoreSettings();
    document.getElementById('settings-store-name').value = store.name || '';
    document.getElementById('settings-store-address').value = store.address || '';
    document.getElementById('settings-store-phone').value = store.phone || '';
    document.getElementById('settings-store-footer').value = store.footer || '';
    applyBranding();
  }

  function resetUserForm() {
    editingUserId = null;
    document.getElementById('settings-user-form').reset();
    document.getElementById('settings-user-active').checked = true;
    document.getElementById('settings-user-form-title').textContent = 'إضافة مستخدم';
    document.getElementById('settings-user-save-btn').textContent = 'حفظ المستخدم';
  }

  function getUsers() {
    return NadirUsers.getAll();
  }

  function countAdmins(excludeUserId = null) {
    return getUsers().filter((user) => user.role === 'admin' && user.active !== false && user.id !== excludeUserId).length;
  }

  function renderUsers() {
    const list = document.getElementById('settings-users-list');
    if (!list) return;

    const users = getUsers();
    if (!users.length) {
      list.innerHTML = '<div class="empty-state"><p>لا يوجد مستخدمون حتى الآن.</p></div>';
      return;
    }

    list.innerHTML = users.map((user) => {
      const isActive = user.active !== false;
      return `
        <div class="card" style="margin-bottom:10px;">
          <div class="card-row" style="align-items:flex-start;gap:10px;">
            <div style="width:42px;height:42px;border-radius:12px;background:rgba(240,192,64,.12);border:1px solid rgba(240,192,64,.22);display:flex;align-items:center;justify-content:center;font-weight:900;color:var(--accent);flex-shrink:0;">
              ${escapeHtml(NadirUsers.getInitials(user.name))}
            </div>
            <div style="flex:1;min-width:0;">
              <div class="card-title">${escapeHtml(user.name)}</div>
              <div class="card-sub" style="margin-top:3px;">${escapeHtml(NadirUsers.getRoleLabel(user.role))}</div>
              <div class="card-sub" dir="ltr">${escapeHtml(user.email || '')}</div>
              <div class="card-sub" dir="ltr">${escapeHtml(user.mobile || '')}</div>
              <div style="margin-top:6px;">
                <span class="badge ${isActive ? 'badge-green' : 'badge-yellow'}">${isActive ? 'مفعل' : 'موقوف'}</span>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
              <button class="btn btn-secondary btn-sm" type="button" data-settings-edit="${user.id}">تعديل</button>
              <button class="btn ${isActive ? 'btn-secondary' : 'btn-success'} btn-sm" type="button" data-settings-toggle="${user.id}">
                ${isActive ? 'إيقاف' : 'تفعيل'}
              </button>
              <button class="btn btn-danger btn-sm" type="button" data-settings-delete="${user.id}">حذف</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-settings-edit]').forEach((button) => {
      button.addEventListener('click', () => openEdit(button.dataset.settingsEdit));
    });
    list.querySelectorAll('[data-settings-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggleUser(button.dataset.settingsToggle));
    });
    list.querySelectorAll('[data-settings-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteUser(button.dataset.settingsDelete));
    });
  }

  function renderActivity() {
    const list = document.getElementById('settings-activity-list');
    if (!list || typeof OpsMeta === 'undefined') return;
    const rows = OpsMeta.getActivity().slice(0, 20);
    if (!rows.length) {
      list.innerHTML = '<div class="empty-state"><p>لا توجد أنشطة مسجلة حتى الآن.</p></div>';
      return;
    }

    list.innerHTML = rows.map((row) => `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${escapeHtml(row.type || 'نشاط')}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">${escapeHtml(row.actor || 'مستخدم')} ${row.target ? `• ${escapeHtml(row.target)}` : ''}</div>
        </div>
        <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;font-family:var(--font-mono);">${Utils.formatDateTime(row.at)}</div>
      </div>
    `).join('');
  }

  function openEdit(userId) {
    const user = NadirUsers.getById(userId);
    if (!user) {
      Toast.error('المستخدم غير موجود');
      return;
    }

    editingUserId = user.id;
    document.getElementById('settings-user-name').value = user.name || '';
    document.getElementById('settings-user-email').value = user.email || '';
    document.getElementById('settings-user-mobile').value = user.mobile || '';
    document.getElementById('settings-user-role').value = user.role || 'cashier';
    document.getElementById('settings-user-password').value = '';
    document.getElementById('settings-user-active').checked = user.active !== false;
    document.getElementById('settings-user-form-title').textContent = `تعديل المستخدم: ${user.name}`;
    document.getElementById('settings-user-save-btn').textContent = 'حفظ التعديلات';
    document.getElementById('settings-user-name').focus();
  }

  async function saveStoreSettings(event) {
    event.preventDefault();
    const next = {
      name: document.getElementById('settings-store-name').value.trim(),
      address: document.getElementById('settings-store-address').value.trim(),
      phone: document.getElementById('settings-store-phone').value.trim(),
      footer: document.getElementById('settings-store-footer').value.trim(),
    };

    DB.saveStoreSettings(next);
    applyBranding();
    OpsMeta.addActivity({
      actor: currentSession()?.name || 'مدير',
      type: 'تحديث بيانات المتجر',
      target: next.name || 'المتجر',
    });
    renderActivity();
    Toast.success('تم حفظ بيانات المتجر');
  }

  async function saveUser(event) {
    event.preventDefault();
    const name = document.getElementById('settings-user-name').value.trim();
    const email = document.getElementById('settings-user-email').value.trim();
    const mobile = document.getElementById('settings-user-mobile').value.trim();
    const role = document.getElementById('settings-user-role').value;
    const password = document.getElementById('settings-user-password').value;
    const active = document.getElementById('settings-user-active').checked;

    if (!name) { Toast.error('الاسم مطلوب'); return; }
    if (!email) { Toast.error('البريد الإلكتروني مطلوب'); return; }
    if (!mobile) { Toast.error('رقم الموبايل مطلوب'); return; }
    if (!editingUserId && !password) { Toast.error('كلمة المرور مطلوبة للمستخدم الجديد'); return; }
    if (password) {
      const passwordCheck = NadirUsers.validatePasswordStrength(password);
      if (!passwordCheck.ok) {
        Toast.error(passwordCheck.message);
        return;
      }
    }

    const currentUser = editingUserId ? NadirUsers.getById(editingUserId) : null;
    if (currentUser?.role === 'admin' && (role !== 'admin' || !active) && countAdmins(editingUserId) === 0) {
      Toast.error('يجب أن يبقى مدير واحد مفعل على الأقل');
      return;
    }

    try {
      let user;
      if (editingUserId) {
        const payload = { name, email, mobile, role, active };
        if (password) payload.passwordHash = await NadirUsers.hashPassword(password);
        user = await NadirUsers.updateUser(editingUserId, payload);
        syncCurrentSession(user);
        OpsMeta.addActivity({
          actor: currentSession()?.name || 'مدير',
          type: 'تعديل مستخدم',
          target: user.name,
        });
        Toast.success('تم تحديث المستخدم');
      } else {
        user = await NadirUsers.createUser({
          name,
          email,
          mobile,
          role,
          active,
          passwordHash: await NadirUsers.hashPassword(password),
        });
        OpsMeta.addActivity({
          actor: currentSession()?.name || 'مدير',
          type: 'إضافة مستخدم',
          target: user.name,
        });
        Toast.success('تمت إضافة المستخدم');
      }
      resetUserForm();
      renderUsers();
      renderActivity();
    } catch (error) {
      Toast.error(error?.message || 'تعذر حفظ المستخدم');
    }
  }

  function toggleUser(userId) {
    const user = NadirUsers.getById(userId);
    if (!user) {
      Toast.error('المستخدم غير موجود');
      return;
    }

    const session = currentSession();
    const nextActive = user.active === false;

    if (!nextActive && session?.id === user.id) {
      Toast.error('لا يمكن إيقاف الحساب الحالي أثناء استخدامه');
      return;
    }
    if (!nextActive && user.role === 'admin' && countAdmins(user.id) === 0) {
      Toast.error('يجب أن يبقى مدير واحد مفعل على الأقل');
      return;
    }

    try {
      const updated = NadirUsers.setUserActive(userId, nextActive);
      syncCurrentSession(updated);
      OpsMeta.addActivity({
        actor: currentSession()?.name || 'مدير',
        type: nextActive ? 'تفعيل مستخدم' : 'إيقاف مستخدم',
        target: updated.name,
      });
      renderUsers();
      renderActivity();
      Toast.success(nextActive ? 'تم تفعيل المستخدم' : 'تم إيقاف المستخدم');
    } catch (error) {
      Toast.error(error?.message || 'تعذر تحديث حالة المستخدم');
    }
  }

  function deleteUser(userId) {
    const user = NadirUsers.getById(userId);
    if (!user) {
      Toast.error('المستخدم غير موجود');
      return;
    }

    const session = currentSession();
    if (session?.id === user.id) {
      Toast.error('لا يمكن حذف الحساب الحالي');
      return;
    }
    if (user.role === 'admin' && countAdmins(user.id) === 0) {
      Toast.error('لا يمكن حذف آخر مدير في النظام');
      return;
    }
    if (!Utils.confirm(`هل تريد حذف المستخدم "${user.name}"؟`)) return;

    try {
      NadirUsers.removeUser(userId);
      OpsMeta.addActivity({
        actor: currentSession()?.name || 'مدير',
        type: 'حذف مستخدم',
        target: user.name,
      });
      if (editingUserId === userId) resetUserForm();
      renderUsers();
      renderActivity();
      Toast.success('تم حذف المستخدم');
    } catch (error) {
      Toast.error(error?.message || 'تعذر حذف المستخدم');
    }
  }

  async function load() {
    loadStoreForm();
    renderUsers();
    renderActivity();
  }

  function init() {
    applyBranding();
    document.getElementById('settings-store-form')?.addEventListener('submit', saveStoreSettings);
    document.getElementById('settings-user-form')?.addEventListener('submit', saveUser);
    document.getElementById('settings-user-cancel-btn')?.addEventListener('click', resetUserForm);
    document.getElementById('settings-user-add-btn')?.addEventListener('click', resetUserForm);
    document.getElementById('settings-refresh-btn')?.addEventListener('click', () => load().catch(() => {}));
    resetUserForm();
  }

  return { init, load, applyBranding };
})();

window.SettingsModule = SettingsModule;

{
  const originalApplyBranding = window.SettingsModule.applyBranding;
  window.SettingsModule.applyBranding = () => {
    originalApplyBranding();

    const brandMark = document.querySelector('.brand-mark');
    const loadingBadge = document.querySelector('.loading-badge');
    const loadingName = document.getElementById('loading-brand-name');
    const loadingSub = document.getElementById('loading-brand-sub');
    const headerTitle = document.getElementById('app-brand-title');

    if (brandMark) brandMark.innerHTML = '<img src="icons/mm-logo.png" alt="MM Logo">';
    if (loadingBadge) loadingBadge.innerHTML = '<img src="icons/mm-logo.png" alt="MM Logo">';
    if (loadingName && (!loadingName.textContent || /^mh\b/i.test(loadingName.textContent.trim()))) {
      loadingName.textContent = 'الحبيب';
    }
    if (loadingSub && !loadingSub.textContent.trim()) {
      loadingSub.textContent = 'نظام موحد لإدارة المبيعات والتوزيع';
    }
    if (headerTitle && /^mh\b/i.test(headerTitle.textContent.trim())) {
      headerTitle.innerHTML = 'الحبيب <span>للتجارة والتوزيع</span>';
    }
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'الحبيب للتجارة والتوزيع');
    document.querySelector('link[rel="icon"]')?.setAttribute('href', 'icons/mm-logo.png');
    document.querySelector('link[rel="shortcut icon"]')?.setAttribute('href', 'icons/mm-logo.png');
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', 'icons/mm-logo.png');
    document.title = headerTitle?.textContent?.trim() || document.title;
  };
}
