/**
 * backup.js — وحدة النسخ الاحتياطي والتصدير
 * يدعم تصدير: Excel (XLSX) | PDF | JSON
 * يستخدم SheetJS للـ Excel و html2canvas + jsPDF للـ PDF (دعم كامل للعربية)
 */

const BackupModule = (() => {

  // ─── حقن CSS الخاص بالموديول ───────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('backup-module-styles')) return;
    const style = document.createElement('style');
    style.id = 'backup-module-styles';
    style.textContent = `
      #backup-modal {
        display:none;position:fixed;inset:0;z-index:9999;
        background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);
        align-items:center;justify-content:center;
      }
      #backup-modal.open{display:flex}
      #backup-modal .modal-content{
        background:#1a1d2e;border-radius:12px;padding:24px;
        width:90%;max-width:480px;max-height:85vh;overflow-y:auto;
        direction:rtl;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#eee;
      }
      #backup-modal .modal-header{
        font-size:18px;font-weight:bold;color:#f0c040;text-align:center;
        margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid #2a2d3e;
      }
      #backup-modal .backup-section{
        background:#222640;border-radius:8px;padding:14px 16px;margin-bottom:12px;
      }
      #backup-modal .backup-section h4{margin:0 0 6px;font-size:14px;color:#f0c040}
      #backup-modal .backup-section p{margin:0 0 10px;font-size:12px;color:#aaa;line-height:1.6}
      #backup-modal .backup-section button{
        background:#f0c040;color:#111;border:none;border-radius:6px;
        padding:8px 16px;font-size:13px;font-weight:bold;cursor:pointer;
        margin:2px 4px;transition:background .2s;
      }
      #backup-modal .backup-section button:hover{background:#e0b030}
      #backup-modal .pdf-periods{display:flex;gap:6px;flex-wrap:wrap}
      #backup-modal .pdf-periods button{
        flex:1;min-width:60px;padding:6px 8px;font-size:12px;
        background:#2a2d3e;color:#f0c040;border:1px solid #f0c040;border-radius:6px;
      }
      #backup-modal .pdf-periods button:hover{background:#f0c040;color:#111}
      #backup-modal #backup-modal-close{
        display:block;width:100%;margin-top:12px;padding:10px;
        background:#2a2d3e;color:#aaa;border:1px solid #333;
        border-radius:8px;font-size:14px;cursor:pointer;text-align:center;
      }
      #backup-modal #backup-modal-close:hover{background:#333;color:#fff}
      #backup-modal #auto-backup-slider{
        width:42px;height:22px;border-radius:11px;background:#444;
        position:relative;cursor:pointer;display:inline-block;
        vertical-align:middle;margin-right:8px;transition:background .3s;
      }
      #backup-modal #auto-backup-slider span{
        position:absolute;top:3px;left:3px;width:16px;height:16px;
        border-radius:50%;background:#fff;transition:left .2s;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── جلب كل البيانات ───────────────────────────────────────────────────────
  async function fetchAllData() {
    const [products, shops, invoices, payments, movements, appSettings] = await Promise.all([
      DB.getAll('products'),
      DB.getAll('shops'),
      DB.getAllParsed('invoices'),
      DB.req('GET', 'invoice_payments', null, '?order=id.asc').then(r => r.map ? r : []),
      DB.req('GET', 'stock_movements',  null, '?order=id.asc').then(r => r.map ? r : []),
      DB.getAll('app_settings').catch(() => []),
    ]);
    return {
      products,
      shops,
      invoices,
      payments,
      movements,
      appSettings,
      users: typeof NadirUsers !== 'undefined' ? NadirUsers.getAll() : [],
      debts: readJsonSafe('nadir_old_debts', {}),
    };
  }

  // ─── تصدير JSON ────────────────────────────────────────────────────────────
  async function exportJSON() {
    showProgress('جاري تجميع البيانات...');
    try {
      const data = await fetchAllData();
      const backup = {
        version: '1.1',
        exportedAt: new Date().toISOString(),
        store: DB.getStoreSettings(),
        data,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `ALHABIB-backup-${dateStamp()}.json`);
      Toast.success('✅ تم تصدير النسخة الاحتياطية');
    } catch (e) {
      Toast.error('فشل التصدير: ' + e.message);
    } finally {
      hideProgress();
    }
  }

  // ─── تصدير Excel ───────────────────────────────────────────────────────────
  async function exportExcel() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    showProgress('جاري إنشاء ملف Excel...');
    try {
      const { products, shops, invoices, payments, movements } = await fetchAllData();
      const paymentsMap = buildInvoicePaymentsMap(payments);
      const wb = XLSX.utils.book_new();

      addSheet(wb, products.map(p => ({
        'الكود': p.id, 'الاسم': p.name, 'سعر البيع': p.price,
        'تكلفة الشراء': p.cost, 'الكمية': p.quantity, 'حد التنبيه': p.minStock,
        'الباركود': p.barcode || '', 'التصنيف': p.category || '',
        'تاريخ الإضافة': fmtDate(p.createdAt),
      })), 'المنتجات');

      addSheet(wb, shops.map(s => ({
        'الكود': s.id, 'الاسم': s.name, 'المسؤول': s.contact || '',
        'الهاتف': s.phone || '', 'البريد': s.email || '', 'العنوان': s.address || '',
        'الرصيد المديون': s.balance || 0, 'تاريخ الإضافة': fmtDate(s.createdAt),
      })), 'العملاء');

      addSheet(wb, invoices.map(inv => {
        const amountPaid = getInvoicePaidAmount(inv, paymentsMap);
        return ({
        'رقم الفاتورة': inv.number, 'العميل': inv.shopName || 'زبون عادي',
        'التاريخ': fmtDate(inv.createdAt), 'المجموع الفرعي': inv.subtotal || 0,
        'الخصم': inv.discount || 0, 'الضريبة': inv.tax || 0,
        'الإجمالي': inv.total, 'المدفوع': amountPaid,
        'المتبقي': Math.max(0, (inv.total || 0) - amountPaid),
        'الحالة': statusLabel(inv.status), 'مرتجع': inv.isReturn ? 'نعم' : 'لا',
        'ملاحظة': inv.note || '',
        'عدد الأصناف': Array.isArray(inv.items) ? inv.items.length : 0,
      })}), 'الفواتير');

      const itemRows = [];
      invoices.forEach(inv => {
        (Array.isArray(inv.items) ? inv.items : []).forEach(item => {
          itemRows.push({
            'رقم الفاتورة': inv.number, 'تاريخ الفاتورة': fmtDate(inv.createdAt),
            'العميل': inv.shopName || 'زبون عادي', 'المنتج': item.name,
            'الكمية': item.qty, 'سعر الوحدة': item.price,
            'تكلفة الوحدة': item.costAtTime || 0,
            'الإجمالي': item.price * item.qty,
            'الربح': (item.price - (item.costAtTime || 0)) * item.qty,
          });
        });
      });
      addSheet(wb, itemRows, 'بنود الفواتير');

      addSheet(wb, payments.map(p => ({
        'الكود': p.id, 'رقم الفاتورة': p.invoice_number || p.invoiceNumber || '',
        'المبلغ': parseFloat(p.amount) || 0,
        'طريقة الدفع': p.payment_method || p.paymentMethod || 'نقدي',
        'تاريخ الدفع': fmtDate(p.paid_at || p.paidAt || p.created_at),
        'ملاحظة': p.note || '',
      })), 'الدفعات');

      addSheet(wb, movements.map(m => ({
        'التاريخ': fmtDate(m.created_at || m.createdAt),
        'المنتج': m.product_name || m.productName || '',
        'النوع': m.type === 'in' ? 'وارد' : 'صادر', 'الكمية': m.qty,
        'قبل': m.balance_before ?? m.balanceBefore,
        'بعد': m.balance_after ?? m.balanceAfter,
        'السبب': m.reason || '',
        'رقم الفاتورة': m.invoice_number || m.invoiceNumber || '',
      })), 'حركة المخزون');

      const totalSales = invoices.filter(i => !i.isReturn && i.status !== 'void').reduce((s, i) => s + (i.total || 0), 0);
      const totalPaid  = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      const totalDebt  = shops.reduce((s, sh) => s + (parseFloat(sh.balance) || 0), 0);
      addSheet(wb, [
        { 'البيان': 'إجمالي المبيعات',    'القيمة': totalSales },
        { 'البيان': 'إجمالي المحصّل',    'القيمة': totalPaid },
        { 'البيان': 'إجمالي المديونيات', 'القيمة': totalDebt },
        { 'البيان': 'عدد الفواتير',       'القيمة': invoices.filter(i => !i.isReturn && i.status !== 'void').length },
        { 'البيان': 'عدد العملاء',        'القيمة': shops.length },
        { 'البيان': 'عدد المنتجات',       'القيمة': products.length },
        { 'البيان': 'تاريخ التصدير',      'القيمة': new Date().toLocaleString('ar-EG') },
      ], 'ملخص');

      XLSX.writeFile(wb, `ALHABIB-backup-${dateStamp()}.xlsx`);
      Toast.success('✅ تم تصدير ملف Excel بنجاح');
    } catch (e) {
      console.error(e);
      Toast.error('فشل التصدير: ' + e.message);
    } finally {
      hideProgress();
    }
  }

  // ─── تحميل مكتبات PDF ─────────────────────────────────────────────────────
  async function loadPdfLibs() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }

  // ─── بناء HTML التقرير ─────────────────────────────────────────────────────
  function buildReportHTML(data) {
    const { store, periodLabel, filteredInv, filteredRet, topProds, latestInv,
            netSales, totalPaid, remaining, avgInvoice } = data;

    const kpi = (label, value) => `
      <div style="flex:1;background:#1e2435;border-radius:6px;padding:10px 8px;text-align:center;min-width:120px;">
        <div style="font-size:11px;color:#8892a4;margin-bottom:4px;">${label}</div>
        <div style="font-size:16px;font-weight:bold;color:#f0c040;">${value}</div>
      </div>`;

    const tr = (cells, isHeader) => {
      const bg = isHeader ? 'background:#0f1117;' : '';
      const cl = isHeader ? 'color:#f0c040;font-weight:bold;' : 'color:#222;';
      return `<tr style="${bg}">${cells.map(c =>
        `<td style="padding:6px 8px;border:1px solid #e0e0e0;text-align:center;font-size:12px;${cl}">${c}</td>`
      ).join('')}</tr>`;
    };

    const prodsTable = topProds.length === 0
      ? '<p style="color:#999;text-align:center;">لا توجد بيانات</p>'
      : `<table style="width:100%;border-collapse:collapse;margin-top:6px;">
          ${tr(['#', 'المنتج', 'الكمية', 'الإيرادات (ج.م)'], true)}
          ${topProds.map((p, i) => tr([i + 1, p.name, p.qty, fmt(p.revenue)])).join('')}
        </table>`;

    const invTable = latestInv.length === 0
      ? '<p style="color:#999;text-align:center;">لا توجد فواتير</p>'
      : `<table style="width:100%;border-collapse:collapse;margin-top:6px;">
          ${tr(['رقم الفاتورة', 'العميل', 'التاريخ', 'الإجمالي', 'المدفوع', 'الحالة'], true)}
          ${latestInv.map(inv => tr([
            inv.number,
            (inv.shopName || 'زبون عادي').substring(0, 18),
            fmtDate(inv.createdAt),
            fmt(inv.total),
            fmt(inv.amountPaid || 0),
            statusLabel(inv.status),
          ])).join('')}
        </table>`;

    return `
      <div id="pdf-report-container" dir="rtl" style="
        width:750px;padding:20px 24px;
        font-family:'Segoe UI','Tahoma','Cairo','Arial',sans-serif;
        background:#fff;color:#222;line-height:1.6;">

        <div style="background:#0f1117;border-radius:8px;padding:14px;text-align:center;margin-bottom:16px;">
          <div style="font-size:22px;font-weight:bold;color:#f0c040;">${store.name || 'الحبيب'}</div>
          <div style="font-size:12px;color:#b4b4b4;margin-top:4px;">
            ${(store.address || '') + (store.address && store.phone ? '  ·  ' : '') + (store.phone ? 'Tel: ' + store.phone : '')}
          </div>
        </div>

        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:18px;font-weight:bold;">تقرير المبيعات — ${periodLabel}</div>
          <div style="font-size:11px;color:#666;">تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}</div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:8px;">
          ${kpi('صافي المبيعات', fmt(netSales) + ' ج.م')}
          ${kpi('المحصّل', fmt(totalPaid) + ' ج.م')}
          ${kpi('المتبقي', fmt(remaining) + ' ج.م')}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:18px;">
          ${kpi('عدد الفواتير', filteredInv.length)}
          ${kpi('المرتجعات', filteredRet.length)}
          ${kpi('متوسط الفاتورة', fmt(avgInvoice) + ' ج.م')}
        </div>

        <div style="font-size:15px;font-weight:bold;color:#1e2435;margin-bottom:4px;">أعلى المنتجات مبيعاً</div>
        ${prodsTable}

        <div style="font-size:15px;font-weight:bold;color:#1e2435;margin:18px 0 4px;">آخر 20 فاتورة</div>
        ${invTable}

        <div style="text-align:center;font-size:10px;color:#999;margin-top:20px;border-top:1px solid #eee;padding-top:8px;">
          الحبيب للتجارة والتوزيع — تم التصدير تلقائياً
        </div>
      </div>`;
  }

  // ─── تصدير PDF ─────────────────────────────────────────────────────────────
  async function exportPDF(period = 'all') {
    showProgress('جاري تحميل المكتبات...');
    await loadPdfLibs();

    showProgress('جاري تجميع البيانات...');
    try {
      const { products, shops, invoices, payments } = await fetchAllData();
      const store = DB.getStoreSettings();
      const invoicePaymentsMap = buildInvoicePaymentsMap(payments);

      const { from, to } = getDateRange(period);
      const filteredInv = invoices.filter(inv => {
        const d = new Date(inv.createdAt);
        return d >= from && d <= to && !inv.isReturn && inv.status !== 'void';
      });
      const filteredRet = invoices.filter(inv => {
        const d = new Date(inv.createdAt);
        return d >= from && d <= to && inv.isReturn;
      });
      const filteredInvoiceIds = new Set(filteredInv.map(inv => String(inv.id)));
      const filteredPay = payments.filter(p => {
        const d = new Date(p.paid_at || p.paidAt || p.created_at || 0);
        const invoiceId = p.invoiceId ?? p.invoice_id;
        return d >= from && d <= to && filteredInvoiceIds.has(String(invoiceId));
      });

      const totalSales   = filteredInv.reduce((s, i) => s + (i.total || 0), 0);
      const totalReturns = filteredRet.reduce((s, i) => s + (i.total || 0), 0);
      const totalPaid    = filteredPay.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      const netSales     = totalSales - totalReturns;
      const remaining    = Math.max(0, netSales - totalPaid);
      const avgInvoice   = filteredInv.length ? totalSales / filteredInv.length : 0;

      const periodLabels = {
        today: 'اليوم', '7days': 'آخر 7 أيام', month: 'هذا الشهر',
        year: 'هذه السنة', all: 'كل الفترات',
      };

      const prodSales = {};
      filteredInv.forEach(inv => {
        (inv.items || []).forEach(item => {
          if (!prodSales[item.productId])
            prodSales[item.productId] = { name: item.name, qty: 0, revenue: 0 };
          prodSales[item.productId].qty     += item.qty;
          prodSales[item.productId].revenue += item.price * item.qty;
        });
      });
      const topProds = Object.values(prodSales).sort((a, b) => b.qty - a.qty).slice(0, 10);

      const latestInv = [...filteredInv]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20)
        .map(inv => ({
          ...inv,
          amountPaid: getInvoicePaidAmount(inv, invoicePaymentsMap),
        }));

      showProgress('جاري بناء التقرير...');

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;top:-9999px;left:-9999px;z-index:-1;';
      wrapper.innerHTML = buildReportHTML({
        store, periodLabel: periodLabels[period] || period,
        filteredInv, filteredRet, filteredPay, topProds, latestInv,
        totalSales, totalReturns, totalPaid, netSales, remaining, avgInvoice,
      });
      document.body.appendChild(wrapper);

      const container = wrapper.querySelector('#pdf-report-container');

      showProgress('جاري حفظ الملف...');
      const canvas = await html2canvas(container, {
        scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
      });
      document.body.removeChild(wrapper);

      const { jsPDF } = window.jspdf;
      const pdf    = new jsPDF('p', 'mm', 'a4');
      const pw     = pdf.internal.pageSize.getWidth();
      const ph     = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const iw     = pw - margin * 2;
      const ih     = (canvas.height * iw) / canvas.width;

      if (ih <= ph - margin * 2) {
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, iw, ih);
      } else {
        let y = 0;
        const pc  = document.createElement('canvas');
        const ctx = pc.getContext('2d');
        const sph = ((ph - margin * 2) / iw) * canvas.width;
        pc.width  = canvas.width;

        while (y < canvas.height) {
          const sh = Math.min(sph, canvas.height - y);
          pc.height = sh;
          ctx.clearRect(0, 0, pc.width, pc.height);
          ctx.drawImage(canvas, 0, y, canvas.width, sh, 0, 0, canvas.width, sh);
          const pih = (sh * iw) / canvas.width;
          if (y > 0) pdf.addPage();
          pdf.addImage(pc.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, iw, pih);
          y += sh;
        }
      }

      pdf.save(`ALHABIB-report-${period}-${dateStamp()}.pdf`);
      localStorage.setItem('nadir_last_backup', new Date().toISOString());
      Toast.success('✅ تم تصدير تقرير PDF بنجاح');

    } catch (e) {
      console.error('[exportPDF]', e);
      Toast.error('فشل إنشاء PDF: ' + e.message);
    } finally {
      hideProgress();
    }
  }

  // ─── استيراد JSON ──────────────────────────────────────────────────────────
  async function importJSON(file) {
    if (!file) return;
    showProgress('جاري قراءة الملف...');
    try {
      if (!DB.hasRemoteConfig() || !DB.isOnline()) {
        throw new Error('الاستيراد الكامل يحتاج اتصالًا مباشرًا بقاعدة البيانات');
      }

      const text   = await file.text();
      const backup = JSON.parse(text);
      const summary = validateBackupPayload(backup);
      if (!summary.ok) throw new Error(summary.message);

      const { data } = backup;
      const msg = `سيتم استيراد أو تحديث:\n• ${data.products?.length || 0} منتج\n• ${data.shops?.length || 0} عميل\n• ${data.invoices?.length || 0} فاتورة\n• ${data.payments?.length || 0} دفعة\n• ${data.movements?.length || 0} حركة مخزون\n• ${data.users?.length || 0} مستخدم\n\nلن يتم حذف البيانات الحالية، وسيتم التحديث حسب نفس المعرف.\nهل تريد المتابعة؟`;
      if (!confirm(msg)) { hideProgress(); return; }

      const tableJobs = [
        { key: 'products', table: 'products', rows: data.products || [] },
        { key: 'shops', table: 'shops', rows: data.shops || [] },
        { key: 'invoices', table: 'invoices', rows: data.invoices || [] },
        { key: 'payments', table: 'invoice_payments', rows: data.payments || [] },
        { key: 'movements', table: 'stock_movements', rows: data.movements || [] },
        { key: 'appSettings', table: 'app_settings', rows: data.appSettings || [] },
      ];

      const totalRows = tableJobs.reduce((sum, job) => sum + job.rows.length, 0);
      let processedRows = 0;

      for (const job of tableJobs) {
        for (const row of job.rows) {
          await DB.rawUpsert(job.table, normalizeBackupRow(job.table, row));
          processedRows++;
          if (processedRows % 10 === 0 || processedRows === totalRows) {
            showProgress(`جاري الاستيراد... ${processedRows}/${totalRows}`);
          }
        }
      }

      if (Array.isArray(data.users) && typeof NadirUsers !== 'undefined') {
        NadirUsers.saveAll(data.users);
      }
      if (data.debts && typeof data.debts === 'object') {
        localStorage.setItem('nadir_old_debts', JSON.stringify(data.debts));
      }
      if (backup.store) {
        DB.saveStoreSettings(backup.store);
      }

      hideProgress();
      Toast.success(`✅ تم استيراد النسخة الاحتياطية بنجاح`);
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      hideProgress();
      Toast.error('فشل الاستيراد: ' + e.message);
    }
  }

  // ─── النافذة الرئيسية ──────────────────────────────────────────────────────
  function openModal() {
    let modal = document.getElementById('backup-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'backup-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">النسخ الاحتياطي والتصدير</div>

          <div class="backup-section">
            <h4>📊 تصدير Excel (موصى به)</h4>
            <p>يصدّر جميع البيانات في ملف XLSX منظم: منتجات · عملاء · فواتير · بنود · دفعات · حركة مخزون · ملخص</p>
            <button onclick="BackupModule.exportExcel()">تصدير Excel الآن</button>
          </div>

          <div class="backup-section">
            <h4>📄 تقرير PDF</h4>
            <p>تقرير مبيعات جاهز للطباعة أو المشاركة</p>
            <div class="pdf-periods">
              <button onclick="BackupModule.exportPDF('today')">اليوم</button>
              <button onclick="BackupModule.exportPDF('month')">الشهر</button>
              <button onclick="BackupModule.exportPDF('year')">السنة</button>
              <button onclick="BackupModule.exportPDF('7days')">7 أيام</button>
              <button onclick="BackupModule.exportPDF('all')">الكل</button>
            </div>
          </div>

          <div class="backup-section">
            <h4>💾 نسخة احتياطية JSON</h4>
            <p>نسخة كاملة من البيانات والإعدادات والمستخدمين — مناسبة للاستعادة أو النقل</p>
            <div>
              <button onclick="BackupModule.exportJSON()">تصدير</button>
              <button onclick="document.getElementById('import-json-input').click()">استيراد</button>
            </div>
            <input type="file" id="import-json-input" accept=".json" style="display:none"
              onchange="BackupModule.importJSON(this.files[0])">
          </div>

          <div class="backup-section">
            <h4>⚙️ إعدادات النسخ التلقائي</h4>
            <p>
              تذكير يومي بالنسخ الاحتياطي
              <div id="auto-backup-slider"
                onclick="BackupModule.toggleAutoBackup(localStorage.getItem('nadir_auto_backup')!=='true')">
                <span></span>
              </div>
            </p>
            <div id="last-backup-info" style="font-size:12px;color:#888;margin-top:6px;"></div>
          </div>

          <button id="backup-modal-close">إغلاق</button>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#backup-modal-close').onclick = closeModal;
      modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    }

    const lastBackup = localStorage.getItem('nadir_last_backup');
    const infoEl = modal.querySelector('#last-backup-info');
    if (infoEl) {
      infoEl.textContent = lastBackup
        ? 'آخر نسخة: ' + new Date(lastBackup).toLocaleString('ar-EG')
        : 'لم يتم عمل نسخة احتياطية بعد';
    }
    modal.classList.add('open');
  }

  function closeModal() {
    document.getElementById('backup-modal')?.classList.remove('open');
  }

  // ─── النسخ التلقائي ────────────────────────────────────────────────────────
  function toggleAutoBackup(enabled) {
    localStorage.setItem('nadir_auto_backup', enabled ? 'true' : 'false');
    const slider = document.getElementById('auto-backup-slider');
    if (slider) {
      slider.style.background = enabled ? '#f0c040' : '#444';
      const knob = slider.querySelector('span');
      if (knob) knob.style.left = enabled ? '21px' : '3px';
    }
    Toast.info(enabled ? '🔔 تذكير النسخ الاحتياطي مفعّل' : '🔕 تم إيقاف التذكير');
  }

  function checkAutoBackupReminder() {
    if (localStorage.getItem('nadir_auto_backup') === 'false') return;
    const last = localStorage.getItem('nadir_last_backup');
    if (!last) return;
    const daysSince = (Date.now() - new Date(last).getTime()) / 86400000;
    if (daysSince >= 1) {
      setTimeout(() => {
        Toast.show('💾 لم تقم بنسخة احتياطية منذ ' + Math.floor(daysSince) + ' يوم — اضغط هنا', 'info', 6000);
        const toastEl = document.querySelector('.toast.show');
        if (toastEl) { toastEl.style.cursor = 'pointer'; toastEl.onclick = openModal; }
      }, 3000);
    }
  }

  // ─── زر الهيدر ─────────────────────────────────────────────────────────────
  function injectHeaderButton() {
    if (typeof OpsMeta !== 'undefined' && !OpsMeta.isAdmin()) return;
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions || document.getElementById('backup-header-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'backup-header-btn';
    btn.className = 'btn btn-secondary btn-sm';
    btn.style.cssText = 'padding:6px 10px;min-height:32px;';
    btn.title = 'نسخ احتياطي';
    btn.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16"/></svg>`;
    btn.onclick = openModal;
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) headerActions.insertBefore(btn, logoutBtn);
    else headerActions.appendChild(btn);
  }

  // ─── Progress ──────────────────────────────────────────────────────────────
  function showProgress(msg = 'جاري المعالجة...') {
    let el = document.getElementById('backup-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'backup-progress';
      el.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(15,17,23,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;';
      el.innerHTML = `
        <div style="width:36px;height:36px;border:3px solid #333;border-top-color:#f0c040;border-radius:50%;animation:bk-spin .8s linear infinite;"></div>
        <div id="backup-progress-msg" style="color:#eee;font-size:14px;"></div>
        <style>@keyframes bk-spin{to{transform:rotate(360deg)}}</style>`;
      document.body.appendChild(el);
    }
    document.getElementById('backup-progress-msg').textContent = msg;
    el.style.display = 'flex';
  }

  function hideProgress() {
    const el = document.getElementById('backup-progress');
    if (el) el.style.display = 'none';
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function addSheet(wb, rows, name) {
    if (!rows.length) rows = [{ '(لا توجد بيانات)': '' }];
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    localStorage.setItem('nadir_last_backup', new Date().toISOString());
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-GB'); } catch { return iso; }
  }

  function fmt(n) { return parseFloat(n || 0).toFixed(2); }

  function buildInvoicePaymentsMap(payments = []) {
    return (Array.isArray(payments) ? payments : []).reduce((acc, payment) => {
      const invoiceId = payment?.invoiceId ?? payment?.invoice_id;
      if (invoiceId === undefined || invoiceId === null || invoiceId === '') return acc;
      acc[invoiceId] = (acc[invoiceId] || 0) + (parseFloat(payment.amount) || 0);
      return acc;
    }, {});
  }

  function getInvoicePaidAmount(invoice, paymentsMap = {}) {
    const invoiceId = invoice?.id;
    if (invoiceId !== undefined && invoiceId !== null && Object.prototype.hasOwnProperty.call(paymentsMap, invoiceId)) {
      return parseFloat(paymentsMap[invoiceId]) || 0;
    }
    return parseFloat(invoice?.amountPaid) || 0;
  }

  function readJsonSafe(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function validateBackupPayload(backup) {
    if (!backup || typeof backup !== 'object') {
      return { ok: false, message: 'ملف النسخة الاحتياطية غير صالح' };
    }
    if (!backup.version || !backup.data || typeof backup.data !== 'object') {
      return { ok: false, message: 'الملف لا يحتوي على بنية نسخة احتياطية صحيحة' };
    }
    const requiredLists = ['products', 'shops', 'invoices', 'payments', 'movements'];
    for (const key of requiredLists) {
      if (!Array.isArray(backup.data[key])) {
        return { ok: false, message: `قسم ${key} مفقود أو غير صالح داخل الملف` };
      }
    }
    return { ok: true, message: '' };
  }

  function normalizeBackupRow(table, row) {
    const next = { ...(row || {}) };
    if (table === 'invoices' && Array.isArray(next.items)) {
      next.items = JSON.stringify(next.items);
    }
    if (table === 'invoice_payments') {
      next.invoiceId = next.invoiceId ?? next.invoice_id ?? null;
      next.shopId = next.shopId ?? next.shop_id ?? null;
      next.paymentMethod = next.paymentMethod ?? next.payment_method ?? 'cash';
      next.paidAt = next.paidAt ?? next.paid_at ?? next.createdAt ?? next.created_at ?? null;
    }
    if (table === 'stock_movements') {
      next.productId = next.productId ?? next.product_id ?? null;
      next.productName = next.productName ?? next.product_name ?? '';
      next.invoiceId = next.invoiceId ?? next.invoice_id ?? null;
      next.invoiceNumber = next.invoiceNumber ?? next.invoice_number ?? '';
      next.balanceBefore = next.balanceBefore ?? next.balance_before ?? 0;
      next.balanceAfter = next.balanceAfter ?? next.balance_after ?? 0;
    }
    return next;
  }

  function statusLabel(s) {
    return { paid:'مدفوعة', pending:'معلقة', partial:'جزئي', void:'ملغاة' }[s] || s || '';
  }

  function getDateRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (period) {
      case 'today':  return { from: today, to: new Date(today.getTime() + 86399999) };
      case '7days':  return { from: new Date(today.getTime() - 6*86400000), to: new Date(today.getTime() + 86399999) };
      case 'month':  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59) };
      case 'year':   return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
      default:       return { from: new Date(0), to: new Date(9999, 0) };
    }
  }

  // ─── init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    injectHeaderButton();
    checkAutoBackupReminder();
  }

  return { init, openModal, exportJSON, exportExcel, exportPDF, importJSON, toggleAutoBackup };

})();
