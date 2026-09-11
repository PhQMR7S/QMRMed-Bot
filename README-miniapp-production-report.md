# تقرير إصلاح QMRMed Telegram Mini App

## النتيجة

تم تحويل Mini App الحالية داخل مستودع `QMRMed-Bot` إلى واجهة تعتمد على بيانات الحساب الحقيقية من Telegram وPrisma/PostgreSQL، مع الحفاظ على منطق البوت الحالي للدراسة والاشتراكات وTelegram Stars وأكواد التفعيل. لم يتم إنشاء قاعدة بيانات أو نظام دفع أو archive مستقل.

**Commit:** `268ab24` — `Make Telegram Mini App production-ready`

## الملفات المعدلة

| الملف | التغيير |
|---|---|
| `src/miniapp.ts` | تحقق server-side من Telegram initData، ربط `/api/me` و`/api/plans` و`/api/archive` بالـ database، جلب صورة Telegram من Bot API server-side، وتطبيق user-scoping للأرشيف. |
| `src/index.ts` | دعم deep-links من Mini App إلى تدفقات الاشتراك والتفعيل الحالية في البوت عبر `/start plans` و`/start activation`. |
| `miniapp/index.html` | إزالة بيانات الحساب الثابتة واستبدالها بـ loading shell آمن. |
| `miniapp/runtime.js` | إعادة بناء rendering ليستخدم payload الحقيقي من backend، مع loading/success/empty/error/retry، profile photo، الخطط والأسعار الحقيقية، وروابط Telegram. |
| `miniapp/styles.css` | إضافة تنسيق صورة الحساب، مدد الخطط، وحالات الشاشات الصغيرة. |
| `miniapp/app.js` و`miniapp/bootstrap.js` | حذف السكربتات القديمة غير المستخدمة التي كانت تحتوي fallbackات حساب قديمة. |
| `tests/miniapp-static.test.ts` | تحديث اختبارات shell ومنع fake account data والتحقق من retry/photo rendering. |
| `tests/miniapp-auth.test.ts` | إضافة اختبارات HMAC، tampering، وانتهاء صلاحية initData. |
| `package-lock.json` | تثبيت dependency lockfile الناتج عن `npm install`. |

## المصادقة ومزامنة المستخدم

يقرأ backend قيمة `X-Telegram-Init-Data`، ويتحقق من HMAC/hash و`auth_date` ووجود Telegram user ID وانتهاء الصلاحية. بعد نجاح التحقق يستخدم `upsertTelegramUser` على `telegramId` الفعلي، فلا يمكن للمستخدم تمرير Telegram ID عشوائي للوصول إلى حساب آخر.

يُرجع `/api/me` البيانات من المستخدم الحقيقي، بما في ذلك الاسم وusername وdepartment وstage والخطة والتجربة والاشتراك والتقدم وعدد عناصر الأرشيف.

## صورة الحساب

يستخدم backend `BOT_TOKEN` فقط على الخادم لاستدعاء `getUserProfilePhotos` ثم `getFile` من Telegram Bot API. لا يتم إرسال token إلى المتصفح. تعاد الصورة كـ data URL قصير العمر ضمن `/api/me`، وإذا لم توجد صورة يستخدم frontend أول حرف من اسم المستخدم كـ fallback أنيق دون عرض رسالة خطأ.

## الاشتراك والتفعيل

لا توجد أي عملية شراء أو تفعيل داخل Mini App. `/api/plans` يعرض الأسعار والمدد من `config` الفعلي، والزر يفتح deep-link إلى QMRMed Bot. أضيف دعم payloads التالية في `/start`:

- `plans` / `subscription` / `subscribe` لفتح `plansMenu()` الحالي.
- `activation` / `activate` / `redeem` لفتح تدفق كود التفعيل الحالي.

تظل عمليات Telegram Stars والتحقق من الفاتورة وتفعيل Subscription داخل `payments.ts` و`activation.ts` كما هي.

## الأرشيف

أصبح `FileAiArchive` في Prisma هو مصدر البيانات الدائم الوحيد للـ Mini App. تمت إزالة fallback القراءة من مجلد محلي من endpoints، وتستخدم تفاصيل الأرشيف شرط `where: { id, userId }` لمنع وصول مستخدم إلى سجل مستخدم آخر.

## الواجهة وتجربة الاستخدام

تم الحفاظ على RTL وواجهة QMRMed الداكنة وبطاقات glass والـ bottom navigation. أضيفت الحالات التالية لكل من الحساب والخطط والأرشيف:

- loading skeleton
- success
- empty archive
- error
- retry

لم تعد الشاشة تعرض بيانات تجريبية عند فشل API. كما تم حذف بيانات الحساب الثابتة من HTML الأولي.

## نتائج التحقق

| الفحص | النتيجة |
|---|---|
| `npm run check` | نجح |
| `npm run build` | نجح |
| `npm test` | نجح: **43/43** |
| Telegram initData valid signature | نجح |
| Telegram initData tampering rejection | نجح |
| Telegram initData expiry rejection | نجح |
| `/api/health` smoke test | نجح محليًا |
| Static `index.html` delivery | نجح محليًا |
| `git diff --check` | نجح |

## ملاحظة إنتاجية متبقية

لم يتم تنفيذ اختبار حي مع Telegram وPostgreSQL الإنتاجيين داخل هذه البيئة لعدم توفر أسرار `BOT_TOKEN` و`DATABASE_URL` الإنتاجية. قبل النشر النهائي يجب ضبط `BOT_TOKEN`, `DATABASE_URL`, `MINI_APP_BOT_USERNAME`, و`MINI_APP_URL` في بيئة التشغيل، ثم فتح Mini App من Telegram والتحقق من `/api/me` وصورة الحساب وخطتي الاشتراك والتفعيل بحساب حقيقي.
