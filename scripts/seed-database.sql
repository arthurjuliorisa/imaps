-- =============================================================================
-- iMAPS v2.4.2 - Database Seeding Script
-- Populates initial data for companies, item types, users, and menus
-- =============================================================================

-- ==================== SEED USERS ====================
INSERT INTO users (id, username, email, password, role, company_code) VALUES
  ('user-admin-001', 'admin', 'admin@imaps.local', '$2a$10$Mb6Dd.uSApQg9tSfD7KGnuEf06PoAdPDkhhgM3WRdu1tZFOumzYoW', 'ADMIN', '1370'),
  ('user-viewer-001', 'viewer', 'viewer@imaps.local', '$2a$10$KPEZKNM75oOL2xkl3qRl3u1qRbLnC4BQWvCim0Au4rFgAw9hrnEG2', 'VIEWER', '1370'),
  ('user-operator-001', 'operator', 'operator@imaps.local', '$2a$10$BWMgfYW0zPNx0j4SPQKNd.N9kwgEmqdnM.QqPeHLd2pK0hjrWgmp2', 'USER', '1370')
ON CONFLICT (email) DO NOTHING;

-- ==================== SEED MENUS ====================
INSERT INTO menus (id, name, route, icon, "order", parent_id) VALUES
  ('menu-01', 'Dashboard', '/dashboard', 'HomeIcon', 1, NULL),

  -- Master Data
  ('menu-10', 'Master Data', '#', 'DatabaseIcon', 10, NULL),
  ('menu-11', 'Companies', '/master/companies', 'BuildingIcon', 11, NULL),
  ('menu-12', 'Item Types', '/master/item-types', 'TagIcon', 12, NULL),
  ('menu-13', 'Beginning Balances', '/master/beginning-balances', 'ScaleIcon', 13, NULL),

  -- Customs Transactions
  ('menu-20', 'Customs', '#', 'TruckIcon', 20, NULL),
  ('menu-21', 'Incoming Goods', '/customs/incoming', 'ArrowDownIcon', 21, NULL),
  ('menu-22', 'Outgoing Goods', '/customs/outgoing', 'ArrowUpIcon', 22, NULL),
  ('menu-23', 'Material Usage', '/customs/material-usage', 'CogIcon', 23, NULL),
  ('menu-24', 'Production Output', '/customs/production', 'PackageIcon', 24, NULL),
  ('menu-25', 'WIP Balance', '/customs/wip-balance', 'LayersIcon', 25, NULL),
  ('menu-26', 'Adjustments', '/customs/adjustments', 'EditIcon', 26, NULL),

  -- Reports
  ('menu-30', 'Reports', '#', 'FileTextIcon', 30, NULL),
  ('menu-31', 'Stock Daily Snapshot', '/reports/stock-snapshot', 'CameraIcon', 31, NULL),
  ('menu-32', 'PPKEK Traceability', '/reports/traceability', 'GitBranchIcon', 32, NULL),
  ('menu-33', 'Work Order Summary', '/reports/work-orders', 'ClipboardIcon', 33, NULL),

  -- Settings
  ('menu-40', 'Settings', '#', 'SettingsIcon', 40, NULL),
  ('menu-41', 'Users', '/settings/users', 'UsersIcon', 41, NULL),
  ('menu-42', 'Access Control', '/settings/access-menu', 'ShieldIcon', 42, NULL),
  ('menu-43', 'Activity Logs', '/settings/activity-logs', 'ListIcon', 43, NULL),
  ('menu-44', 'Batch Processing Logs', '/settings/batch-logs', 'ServerIcon', 44, NULL)
ON CONFLICT (name) DO NOTHING;

-- ==================== SEED USER ACCESS MENUS (Admin gets all) ====================
INSERT INTO user_access_menus (user_id, menu_id, can_view, can_create, can_edit, can_delete)
SELECT 'user-admin-001', id, TRUE, TRUE, TRUE, TRUE
FROM menus
ON CONFLICT (user_id, menu_id) DO NOTHING;

-- ==================== SEED USER ACCESS MENUS (Viewer - read only) ====================
INSERT INTO user_access_menus (user_id, menu_id, can_view, can_create, can_edit, can_delete)
SELECT 'user-viewer-001', id, TRUE, FALSE, FALSE, FALSE
FROM menus
WHERE name IN ('Dashboard', 'Reports', 'Stock Daily Snapshot', 'PPKEK Traceability', 'Work Order Summary')
ON CONFLICT (user_id, menu_id) DO NOTHING;

-- ==================== SEED USER ACCESS MENUS (Operator - CRUD on customs) ====================
INSERT INTO user_access_menus (user_id, menu_id, can_view, can_create, can_edit, can_delete)
SELECT 'user-operator-001', id, TRUE, TRUE, TRUE, FALSE
FROM menus
WHERE name IN ('Dashboard', 'Customs', 'Incoming Goods', 'Outgoing Goods', 'Material Usage', 'Production Output', 'WIP Balance', 'Adjustments')
ON CONFLICT (user_id, menu_id) DO NOTHING;

-- Done!
SELECT 'Database seeding completed successfully!' AS status;
