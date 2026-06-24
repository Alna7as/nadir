/**
 * print.js — وحدة توليد الإيصال والطباعة والمشاركة
 * الإصلاحات:
 * - [إصلاح 10] STORE معلومات من DB.getStoreSettings() بدل hardcoded
 */

const PrintModule = (() => {

  let _currentInvoice = null;
  let _customPrintOptions = null;

  function getDebtSnapshot(invoice) {
    const oldDebt = parseFloat(invoice?.oldDebt) || 0;
    const newDebt = parseFloat(invoice?.newDebt) || 0;
    const totalDue = parseFloat(invoice?.totalDue) || parseFloat((oldDebt + newDebt).toFixed(2));
    const hasDebtInfo = !!invoice?.shopId && (oldDebt > 0.009 || newDebt > 0.009 || totalDue > 0.009);
    return { oldDebt, newDebt, totalDue, hasDebtInfo };
  }

  // ---- بناء HTML الإيصال ----
  function buildReceiptHTML(invoice) {
    // [إصلاح 10] جلب بيانات المتجر من الإعدادات
    const STORE = DB.getStoreSettings();
    const logoSrc = new URL('icons/mm-logo.png', window.location.href).href;
    const date = Utils.formatDateTime(invoice.createdAt || new Date().toISOString());
    const salesRepName = String(invoice.salesRepName || invoice.repName || 'المدير').trim() || 'المدير';

    const items = Utils.normalizeInvoiceItems(invoice.items);
    const total = parseFloat(invoice.total) || 0;
    const amountPaid = Math.max(0, parseFloat(invoice.amountPaid) || 0);
    const remaining = Math.max(0, total - amountPaid);
    const hasPaymentBreakdown = invoice.amountPaid !== undefined && invoice.amountPaid !== null;
    const emphasizePaid = hasPaymentBreakdown && total > 0 && amountPaid < total - 0.01;
    const debt = getDebtSnapshot(invoice);
    let itemsHTML = '';
    // [ميزة 4] كل منتج في سطر واحد: الاسم | السعر × العدد = الإجمالي
    items.forEach(item => {
      const name      = item.name || '';
      const lineTotal = Utils.currency(item.price * item.qty);

      itemsHTML += `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin:3px 0;font-size:11px;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:4px;">${escapeHtml(name)}</span>
          <span style="white-space:nowrap;color:#555;margin:0 4px;">${item.qty}×${Utils.currency(item.price)}</span>
          <span style="font-weight:700;white-space:nowrap;">${lineTotal}</span>
        </div>`;
    });

    let totalsHTML = `
      <div style="display:flex;justify-content:space-between;">
        <span>المجموع الجزئي</span>
        <span>${Utils.currency(invoice.subtotal)}</span>
      </div>`;

    if (invoice.discount && invoice.discount > 0) {
      totalsHTML += `
        <div style="display:flex;justify-content:space-between;">
          <span>خصم</span>
          <span>− ${Utils.currency(invoice.discount)}</span>
        </div>`;
    }
    if (invoice.tax && invoice.tax > 0) {
      const pct = invoice.taxPct ? ` (${invoice.taxPct}%)` : '';
      totalsHTML += `
        <div style="display:flex;justify-content:space-between;">
          <span>ضريبة${pct}</span>
          <span>+ ${Utils.currency(invoice.tax)}</span>
        </div>`;
    }

    const statusLabel = {
      paid: 'مدفوعة',
      pending: 'معلقة',
      partial: 'جزئي',
      void: 'ملغاة',
      return: 'مرتجع',
      draft: 'مسودة',
    }[invoice.status] || '';
    const paymentSystemLabel = amountPaid <= 0.009
      ? 'آجل'
      : amountPaid >= total - 0.01
        ? 'كامل'
        : 'جزئي';

    return `
      <div id="receipt-content" style="
        font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
        font-size: 13px;
        line-height: 1.75;
        color: #111;
        background: #fff;
        width: 100%;
        max-width: 360px;
        margin: 0 auto;
        padding: 14px 12px;
        word-break: break-word;
        direction: rtl;
        text-align: right;
      ">
        <div style="text-align:center;margin-bottom:8px;padding:4px 0 8px;">
          <img src="${logoSrc}" alt="Logo" style="width:28px;height:28px;object-fit:contain;display:block;margin:0 auto 6px;">
          <div style="font-size:14px;font-weight:900;letter-spacing:.2px;">${escapeHtml(STORE.name)}</div>
          <div style="font-size:10px;color:#333;font-weight:700;">${escapeHtml(STORE.address)}</div>
          <div style="font-size:10px;color:#333;font-weight:700;">${escapeHtml(STORE.phone)}</div>
        </div>

        <div style="border-top:1px dashed #999;margin:6px 0;"></div>

        <div style="font-size:11px;margin-bottom:8px;padding:4px 0;">
          <div style="display:flex;justify-content:space-between;">
            <span>فاتورة رقم</span>
            <span style="font-weight:900;">${escapeHtml(invoice.number)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span>التاريخ</span>
            <span>${date}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span>العميل</span>
            <span style="max-width:55%;text-align:left;overflow-wrap:break-word;font-weight:900;">${escapeHtml(invoice.shopName || 'زبون عادي')}</span>
          </div>
          
          <div style="display:flex;justify-content:space-between;">
            <span>المندوب</span>
            <span style="font-weight:900;">${escapeHtml(salesRepName)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex:1;">
              <span>نظام الدفع</span>
              <span style="font-weight:900;">${paymentSystemLabel}</span>
            </div>
          </div>
        </div>

        <div style="border-top:1px dashed #999;margin:6px 0;"></div>

        <div style="display:flex;justify-content:space-between;font-size:10px;color:#444;margin-bottom:4px;font-weight:900;padding:0 2px;">
          <span>الأصناف</span>
          <span>الإجمالي</span>
        </div>

        <div style="font-size:11px;margin-bottom:8px;padding:0;">
          ${itemsHTML}
        </div>

        <div style="border-top:1px solid #000;margin:6px 0;"></div>

        <div style="font-size:11px;margin-bottom:6px;padding:2px 0;">
          ${totalsHTML}
        </div>

        <div style="border-top:2px solid #000;margin:6px 0;"></div>
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:900;margin-bottom:6px;color:#111;padding:4px 0;">
          <span>${emphasizePaid ? 'المدفوع الآن' : 'إجمالي الفاتورة'}</span>
          <span>${Utils.currency(emphasizePaid ? amountPaid : total)}</span>
        </div>

        ${hasPaymentBreakdown ? `
        <div style="border-top:1px dashed #999;margin:6px 0;"></div>
        <div style="font-size:11px;">
          <div style="display:flex;justify-content:space-between;padding:2px 0;">
            <span>إجمالي الفاتورة</span>
            <span style="font-weight:700;">${Utils.currency(total)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:2px 0;">
            <span>المدفوع</span>
            <span style="font-weight:700;">${Utils.currency(amountPaid)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:2px 0;">
            <span>المتبقي</span>
            <span style="font-weight:700;">
              ${Utils.currency(remaining)}
            </span>
          </div>
        </div>
        ${remaining > 0 ? `<div style="margin-top:6px;padding:4px 0;font-size:12px;font-weight:900;text-align:center;">المطلوب سداده الآن: ${Utils.currency(remaining)}</div>` : ''}` : ''}

        ${debt.hasDebtInfo ? `
        <div style="border-top:1px dashed #999;margin:6px 0;"></div>
        <div style="font-size:11px;">
          <div style="display:flex;justify-content:space-between;padding:2px 0;">
            <span>المديونية القديمة</span>
            <span>${Utils.currency(debt.oldDebt)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:2px 0;">
            <span>المديونية الجديدة</span>
            <span>${Utils.currency(debt.newDebt)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-weight:700;">
            <span>إجمالي المستحق</span>
            <span>${Utils.currency(debt.totalDue)}</span>
          </div>
        </div>` : ''}

        ${invoice.note ? `
        <div style="border-top:1px dashed #999;margin:6px 0;padding-top:6px;font-size:10px;color:#555;">
          ملاحظة: ${escapeHtml(invoice.note)}
        </div>` : ''}

        <div style="border-top:1px dashed #999;margin:8px 0 4px;text-align:center;font-size:10px;color:#777;">
          ${STORE.footer ? `<div style="margin-top:6px;">${escapeHtml(STORE.footer)}</div>` : ''}
          <div style="margin-top:4px;font-size:9px;">powerd by ENG: hamada yasser</div>
          <div style="margin-top:2px;font-size:10px;font-weight:900;">01032190560</div>
        </div>
      </div>`;
  }

  function preview(invoice) {
    const modal = document.getElementById('print-modal');
    const area  = document.getElementById('print-preview-area');
    if (!modal || !area) return;
    _customPrintOptions = null;
    area.innerHTML = buildReceiptHTML(invoice);
    modal._invoice = invoice;
    _currentInvoice = invoice;
    const saveBtn = document.getElementById('save-invoice-print-btn');
    const shareBtn = document.getElementById('share-receipt-btn');
    const a4Btn = document.getElementById('print-a4-btn');
    if (saveBtn) saveBtn.style.display = '';
    if (shareBtn) shareBtn.style.display = '';
    if (a4Btn) a4Btn.style.display = '';
    modal.classList.add('open');
  }

  function previewCustom(html, options = {}) {
    const modal = document.getElementById('print-modal');
    const area  = document.getElementById('print-preview-area');
    if (!modal || !area) return;
    _customPrintOptions = {
      pageSize: options.pageSize || '55mm',
      title: options.title || 'طباعة',
    };
    area.innerHTML = html;
    modal._invoice = null;
    _currentInvoice = null;
    const saveBtn = document.getElementById('save-invoice-print-btn');
    const shareBtn = document.getElementById('share-receipt-btn');
    const a4Btn = document.getElementById('print-a4-btn');
    if (saveBtn) saveBtn.style.display = 'none';
    if (shareBtn) shareBtn.style.display = 'none';
    if (a4Btn) a4Btn.style.display = 'none';
    modal.classList.add('open');
  }

  function closePrintModal() {
    const modal = document.getElementById('print-modal');
    if (modal) modal.classList.remove('open');
  }

  function printReceipt() {
    const area = document.getElementById('print-preview-area');
    const content = area ? area.querySelector('#receipt-content') : null;
    if (!content) { Toast.error('لا يوجد محتوى للطباعة — افتح الفاتورة أولاً'); return; }
    const pageSize = _customPrintOptions?.pageSize || '58mm';
    const title = _customPrintOptions?.title || 'طباعة';

    const html = `<!DOCTYPE html><html dir="rtl"><head>
      <meta charset="UTF-8">
      <style>
        @page { margin: 0; size: ${pageSize} auto; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { width: ${pageSize}; max-width: ${pageSize}; background:#fff; }
        body { background: #fff; font-family: 'Segoe UI', Tahoma, Arial, monospace; direction: rtl; }
      </style>
    </head><body>${content.outerHTML}</body></html>`;

    const win = window.open('', '_blank', 'width=320,height=700');
    if (!win) { Toast.error('المتصفح منع نافذة الطباعة — اسمح بالـ popups'); return; }
    win.document.open();
    win.document.write(html.replace('<title></title>', `<title>${title}</title>`));
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
    setTimeout(() => { try { win.focus(); win.print(); } catch(e) {} }, 900);
  }

  async function shareReceipt() {
    const modal = document.getElementById('print-modal');
    const inv = modal?._invoice;
    if (!inv) return;

    const text = buildReceiptText(inv);

    if (navigator.share) {
      try {
        await navigator.share({ title: `فاتورة ${inv.number}`, text });
        Toast.success('تمت المشاركة ✓');
      } catch (err) {
        if (err.name !== 'AbortError') fallbackCopy(text);
      }
    } else {
      fallbackCopy(text);
    }
  }

  function buildReceiptText(invoice) {
    // [إصلاح 10] جلب بيانات المتجر من الإعدادات
    const STORE = DB.getStoreSettings();
    const items = Utils.normalizeInvoiceItems(invoice.items);
    const debt = getDebtSnapshot(invoice);
    const line = '─'.repeat(28);
    const date = Utils.formatDateTime(invoice.createdAt || new Date().toISOString());
    const salesRepName = String(invoice.salesRepName || invoice.repName || 'المدير').trim() || 'المدير';
    let text = '';

    text += `${STORE.name}\n`;
    text += `${STORE.address}\n`;
    text += `${STORE.phone}\n`;
    text += `${line}\n`;
    text += `فاتورة: ${invoice.number}\n`;
    text += `التاريخ: ${date}\n`;
    text += `العميل: ${invoice.shopName || 'زبون عادي'}\n`;
    text += `المندوب: ${salesRepName}\n`;
    text += `${line}\n`;

    items.forEach(item => {
      const rawName = item.name || '';
      const name = (typeof Intl !== 'undefined' && Intl.Segmenter)
        ? [...new Intl.Segmenter('ar', {granularity:'grapheme'}).segment(rawName)]
            .slice(0,18).map(s=>s.segment).join('')
        : rawName.substring(0, 18);
      const total = Utils.currency(item.price * item.qty);
      text += `${name}\n`;
      text += `  ${item.qty} × ${Utils.currency(item.price)} = ${total}\n`;
    });

    text += `${line}\n`;
    text += `المجموع الجزئي: ${Utils.currency(invoice.subtotal)}\n`;
    if (invoice.discount > 0) text += `خصم: − ${Utils.currency(invoice.discount)}\n`;
    if (invoice.tax > 0)      text += `ضريبة: + ${Utils.currency(invoice.tax)}\n`;
    text += `${line}\n`;
    const total = parseFloat(invoice.total) || 0;
    const amountPaid = Math.max(0, parseFloat(invoice.amountPaid) || 0);
    const remaining = Math.max(0, total - amountPaid);
    const hasPaymentBreakdown = invoice.amountPaid !== undefined && invoice.amountPaid !== null;
    text += `إجمالي الفاتورة: ${Utils.currency(total)}\n`;
    if (hasPaymentBreakdown) {
      text += `المدفوع:  ${Utils.currency(amountPaid)}\n`;
      text += `المتبقي:  ${Utils.currency(remaining)}\n`;
    }
    if (debt.hasDebtInfo) {
      text += `المديونية القديمة: ${Utils.currency(debt.oldDebt)}\n`;
      text += `المديونية الجديدة: ${Utils.currency(debt.newDebt)}\n`;
      text += `إجمالي المستحق: ${Utils.currency(debt.totalDue)}\n`;
    }
    text += `${line}\n`;
    if (invoice.note) text += `ملاحظة: ${invoice.note}\n`;
    if (STORE.footer) text += `${STORE.footer}\n`;
    text += `powerd by ENG: hamada yasser\n`;
    text += `01032190560\n`;

    return text;
  }

  function fallbackCopy(text) {
    navigator.clipboard.writeText(text)
      .then(() => Toast.success('تم نسخ الإيصال إلى الحافظة!'))
      .catch(() => Toast.error('تعذّر نسخ الإيصال'));
  }

  function printA4(invoice) {
    // [إصلاح 10] جلب بيانات المتجر من الإعدادات
    const STORE = DB.getStoreSettings();
    let items = Utils.normalizeInvoiceItems(invoice.items);
    const debt = getDebtSnapshot(invoice);
    const salesRepName = String(invoice.salesRepName || invoice.repName || 'المدير').trim() || 'المدير';
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>فاتورة ${escapeHtml(invoice.number)}</title>
    <style>
      body{font-family:Cairo,'Segoe UI',sans-serif;padding:32px;color:#111827;font-size:14px;max-width:880px;margin:0 auto;background:#fff;}
      h1{font-size:28px;font-weight:900;margin:0;}
      .sub{color:#333;font-size:12px;font-weight:700;}
      .header{display:flex;justify-content:space-between;gap:18px;padding:8px 0 18px;margin-bottom:18px;border-bottom:2px solid #111827;}
      .brand{display:flex;gap:14px;align-items:center;}
      .brand img{width:32px;height:32px;object-fit:contain;}
      table{width:100%;border-collapse:collapse;margin-top:16px;}
      th,td{padding:11px 12px;border:1px solid #d9dee7;text-align:right;}
      th{background:#f3f3f3;font-weight:900;}
      .totals{margin-top:20px;padding:12px 0;max-width:320px;margin-right:auto;background:#fff;border-top:2px solid #111827;border-bottom:2px solid #111827;}
      .tot-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;font-weight:700;}
      .tot-row.grand{font-weight:900;font-size:17px;border-top:1px solid #d9dee7;padding-top:10px;margin-top:6px;}
      .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;border:1px solid #111;color:#111;background:#fff;}
      @media print{button{display:none}}
    </style></head><body>
    <button onclick="window.print()" style="margin-bottom:20px;padding:8px 20px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:Cairo,sans-serif;">🖨 طباعة</button>
    <div class="header" style="align-items:flex-start;">
      <div class="brand"><img src="${new URL('icons/mm-logo.png', window.location.href).href}" alt="Logo"><div><h1>${escapeHtml(STORE.name)}</h1><div class="sub">${escapeHtml(STORE.phone)} | ${escapeHtml(STORE.address)}</div></div></div>
      <div style="text-align:left;">
        <div style="font-size:18px;font-weight:700;"># ${escapeHtml(invoice.number)}</div>
        <div class="sub">${Utils.formatDateTime(invoice.createdAt)}</div>
        <div style="margin-top:4px;"><span class="badge ${invoice.status}">${{paid:'مدفوعة',pending:'معلقة',void:'ملغاة',return:'مرتجع'}[invoice.status]||invoice.status}</span></div>
      </div>
    </div>
    <div style="margin:16px 0;padding:0 0 12px;border-bottom:1px solid #d9dee7;">
      <div><strong>العميل:</strong> ${escapeHtml(invoice.shopName || 'زبون عادي')}</div>
      <div style="margin-top:6px;"><strong>المندوب:</strong> ${escapeHtml(salesRepName)}</div>
    </div>
    <table>
      <thead><tr><th>المنتج</th><th>السعر × الكمية</th><th>الإجمالي</th></tr></thead>
      <tbody>${(items||[]).map((it)=>`<tr><td>${escapeHtml(it.name)}</td><td style="text-align:center;">${it.qty} × ${Utils.currency(it.price)}</td><td>${Utils.currency(it.price*it.qty)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="totals">
      <div class="tot-row"><span>المجموع الجزئي</span><span>${Utils.currency(invoice.subtotal)}</span></div>
      ${invoice.discount>0?`<div class="tot-row"><span>الخصم</span><span>- ${Utils.currency(invoice.discount)}</span></div>`:''}
      <div class="tot-row grand">
        <span>${invoice.amountPaid!==undefined&&invoice.amountPaid!==null&&(Math.max(0, parseFloat(invoice.amountPaid) || 0) < (parseFloat(invoice.total) || 0) - 0.01) ? 'المدفوع الآن' : 'إجمالي الفاتورة'}</span>
        <span>${Utils.currency(invoice.amountPaid!==undefined&&invoice.amountPaid!==null&&(Math.max(0, parseFloat(invoice.amountPaid) || 0) < (parseFloat(invoice.total) || 0) - 0.01) ? Math.max(0, parseFloat(invoice.amountPaid) || 0) : parseFloat(invoice.total) || 0)}</span>
      </div>
      ${invoice.amountPaid!==undefined&&invoice.amountPaid!==null?`
        <div class="tot-row"><span>إجمالي الفاتورة</span><span>${Utils.currency(parseFloat(invoice.total) || 0)}</span></div>
        <div class="tot-row"><span>المدفوع</span><span>${Utils.currency(Math.max(0, parseFloat(invoice.amountPaid) || 0))}</span></div>
        <div class="tot-row" style="font-weight:700;"><span>المتبقي</span><span>${Utils.currency(Math.max(0, (parseFloat(invoice.total) || 0) - (parseFloat(invoice.amountPaid) || 0)))}</span></div>
      `:''}
      ${debt.hasDebtInfo ? `
        <div class="tot-row"><span>المديونية القديمة</span><span>${Utils.currency(debt.oldDebt)}</span></div>
        <div class="tot-row"><span>المديونية الجديدة</span><span>${Utils.currency(debt.newDebt)}</span></div>
        <div class="tot-row" style="font-weight:700;"><span>إجمالي المستحق</span><span>${Utils.currency(debt.totalDue)}</span></div>
      ` : ''}
    </div>
    ${invoice.note?`<div style="margin-top:16px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:12px;">ملاحظة: ${escapeHtml(invoice.note)}</div>`:''}
    <div style="margin-top:24px;text-align:center;color:#666;font-size:11px;">
      ${STORE.footer ? `<div>${escapeHtml(STORE.footer)}</div>` : ''}
      <div style="margin-top:6px;">powerd by ENG: hamada yasser</div>
      <div style="margin-top:4px;font-weight:900;">01032190560</div>
    </div>
    </body></html>`);
    win.document.close();
  }

  function init() {
    const closeBtn = document.getElementById('print-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closePrintModal);

    const overlay = document.getElementById('print-modal');
    if (overlay) overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePrintModal();
    });

    const printBtn = document.getElementById('print-receipt-btn');
    if (printBtn) printBtn.addEventListener('click', printReceipt);

    const shareBtn = document.getElementById('share-receipt-btn');
    if (shareBtn) shareBtn.addEventListener('click', shareReceipt);

    const saveFromPrintBtn = document.getElementById('save-invoice-print-btn');
    if (saveFromPrintBtn) saveFromPrintBtn.addEventListener('click', () => {
      closePrintModal();
      Toast.success('تم حفظ الفاتورة ✓');
    });
  }

  return { init, preview, previewCustom, buildReceiptText, printA4, get currentInvoice() { return _currentInvoice; } };
})();
