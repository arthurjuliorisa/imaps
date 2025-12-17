# ============================================================================
# iMAPS Production Database Deployment Script (PowerShell)
# ============================================================================
# Version: 1.0
# Description: Automated deployment script for iMAPS database setup on Windows
# Usage: .\scripts\deploy.ps1 [-Environment production] [-SkipInit] [-SkipSeed]
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("development", "production")]
    [string]$Environment = "development",

    [Parameter(Mandatory=$false)]
    [switch]$SkipInit = $false,

    [Parameter(Mandatory=$false)]
    [switch]$SkipSeed = $false,

    [Parameter(Mandatory=$false)]
    [string]$PostgresUser = "postgres",

    [Parameter(Mandatory=$false)]
    [string]$DatabaseName = "imaps_db",

    [Parameter(Mandatory=$false)]
    [string]$DatabaseUser = "appuser"
)

# ============================================================================
# CONFIGURATION
# ============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$SqlDir = Join-Path $ScriptDir "sql"
$LogDir = Join-Path $ProjectRoot "logs\deployment"
$LogFile = Join-Path $LogDir "deploy_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-Log {
    param(
        [string]$Level,
        [string]$Message
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"

    # Write to console with colors
    switch ($Level) {
        "INFO"    { Write-Host $logMessage -ForegroundColor Cyan }
        "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
        "WARNING" { Write-Host $logMessage -ForegroundColor Yellow }
        "ERROR"   { Write-Host $logMessage -ForegroundColor Red }
        default   { Write-Host $logMessage }
    }

    # Write to log file
    Add-Content -Path $LogFile -Value $logMessage
}

function Write-Info {
    param([string]$Message)
    Write-Log -Level "INFO" -Message $Message
}

function Write-Success {
    param([string]$Message)
    Write-Log -Level "SUCCESS" -Message $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Log -Level "WARNING" -Message $Message
}

function Write-Error {
    param([string]$Message)
    Write-Log -Level "ERROR" -Message $Message
}

function Write-Fatal {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

function Show-Help {
    @"
iMAPS Database Deployment Script (PowerShell)

Usage: .\scripts\deploy.ps1 [OPTIONS]

Parameters:
    -Environment    Set environment (development|production) [default: development]
    -SkipInit       Skip database initialization (use for existing databases)
    -SkipSeed       Skip data seeding
    -PostgresUser   PostgreSQL superuser [default: postgres]
    -DatabaseName   Database name [default: imaps_db]
    -DatabaseUser   Application database user [default: appuser]
    -Help           Show this help message

Examples:
    # Full deployment (development)
    .\scripts\deploy.ps1

    # Production deployment
    .\scripts\deploy.ps1 -Environment production

    # Deploy without reinitializing database
    .\scripts\deploy.ps1 -SkipInit

    # Deploy without seeding data
    .\scripts\deploy.ps1 -SkipSeed

Environment Variables:
    DATABASE_URL        PostgreSQL connection string
    PGPASSWORD          PostgreSQL password (for psql command)

"@
}

# ============================================================================
# PREREQUISITES CHECK
# ============================================================================

function Test-Prerequisites {
    Write-Info "Checking prerequisites..."

    # Check if we're in the right directory
    if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
        Write-Fatal "Error: Not in project root directory. Please run from project root."
    }

    # Check for required commands
    $requiredCommands = @("psql", "node", "npm")
    foreach ($cmd in $requiredCommands) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            Write-Fatal "Error: Required command '$cmd' not found. Please install it first."
        }
    }

    # Check for SQL files
    $requiredSqlFiles = @(
        "00_init_database.sql",
        "01_setup_partitions.sql",
        "02_traceability_tables.sql",
        "03_functions.sql",
        "04_create_views.sql"
    )
    foreach ($sqlFile in $requiredSqlFiles) {
        $sqlPath = Join-Path $SqlDir $sqlFile
        if (-not (Test-Path $sqlPath)) {
            Write-Fatal "Error: Required SQL file '$sqlFile' not found in $SqlDir"
        }
    }

    # Check for .env file
    $envPath = Join-Path $ProjectRoot ".env"
    if (-not (Test-Path $envPath)) {
        Write-Warning ".env file not found. Make sure DATABASE_URL is set in environment."
    }

    # Check DATABASE_URL
    if (-not $env:DATABASE_URL) {
        Write-Warning "DATABASE_URL not set. Using default connection settings."
    }

    Write-Success "Prerequisites check passed"
}

# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================

function Initialize-Database {
    if ($SkipInit) {
        Write-Warning "Skipping database initialization (-SkipInit flag)"
        return
    }

    Write-Info "Initializing database..."

    $initScript = Join-Path $SqlDir "00_init_database.sql"

    try {
        $result = & psql -U $PostgresUser -f $initScript 2>&1
        $result | Out-File -FilePath $LogFile -Append

        Write-Success "Database initialized successfully"
    }
    catch {
        Write-Fatal "Failed to initialize database. Check $LogFile for details. Error: $_"
    }
}

# ============================================================================
# PRISMA OPERATIONS
# ============================================================================

function Invoke-PrismaGenerate {
    Write-Info "Running Prisma generate..."

    try {
        $result = & npx prisma generate 2>&1
        $result | Out-File -FilePath $LogFile -Append

        if ($LASTEXITCODE -eq 0) {
            Write-Success "Prisma client generated successfully"
        }
        else {
            throw "Prisma generate failed with exit code $LASTEXITCODE"
        }
    }
    catch {
        Write-Fatal "Failed to generate Prisma client. Check $LogFile for details. Error: $_"
    }
}

function Invoke-PrismaPush {
    Write-Info "Running Prisma db push..."

    $prismaArgs = @("db", "push")

    if ($Environment -eq "development") {
        $prismaArgs += "--force-reset"
        Write-Warning "Using --force-reset (development mode)"
    }
    else {
        Write-Warning "Production mode: No force-reset. Migrations will be applied incrementally."
    }

    try {
        $result = & npx prisma @prismaArgs 2>&1
        $result | Out-File -FilePath $LogFile -Append

        if ($LASTEXITCODE -eq 0) {
            Write-Success "Prisma schema pushed successfully"
        }
        else {
            throw "Prisma push failed with exit code $LASTEXITCODE"
        }
    }
    catch {
        Write-Fatal "Failed to push Prisma schema. Check $LogFile for details. Error: $_"
    }
}

# ============================================================================
# SQL SCRIPTS EXECUTION
# ============================================================================

function Invoke-SqlScript {
    param(
        [string]$ScriptName
    )

    $scriptPath = Join-Path $SqlDir $ScriptName
    Write-Info "Executing $ScriptName..."

    try {
        $result = & psql -U $DatabaseUser -d $DatabaseName -f $scriptPath 2>&1
        $result | Out-File -FilePath $LogFile -Append

        if ($LASTEXITCODE -eq 0) {
            Write-Success "$ScriptName executed successfully"
            return $true
        }
        else {
            Write-Error "Failed to execute $ScriptName. Check $LogFile for details."
            return $false
        }
    }
    catch {
        Write-Error "Failed to execute $ScriptName. Error: $_"
        return $false
    }
}

function Initialize-Partitions {
    Write-Info "Setting up table partitions..."
    if (-not (Invoke-SqlScript "01_setup_partitions.sql")) {
        Write-Fatal "Failed to setup partitions"
    }
}

function Initialize-TraceabilityTables {
    Write-Info "Creating traceability tables..."
    if (-not (Invoke-SqlScript "02_traceability_tables.sql")) {
        Write-Fatal "Failed to create traceability tables"
    }
}

function Initialize-Functions {
    Write-Info "Creating database functions..."
    if (-not (Invoke-SqlScript "03_functions.sql")) {
        Write-Fatal "Failed to create functions"
    }
}

function Initialize-Views {
    Write-Info "Creating database views..."
    if (-not (Invoke-SqlScript "04_create_views.sql")) {
        Write-Fatal "Failed to create views"
    }
}

# ============================================================================
# DATA SEEDING
# ============================================================================

