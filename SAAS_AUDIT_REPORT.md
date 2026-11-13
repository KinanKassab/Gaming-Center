# SaaS Audit Report

تاريخ التدقيق: 2026-09-25. النطاق هو حالة شجرة العمل الحالية داخل `Code/`، بما فيها التغييرات المحلية غير الملتزم بها. لم يُعدّل أي كود أو ملف موجود؛ أُنشئت ملفات التقارير الثلاثة فقط.

## 1. Executive Summary

التطبيق أساس SaaS متعدد المؤسسات مبني على Next.js وPostgreSQL، ويحتوي على تدفقات الهوية والمؤسسات والفروع والعملاء وتشغيل الأجهزة والجلسات والفوترة والتحصيل وكتالوج POS المرتبط بالجلسات. توجد ضوابط جيدة في مسار المستأجر والصلاحيات، لكن الحالة الحالية ليست جاهزة للبناء أو لإغلاق التحقق: `typecheck` والبناء يفشلان، و13 اختباراً يفشل، كما أن صفحة كشف حساب العميل تمرر callback عبر حد Server/Client.

تم تشغيل التطبيق محلياً واستخدام المتصفح في التدفقات العامة، وفُحصت 28 صفحة و69 ملف API. قاعدة التشغيل كانت محلية باسم `gaming_center_security_test`، وبها 4 مستخدمين أساسيين لكن دون أي مؤسسة أو عضوية. لم تتوفر بيانات دخول اختبارية صالحة، لذلك تعذر اختبار CRUD ولوحة الإدارة كتجربة موظف مصادق. لا توجد دلائل على فساد بيانات في قاعدة التشغيل؛ لم تُنفّذ عمليات كتابة عليها.

## 2. Overall Health

| المجال | الحالة |
| --- | --- |
| Functionality | الأساسيات ظاهرة في الكود والاختبارات، لكن تدفقات الإدارة والتحصيل وPOS لم تُختبر عبر حساب مصادق. فشل 13 اختباراً آلياً. |
| UX | صفحات الدخول والحالات العامة واضحة، وتبديل اللغة والسمة يحفظ تفضيلاتهما. لا يمكن تقييم مسارات المستخدم الإداري كاملة دون حساب اختبار. |
| UI | النظام يستخدم tokens ومكوّنات مشتركة للجداول والنماذج والتنبيهات والحوارات. لا توجد ملاحظة بصرية مؤكدة من صفحة الدخول؛ بقية صفحات المنتج لم تُعرض بحساب مصادق. |
| Code Quality | ESLint بلا أخطاء مع تحذير unused واحد. TypeScript يفشل بخطأ واحد يمنع البناء. توجد آثار debug غير مناسبة للإصدار. |
| Architecture | فصل modular monolith ظاهر في مجالات الهوية والألعاب والمالية، مع authorization في الخدمات وtenant transaction. Milestone 9 ما زال شريحة POS غير مخزنية، وبعض نطاق المنتج مخطط/مؤجل. |
| Security | اختبارات الطلبات غير المصادق عليها أعادت 401 للمسارات المحمية. فحص المصدر وجد حقول redaction غير عميقة في تسجيل الأخطاء وآثار إرسال debug إلى localhost؛ لا يوجد إثبات لتجاوز مستأجر أو صلاحية في هذا التدقيق. |
| Performance | لا يوجد قياس إنتاجي كافٍ لإثبات عطل أداء. قائمة العملاء محدودة إلى 50 بلا pagination، كما أن فحص Lighthouse لم يكتمل. |
| Responsiveness | لا توجد نتيجة بصرية مؤكدة عند المقاسات المطلوبة؛ اختبارات المنطق تغطي نقاط 390 و900 و1440، لكن لم يمكن ضبط viewport في أداة المتصفح المستخدمة. |

## 3. Critical Issues

لا توجد مشكلة مصنفة CRITICAL مثبتة في هذا التدقيق. المشكلات HIGH التالية تمنع اعتبار الحالة قابلة للإصدار:

### AUD-001

- **Severity:** HIGH
- **Location:** `Code/src/ui/smart-device-search.ts:108`
- **Description:** `haystack.match(...) ?? []` يُستنتج كقائمة `never[]` في هذا الإعداد، لذلك `numbers.includes(digits)` لا يمر TypeScript.
- **Steps to reproduce:** من `Code/` شغّل `npm run typecheck` أو `npm run build`.
- **Expected behavior:** ينجح فحص الأنواع والبناء.
- **Actual behavior:** `TS2345: Argument of type 'string' is not assignable to parameter of type 'never'.`
- **Evidence:** ظهر الخطأ نفسه في typecheck وفي مرحلة فحص الأنواع من build.
- **Suggested fix:** صرّح بنوع نتيجة المطابقة كـ`string[]` أو استخدم تضييقاً نوعياً مكافئاً، ثم أعد الفحوص.

### AUD-002

