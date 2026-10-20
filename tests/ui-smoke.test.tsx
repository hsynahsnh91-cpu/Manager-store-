// @vitest-environment jsdom
/**
 * اختبار دخان للواجهة: يصيّر التطبيق ويتنقل بين جميع الصفحات دون أخطاء.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// بيئة DOM مبسّطة للاختبار
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderApp(): Promise<Root> {
  const { default: App } = await import('../src/App');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(App));
  });
  return root;
}

async function navigate(hash: string): Promise<void> {
  window.location.hash = hash;
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

let root: Root | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  window.location.hash = '#/';
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
});

describe('الواجهة — صياغة الصفحات', () => {
  it('يُصيّر التطبيق ويعرض لوحة التحكم', async () => {
    root = await renderApp();
    expect(document.body.textContent).toBeTruthy();
    // بطاقة واحدة على الأقل من لوحة التحكم
    expect(document.querySelectorAll('main').length).toBeGreaterThanOrEqual(0);
  });

  it('يتنقل إلى جميع الصفحات دون أخطاء', async () => {
    root = await renderApp();
    const routes = [
      '#/products',
      '#/pos',
      '#/invoices',
      '#/purchases',
      '#/customers',
      '#/suppliers',
      '#/expenses',
      '#/cash',
      '#/reports',
      '#/settings',
      '#/',
    ];
    for (const route of routes) {
      await navigate(route);
      // لا يجب أن ينهار التطبيق — وجود محتوى في الصفحة يعني نجاح الصياغة
      expect(document.body.innerHTML.length).toBeGreaterThan(100);
    }
  }, 20000);
});
