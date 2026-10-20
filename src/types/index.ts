// أنواع البيانات لنظام مدير المتجر
// جميع المبالغ تُخزَّن كأرقام بوحدتين عشريتين (دقة العملة)، والحسابات تتم عبر utils/money

export type ID = string;

export type PaymentMethod = 'cash' | 'bank'; // نقدًا أو تحويل بنكي/شبكة
export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'cancelled';
export type PurchaseStatus = 'ordered' | 'received' | 'cancelled';

export interface Product {
  id: ID;
  name: string;
  code: string; // رمز المنتج
  barcode: string;
  category: string;
  purchasePrice: number; // تكلفة الوحدة الأساسية (بعد توزيع الخصم والتكاليف)
  salePrice: number; // سعر بيع الوحدة الأساسية
  quantity: number; // المخزون بوحدة البيع الأساسية
  alertThreshold: number; // حد التنبيه
  supplierId: ID | null;
  description: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  // حقول اختيارية أُضيفت مع مكتبة الأسعار (متوافقة مع السجلات القديمة)
  unit?: string; // الوحدة/الحجم (لتر، كجم، علبة…) — عرض فقط للسجلات القديمة
  purchasePriceUpdatedAt?: number; // تاريخ آخر تغيير لسعر الشراء
  salePriceUpdatedAt?: number; // تاريخ آخر تغيير لسعر البيع
  lastSupplierId?: ID | null; // آخر مورّد ورد سعر الشراء منه

  // ——— الإصدار 3: دليل الأصناف السوري والوحدات والصلاحية ———
  /** اسم مختصر للاستخدام السريع في نقطة البيع */
  shortName?: string;
  /** العلامة التجارية */
  brand?: string;
  /** أسماء بديلة للبحث: «رز»، «أرز كيلو»… */
  aliases?: string[];
  /** الوحدة التي يُخزَّن ويُباع بها المخزون (piece/kg/g/l/ml/…) */
  saleUnit?: string;
  /** الوحدة التي يشتري بها المتجر عادةً (carton/box/kg/…) */
  purchaseUnit?: string;
  /** عدد وحدات البيع داخل وحدة الشراء (يحدده المستخدم — لا قيمة افتراضية) */
  unitsPerPurchase?: number | null;
  /** نسبة ربح خاصة بالمنتج تُستخدم في اقتراح سعر البيع (اختياري) */
  marginPercent?: number | null;
  /** حجم العبوة: 1 كغ، 500 مل… */
  sizeValue?: number | null;
  sizeUnit?: string;
  perishable?: boolean;
  expiryDate?: number | null;
  batchNumber?: string;
  /** مسودة دليل أصناف: اسم فقط بلا أسعار/كميات — ليست مخزونًا حقيقيًا */
  catalogDraft?: boolean;
}

export interface Customer {
  id: ID;
  name: string;
  phone: string;
  address: string;
  notes: string;
  creditDays: number; // أيام السماح للتنبيه بالديون المتأخرة
  createdAt: number;
  updatedAt: number;
  /** رصيد سابق من دفتر قديم — يُدرج في أول كشف الحساب */
  openingBalance?: number;
  /** ما سُدِّد من الرصيد السابق */
  openingBalancePaid?: number;
  /** رقم تعريفي اختياري للزبون */
  reference?: string;
}

export interface Supplier {
  id: ID;
  name: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  /** المنطقة/العنوان التفصيلي */
  area?: string;
  /** المنتجات التي يوردها (نص حر) */
  supplies?: string;
  /** رصيد سابق للمورد */
  openingBalance?: number;
}

export interface InvoiceItem {
  productId: ID;
  name: string; // لقطة اسم المنتج وقت البيع
  code: string;
  quantity: number; // بوحدة البيع وقت العملية
  unitPrice: number; // لقطة سعر البيع وقت البيع
  unitCost: number; // لقطة تكلفة الوحدة وقت البيع (COGS)
  lineTotal: number;
  /** وحدة البيع وقت العملية (حبة/كغ/…) — لقطة تاريخية */
  unit?: string;
}

export interface Invoice {
  id: ID;
  number: string; // رقم الفاتورة
  date: number; // timestamp
  customerId: ID | null;
  customerName: string; // لقطة
  items: InvoiceItem[];
  subtotal: number;
  discount: number; // خصم مبلغ ثابت
  total: number; // الإجمالي بعد الخصم
  paid: number; // المدفوع
  remaining: number; // المتبقي
  paymentMethod: PaymentMethod | 'credit';
  status: InvoiceStatus;
  cogs: number; // تكلفة البضاعة المباعة وقت البيع
  initialPaid: number; // المدفوع وقت إنشاء الفاتورة (الباقي من الدفعات لاحقًا)
  clientToken: string; // مفتاح ضد البيع المكرر
  cancelReason: string;
  cancelledAt: number | null;
  notes: string;
  createdAt: number;
}