- **Severity:** HIGH
- **Location:** `Code/src/app/customer/view/[token]/page.tsx:61` و`Code/src/app/admin/customers/[customerId]/page.tsx:109`
- **Description:** صفحتا البوابة العامة وتفاصيل العميل تمرران `kindLabel` كدالة إلى `CustomerStatementTable` العميل. دوال JavaScript لا يمكن تسلسلها كـprops عبر حد Server Component إلى Client Component.
- **Steps to reproduce:** افتح كشف حساب عميل صالحاً من رابط `/customer/view/:token` أو صفحة عميل إدارية فيها كشف الحساب.
- **Expected behavior:** يظهر كشف الحساب وتسميات أنواعه بالعربية/الإنجليزية.
- **Actual behavior:** حد RSC يرفض تمرير function prop وقد يفشل عرض الصفحة؛ لم يتوفر token/حساب مصادق لإثبات العرض النهائي عبر المتصفح.
- **Evidence:** اختبار `tests/admin/rsc-select-action.test.ts` يفشل ويحدد الصفحة العامة؛ مراجعة الصفحة الإدارية وجدت تمرير callback آخر إلى المكوّن نفسه.
- **Suggested fix:** مرّر بيانات قابلة للتسلسل (locale ومفاتيح الترجمة) واجعل المكوّن يحل التسميات داخلياً، أو حوّل الجدول إلى Server Component إن أمكن.

### AUD-003

- **Severity:** HIGH
- **Location:** `tests/isolation/tenant-isolation.test.ts` و`tests/security/rls-hardening.test.ts`
- **Description:** إدخالات الاختبار المباشرة إلى `core_customers` لا تعيّن `portal_token` رغم أن العمود أصبح `NOT NULL`. هذا يكسر اختبارات عزل المستأجر وRLS بدلاً من اختبار السلوك المطلوب.
- **Steps to reproduce:** شغّل `npm test -- --reporter=dot`.
- **Expected behavior:** تنشئ fixtures سجلات متوافقة مع آخر schema وتنجح اختبارات isolation/RLS.
- **Actual behavior:** 12 اختباراً تفشل بخطأ `null value in column "portal_token" ... violates not-null constraint`.
- **Evidence:** نتيجة Vitest: 110 ملفات اختبار ناجحة و3 ملفات فاشلة؛ 613 اختباراً ناجحاً و13 فاشلاً من 626. الإخفاقات الـ12 المذكورة جميعها تتضمن هذا السبب؛ الاختبار الثالث عشر هو فحص RSC في AUD-002.
- **Suggested fix:** حدّث جميع fixtures وعبارات SQL لإعطاء token UUID فريداً، ثم أضف تأكيداً بأن الاختبارات تستخدم schema مطابقاً لآخر migrations.

## 4. UX Issues

| ID | Severity | المشكلة والأثر | الموقع / الدليل | المعالجة المقترحة |
| --- | --- | --- | --- | --- |
| AUD-004 | MEDIUM | قائمة العملاء تعرض أول 50 سجلاً فقط ولا توفر انتقال صفحات أو مؤشراً بوجود نتائج أخرى. من دون بحث مطابق يصعب الوصول إلى عميل خارج أول 50. | `src/app/admin/customers/page.tsx` لا يعرض pagination؛ `src/modules/customers/customers.ts` يضع `limit` افتراضياً 50. | أضف cursor/offset pagination، عدد/مؤشر نتائج، واحفظ فلاتر URL بين الصفحات. |
| AUD-005 | MEDIUM | رسالة فشل الدخول تظهر بصرياً بعد الإرسال، لكنها فقرة عادية بلا `role="alert"` أو live region، فلا يوجد ضمان لإعلانها لقارئ الشاشة. | `src/app/login/login-form.tsx`؛ شوهدت الرسالة العربية بعد إدخال بيانات غير صحيحة. | اربط الخطأ بالحقل/النموذج وأعلنه فوراً عبر `role="alert"` أو نمط مناسب، مع إبقاء النص المترجم. |
| AUD-006 | Coverage limitation | لم يمكن التحقق من onboarding؛ حالة قاعدة الاختبار لا تحتوي مؤسسة ولا عضوية ولا حساب دخول متاح. هذه فجوة في قابلية التحقق المحلي وليست دليلاً على عطل production. | `gaming_center_security_test`: 4 مستخدمين، 0 مؤسسة، 0 عضوية؛ `/setup` يعيد 303 إلى `/login` لأن أول مستخدم موجود بالفعل. | وفّر seed محلياً disposable لمؤسسة ومالك وبيانات تشغيل اصطناعية، من دون أسرار أو بيانات حقيقية.

## 5. UI Issues

- لم تُثبت مشكلة اتساق مرئية من الصفحة العامة الوحيدة القابلة للاستخدام. لقطة صفحة الدخول على 1280×720 أظهرت نموذجاً مقروءاً وحقولاً ذات labels.
- يوجد نظام tokens ومكونات موحدة للأزرار والحقول والجداول والحالات الفارغة والـskeleton والحوارات. هذا إيجابي، لكن لم تُعاين واجهات الجداول والحوارات الإدارية.
- توجد صفحة كشف حساب إدارية وعامة تستخدمان المكوّن المشترك ذاته مع props غير قابلة للتسلسل؛ سُجلت كمشكلة وظيفية AUD-002.

