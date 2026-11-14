import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as mui from '@mui/material';
import Logout from '@mui/icons-material/Logout';
import NavigateNext from '@mui/icons-material/NavigateNext';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Brightness4 from '@mui/icons-material/Brightness4';
import Brightness7 from '@mui/icons-material/Brightness7';
import { getTheme } from '../app/theme/theme';

// Offline JSX/handler and real MUI CSS checks. No browser geometry, focus,
// hit-testing, application session, effects or network requests are simulated.
function load(file: string, imports: Record<string, unknown>) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    exports,
    require: (name: string) => {
      if (!(name in imports)) throw new Error(`Unmocked import: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

type Node = React.ReactElement<any>;
function nodes(node: React.ReactNode): Node[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement(child)
    ? [child as Node, ...nodes((child as Node).props.children)] : []);
}

function header(width = 375, mode: 'light' | 'dark' = 'light', path = '/insw/queue-settings', name = 'User', collapsed = false) {
  const theme = getTheme(mode);
  let anchor: unknown = null;
  let toggles = 0;
  let drawerClicks = 0;
  let collapseClicks = 0;
  const signOutCalls: unknown[] = [];
  const destinations: string[] = [];
  const shared = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': mui,
  };
  const { ThemeToggle } = load('app/components/ThemeToggle.tsx', {
    ...shared,
    '@mui/icons-material/Brightness4': { default: Brightness4, __esModule: true },
    '@mui/icons-material/Brightness7': { default: Brightness7, __esModule: true },
    './ThemeProvider': { useThemeMode: () => ({ mode, toggleTheme: () => { toggles++; } }) },
  });
  const { Header } = load('app/components/Header.tsx', {
    ...shared,
    react: { ...React, useState: () => [anchor, (value: unknown) => { anchor = value; }] },
    '@mui/material': { ...mui, useTheme: () => theme, useMediaQuery: () => width < theme.breakpoints.values.md },
    '@mui/icons-material': { Logout, NavigateNext, Menu: MenuIcon, ChevronLeft: ChevronLeftIcon, ChevronRight: ChevronRightIcon },
    './ThemeToggle': { ThemeToggle },
    'next-auth/react': {
      useSession: () => ({ data: { user: { name, email: `${'email'.repeat(50)}@example.invalid` } } }),
      signOut: async (options: unknown) => { signOutCalls.push(options); },
    },
    'next/navigation': { usePathname: () => path, useRouter: () => ({ push: (url: string) => destinations.push(url) }) },
    'next/link': { __esModule: true, default: React.forwardRef<HTMLAnchorElement, any>((props, ref) => React.createElement('a', { ...props, ref })) },
  });
  const tree = () => Header({ sidebarCollapsed: collapsed, onMenuClick: () => { drawerClicks++; }, onToggleCollapse: () => { collapseClicks++; } });
  return {
    tree, theme, ThemeToggle, signOutCalls, destinations,
    counts: () => ({ toggles, drawerClicks, collapseClicks }),
    html: () => renderToStaticMarkup(React.createElement(mui.ThemeProvider, { theme }, tree())),
  };
}

// Resolve actual MUI sx breakpoint output, without claiming physical layout.
function styles(view: ReturnType<typeof header>, node: Node, width: number) {
  const css = view.theme.unstable_sx(node.props.sx) as Record<string, any>;
  return Object.entries(css).reduce((result, [key, value]) => {
    if (!key.startsWith('@media')) return { ...result, [key]: value };
    const min = key.match(/min-width:(\d+(?:\.\d+)?)px/);
    return min && width >= Number(min[1]) ? { ...result, ...value } : result;
  }, {} as Record<string, any>);
}

for (const mode of ['light', 'dark'] as const) {
  for (const width of [320, 375, 480, 600, 768, 899, 900, 1024, 1440]) {
    test(`MUI responsive contract at ${width}px in ${mode} mode on two shared-shell routes`, () => {
      for (const path of ['/insw/queue-settings', `/customs/${'long-page-title-'.repeat(20)}`]) {
        const view = header(width, mode, path, 'LongAccountName'.repeat(40));
        const all = nodes(view.tree());
        const toolbar = all.find(n => n.type === mui.Toolbar)!;
        const children = React.Children.toArray(toolbar.props.children).filter(React.isValidElement) as Node[];
        const actions = children.at(-1)!;
        expect(styles(view, actions, width)).toMatchObject({ display: 'flex', flexShrink: 0 });
        const crumbs = all.find(n => n.type === mui.Breadcrumbs)!;
        expect(styles(view, crumbs, width).display).toBe(width < 900 ? 'none' : 'block');
        const crumbContainer = children.find(n => n.props.children?.type === mui.Breadcrumbs)!;
        expect(styles(view, crumbContainer, width)).toMatchObject({ flexGrow: 1, minWidth: 0 });
        expect(styles(view, crumbs, width)['& .MuiBreadcrumbs-ol'].flexWrap).toBe('nowrap');
        expect(styles(view, crumbs, width)['& .MuiBreadcrumbs-li']).toMatchObject({ minWidth: 0, overflow: 'hidden' });
        if (width < 900) {
          const title = all.find(n => n.type === mui.Typography && n.props.variant === 'h6')!;
          expect(styles(view, title, width)).toMatchObject({ display: width < 600 ? 'none' : 'block', minWidth: 0, textOverflow: 'ellipsis' });
          expect(all.find(n => n.props['aria-label'] === 'open drawer')).toBeTruthy();
        } else {
          const brand = children[0];
          expect(styles(view, brand, width).flexShrink).toBe(0);
          expect(all.find(n => n.props['aria-label'] === 'open drawer')).toBeUndefined();
          expect(styles(view, all[0], width).width).toBe('calc(100% - 280px)');
        }
        const html = view.html();
        expect(html).toContain('aria-label="Account menu"');
        expect(html).toContain(`aria-label="Switch to ${mode === 'light' ? 'dark' : 'light'} mode"`);
        expect(html).toContain('min-width:0');
        expect(html).toContain('@media (min-width:900px)');
      }
    });
  }
}

test('account trigger opens/closes the same menu; long account values wrap and logout keeps its destination', async () => {
  const name = 'Account'.repeat(100);
  const view = header(320, 'light', '/insw/queue-settings', name);
  const find = (type: unknown) => nodes(view.tree()).find(n => n.type === type)!;
  const trigger = () => nodes(view.tree()).find(n => n.props['aria-label'] === 'Account menu')!;
  expect(trigger().props).toMatchObject({ 'aria-haspopup': 'menu', 'aria-expanded': false });
  const target = {};
  trigger().props.onClick({ currentTarget: target });
  expect(trigger().props).toMatchObject({ 'aria-expanded': true, 'aria-controls': 'header-account-menu' });
  expect(find(mui.Menu).props).toMatchObject({ id: 'header-account-menu', open: true, anchorEl: target });
  expect(find(mui.Menu).props.PaperProps.sx).toMatchObject({ maxWidth: 'calc(100vw - 32px)', overflowWrap: 'anywhere' });
  expect(nodes(view.tree()).some(n => n.props.children === name)).toBe(true);
  find(mui.Menu).props.onClose({}, 'escapeKeyDown');
  expect(find(mui.Menu).props.open).toBe(false);
  trigger().props.onClick({ currentTarget: target });
  find(mui.Menu).props.onClose({}, 'backdropClick');
  expect(find(mui.Menu).props.open).toBe(false);
  trigger().props.onClick({ currentTarget: target });
  await find(mui.MenuItem).props.onClick();
  expect(find(mui.Menu).props.open).toBe(false);
  expect(view.signOutCalls).toEqual([{ redirect: false }]);
  expect(view.destinations).toEqual(['/login']);
});

test('theme tooltip/callback and natural button order remain intact; both sidebar callbacks survive', () => {
  for (const mode of ['light', 'dark'] as const) {
    const view = header(375, mode);
    const themeTree = view.ThemeToggle();
    expect(themeTree.type).toBe(mui.Tooltip);
    expect(themeTree.props.title).toBe(`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`);
    themeTree.props.children.props.onClick();
    const controls = nodes(view.tree()).filter(n => n.type === mui.IconButton || n.type === view.ThemeToggle);
    expect(controls.map(n => n.props['aria-label'] || 'theme')).toEqual(['open drawer', 'theme', 'Account menu']);
    for (const control of controls) expect(control.props.tabIndex).toBeUndefined();
    controls[0].props.onClick();
    expect(view.counts()).toEqual({ toggles: 1, drawerClicks: 1, collapseClicks: 0 });
    expect(view.html()).toMatch(/<button[^>]*type="button"[^>]*aria-label="Account menu"/);
  }
  for (const collapsed of [false, true]) {
    const view = header(1440, 'light', '/customs/stock-opname', 'User', collapsed);
    nodes(view.tree()).find(n => n.type === mui.IconButton)!.props.onClick();
    expect(view.counts().collapseClicks).toBe(1);
    expect(styles(view, view.tree(), 1440).width).toBe(`calc(100% - ${collapsed ? 72 : 280}px)`);
  }
});
