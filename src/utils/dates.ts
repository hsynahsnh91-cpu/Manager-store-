/** أدوات التاريخ */

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function daysAgo(days: number, from = Date.now()): number {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

export function formatDate(ts: number, lang: 'ar' | 'en' = 'ar'): string {
  return new Date(ts).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatDateTime(ts: number, lang: 'ar' | 'en' = 'ar'): string {
  return new Date(ts).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(ts: number, lang: 'ar' | 'en' = 'ar'): string {
  return new Date(ts).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** قيمة حقل input[type=date] (YYYY-MM-DD) */
export function toDateInput(ts: number): string {
  const d = new Date(startOfDay(ts));
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** تحويل قيمة input[type=date] إلى بداية اليوم */
export function fromDateInput(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return Date.now();
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