## 6. Responsive Issues

لا أسجل خللاً responsive مؤكداً لعدم عرض صفحات الإدارة بأحجام مختلفة. الاختبارات الثابتة `tests/ui/shell-layout.test.ts` تغطي قواعد عند 390 و900 و1440px وتحدد drawer عند 1100px وbottom nav عند 720px. لم تُختبر فعلياً مقاسات 1440، 1280، 1024، 768، 390، 375 بالمتصفح، ولا overflow الجداول/الحوارات بعد تسجيل الدخول.

## 7. Functional Issues

| ID | Severity | المشكلة والأثر | الموقع / الدليل | المعالجة المقترحة |
| --- | --- | --- | --- | --- |
| AUD-007 | LOW | دالة `listPaymentsForCharge` معرفة وغير مستخدمة. يترك ذلك التباساً حول قراءة سجل الدفعات، ويصدر ESLint تحذيراً. | `src/modules/finance/checkout.ts:280`؛ تحذير `@typescript-eslint/no-unused-vars`. | احذف الدالة إن لم تعد مطلوبة، أو اربطها بتدفق سجل الدفعات المقصود مع اختبار. |
| AUD-008 | Scope gap | جزء POS الجاري هو كتالوج وطلبات مشروبات NON_STOCK مرتبطة بالجلسة؛ المخزون وحركاته والشراء، وردّ الأموال/الإبطال، الإيصالات، والـcash shifts ليست ضمن الشريحة الحالية. | `IMPLEMENTATION_STATUS.md` و`0018_pos_catalog_orders.sql`؛ موثّقة صراحة كمؤجلة أو خارج الشريحة. | اعتبرها فجوات نطاق قبل التشغيل الكامل، ولا توسعها قبل اعتماد milestone/قرار المنتج المقابل. |

توجد primitives لحالات التحميل والفراغ والخطأ والنجاح. واجهات العملاء والجهاز تستخدم query-string للبحث/الفلترة، والتقارير تقرأ التاريخ والفرع والحالة والصفحة من URL. لم يمكن اختبار سلوك CRUD أو تأكيدات الحذف/الأرشفة أو pagination في المتصفح لعدم وجود جلسة مستخدم.

## 8. Security Issues

### AUD-009

- **Severity:** MEDIUM
- **Location:** ستة ملفات: `src/middleware.ts`, `src/auth/setup-page-redirect.ts`, `src/app/_components/hard-redirect.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/_components/admin-shell.tsx`, `src/app/admin/gaming/sessions/page.tsx`.
- **Description:** آثار `agent log` ما زالت ترسل طلبات إلى endpoint ثابت على `127.0.0.1:7293`. تتضمن بيانات التنقل method/path/search ووجهة redirect وحالة وجود viewer/organization. الطلبات تلتقط أخطاء الشبكة بصمت. هذا telemetry مؤقت لا ينبغي أن يبقى في منتج متعدد المستأجرين، ويمكن لأي خدمة محلية تستمع للمنفذ تلقي البيانات.
- **Steps to reproduce:** افتح مسار `/admin` أو نفّذ redirect/انتقال الجلسات أثناء وجود مستمع محلي على المنفذ المذكور.
- **Expected behavior:** لا تغادر بيانات المسار أو query المستخدم إلى خدمة غير مهيأة ضمن التطبيق.
- **Actual behavior:** ينفذ المصدر `fetch` إلى loopback في middleware والصفحات/المكونات.
- **Evidence:** بحث شامل عن `127.0.0.1:7293` و`#region agent log` أعاد الملفات الستة أعلاه.
- **Suggested fix:** أزل instrumentation كاملاً أو انقله إلى نظام observability موثق ومهيأ عبر إعداد آمن مع تقليل البيانات.

### AUD-010 (Needs Verification)

- **Severity:** MEDIUM
- **Location:** `src/core/log.ts:72-80`
- **Description:** redaction يمر على حقول المستوى الأول فقط؛ كائن `error` يُضاف لاحقاً ويحمل `message` و`stack` دون تنقيح متكرر. لم يُثبت أن provider/database يضع سراً فعلياً في exception، لكن نمط التسجيل لا يضمن إخفاءه.
- **Evidence:** `redactFields(fields)` غير recursive، و`logError` يضيف كائن الخطأ بعد التنقيح.
- **Suggested fix:** نقّح message/stack والأسباب المتداخلة أو سجّل نوع الخطأ ومعرف الطلب فقط؛ أضف اختبار sentinel يتحقق من عدم ظهور سر/URL في log.

إيجابياً، رفضت API ست محاولات POST محمية بلا جلسة بـ401. مسار التفويض يشتق organization من الجلسة/العضوية، ويستخدم `withTenant` ويفحص الصلاحيات ونطاق الفرع في الخدمات. اختبارات API/العزل موجودة، لكن 12 من اختبارات RLS/isolation لم تعد صالحة بسبب fixtures، كما لم تُشغّل مجموعة PostgreSQL الحية لغياب إعداداتها المخصصة التي تسمح بإعادة تهيئة قاعدة اختبار disposable.

