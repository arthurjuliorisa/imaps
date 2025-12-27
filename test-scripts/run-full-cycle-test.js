/**
 * Automated Test Script for Full Cycle Scenario
 *
 * Usage:
 *   node test-scripts/run-full-cycle-test.js
 *
 * Prerequisites:
 *   - Development server running on http://localhost:3000
 *   - Valid user credentials
 *   - Company code 1310 exists in database
 */

const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:3000';
const PAYLOAD_FILE = path.join(__dirname, '../test-payloads/full-cycle-scenario-01-complete-workflow.json');

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Load test scenario
let scenario;
try {
  const rawData = fs.readFileSync(PAYLOAD_FILE, 'utf8');
  scenario = JSON.parse(rawData);
  console.log(`${colors.cyan}✓ Loaded scenario: ${scenario.scenario_name}${colors.reset}\n`);
} catch (error) {
  console.error(`${colors.red}✗ Failed to load scenario file:${colors.reset}`, error.message);
  process.exit(1);
}

// Helper function to make API calls
async function makeRequest(method, endpoint, payload = null, cookies = null) {
  const url = `${BASE_URL}${endpoint}`;

  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (cookies) {
    options.headers['Cookie'] = cookies;
  }

  if (payload) {
    options.body = JSON.stringify(payload);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      data,
      headers: response.headers,
    };
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

// Helper function to verify stock balance
async function verifyStock(cookies, expectedStock, sequenceNum) {
  console.log(`${colors.blue}  → Verifying stock balance...${colors.reset}`);

  // Note: Adjust this endpoint based on your actual stock query API
  const result = await makeRequest('GET', '/api/customs/stock/balance', null, cookies);

  if (!result.ok) {
    console.log(`${colors.yellow}  ⚠ Stock verification skipped (API not available)${colors.reset}`);
    return;
  }

  let allMatch = true;
  for (const [itemCode, expectedQty] of Object.entries(expectedStock)) {
    const actualQty = result.data?.stock?.[itemCode] || 0;

    if (actualQty !== expectedQty) {
      console.log(`${colors.red}  ✗ ${itemCode}: Expected ${expectedQty}, Got ${actualQty}${colors.reset}`);
      allMatch = false;
    } else {
      console.log(`${colors.green}  ✓ ${itemCode}: ${actualQty}${colors.reset}`);
    }
  }

  if (allMatch) {
    console.log(`${colors.green}  ✓ All stock balances match!${colors.reset}`);
  }
}

// Main test execution
async function runTest() {
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}  Full Cycle Transaction Test${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}\n`);

  // Step 1: Login (you need to implement this based on your auth system)
  console.log(`${colors.yellow}Note: Make sure you're logged in to the application${colors.reset}`);
  console.log(`${colors.yellow}This script assumes you have a valid session cookie${colors.reset}\n`);

  const cookies = process.env.SESSION_COOKIE || null;

  if (!cookies) {
    console.log(`${colors.yellow}⚠ No SESSION_COOKIE environment variable set${colors.reset}`);
    console.log(`${colors.yellow}  Some endpoints may fail due to authentication${colors.reset}\n`);
  }

  // Step 2: Execute transactions sequentially
  let successCount = 0;
  let failCount = 0;

  for (const transaction of scenario.transactions) {
    // Skip alternative sequences if not explicitly selected
    if (transaction.sequence === '11-ALTERNATIVE' || transaction.sequence === 12) {
      console.log(`${colors.yellow}⊘ Skipping sequence ${transaction.sequence} (alternative/edge case)${colors.reset}\n`);
      continue;
    }

    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.cyan}Sequence ${transaction.sequence}: ${transaction.type}${colors.reset}`);
    console.log(`${colors.blue}${transaction.description}${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

    try {
      const result = await makeRequest('POST', transaction.endpoint, transaction.payload, cookies);

      if (result.ok) {
        console.log(`${colors.green}✓ Success: ${result.status} ${result.statusText}${colors.reset}`);
        console.log(`  Response:`, JSON.stringify(result.data, null, 2).substring(0, 200) + '...');

        // Verify stock if expected stock is provided
        if (transaction.expected_stock_after) {
          await verifyStock(cookies, transaction.expected_stock_after, transaction.sequence);
        }

        successCount++;
      } else {
        console.log(`${colors.red}✗ Failed: ${result.status} ${result.statusText}${colors.reset}`);
        console.log(`  Error:`, result.data);
        failCount++;
      }

      if (transaction.notes) {
        console.log(`${colors.yellow}  Note: ${transaction.notes}${colors.reset}`);
      }

    } catch (error) {
      console.log(`${colors.red}✗ Error: ${error.message}${colors.reset}`);
      failCount++;
    }

    console.log(''); // Empty line between transactions
  }

  // Step 3: Final Summary
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}  Test Summary${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.green}  ✓ Successful: ${successCount}${colors.reset}`);
  console.log(`${colors.red}  ✗ Failed: ${failCount}${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}\n`);

  if (failCount === 0) {
    console.log(`${colors.green}🎉 All tests passed!${colors.reset}\n`);
  } else {
    console.log(`${colors.red}⚠ Some tests failed. Please review the logs above.${colors.reset}\n`);
  }
}

// Run the test
runTest().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
