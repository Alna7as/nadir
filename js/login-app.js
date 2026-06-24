(function() {
  if (window.LoginAppInitialized) return;
  window.LoginAppInitialized = true;

  function readStoreBranding() {
    try {
      const raw = localStorage.getItem('nadir_store_settings');
      const data = raw ? JSON.parse(raw) : {};
      const name = String(data?.name || '').trim();
      const address = String(data?.address || '').trim();
      const normalizedName = !name || /^(mm|mh)\b/i.test(name) || name === 'نظام المبيعات'
        ? 'الحبيب للتجارة والتوزيع'
        : name;
      return {
        name: normalizedName,
        subtitle: address || 'تسجيل دخول سريع وآمن لإدارة البيع والتحصيل ومتابعة حركة اليوم.',
      };
    } catch (_) {
      return {
        name: 'الحبيب للتجارة والتوزيع',
        subtitle: 'تسجيل دخول سريع وآمن لإدارة البيع والتحصيل ومتابعة حركة اليوم.',
      };
    }
  }

  function injectStyles() {
    if (document.getElementById('nadir-login-app-styles')) return;
    const style = document.createElement('style');
    style.id = 'nadir-login-app-styles';
    style.textContent = `
      .nadir-auth{display:grid;grid-template-columns:minmax(250px,320px) 1fr;min-height:600px;background:linear-gradient(180deg,#11161d 0%,#0D1117 100%)}
      .nadir-auth *{box-sizing:border-box}
      .nadir-auth-hero{padding:34px 26px;background:radial-gradient(circle at top, rgba(34,197,94,.14), transparent 38%),linear-gradient(180deg,#161B22 0%,#11161d 100%);color:#E6EDF3;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden}
      .nadir-auth-hero::before{content:'';position:absolute;inset:auto -60px 34px auto;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.03)}
      .nadir-auth-merchant{width:110px;height:110px;border-radius:28px;background:#161B22;display:flex;align-items:center;justify-content:center;box-shadow:0 20px 40px rgba(0,0,0,.22);padding:10px;margin-bottom:18px;position:relative;z-index:1;border:1px solid #30363d}
      .nadir-auth-merchant img{width:100%;height:100%;object-fit:contain;border-radius:22px}
      .nadir-auth-hero h2{font:900 29px 'Tajawal',sans-serif;line-height:1.25;text-align:center;margin-bottom:8px}
      .nadir-auth-hero p{font:500 13px 'Tajawal',sans-serif;line-height:1.8;text-align:center;color:#8B949E;max-width:240px}
      .nadir-auth-panel{padding:34px 30px;display:flex;flex-direction:column;justify-content:center}
      .nadir-auth-panel h3{font:900 30px 'Tajawal',sans-serif;color:#E6EDF3;margin-bottom:8px}
      .nadir-auth-sub{font:500 13px 'Tajawal',sans-serif;color:#8B949E;line-height:1.8;margin-bottom:18px}
      .nadir-auth-field{margin-bottom:12px}
      .nadir-auth-label{font:800 13px 'Tajawal',sans-serif;color:#c9d1d9;margin-bottom:8px;display:block}
      .nadir-auth-input{width:100%;min-height:50px;border-radius:16px;border:1px solid #30363d;background:#161B22;color:#E6EDF3;padding:12px 16px;font:700 15px 'Tajawal',sans-serif;outline:none;box-shadow:0 10px 24px rgba(0,0,0,.12)}
      .nadir-auth-input::placeholder{color:#8B949E}
      .nadir-auth-input:focus{border-color:#22C55E;box-shadow:0 0 0 4px rgba(34,197,94,.10)}
      .nadir-auth-input.error{border-color:#c75d55}
      .nadir-auth-input.valid{border-color:#2f8f68}
      .nadir-auth-wrap{position:relative}
      .nadir-auth-wrap .nadir-auth-input{padding-inline-start:16px;padding-inline-end:52px}
      .nadir-auth-toggle{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:32px;height:32px;border:none;border-radius:10px;background:#0D1117;color:#8B949E;display:flex;align-items:center;justify-content:center;cursor:pointer}
      .nadir-auth-toggle svg{width:17px;height:17px}
      .nadir-auth-error{display:none;margin-top:6px;font:700 11px 'Tajawal',sans-serif;color:#c75d55}
      .nadir-auth-error.show{display:block}
      .nadir-auth-meta{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:6px 0 16px}
      .nadir-auth-remember{display:flex;align-items:center;gap:8px;font:700 12px 'Tajawal',sans-serif;color:#c9d1d9;cursor:pointer}
      .nadir-auth-check{width:18px;height:18px;border-radius:6px;border:1px solid #30363d;display:flex;align-items:center;justify-content:center;background:#161B22}
      .nadir-auth-check svg{width:12px;height:12px;opacity:0}
      .nadir-auth-check.checked{background:rgba(34,197,94,.10);border-color:#22C55E;color:#22C55E}
      .nadir-auth-check.checked svg{opacity:1}
      .nadir-auth-forgot{font:700 12px 'Tajawal',sans-serif;color:#22C55E;text-decoration:none}
      .nadir-auth-submit{width:100%;min-height:50px;border:none;border-radius:16px;background:linear-gradient(135deg,#22C55E 0%,#16a34a 100%);color:#0D1117;font:900 15px 'Tajawal',sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;box-shadow:0 16px 28px rgba(34,197,94,.20)}
      .nadir-auth-submit.loading{opacity:.84;pointer-events:none}
      .nadir-auth-spinner{display:none;width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:nadirSpin .7s linear infinite}
      .nadir-auth-security{margin-top:16px;padding-top:14px;border-top:1px solid #30363d;text-align:center;font:700 11px 'Tajawal',sans-serif;color:#8B949E}
      .nadir-auth-success{position:absolute;inset:0;background:rgba(13,17,23,.92);display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:2;text-align:center;padding:20px}
      .nadir-auth-success.show{display:flex}
      .nadir-auth-success-box{width:70px;height:70px;border-radius:24px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;color:#d7fff2}
      .nadir-auth-success-box svg{width:30px;height:30px}
      @keyframes nadirSpin{to{transform:rotate(360deg)}}
      @media (max-width:860px){.nadir-auth{grid-template-columns:1fr}.nadir-auth-hero{padding:26px 22px;min-height:220px}.nadir-auth-panel{padding:24px 18px 26px}.nadir-auth-panel h3{font-size:27px}}
      @media (max-width:560px){.nadir-auth{min-height:auto}.nadir-auth-hero{padding:22px 18px;min-height:180px}.nadir-auth-merchant{width:82px;height:82px;border-radius:22px;margin-bottom:14px}.nadir-auth-merchant img{border-radius:16px}.nadir-auth-hero h2{font-size:22px}.nadir-auth-hero p{font-size:12px;line-height:1.7;max-width:100%}.nadir-auth-panel{padding:18px 14px 20px}.nadir-auth-panel h3{font-size:23px}.nadir-auth-sub{font-size:12px;margin-bottom:14px}.nadir-auth-label{font-size:12px;margin-bottom:6px}.nadir-auth-input{min-height:46px;border-radius:14px;font-size:14px;padding:11px 14px}.nadir-auth-wrap .nadir-auth-input{padding-inline-start:14px;padding-inline-end:46px}.nadir-auth-toggle{right:8px;width:28px;height:28px;border-radius:9px}.nadir-auth-toggle svg{width:15px;height:15px}.nadir-auth-meta{align-items:flex-start;flex-direction:column;gap:8px;margin-bottom:14px}.nadir-auth-remember,.nadir-auth-forgot,.nadir-auth-security{font-size:11px}.nadir-auth-submit{min-height:46px;border-radius:14px;font-size:14px}.nadir-auth-success-box{width:58px;height:58px;border-radius:18px}.nadir-auth-success-box svg{width:24px;height:24px}}
    `;
    document.head.appendChild(style);
  }

  function setFieldState(fieldId, errorId, message) {
    const field = document.getElementById(fieldId);
    const error = document.getElementById(errorId);
    if (!field || !error) return;
    field.classList.remove('error', 'valid');
    if (message) {
      field.classList.add('error');
      error.textContent = message;
      error.classList.add('show');
      return;
    }
    if (field.value.trim()) field.classList.add('valid');
    error.textContent = '';
    error.classList.remove('show');
  }

  function toast(message) {
    const node = document.createElement('div');
    node.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:12px 16px;border-radius:12px;background:#163b3c;color:#fff;font:700 13px Tajawal,sans-serif;z-index:9999;box-shadow:0 12px 24px rgba(15,59,60,.22)';
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2300);
  }

  function renderTemplate() {
    const card = document.getElementById('loginCard');
    if (!card) return;

    const branding = readStoreBranding();
    card.style.maxWidth = '900px';
    card.style.padding = '0';
    card.style.overflow = 'hidden';
    card.style.borderRadius = '24px';
    card.innerHTML = `
      <div class="nadir-auth">
        <section class="nadir-auth-hero">
          <div class="nadir-auth-merchant" aria-hidden="true">
            <img src="icons/mm-logo.png" alt="الحبيب Logo">
          </div>
          <h2>${branding.name}</h2>
          <p>${branding.subtitle}</p>
        </section>
        <section class="nadir-auth-panel">
          <h3>تسجيل الدخول</h3>
          <div class="nadir-auth-sub">أدخل البريد الإلكتروني أو رقم الموبايل وكلمة المرور للمتابعة إلى النظام.</div>

          <form id="na-login-form" novalidate>
            <div class="nadir-auth-field">
              <label class="nadir-auth-label" for="na-login-id">البريد الإلكتروني أو رقم الموبايل</label>
              <input id="na-login-id" class="nadir-auth-input" dir="ltr" placeholder="example@mail.com أو 01000000000">
              <div class="nadir-auth-error" id="na-login-id-error"></div>
            </div>
            <div class="nadir-auth-field">
              <label class="nadir-auth-label" for="na-login-pass">كلمة المرور</label>
              <div class="nadir-auth-wrap">
                <input id="na-login-pass" type="password" class="nadir-auth-input" dir="ltr" placeholder="••••••••••">
                <button type="button" class="nadir-auth-toggle" data-target="na-login-pass">
                  <svg class="show-eye" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                  <svg class="hide-eye" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" style="display:none"><path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>
                </button>
              </div>
              <div class="nadir-auth-error" id="na-login-pass-error"></div>
            </div>
            <div class="nadir-auth-meta">
              <label class="nadir-auth-remember" id="na-remember-label">
                <span class="nadir-auth-check" id="na-remember-check">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                </span>
                تذكرني
              </label>
              <a href="#" class="nadir-auth-forgot" id="na-forgot-link">نسيت كلمة المرور؟</a>
            </div>
            <button type="submit" class="nadir-auth-submit" id="na-login-btn">
              <span class="nadir-auth-spinner" id="na-login-spinner"></span>
              <span id="na-login-text">دخول إلى النظام</span>
            </button>
          </form>

          <div class="nadir-auth-security">الحبيب للتجارة والتوزيع</div>
        </section>
        <div class="nadir-auth-success" id="na-success">
          <div class="nadir-auth-success-box"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
          <div style="font-size:24px;font-weight:900" id="na-success-title">مرحبًا بك</div>
          <div style="font-size:13px;color:#d2e7e5" id="na-success-sub">جارٍ تجهيز الواجهة المناسبة...</div>
        </div>
      </div>
    `;
  }

  function bind() {
    let remember = false;

    function setLoading(on) {
      const button = document.getElementById('na-login-btn');
      const spinner = document.getElementById('na-login-spinner');
      const text = document.getElementById('na-login-text');
      if (!button || !spinner || !text) return;
      button.classList.toggle('loading', on);
      spinner.style.display = on ? 'inline-flex' : 'none';
      text.style.display = on ? 'none' : 'inline-flex';
    }

    function showSuccess(title, sub) {
      document.getElementById('na-success-title').textContent = title;
      document.getElementById('na-success-sub').textContent = sub;
      document.getElementById('na-success').classList.add('show');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1400);
    }

    document.querySelectorAll('.nadir-auth-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        const show = button.querySelector('.show-eye');
        const hide = button.querySelector('.hide-eye');
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        if (show) show.style.display = isPassword ? 'none' : '';
        if (hide) hide.style.display = isPassword ? '' : 'none';
      });
    });

    document.getElementById('na-login-id')?.addEventListener('input', () => {
      setFieldState('na-login-id', 'na-login-id-error', '');
    });

    document.getElementById('na-login-pass')?.addEventListener('input', () => {
      setFieldState('na-login-pass', 'na-login-pass-error', '');
    });

    document.getElementById('na-remember-label')?.addEventListener('click', () => {
      remember = !remember;
      document.getElementById('na-remember-check')?.classList.toggle('checked', remember);
    });

    document.getElementById('na-forgot-link')?.addEventListener('click', (event) => {
      event.preventDefault();
      toast('تواصل مع المدير لإعادة ضبط كلمة المرور.');
    });

    document.getElementById('na-login-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();

      const identity = document.getElementById('na-login-id').value.trim();
      const password = document.getElementById('na-login-pass').value;

      setFieldState('na-login-id', 'na-login-id-error', identity ? '' : 'البريد الإلكتروني أو رقم الموبايل مطلوب');
      setFieldState('na-login-pass', 'na-login-pass-error', password ? '' : 'كلمة المرور مطلوبة');
      if (!identity || !password) return;

      setLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 350));

      try {
        const user = await NadirUsers.authenticate(identity, password);
        if (!user) {
          setFieldState('na-login-pass', 'na-login-pass-error', 'بيانات الدخول غير صحيحة');
          return;
        }

        NadirUsers.writeSession(user);
        if (remember) NadirUsers.rememberUser(user);
        else NadirUsers.clearRemembered();

        showSuccess(`مرحبًا ${user.name}`, 'جارٍ تجهيز الواجهة المناسبة...');
      } catch (error) {
        setFieldState('na-login-pass', 'na-login-pass-error', error?.message || 'تعذر تسجيل الدخول');
      } finally {
        setLoading(false);
      }
    });

    const remembered = NadirUsers.readRemembered();
    if (remembered?.email || remembered?.mobile) {
      document.getElementById('na-login-id').value = remembered.email || remembered.mobile || '';
      remember = true;
      document.getElementById('na-remember-check')?.classList.add('checked');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.title = 'الحبيب للتجارة والتوزيع';
    document.querySelector('link[rel="icon"]')?.setAttribute('href', 'icons/mm-logo.png');
    document.querySelector('link[rel="shortcut icon"]')?.setAttribute('href', 'icons/mm-logo.png');
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', 'icons/mm-logo.png');
    injectStyles();
    renderTemplate();
    bind();
    const session = NadirUsers.readSession();
    if (session) window.location.href = 'index.html';
  });
})();