## 9. Performance Issues

- لا توجد قياسات تثبت مشكلة أداء إنتاجية. زمن build البارد الذي تجاوز دقيقة ليس دليلاً كافياً على أداء المستخدم.
- حد العملاء 50 مع غياب pagination هو قيد وظيفي وأداء محتمل عند كبر البيانات (AUD-004)، وليس دليلاً على بطء مثبت.
- لا يوجد اختبار E2E/Lighthouse مضاف في حزمة المشروع؛ محاولة استخدام DevTools المخصص انتهت بمهلة اتصال، لذلك لم يُلتقط trace أو Lighthouse report.
- عمليات البحث التي فُحصت تستخدم Drizzle وقيوداً محددة؛ لم يثبت N+1 في المسارات التي أمكن مراجعتها. صفحات الإدارة لم تُشغّل ببيانات فعلية.

## 10. Code Quality Issues

- Typecheck/build يفشلان (AUD-001).
- Lint ينجح مع تحذير unused واحد (AUD-007).
- توجد آثار debug في ستة ملفات (AUD-009).
- لا توجد ملفات أو مكونات أو dependencies مصنفة unused بثقة من الأدلة المتاحة. لم يُثبت تكرار مكونات أو مسارات ميتة؛ المسار `/admin/gaming/device-types` يحوّل عمداً إلى إدارة الأجهزة، لذلك لم يصنف dead route.

## 11. Architecture Issues

- المنفذ واضح على شكل modular monolith في identity/gaming/finance/catalog، مع API handlers رفيعة وvalidation مركزية.
- `IMPLEMENTATION_STATUS.md` يضع UX pass وVercel/Supabase adaptation وPOS session-linked slice في IN DEVELOPMENT. هذه الحالة متوافقة مع وجود migrations حتى 0018، لكنها تعني أن مراجعة pilot النهائية لم تكتمل.
- تدفق المنتج الكامل يتوقع inventory/cash shifts وأجزاء مالية إضافية، بينما التنفيذ الحالي يعلن تأجيلها. لا تُعامل هذه العناصر كـbugs داخل الشريحة؛ سجّلها كفجوات نطاق ومخاطر تشغيل.
- التسلسل الاختباري لا يطابق schema الحالي بسبب `portal_token` الإلزامي. يجب أن تبقى migrations وfixtures على مصدر schema واحد.

## 12. Dead / Unused Code

| Path | Type | Evidence | Confidence | Action |
| --- | --- | --- | --- | --- |
| `Code/src/modules/finance/checkout.ts:280` (`listPaymentsForCharge`) | Unused function | ESLint يعلن أن الدالة معرفة ولا تُستخدم. | Confirmed | حذفها إن كان السجل يُقرأ عبر مسار آخر، أو استعادة استخدامها المقصود مع اختبار. |
| لا توجد ملفات/Components/dependencies أخرى مؤكدة | Candidate inventory | لم يظهر دليل موثوق على عدم الاستخدام؛ imports والمسارات الديناميكية تجعل الحذف بالتخمين غير مناسب. | Needs verification | اتركها حتى يتوفر تحليل imports/build أو إثبات runtime. |

## 13. Route Audit

المخزون أدناه مستخرج من ملفات `page.tsx` و`route.ts`. كل صفحات `/admin/*` تتطلب جلسة صالحة؛ صفحات الإدارة تتحقق أيضاً من وجود منظمة وصلاحيات الصفحة. API الذي يمر عبر `requireOrganization()` يحتاج جلسة وعضوية نشطة وصلاحيات المجال، وعمليات branch-scoped تحتاج منحة الفرع المناسبة. أُرسل GET إلى 69 ملف API باستخدام معرفات UUID اصطناعية: 32 أعادت 401، و33 أعادت 405 (المسار لا يقبل GET)، و3 أعادت 200، وواحد أعاد 404 لمسار catch-all المصطنع للمصادقة. انتهت خمس طلبات أولية بمهلة أثناء compilation البارد؛ أُعيدت جميعها بعد استقرار الخادم، وكلها أعادت 405. ست محاولات POST محمية بعينة empty JSON أعادت 401.

### صفحات الويب (28)

