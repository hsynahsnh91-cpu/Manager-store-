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
  purchasePrice: number; // سعر الشراء (آخر تكلفة مسجلة يدويًا)
  salePrice: number;
  quantity: number;
  alertThreshold: number; // حد التنبيه
  supplierId: ID | null;
  description: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
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
}

export interface Supplier {
  id: ID;
  name: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface InvoiceItem {
  productId: ID;
  name: string; // لقطة اسم المنتج وقت البيع
  code: string;
  quantity: number;
  unitPrice: number; // لقطة سعر البيع وقت البيع
  unitCost: number; // لقطة تكلفة الوحدة وقت البيع (COGS)
  lineTotal: number;
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
  quantity: number;
  unitCost: number;
  lineTotal: number;
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
  refType?: 'sale' | 'payment' | 'purchase' | 'expense' | 'supplier_payment' | 'invoice_cancel' | 'purchase_cancel' | 'manual';
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
  amount: number;
  method: PaymentMethod;
  notes: string;
  createdAt: number;
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
}

export type Language = 'ar' | 'en';
export type ThemeMode = 'light' | 'dark';

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
}

/** نتائج الحسابات المشتركة */
export interface Totals {
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
}
