-- OPERATOR APPROVAL REQUIRED PER TARGET. psql only; never use -1 / --single-transaction.
-- See docs/implementation-reports/database/partition-extension-2027-2030-runbook.md.
-- Each include commits at most 16 new leaves (snapshot: 4); errors stop execution.
\set ON_ERROR_STOP on
\set AUTOCOMMIT on
\set root incoming_goods
\set date_key incoming_date
\set company 1310
\ir partition_extension_2027_2030/group.sql
\set company 1370
\ir partition_extension_2027_2030/group.sql
\set company 1380
\ir partition_extension_2027_2030/group.sql
\set root material_usages
\set date_key transaction_date
\set company 1310
\ir partition_extension_2027_2030/group.sql
\set company 1370
\ir partition_extension_2027_2030/group.sql
\set company 1380
\ir partition_extension_2027_2030/group.sql
\set root wip_balances
\set date_key stock_date
\set company 1310
\ir partition_extension_2027_2030/group.sql
\set company 1370
\ir partition_extension_2027_2030/group.sql
\set company 1380
\ir partition_extension_2027_2030/group.sql
\set root production_outputs
\set date_key transaction_date
\set company 1310
\ir partition_extension_2027_2030/group.sql
\set company 1370
\ir partition_extension_2027_2030/group.sql
\set company 1380
\ir partition_extension_2027_2030/group.sql
\set root outgoing_goods
\set date_key outgoing_date
\set company 1310
\ir partition_extension_2027_2030/group.sql
\set company 1370
\ir partition_extension_2027_2030/group.sql
\set company 1380
\ir partition_extension_2027_2030/group.sql
\set root adjustments
\set date_key transaction_date
\set company 1310
\ir partition_extension_2027_2030/group.sql
\set company 1370
\ir partition_extension_2027_2030/group.sql
\set company 1380
\ir partition_extension_2027_2030/group.sql
\set root stock_daily_snapshot
\set date_key snapshot_date
\set company none
\ir partition_extension_2027_2030/group.sql