| Route | Purpose | Auth Required | Role/Permission | Tested | Result |
| --- | --- | --- | --- | --- | --- |
| `/` | مدخل عام وتحويل الجلسة المسجلة | لا؛ يحوّل الجلسة الصالحة | لا | نعم | 200؛ عنوان ووصف ورابط الدخول ظاهر. |
| `/login` | تسجيل الدخول | لا | لا | نعم | نموذج عربي سليم؛ بيانات وهمية خاطئة أعطت رسالة مفهومة. |
| `/setup` | تهيئة أول مالك فقط | أول مستخدم فقط | bootstrap token عند signup | نعم | حوّل إلى `/login` لأن مستخدماً أساسياً موجود؛ لا يوجد signup عادي. |
| `/access-revoked` | شرح تعطيل/سحب الوصول | لا | لا | نعم | نص وإجراء تسجيل الدخول ظاهران. |
| `/customer/view/:token` | كشف حساب عام read-only | رابط token | token بوابة عميل | نعم جزئياً | token غير صالح ومجهول يعرضان not-found؛ حالة token صالح لم تتوفر. |
| `/admin` | لوحة المالك/إنشاء المؤسسة أو dashboard | نعم | dashboard permissions وقراءات المجال | نعم للحاجز فقط | دون جلسة حوّل إلى login؛ المحتوى المصادق غير مختبر. |
| `/admin/audit` | سجل التدقيق | نعم | `audit.read` | لا؛ حُجبت | لا حساب متاح. |
| `/admin/branches` | إدارة الفروع | نعم | `branches.read/manage` | لا؛ حُجبت | لا حساب متاح. |
| `/admin/catalog` | منتجات وأسعار POS | نعم | `pos.catalog.read/manage` | لا؛ حُجبت | لا حساب متاح. |
| `/admin/customers`, `/admin/customers/:customerId` | سجل العملاء، ledger، كشف الحساب | نعم | `customers.read/manage`؛ صلاحية ledger المالية حسب الإجراء | لا؛ حُجبت | callback serialization ومحدودية أول 50 موثقتان. |
| `/admin/gaming` | مدخل/تحويل مجال الألعاب | نعم | حسب الوجهة | لا؛ حُجبت | لا حساب متاح. |
| `/admin/gaming/areas`, `/admin/gaming/areas/:areaId` | المناطق | نعم | `gaming.master.read/manage` + branch access | لا؛ حُجبت | لا حساب متاح. |
| `/admin/gaming/device-types`, `/admin/gaming/device-types/:deviceTypeId` | أنواع الأجهزة/تحويل المسار القديم | نعم | `gaming.master.read/manage` | لا؛ حُجبت | مسار القائمة يحول إلى devices عمداً. |
| `/admin/gaming/devices`, `/admin/gaming/devices/:deviceId` | الأجهزة والبحث والفلاتر | نعم | `gaming.master.read/manage` + branch access | لا؛ حُجبت | لا حساب متاح. |
| `/admin/gaming/floor` | أرضية التشغيل وبدء/تشغيل الجلسات | نعم | `gaming.sessions.read/start/operate/cancel` + branch access | لا؛ حُجبت | لا حساب متاح. |
| `/admin/gaming/pricing` | الخطط والأسعار | نعم | `gaming.master.read/manage` | لا؛ حُجبت | لا حساب متاح. |
| `/admin/gaming/sessions` | رابط تاريخ الجلسات القديم | نعم | `gaming.sessions.read` | لا؛ حُجبت | يحول إلى التقارير حسب التصميم الحالي. |
| `/admin/gaming/sessions/:sessionId` | تفاصيل الجلسة والفوترة/المشروبات | نعم | `gaming.sessions.read/operate`، صلاحيات POS المناسبة | لا؛ حُجبت | لا حساب متاح. |
| `/admin/gaming/sessions/:sessionId/checkout` | الدفع والتحصيل | نعم | قراءة الجلسة وإنشاء دفعة `finance.payments.create` + branch access | لا؛ حُجبت | لا حساب متاح. |
| `/admin/onboarding` | wizard إعداد المركز | نعم | إدارة فرع أو `gaming.master.manage` | لا؛ حُجبت | لا حساب متاح. |
| `/admin/reports` | تقارير التشغيل وتاريخ الجلسات | نعم | `gaming.sessions.read`، والبيانات المالية `finance.payments.read` | لا؛ حُجبت | لا حساب متاح. |
| `/admin/roles` | الأدوار والصلاحيات | نعم | `roles.read/manage` | لا؛ حُجبت | لا حساب متاح. |
| `/admin/settings` | إعدادات المركز | نعم | إعدادات read/manage بحسب المفتاح | لا؛ حُجبت | لا حساب متاح. |
| `/admin/users` | الموظفون وعضوياتهم ووصول الفروع | نعم | `memberships.read/manage`, `roles.read`, `branches.read` | لا؛ حُجبت | لا حساب متاح. |

### API (69)

