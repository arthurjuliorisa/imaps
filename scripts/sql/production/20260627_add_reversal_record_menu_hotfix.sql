-- Production hotfix: register Reversal Record under the Transaksi menu.
--
-- This is an incremental data hotfix for existing databases. Fresh setup and
-- reseeding are handled by prisma/seeders/menu.seeder.ts.
--
-- The menus table has no unique constraint on menu_name or menu_path, so this
-- script uses guarded lookups instead of INSERT ... ON CONFLICT.

BEGIN;

DO $$
DECLARE
    transaksi_menu_id TEXT;
    transaksi_menu_count INTEGER;
    reversal_menu_id TEXT;
    reversal_menu_count INTEGER;
BEGIN
    SELECT COUNT(*), MIN(id)
    INTO transaksi_menu_count, transaksi_menu_id
    FROM menus
    WHERE menu_name = 'Transaksi'
      AND parent_id IS NULL;

    IF transaksi_menu_count = 0 THEN
        RAISE EXCEPTION 'Parent menu Transaksi was not found';
    END IF;

    IF transaksi_menu_count > 1 THEN
        RAISE EXCEPTION 'Parent menu Transaksi is ambiguous: % root records found', transaksi_menu_count;
    END IF;

    SELECT COUNT(*), MIN(id)
    INTO reversal_menu_count, reversal_menu_id
    FROM menus
    WHERE menu_path = '/customs/reversal-record';

    IF reversal_menu_count > 1 THEN
        RAISE EXCEPTION 'Reversal Record menu is ambiguous: % records found for /customs/reversal-record', reversal_menu_count;
    END IF;

    IF reversal_menu_count = 0 THEN
        INSERT INTO menus (
            parent_id,
            menu_name,
            menu_path,
            menu_icon,
            menu_order,
            is_active,
            created_at,
            updated_at
        )
        VALUES (
            transaksi_menu_id,
            'Reversal Record',
            '/customs/reversal-record',
            'History',
            4,
            true,
            NOW(),
            NOW()
        );
    ELSE
        UPDATE menus
        SET
            parent_id = transaksi_menu_id,
            menu_name = 'Reversal Record',
            menu_path = '/customs/reversal-record',
            menu_icon = 'History',
            menu_order = 4,
            is_active = true,
            updated_at = NOW()
        WHERE id = reversal_menu_id;
    END IF;
END $$;

COMMIT;

-- Verification queries:
--
-- Confirm the Transaksi parent:
-- SELECT id, menu_name, parent_id, menu_order, is_active
-- FROM menus
-- WHERE menu_name = 'Transaksi'
--   AND parent_id IS NULL;
--
-- Confirm the Reversal Record menu and parent:
-- SELECT
--     child.id,
--     child.menu_name,
--     child.menu_path,
--     child.parent_id,
--     parent.menu_name AS parent_name,
--     child.menu_icon,
--     child.menu_order,
--     child.is_active
-- FROM menus child
-- LEFT JOIN menus parent
--   ON parent.id = child.parent_id
-- WHERE child.menu_path = '/customs/reversal-record';
--
-- Duplicate check. Expected result: count = 1.
-- SELECT menu_path, COUNT(*)
-- FROM menus
-- WHERE menu_path = '/customs/reversal-record'
-- GROUP BY menu_path;
--
-- Administrator access note:
-- ADMIN users bypass user_access_menus in
-- app/api/settings/access-menu/current-user-menus/route.ts and receive all
-- active menus at runtime. Non-admin users must be granted access manually
-- through Access Menu.
--
-- Optional non-admin access check:
-- SELECT
--     u.email,
--     u.role,
--     m.menu_name,
--     uam.can_view,
--     uam.can_create,
--     uam.can_edit,
--     uam.can_delete
-- FROM user_access_menus uam
-- JOIN users u ON u.id = uam.user_id
-- JOIN menus m ON m.id = uam.menu_id
-- WHERE m.menu_path = '/customs/reversal-record';
--
-- Rollback, if this hotfix must be reverted:
-- BEGIN;
-- DELETE FROM user_access_menus
-- WHERE menu_id IN (
--     SELECT id
--     FROM menus
--     WHERE menu_path = '/customs/reversal-record'
-- );
-- DELETE FROM menus
-- WHERE menu_path = '/customs/reversal-record'
--   AND menu_name = 'Reversal Record';
-- COMMIT;
