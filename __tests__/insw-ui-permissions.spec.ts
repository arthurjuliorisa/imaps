import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/** Actual editor closures with a small re-rendering hook double. This verifies
 * state and request serialization; rendered browser coverage is separate. */
function editor(fetcher: (url: string, init?: RequestInit) => Promise<any>) {
  let cursor = 0;
  const slots: any[] = [];
  const hooks = {
    useState: (initial: any) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef: (initial: any) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    }, useEffect: () => {},
  };
  const imports: Record<string, unknown> = {
    react: hooks, '@mui/material': { useTheme: () => ({}) }, '@mui/icons-material': {},
    '@/app/components/ToastProvider': { useToast: () => ({ success: () => {}, error: () => {} }) },
    'next/navigation': { useSearchParams: () => ({ get: () => null }) }, 'react/jsx-runtime': {},
  };
  const source = readFileSync('app/(authenticated)/settings/access-menu/page.tsx', 'utf8').replace('  return (\n    <Box>',
    '  return { fetchUserPermissions, handleTogglePermission, handleSave, setSelectedUser, permissions } as any;\n  return (\n    <Box>');
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; }, fetch: fetcher, console: { error: () => {} } });
  const render = () => { cursor = 0; return exports.default(); };
  return { render };
}
const initial = [
  { menuId: 'insw', canView: false, canCreate: true, canEdit: false, canDelete: true },
  { menuId: 'unrelated', canView: true, canCreate: false, canEdit: true, canDelete: false },
];
const response = (data: any, ok = true) => ({ ok, json: async () => data });

test('editor load and unchanged save preserve all four flags and unrelated assignments', async () => {
  let saved: any;
  const view = editor(async (_url, init) => {
    if (init?.method === 'POST') { saved = JSON.parse(String(init.body)); return response({}); }
    return response(initial);
  });
  let page = view.render(); page.setSelectedUser({ id: 'A', label: 'A' }); page = view.render();
  await page.fetchUserPermissions('A'); page = view.render();
  await page.handleSave();
  expect(saved).toEqual({ userId: 'A', permissions: initial });
  for (const field of ['canView', 'canCreate', 'canEdit', 'canDelete']) {
    const before = structuredClone(page.permissions);
    page.handleTogglePermission('insw', field); page = view.render();
    expect(page.permissions).toEqual({ ...before, insw: { ...before.insw, [field]: !before.insw[field] } });
    await page.handleSave();
    expect(saved.permissions.find((p: any) => p.menuId === 'insw')).toEqual({ menuId: 'insw', ...page.permissions.insw });
  }
});

test('editor cannot save another user stale grants or failed permission loads', async () => {
  let resolveOld!: (value: any) => void; let posts = 0;
  const old = new Promise<any>(resolve => { resolveOld = resolve; });
  const view = editor(async (url, init) => {
    if (init?.method === 'POST') { posts++; return response({}); }
    return url.endsWith('=A') ? old : response([{ ...initial[0], canCreate: false, canEdit: true }]);
  });
  let page = view.render(); page.setSelectedUser({ id: 'A', label: 'A' }); page = view.render();
  const oldLoad = page.fetchUserPermissions('A');
  page.setSelectedUser({ id: 'B', label: 'B' }); page = view.render();
  const newLoad = page.fetchUserPermissions('B'); page = view.render();
  await page.handleSave(); expect(posts).toBe(0);
  await newLoad; page = view.render();
  resolveOld(response(initial)); await oldLoad; page = view.render();
  expect(page.permissions.insw.canCreate).toBe(false);
  expect(page.permissions.insw.canEdit).toBe(true);
  await page.handleSave(); expect(posts).toBe(1);

  const failed = editor(async (_url, init) => { if (init?.method === 'POST') posts++; return response({}, false); });
  let failedPage = failed.render(); failedPage.setSelectedUser({ id: 'C', label: 'C' }); failedPage = failed.render();
  await failedPage.fetchUserPermissions('C'); failedPage = failed.render();
  await failedPage.handleSave(); expect(posts).toBe(1);
});