| Route | Purpose | Auth Required | Role/Permission | Tested | Result |
| --- | --- | --- | --- | --- | --- |
| `/api/health/live`, `/api/health/ready` | liveness/readiness | لا | لا | نعم | كلاهما 200 و`{"status":"ok"}` على قاعدة الاختبار المحلية. |
| `/api/auth/*all` | Better Auth | يتبع العملية؛ signup العام gated | signup الأول يتطلب token وslot ذري | نعم GET فقط | GET بمسار catch-all اصطناعي 404؛ sign-in الفاشل شوهد من الواجهة. |
| `/api/setup/status` | هل bootstrap أول مستخدم مطلوب | لا | لا | نعم | ضمن استعلام API العام؛ يعيد قيمة حالة فقط. |
| `/api/ui/locale`, `/api/ui/theme` | تفضيلات العرض | لا | لا | نعم من الواجهة | POST ناجح على الأصل القياسي، وتفضيلات اللغة/السمة بقيت بعد refresh. |
| `/api/ui/guided-setup` | إكمال واجهة wizard | نعم | صلاحية إعداد + operational readiness | نعم GET/POST عينات غير مصادق | الرفض 401 بلا جلسة. |
| `/api/me` | المستخدم الحالي | نعم | جلسة فقط | نعم GET | 401 بلا جلسة. |
| `/api/organizations`, `/api/organizations/current`, `/api/organizations/select` | إنشاء/تحديد/تحديث المؤسسة | نعم | مالك/عضوية مؤسسة؛ أول إنشاء فقط عبر endpoint العام | نعم GET حيث ينطبق + POST غير مصادق | POST غير مصادق 401. |
| `/api/branches`, `/api/branches/:branchId`, `/api/branches/:branchId/archive` | CRUD/أرشفة الفروع | نعم | `branches.read/manage` + نطاق المؤسسة | نعم | GET collection 401؛ POST غير مصادق 401؛ GET غير المدعوم 405. |
| `/api/memberships`, `/api/memberships/:membershipId/status`, `/api/memberships/:membershipId/roles/:roleId`, `/api/memberships/:membershipId/branch-access/:branchId` | الموظفون والأدوار ومنح الفرع | نعم | memberships/roles manage | نعم GET | endpoints المحمية غير المصادق عليها مرفوضة؛ لا جلسة دورية. |
| `/api/roles`, `/api/roles/:roleId`, `/api/roles/:roleId/archive`, `/api/roles/:roleId/permissions`, `/api/permissions` | إدارة الأدوار والكتالوج | نعم | `roles.read/manage` | نعم | GET المسارات المحمية 401؛ POST غير مصادق 401. |
| `/api/audit` | سجل التدقيق | نعم | `audit.read` | نعم GET | 401. |
| `/api/customers`, `/api/customers/:customerId`, `/api/customers/:customerId/archive`, `/api/customers/:customerId/ledger` | العملاء والأرشفة ودفتر الحساب | نعم | `customers.read/manage` وصلاحيات finance ledger | نعم | GET collection 401؛ POST غير مصادق 401. |
| `/api/features`, `/api/features/:code` | أعلام الميزات | نعم | قراءة/إدارة المؤسسة | نعم GET | محمي؛ لا حساب متاح. |
| `/api/settings`, `/api/settings/:key`, `/api/settings/:key/branches/:branchId` | الإعدادات | نعم | `settings.read/manage` + branch scope | نعم GET | محمي؛ لا حساب متاح. |
| `/api/gaming/areas`, `/api/gaming/areas/:areaId`, `/api/gaming/areas/:areaId/archive` | المناطق | نعم | `gaming.master.read/manage` + branch access | نعم GET | المجموعة 401/405 وفق method. |
| `/api/gaming/device-types`, `/api/gaming/device-types/:deviceTypeId`, `/api/gaming/device-types/:deviceTypeId/archive`, `/api/gaming/device-types/:deviceTypeId/wizard-archive` | أنواع الأجهزة | نعم | `gaming.master.read/manage` | نعم GET | المجموعة 401/405؛ طلب wizard-archive أُعيد بعد انتهاء compilation وأعاد 405؛ لا تغيير بيانات. |
| `/api/gaming/devices`, `/api/gaming/devices/bulk`, `/api/gaming/devices/:deviceId`, `/api/gaming/devices/:deviceId/archive` | الأجهزة وإنشاء الدفعات | نعم | `gaming.master.read/manage` + فرع | نعم GET | المجموعة 401/405؛ bulk بحد أقصى 50 حسب الكود. |
| `/api/gaming/device-prices`, `/api/gaming/pricing-plans`, `/api/gaming/pricing-plans/:planId`, `/api/gaming/pricing-plans/:planId/archive`, `/api/gaming/pricing-assignments`, `/api/gaming/pricing-assignments/:assignmentId` | الأسعار والإسناد | نعم | `gaming.master.read/manage` | نعم GET | المجموعة 401/405. |
| `/api/gaming/floor` | حالة الأرضية | نعم | `gaming.sessions.read` + branch access | نعم GET | 401 بلا جلسة. |
| `/api/gaming/sessions`, `/api/gaming/sessions/:sessionId`, `/api/gaming/sessions/:sessionId/pause`, `/api/gaming/sessions/:sessionId/resume`, `/api/gaming/sessions/:sessionId/end`, `/api/gaming/sessions/:sessionId/cancel`, `/api/gaming/sessions/:sessionId/move`, `/api/gaming/sessions/:sessionId/customer` | دورة حياة الجلسة | نعم | `gaming.sessions.read/start/operate/cancel` + branch access | نعم GET | GET المحمي 401؛ POST غير المصادق على end 401. |
| `/api/gaming/sessions/:sessionId/billing`, `/api/gaming/sessions/:sessionId/billing/finalize` | قراءة/تثبيت الفوترة | نعم | sessions read/operate | نعم GET | 401 بلا جلسة. |
| `/api/gaming/sessions/:sessionId/checkout`, `/api/gaming/sessions/:sessionId/payments`, `/api/finance/payments/:paymentId` | checkout ودفعات | نعم | `finance.payments.read/create` | نعم GET | محمي؛ POST غير المصادق على مسار الدفع غير منفذ، ورفض POST مماثل أعاد 401. |
| `/api/catalog/products`, `/api/gaming/sessions/:sessionId/pos/orders` | كتالوج/بيع مشروب مرتبط بجلسة | نعم | `pos.catalog.read/manage`, `pos.orders.create` + فرع | نعم GET | لا حساب متاح؛ GET collection مرفوض بلا جلسة. |
| `/api/finance/expenses` | المصاريف/السحب | نعم | `finance.expenses.read/create` + branch grant | نعم GET | GET غير المدعوم 405؛ POST غير المصادق 401. |
| `/api/reports` | تقرير/CSV | نعم | `gaming.sessions.read`; الماليات تتطلب finance read | نعم GET | محمي؛ لا تنزيل مصادق اختُبر. |
| `/api/onboarding/status` | تقدم إعداد المركز | نعم | فرع/ألعاب read | نعم GET | محمي؛ لا حساب متاح. |

