import type { PrismaClient } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import { checkAuth } from './api-auth';
import { prisma } from './prisma';

export type MenuAction = 'view' | 'create' | 'edit';

/** Existing menu flags and ADMIN bypass. Parent VIEW controls read/navigation
 * visibility; CREATE and EDIT remain independent of VIEW. No per-row checks. */
export async function resolveMenuGrants(session: Session, menuPath: string, db: Pick<PrismaClient, '$queryRaw'> = prisma) {
  if (session.user.role === 'ADMIN') return { canView: true, canCreate: true, canEdit: true, canDelete: true };
  const [grants] = await db.$queryRaw<{
    canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  }[]>`SELECT
      COALESCE(access.can_view, false) AND (menu.parent_id IS NULL
        OR (parent.is_active AND COALESCE(parent_access.can_view, false))) AS "canView",
      COALESCE(access.can_create, false) AS "canCreate",
      COALESCE(access.can_edit, false) AS "canEdit",
      COALESCE(access.can_delete, false) AS "canDelete"
    FROM menus menu
    LEFT JOIN user_access_menus access ON access.menu_id = menu.id AND access.user_id = ${session.user.id}
    LEFT JOIN menus parent ON parent.id = menu.parent_id
    LEFT JOIN user_access_menus parent_access ON parent_access.menu_id = parent.id AND parent_access.user_id = ${session.user.id}
    WHERE menu.menu_path = ${menuPath} AND menu.is_active LIMIT 1`;
  return grants ?? { canView: false, canCreate: false, canEdit: false, canDelete: false };
}

export async function checkMenuAuth(menuPath: string, action: MenuAction = 'view') {
  const auth = await checkAuth();
  if (!auth.authenticated) return auth;
  const session = auth.session as Session | null;
  if (!session?.user?.id) return { authenticated: false as const, response: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) };
  const grants = await resolveMenuGrants(session, menuPath);
  const permitted = { view: grants.canView, create: grants.canCreate, edit: grants.canEdit }[action];
  if (!permitted) return { authenticated: false as const, response: NextResponse.json({
    message: `Forbidden - ${menuPath} ${action.toUpperCase()} grant required`,
  }, { status: 403 }) };
  return { authenticated: true as const, session, grants };
}