function Initialize-SeedData {
    if ($SkipSeed) {
        Write-Warning "Skipping database seeding (-SkipSeed flag)"
        return
    }

    Write-Info "Seeding database..."

    try {
        $result = & npm run seed 2>&1
        $result | Out-File -FilePath $LogFile -Append

        if ($LASTEXITCODE -eq 0) {
            Write-Success "Database seeded successfully"
        }
        else {
            throw "Seeding failed with exit code $LASTEXITCODE"
        }
    }
    catch {
        Write-Fatal "Failed to seed database. Check $LogFile for details. Error: $_"
    }
}

# ============================================================================
# POST-DEPLOYMENT VERIFICATION
# ============================================================================

function Test-Deployment {
    Write-Info "Verifying deployment..."

    # Check if key tables exist
    $tables = @("companies", "items", "users", "incoming_goods", "outgoing_goods", "stock_daily_snapshot")
    foreach ($table in $tables) {
        try {
            $result = & psql -U $DatabaseUser -d $DatabaseName -tc "SELECT 1 FROM $table LIMIT 1" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Table '$table' verified"
            }
            else {
                Write-Warning "Table '$table' may not exist or is empty"
            }
        }
        catch {
            Write-Warning "Could not verify table '$table'"
        }
    }

    # Check if functions exist
    $functions = @("calculate_stock_snapshot", "populate_work_order_material_consumption", "populate_work_order_fg_production")
    foreach ($func in $functions) {
        try {
            $result = & psql -U $DatabaseUser -d $DatabaseName -tc "SELECT 1 FROM pg_proc WHERE proname = '$func'" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Function '$func' verified"
            }
            else {
                Write-Warning "Function '$func' may not exist"
            }
        }
        catch {
            Write-Warning "Could not verify function '$func'"
        }
    }

    # Check if views exist
    $views = @("vw_laporan_pemasukan", "vw_laporan_pengeluaran", "vw_lpj_bahan_baku")
    foreach ($view in $views) {
        try {
            $result = & psql -U $DatabaseUser -d $DatabaseName -tc "SELECT 1 FROM pg_views WHERE viewname = '$view'" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Success "View '$view' verified"
            }
            else {
                Write-Warning "View '$view' may not exist"
            }
        }
        catch {
            Write-Warning "Could not verify view '$view'"
        }
    }
}

# ============================================================================
# MAIN DEPLOYMENT WORKFLOW
# ============================================================================

function Start-Deployment {
    Write-Info "============================================================================"
    Write-Info "iMAPS Database Deployment (PowerShell)"
    Write-Info "============================================================================"
    Write-Info "Environment: $Environment"
    Write-Info "Skip Init: $SkipInit"
    Write-Info "Skip Seed: $SkipSeed"
    Write-Info "Log File: $LogFile"
    Write-Info "============================================================================"

    # Create log directory
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }

    # Run deployment steps
    Test-Prerequisites

    # Step 1: Initialize database (optional)
    Initialize-Database

    # Step 2: Generate Prisma client
    Invoke-PrismaGenerate

    # Step 3: Push Prisma schema
    Invoke-PrismaPush

    # Step 4: Setup partitions
    Initialize-Partitions

    # Step 5: Create traceability tables
    Initialize-TraceabilityTables

    # Step 6: Create functions
    Initialize-Functions

    # Step 7: Create views
    Initialize-Views

    # Step 8: Seed database (optional)
    Initialize-SeedData

    # Step 9: Verify deployment
    Test-Deployment

    Write-Info "============================================================================"
    Write-Success "Deployment completed successfully!"
    Write-Info "============================================================================"
    Write-Info "Next steps:"
    Write-Info "  1. Verify the application can connect to the database"
    Write-Info "  2. Run the application: npm run dev"
    Write-Info "  3. Check the logs: Get-Content $LogFile -Tail 50"
    Write-Info "============================================================================"
}

# ============================================================================
# RUN SCRIPT
# ============================================================================

try {
    Start-Deployment
}
catch {
    Write-Fatal "Deployment failed: $_"
}
