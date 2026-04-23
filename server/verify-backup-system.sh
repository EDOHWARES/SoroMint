#!/bin/bash
#=============================================================================
# Backup & Recovery Test Verification Script
# 
# This script verifies the implementation of the scheduled encrypted backups
# and automated recovery testing system.
#
# Usage: ./verify-backup-system.sh
#=============================================================================

set -e

echo "=========================================="
echo "Backup System Verification Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Please run this script from the server directory${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Checking Node.js installation...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed. Please install Node.js v18+ first.${NC}"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js version: $NODE_VERSION${NC}"
echo ""

echo -e "${YELLOW}Step 2: Checking npm installation...${NC}"
if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm is not installed.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm is available${NC}"
echo ""

echo -e "${YELLOW}Step 3: Checking required files...${NC}"

REQUIRED_FILES=(
    "services/backup-service.js"
    "services/recovery-test-service.js"
    "utils/backup-encryption.js"
    "routes/backup-routes.js"
    "config/env-config.js"
    "tests/backup-encryption.test.js"
    "tests/backup-service.test.js"
    "tests/recovery-test-service.test.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ $file exists${NC}"
    else
        echo -e "${RED}✗ $file missing${NC}"
        exit 1
    fi
done
echo ""

echo -e "${YELLOW}Step 4: Checking syntax of JavaScript files...${NC}"
for file in "${REQUIRED_FILES[@]}"; do
    if node --check "$file" 2>/dev/null; then
        echo -e "${GREEN}✓ $file syntax OK${NC}"
    else
        echo -e "${RED}✗ $file has syntax errors${NC}"
        node --check "$file"
        exit 1
    fi
done
echo ""

echo -e "${YELLOW}Step 5: Running unit tests...${NC}"
npm test -- --testPathPattern="backup" --passWithNoTests --forceExit
echo ""

echo -e "${YELLOW}Step 6: Verifying backup routes are registered...${NC}"
if grep -q "backup-routes" index.js; then
    echo -e "${GREEN}✓ Backup routes registered in index.js${NC}"
else
    echo -e "${RED}✗ Backup routes not found in index.js${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}Step 7: Verifying cron jobs are scheduled...${NC}"
if grep -q "scheduleBackups" index.js && grep -q "scheduleRecoveryTests" index.js; then
    echo -e "${GREEN}✓ Cron jobs scheduled in index.js${NC}"
else
    echo -e "${RED}✗ Cron jobs not properly scheduled${NC}"
    exit 1
fi
echo ""

echo "=========================================="
echo -e "${GREEN}All verification steps passed!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Copy .env.example.backup to .env and configure your values"
echo "2. Ensure AWS credentials are set in .env"
echo "3. Set BACKUP_ENCRYPTION_PASSWORD (or it will be auto-generated)"
echo "4. Run 'npm run dev' to start the server"
echo ""
echo "API Endpoints:"
echo "  POST /api/backups/trigger    - Manually trigger a backup"
echo "  GET  /api/backups            - List all backups"
echo "  GET  /api/backups/metadata   - List backup metadata"
echo "  POST /api/backups/test-recovery - Trigger recovery test"
echo "  GET  /api/backups/status     - Get backup system status"
echo ""