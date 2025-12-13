# PowerShell script to deploy materialized views
# Usage: .\deploy-materialized-views.ps1

Write-Host "Deploying Materialized Views v2.0..." -ForegroundColor Green

# Check if DATABASE_URL is set
if (-not $env:DATABASE_URL) {
    Write-Host "ERROR: DATABASE_URL environment variable is not set" -ForegroundColor Red
    Write-Host "Please set it using: `$env:DATABASE_URL = 'your-connection-string'" -ForegroundColor Yellow
    exit 1
}

# Get the script directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptPath
$sqlFile = Join-Path $projectRoot "lib\db\materialized-views-v2.sql"

# Check if SQL file exists
if (-not (Test-Path $sqlFile)) {
    Write-Host "ERROR: SQL file not found at $sqlFile" -ForegroundColor Red
    exit 1
}

# Deploy views
Write-Host "Executing materialized-views-v2.sql..." -ForegroundColor Cyan
Get-Content $sqlFile | psql $env:DATABASE_URL

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to create materialized views" -ForegroundColor Red
    exit 1
}

Write-Host "Creating unique indexes for CONCURRENT refresh..." -ForegroundColor Cyan

# Create unique indexes for each view
$indexSQL = @"
-- mv_laporan_pemasukan
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_laporan_pemasukan_unique
ON mv_laporan_pemasukan (company_code, ppkek_number, item_code, incoming_date);

-- mv_laporan_pengeluaran
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_laporan_pengeluaran_unique
ON mv_laporan_pengeluaran (company_code, ppkek_number, item_code, outgoing_date);

-- mv_mutasi_bahan_baku
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_bahan_baku_unique
ON mv_mutasi_bahan_baku (company_code, item_code, snapshot_date);

-- mv_posisi_wip
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_posisi_wip_unique
ON mv_posisi_wip (company_code, item_code, snapshot_date);

-- mv_mutasi_finished_goods
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_finished_goods_unique
ON mv_mutasi_finished_goods (company_code, item_code, snapshot_date);

-- mv_mutasi_capital_goods
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_capital_goods_unique
ON mv_mutasi_capital_goods (company_code, item_type_code, item_code, snapshot_date);

-- mv_mutasi_scrap
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_scrap_unique
ON mv_mutasi_scrap (company_code, item_code, snapshot_date);
"@

$indexSQL | psql $env:DATABASE_URL

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to create unique indexes" -ForegroundColor Red
    exit 1
}

Write-Host "Refreshing all views..." -ForegroundColor Cyan

# Refresh all materialized views
$views = @(
    "mv_laporan_pemasukan",
    "mv_laporan_pengeluaran",
    "mv_mutasi_bahan_baku",
    "mv_posisi_wip",
    "mv_mutasi_finished_goods",
    "mv_mutasi_capital_goods",
    "mv_mutasi_scrap"
)

foreach ($view in $views) {
    Write-Host "  Refreshing $view..." -ForegroundColor Gray
    psql $env:DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY $view;"

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: Failed to refresh $view" -ForegroundColor Yellow
    } else {
        Write-Host "  $view refreshed successfully" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Materialized Views deployment completed successfully!" -ForegroundColor Green