## 14. Feature Audit

| Feature | Location / Routes | APIs | Tables / Models | User type | Status | Tested / problems |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication / first-owner setup | `/login`, `/setup`, `/access-revoked` | `/api/auth/*`, `/api/setup/status` | `auth_users`, `auth_accounts`, `auth_sessions`, `core_users`, `core_platform_bootstrap` | مالك/موظف | موجود | الدخول الخاطئ عُرض بوضوح؛ signup مغلق لوجود user؛ لا حساب مصادق. |
| Organizations / branches | `/admin`, `/admin/branches` | organizations, branches APIs | `core_organizations`, `core_branches`, memberships | مالك | موجود | API رفض بلا جلسة؛ إنشاء/تعديل مصادق لم يختبر. |
| Staff / roles / branch access | `/admin/users`, `/admin/roles` | memberships, roles, permissions APIs | core memberships/roles/permissions/branch_access | مالك/مدير | موجود | لم تختبر واجهة الصلاحيات؛ الاختبارات الآلية موجودة وبعضها يفشل بسبب fixture schema. |
| Settings / feature flags / audit | `/admin/settings`, `/admin/audit` | settings/features/audit | `core_setting_values`, feature tables, `core_audit_logs` | مالك/مدير | موجود | protected requests reject unauthenticated access؛ لا تجربة صلاحيات بمالك/موظف. |
| Customers / ledger | `/admin/customers`, `/admin/customers/:customerId` | customers + ledger APIs | `core_customers`, finance charges/allocations/ledger | موظف خدمة/أمين صندوق | موجود | أول 50 بلا pagination؛ RSC callback في كشف الحساب؛ CRUD غير مختبر. |
| Public customer statement | `/customer/view/:token` | لا API منفصل ظاهر؛ server read | `core_customers.portal_token`, finance ledger | عميل | موجود | حالات token غير صالح/مجهول تظهر not found؛ valid statement لم يختبر، وcallback قد يمنع render. |
| Gaming master data | `/admin/gaming/areas`, `device-types`, `devices`, `pricing` | gaming master APIs | `gaming_areas`, `gaming_device_types`, `gaming_devices`, `gaming_pricing_*` | مالك/مدير تشغيل | موجود | لا CRUD مصادق عبر browser؛ server authorization موجود في الخدمات. |
| Gaming floor / sessions | `/admin/gaming/floor`, session detail/history | sessions/floor/lifecycle APIs | `gaming_sessions`, `gaming_session_segments`, `gaming_session_pauses` | مشغل | موجود | backend tests موجودة؛ browser start/pause/move/end غير ممكن دون حساب. |
| Billing / checkout / payments | session detail/checkout | billing, checkout, payments APIs | `finance_charges`, items, payments, allocations | أمين صندوق | موجود | مصدر الكود يستعمل integer minor units/idempotency؛ إدخال payment غير مختبر عبر الواجهة. |
| POS catalog / session drinks | `/admin/catalog`, session detail | catalog products, session POS orders | `catalog_*`, `pos_orders`, `pos_order_items`, session links | موظف/مالك | شريحة M9 غير مكتملة | NON_STOCK drinks موجودة؛ inventory/refunds/cash shifts خارج الشريحة. |
| Reports / expenses | `/admin/reports`, dashboard withdrawal | reports/expenses APIs | report read models + `finance_expenses` | مالك/مدير/أمين صندوق | جزئي | route/page لم يختبر مصادقاً؛ session history يعرض page=1-based, limit=50. |
| Onboarding / UI preferences | `/admin/onboarding`, locale/theme controls | onboarding + `/api/ui/*` | operational rows؛ تفضيلات locale/theme cookies | مالك | موجود | لغة وسمة نجحتا وحُفظتا بعد refresh على localhost:3000؛ wizard غير مختبر. |
| Inventory / shifts / refunds / receipts | لا routes تنفيذ ظاهرة في المخزون الحالي | غير موجودة ضمن هذه الشريحة | مخزون/shift/refund tables غير موجودة ضمن M9 الموثق | إدارة/أمين صندوق | مؤجل/خارج M9 POS slice | فجوة نطاق واضحة قبل إطلاق كل قدرات العمل؛ لا تُنفّذ تلقائياً دون اعتماد milestone. |