export interface PurchaseItem {
  productId: ID;
  name: string;
  code: string;
  /** الكمية بوحدة البيع الأساسية (بعد التحويل من وحدة الشراء) */
  quantity: number;
  /** التكلفة النهائية للوحدة الأساسية بعد الخصم والتكاليف الإضافية */
  unitCost: number;
  lineTotal: number;
  // ——— الإصدار 3: الشراء بالكرتونة والوحدات ———
  /** الكمية كما أُدخلت بوحدة الشراء */
  enteredQuantity?: number;
  /** وحدة الشراء المدخلة (كرتونة/كيلو…) */
  enteredUnit?: string;
  /** سعر وحدة الشراء كما أُدخل */
  enteredUnitCost?: number;
  /** معامل التحويل المستخدم (عدد وحدات البيع في وحدة الشراء) */
  unitsPerPurchase?: number | null;
}

export interface Purchase {
  id: ID;
  number: string;
  date: number; // تاريخ الفاتورة/الاستلام
  supplierId: ID | null;
  supplierName: string;
  items: PurchaseItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod: PaymentMethod | 'credit';
  status: PurchaseStatus;
  clientToken: string;
  cancelReason: string;
  cancelledAt: number | null;
  notes: string;
  createdAt: number;
  // ——— الإصدار 3: تكاليف إضافية وتاريخ الاستلام ———
  /** نقل/شحن/تحميل تُوزَّع على البنود وتدخل في تكلفة الوحدة */
  extraCosts?: number;
  receivedAt?: number | null;
}

export interface Expense {
  id: ID;
  date: number;
  amount: number;
  category: string;
  paymentMethod: PaymentMethod;
  description: string;
  createdAt: number;
}

export type CashType = 'in' | 'out' | 'transfer';
export type CashAccount = 'cash' | 'bank';

export interface CashTransaction {
  id: ID;
  date: number;
  type: CashType;
  amount: number; // موجب دائمًا
  account: CashAccount; // للإيداع/السحب: الحساب المستهدف (in) أو المصدر (out)
  transferFrom?: CashAccount;
  transferTo?: CashAccount;
  category: string;
  description: string;
  refType?:
    | 'sale'
    | 'payment'
    | 'purchase'
    | 'expense'
    | 'supplier_payment'
    | 'invoice_cancel'
    | 'purchase_cancel'
    | 'manual'
    | 'manual_sale';
  refId?: string;
  createdAt: number;
}

/** دفعة عميل لتسديد فواتيره */
export interface CustomerPayment {
  id: ID;
  date: number;
  customerId: ID;
  customerName: string;
  invoiceIds: ID[]; // الفواتير التي سُدِّدت (قد تكون فاتورة واحدة)
  /** سجلات البيع اليدوي الآجلة التي سُدِّدت */
  manualSaleIds?: ID[];
  amount: number;
  method: PaymentMethod;
  notes: string;
  createdAt: number;
  /** مفتاح منع تكرار الدفعة عند النقر المزدوج */
  clientToken?: string;
  /** الجزء المخصص لتسديد الرصيد السابق */
  openingApplied?: number;
}

/** دفعة لمورد لتسديد مشترياته الآجلة */
export interface SupplierPayment {
  id: ID;
  date: number;
  supplierId: ID;
  supplierName: string;
  purchaseIds: ID[];
  amount: number;
  method: PaymentMethod;
  notes: string;
  createdAt: number;
  clientToken?: string;
}

export type Language = 'ar' | 'en';
export type ThemeMode = 'light' | 'dark';

/** سياسة تعديل سعر البيع عند تغيّر سعر الشراء من فاتورة ممسوحة */
export type SalePricePolicy = 'never' | 'ask' | 'auto';

export interface Settings {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  currency: string; // رمز العملة
  language: Language;
  theme: ThemeMode;
  allowNegativeStock: boolean; // السماح ببيع مخزون غير متوفر
  invoicePrefix: string;
  purchasePrefix: string;
  lowStockDefault: number;
  expenseCategories: string[];
  updatedAt: number;
  // التسعير والتصنيفات (أُضيفت لاحقًا — القيم الافتراضية في DEFAULT_SETTINGS)
  salePricePolicy?: SalePricePolicy;
  defaultMarginPercent?: number; // هامش الربح المقترح (%)
  roundSalePriceTo?: number; // تقريب سعر البيع المقترح (0 = بدون تقريب)
  manualSalePrefix?: string;
  // ——— الإصدار 3: هوية المتجر السوري والمصطلحات ———
  /** نوع المتجر — يغيّر بعض المصطلحات الافتراضية */
  storeType?: 'grocery' | 'mini_market' | 'supermarket' | 'butcher' | 'other';
  /** اسم دفتر الدين كما يسميه صاحب المحل */
  debtLedgerTitle?: string;
  /** مرادفات محلية للبحث: «جبنة» ← «جبن»… */
  searchSynonyms?: { from: string; to: string[] }[];
  /** عدد أيام التنبيه قبل انتهاء الصلاحية */
  expiryAlertDays?: number;
}

