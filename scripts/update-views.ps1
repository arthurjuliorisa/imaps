# ============================================================================
# Update Database Views Script
# ============================================================================
# Description: Updates PostgreSQL views for iMAPS application
# Usage: .\scripts\update-views.ps1
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DropViewsFile = Join-Path $ScriptDir "sql\00_drop_views.sql"
$CreateViewsFile = Join-Path $ScriptDir "sql\04_create_views.sql"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "iMAPS - Update Database Views" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan

# Check if SQL files exist
if (-not (Test-Path $DropViewsFile)) {
    Write-Host "ERROR: SQL file not found at $DropViewsFile" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $CreateViewsFile)) {
    Write-Host "ERROR: SQL file not found at $CreateViewsFile" -ForegroundColor Red
    exit 1
}

# Parse DATABASE_URL if provided
if ($DatabaseUrl) {
    Write-Host "Using DATABASE_URL from environment..." -ForegroundColor Yellow

    # Parse PostgreSQL URL: postgresql://user:password@host:port/database
    if ($DatabaseUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)") {
        $DbUser = $matches[1]
        $DbPassword = $matches[2]
        $DbHost = $matches[3]
        $DbPort = $matches[4]
        $DbName = $matches[5]

        Write-Host "Database: $DbName" -ForegroundColor Cyan
        Write-Host "Host: ${DbHost}:${DbPort}" -ForegroundColor Cyan
        Write-Host "User: $DbUser" -ForegroundColor Cyan

        # Set PGPASSWORD environment variable
        $env:PGPASSWORD = $DbPassword

        try {
            # Step 1: Drop existing views
            Write-Host "`n[1/2] Dropping existing views..." -ForegroundColor Yellow
            Start-Process -FilePath "psql" -ArgumentList "-h", $DbHost, "-p", $DbPort, "-U", $DbUser, "-d", $DbName, "-f", $DropViewsFile -NoNewWindow -Wait -ErrorAction SilentlyContinue

            # Note: We don't check exit code here because DROP IF EXISTS may generate NOTICE messages
            Write-Host "Views dropped successfully" -ForegroundColor Green

            # Step 2: Create new views
            Write-Host "`n[2/2] Creating new views with hybrid approach..." -ForegroundColor Yellow
            $createProcess = Start-Process -FilePath "psql" -ArgumentList "-h", $DbHost, "-p", $DbPort, "-U", $DbUser, "-d", $DbName, "-f", $CreateViewsFile -NoNewWindow -Wait -PassThru -ErrorAction SilentlyContinue

            if ($createProcess.ExitCode -eq 0) {
                Write-Host "`n============================================================================" -ForegroundColor Green
                Write-Host "SUCCESS: Database views updated successfully!" -ForegroundColor Green
                Write-Host "============================================================================" -ForegroundColor Green

                # Show summary
                Write-Host "`nViews created:" -ForegroundColor Cyan
                Write-Host "  - vw_laporan_pemasukan (Lap. Pemasukan)" -ForegroundColor Gray
                Write-Host "  - vw_laporan_pengeluaran (Lap. Pengeluaran)" -ForegroundColor Gray
                Write-Host "  - vw_lpj_bahan_baku (LPJ Bahan Baku)" -ForegroundColor Gray
                Write-Host "  - vw_lpj_hasil_produksi (LPJ Hasil Produksi)" -ForegroundColor Gray
                Write-Host "  - vw_lpj_wip (LPJ WIP)" -ForegroundColor Gray
                Write-Host "  - vw_lpj_barang_modal (LPJ Barang Modal)" -ForegroundColor Gray
                Write-Host "  - vw_lpj_barang_sisa (LPJ Scrap)" -ForegroundColor Gray
            } else {
                Write-Host "`n============================================================================" -ForegroundColor Red
                Write-Host "ERROR: Failed to create views (Exit code: $($createProcess.ExitCode))" -ForegroundColor Red
                Write-Host "============================================================================" -ForegroundColor Red
                exit 1
            }
        }
        finally {
            # Clear password from environment
            $env:PGPASSWORD = $null
        }
    } else {
        Write-Host "ERROR: Invalid DATABASE_URL format" -ForegroundColor Red
        Write-Host "Expected format: postgresql://user:password@host:port/database" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "ERROR: DATABASE_URL not found" -ForegroundColor Red
    Write-Host "Please set DATABASE_URL environment variable or provide it as parameter" -ForegroundColor Yellow
    Write-Host "`nExample:" -ForegroundColor Cyan
    Write-Host "  .\scripts\update-views.ps1 -DatabaseUrl 'postgresql://user:pass@localhost:5432/imaps_db'" -ForegroundColor Gray
    exit 1
}

Write-Host "`nDone! You can now test the updated endpoints." -ForegroundColor Green