## 15. Missing States

| State | Evidence | Audit status |
| --- | --- | --- |
| Loading | `LoadingState`, `Skeleton`, وأزرار busy | موجود في shared UI؛ لا تدفق إدارة مصادق اختُبر. |
| Empty | `EmptyState`, empty tables/products | موجود في صفحات المصدر. |
| Error | `ErrorState`, form/API error copy | موجود؛ خطأ login لا يعلن live semantics (AUD-005). |
| Success | `SuccessBanner`, toast region، router refresh بعد نجاح mutation | موجود في primitives؛ mutation نجاح لم يُختبر عبر واجهة مصادق. |
| Permission denied | `AccessDenied` وصفحة سحب الوصول، و403 mapper | موجود؛ اختبر 401 unauth فقط، لا role-specific 403 من جلسة حقيقية. |
| Offline | لا نمط offline ظاهر؛ المشروع موثق cloud-first | غير موجود حالياً؛ مقبول وفق النطاق، لكن المستخدم يبقى مع خطأ طلب عام عند انقطاع الشبكة. |
| Timeout | لا حالة timeout مستقلة ظاهرة في flows التي قرئت | Needs verification؛ اختبر retry/timeout في E2E لاحقاً. |
| Duplicate | تحذير duplicate customer phone/email/name؛ idempotency لدفعات | موجود جزئياً؛ لا browser test للتكرار أو rapid submit. |
| Validation | HTML required/min/max + Zod server schemas | موجود في المصدر؛ لم تُجرّب كل الحقول المصادق عليها بسبب غياب جلسة. |

## 16. Edge Cases

- بيانات الدخول الخاطئة تبقى في URL آمنة وفق source/test؛ الواجهة عرضت رسالة مترجمة ولم تعرض أسراراً.
- `/setup` مغلق بعد وجود Core User؛ لا يسمح بإنشاء مستخدم آخر عبر signup العام وفق gate، ما يحمي bootstrap لكنه يجعل قاعدة محلية بها orphan user تحتاج مسار استرداد مالك واضح.
- UUID token مجهول في بوابة العميل لا يكشف وجود عميل؛ يعرض not found كما ينبغي.
- تحديد حد 50 عميل من دون pagination يحجب جزءاً من النتائج غير المطابقة للبحث.
- العمليات المالية والجلسات متوقعة أن تكون retry-safe/idempotent حسب الكود والاختبارات، لكن rapid double-submit لم يختبر بالمتصفح.
- التاريخ/الفرع/الحالة في التقارير تُقرأ من URL؛ لا اختبار back/forward أو refresh ضمن جلسة مصادق.
- الأعطال الحية في اختبار migration/role لا يمكن استنتاجها من PGlite وحده؛ اختبار PostgreSQL الآني لم يُشغّل بإعداداته fail-closed.

## 17. Production Risks

1. لا يمكن نشر الحالة الحالية بنجاح حتى يُصلح خطأ TypeScript.
2. أخطاء RSC قد تمنع عرض كشف حساب العميل العام والإداري.
3. مجموعة الاختبارات لا تقدم حالياً إشارة موثوقة على isolation/RLS بسبب fixtures قديمة، رغم وجود اختبارات واسعة.
4. debug telemetry وredaction غير العميق يستحقان إزالة/تقوية قبل بيئة production.
5. تدفقات admin CRUD، بيانات المؤسسة، والresponsive لم تخضع لاختبار واقعي بسبب غياب حساب محلي صالح.
6. المخزون والـcash shifts والـrefunds/receipts ما زالت خارج الشريحة الحالية؛ يجب مواءمة ذلك مع خطة pilot ونطاق المنتج قبل الاعتماد التشغيلي.

## 18. Positive Findings

- تطبيق Next.js محلي عمل وأعاد `/api/health/live` و`/api/health/ready` الحالة `ok`.
- الدخول الخاطئ عرض رسالة عربية مفهومة، و`/setup` منع bootstrap إضافياً، وadmin غير المصادق حُوّل إلى login.
- تفضيلات اللغة والسمة تبدلت وحُفظت بعد refresh، ثم أُعيدت إلى العربية/الفاتح بعد الاختبار.
- مسارات API المحمية رفضت الطلبات غير المصادق عليها، ولم تنجح أي محاولة mutation غير مصادق عليها.
- application authorization وbranch access منفصلان عن دور المستخدم في التصميم، وtenant context transaction-local.
- المبالغ تمر كنصوص integer minor units في مسارات checkout التي قرئت، مع transaction/idempotency tests.
- توجد اختبارات كثيرة للوحدات والعزل والـHTTP، ومكونات مشتركة للحالات والجداول والحوارات.
- لا توجد migrations أو شيفرة Cards/NFC في المخزون المفحوص؛ scope المستقبلي موثق خارج MVP.