/** تصنيف منتج قابل للتعديل والإضافة */
export interface ProductCategory {
  id: ID;
  name: string;
  normalized: string; // مفتاح منع التكرار (بعد تطبيع الاسم)
  keywords: string[]; // كلمات تساعد الاقتراح التلقائي
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  /** تصنيف رئيسي أم فرعي — التصنيفات الفرعية تظهر تحت الأب */
  parentId?: ID | null;
  sortOrder?: number;
}

export type PriceField = 'purchase' | 'sale';
export type PriceSourceType = 'manual' | 'purchase' | 'scanned_invoice' | 'invoice_library' | 'initial';

/** سجل تغيّر سعر منتج (سعر شراء أو بيع) */
export interface PriceChange {
  id: ID;
  productId: ID;
  productName: string;
  field: PriceField;
  oldPrice: number;
  newPrice: number;
  date: number; // التاريخ الفعلي للسعر (تاريخ الفاتورة إن وُجد)
  createdAt: number;
  source: PriceSourceType;
  sourceId: ID | null;
  sourceLabel: string; // مثال: «فاتورة مشتريات PUR-00012» أو «فاتورة ممسوحة 4582 — مؤسسة الأمانة»
}

/** مصدر سجل البيع */
export type SaleSourceType = 'pos' | 'manual' | 'scanned';

/** بيع مسجّل يدويًا — قد يكون مخزنيًا (يخصم المخزون) أو إيرادًا فقط */
export interface ManualSale {
  id: ID;
  number: string; // MS-00001
  date: number; // وقت العملية الفعلي (قابل للتعديل)
  productId: ID | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  unitCost: number | null; // تكلفة الوحدة إن كانت معروفة
  buyerName: string;
  category: string;
  note: string;
  source: SaleSourceType;
  stockApplied: boolean; // هل خُصمت الكمية من المخزون
  paid: number;
  paymentMethod: PaymentMethod | 'credit';
  clientToken: string;
  createdAt: number;
  updatedAt: number;
  /** الزبون المرتبط — لازمة لإدراج البيع الآجل في دفتر الدين */
  customerId?: ID | null;
  unit?: string;
  /** المدفوع وقت التسجيل (لا يتغيّر عند تحصيل الدفعات لاحقًا) */
  initialPaid?: number;
}

/** سطر داخل فاتورة ممسوحة ضوئيًا */
export interface ScannedInvoiceItem {
  id: string;
  rawName: string; // كما استخرجه OCR
  name: string; // الاسم بعد المراجعة
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  tax: number;
  unit: string;
  productId: ID | null;
  matchState: 'matched' | 'new' | 'unlinked' | 'ignored';
  matchScore: number; // 0..1 درجة المطابقة
  confidence: number; // 0..1 ثقة الاستخراج
  needsReview: boolean;
}

export type ScannedInvoiceStatus = 'confirmed';

/** فاتورة شراء مؤرشفة بعد المسح والمراجعة */
export interface ScannedInvoice {
  id: ID;
  supplierId: ID | null;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: number; // تاريخ الفاتورة نفسها
  scanDate: number; // وقت إضافتها إلى النظام
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items: ScannedInvoiceItem[];
  rawText: string;
  imageId: ID | null;
  imageName: string;
  ocrConfidence: number; // 0..100 من المحرك
  engine: string;
  status: ScannedInvoiceStatus;
  notes: string;
  edits: { field: string; from: string; to: string; at: number }[];
  priceUpdates: {
    productId: ID;
    productName: string;
    oldPrice: number;
    newPrice: number;
    action: 'updated' | 'unchanged' | 'skipped';
    /** سبب التخطي — قديم: تاريخ الفاتورة أقدم من آخر تحديث للسعر */
    reason?: 'stale';
  }[];
  pricesApplied: boolean;
  duplicateOf: ID | null;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
}

/** صورة فاتورة محفوظة بشكل دائم (Blob داخل IndexedDB) */
export interface InvoiceImage {
  id: ID;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  name: string;
  size: number;
  createdAt: number;
}

/** سجل مراجعة للتعديلات المهمة */
export interface AuditEntry {
  id: ID;
  at: number;
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'price_update'
    | 'scan_confirm'
    | 'category_create'
    | 'category_update'
    | 'category_delete'
    | 'sale_delete'
    | 'write_off'
    | 'markdown';
  entity: 'manualSale' | 'scannedInvoice' | 'product' | 'category' | 'price';
  entityId: string;
  summary: string;
  before: string;
  after: string;
}

/** إتلاف/تلف بضاعة — أثر مالي منفصل عن المبيعات (غير نقدي) */
export interface StockWriteOff {
  id: ID;
  date: number;
  productId: ID | null;
  productName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  value: number;
  kind: 'damage' | 'expiry' | 'loss' | 'other';
  reason: string;
  createdAt: number;
}

/** آخر سعر شراء مسجّل لمنتج من مورّد معيّن */
export interface SupplierPrice {
  id: ID;
  supplierId: ID;
  supplierName: string;
  productId: ID;
  productName: string;
  unitCost: number; // تكلفة الوحدة الأساسية
  unit: string;
  date: number;
  source: PriceSourceType;
  sourceId: ID | null;
  createdAt: number;
}

/** نتائج الحسابات المشتركة */
export interface Totals {
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
}
