# 🚀 إعداد nadir-pos مع Supabase

## الخطوة 1 — إنشاء مشروع Supabase

1. اذهب إلى [supabase.com](https://supabase.com) وسجّل دخول مجاني
2. اضغط **New Project**
3. اختر اسماً للمشروع (مثل: nadir-pos) وكلمة مرور للداتابيز
4. انتظر دقيقة حتى يتم إنشاء المشروع

## الخطوة 2 — إنشاء الجداول

1. في لوحة Supabase اضغط على **SQL Editor** من القائمة الجانبية
2. اضغط **New Query**
3. انسخ محتوى ملف `supabase_schema.sql` بالكامل والصقه
4. اضغط **Run** (أو Ctrl+Enter)
5. يجب أن تظهر رسالة "Success"

## الخطوة 3 — الحصول على بيانات الاتصال

1. اضغط على **Project Settings** (أيقونة الترس في الأسفل)
2. اضغط **API**
3. انسخ:
   - **Project URL** — مثال: `https://abcxyz.supabase.co`
   - **anon public** key (تحت Project API keys)

## الخطوة 4 — تعديل التطبيق

افتح ملف `js/app.js` وعدّل السطرين الأوائل:

```javascript
const SUPABASE_URL      = 'https://xxxx.supabase.co';   // ← رابطك هنا
const SUPABASE_ANON_KEY = 'eyJhbGc...';                 // ← مفتاحك هنا
```

## الخطوة 5 — تشغيل التطبيق

افتح ملف `index.html` في المتصفح، أو ارفعه على أي استضافة ويب.

---

## ملاحظات مهمة

- ✅ البيانات محفوظة على السحابة ومتاحة من أي جهاز
- ✅ Supabase مجاني حتى 500MB بيانات
- ⚠️ لا تشارك `SUPABASE_ANON_KEY` مع أشخاص لا تثق بهم
- 🔒 يمكن لاحقاً تفعيل Authentication الكامل في Supabase لحماية أفضل
