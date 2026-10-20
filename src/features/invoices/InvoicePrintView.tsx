import type { Invoice } from '../../types';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { formatDate, formatDateTime } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

/** فاتورة قابلة للطباعة — تنسيق واضح بالشعار والبنود والإجماليات */
export function InvoicePrintView({ invoice }: { invoice: Invoice }) {
  const { settings } = useApp();
  const { t, lang } = useI18n();

  const statusTone =
    invoice.status === 'paid'
      ? 'text-emerald-600'
      : invoice.status === 'partial'
        ? 'text-amber-600'
        : invoice.status === 'cancelled'
          ? 'text-rose-600'
          : 'text-slate-500';

  return (
    <div className="print-area mx-auto max-w-xl bg-white p-6 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
      {/* الترويسة */}
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3 dark:border-slate-300">
        <div>
          <h2 className="text-lg font-extrabold">{settings.storeName || t('storeNameLabel')}</h2>
          {settings.storeAddress && <p className="text-xs text-slate-500">{settings.storeAddress}</p>}
          {settings.storePhone && (
            <p className="text-xs text-slate-500" dir="ltr">
              {settings.storePhone}
            </p>
          )}
        </div>
        <div className="text-end">
          <p className="text-sm font-extrabold">{t('invoiceDetails')}</p>
          <p className="text-xs font-bold" dir="ltr">
            {invoice.number}
          </p>
          <p className="text-[11px] text-slate-500">{formatDate(invoice.date, lang)}</p>
          {invoice.status === 'cancelled' && (
            <p className="mt-1 text-[11px] font-bold text-rose-600">
              {t('statusCancelled')}
              {invoice.cancelReason ? ` — ${invoice.cancelReason}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* العميل */}
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {t('soldTo')}: <strong>{invoice.customerName || t('walkInCustomer')}</strong>
        </span>
        <span className={`font-bold ${statusTone}`}>
          {invoice.status === 'paid'
            ? t('statusPaid')
            : invoice.status === 'partial'
              ? t('statusPartial')
              : invoice.status === 'cancelled'
                ? t('statusCancelled')
                : t('statusUnpaid')}
        </span>
      </div>

      {/* البنود */}
      <table className="mt-4 w-full border-collapse text-xs">
        <thead>
          <tr className="border-y border-slate-300 dark:border-slate-600">
            <th className="py-1.5 text-start font-bold">#</th>
            <th className="py-1.5 text-start font-bold">{t('productName')}</th>
            <th className="py-1.5 text-center font-bold">{t('quantity')}</th>
            <th className="py-1.5 text-end font-bold">{t('price')}</th>
            <th className="py-1.5 text-end font-bold">{t('total')}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, idx) => (
            <tr key={`${item.productId}-${idx}`} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-1.5 text-slate-400">{idx + 1}</td>
              <td className="py-1.5">
                <span className="font-semibold">{item.name}</span>
                <span className="ms-1 text-[10px] text-slate-400" dir="ltr">
                  {item.code}
                </span>
              </td>
              <td className="py-1.5 text-center font-mono">{item.quantity}</td>
              <td className="py-1.5 text-end font-mono">{formatMoney(item.unitPrice)}</td>
              <td className="py-1.5 text-end font-mono font-bold">{formatMoney(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* الإجماليات */}
      <div className="mt-4 ms-auto max-w-xs space-y-1 text-xs">
        <Line label={t('subtotal')} value={formatMoney(invoice.subtotal, settings.currency)} />
        <Line label={t('discount')} value={`− ${formatMoney(invoice.discount, settings.currency)}`} />
        <div className="flex items-center justify-between border-y-2 border-slate-800 py-1.5 text-sm font-extrabold dark:border-slate-300">
          <span>{t('total')}</span>
          <span dir="ltr">{formatMoney(invoice.total, settings.currency)}</span>
        </div>
        <Line label={t('paid')} value={formatMoney(invoice.paid, settings.currency)} />
        <Line label={t('remaining')} value={formatMoney(invoice.remaining, settings.currency)} strong />
      </div>

      <p className="mt-6 text-center text-[11px] text-slate-400">
        {t('thanksNote')} · {formatDateTime(invoice.createdAt, lang)}
      </p>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-bold' : 'text-slate-500'}>{label}</span>
      <span className={`font-mono ${strong ? 'font-extrabold' : ''}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}
