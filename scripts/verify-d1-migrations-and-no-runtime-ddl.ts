/**
 * Verification Suite for D1 Migrations and Elimination of Runtime Schema Mutation
 * PROMPT 4 Verification:
 * 1. Static code verification: Zero runtime DDL (ALTER TABLE, CREATE TABLE, CREATE INDEX, CREATE TRIGGER) in src/
 * 2. Migration integrity: All 21 migrations execute cleanly and create the complete authoritative database schema
 * 3. Specific schema areas verification:
 *    - products, product slug, product slug history, buying price, featured sort order, video URL
 *    - orders, advance payment, reviews, review moderation, rate limits, audit logs, media assets, expenses
 *    - webhook replay table, inventory negative-stock triggers
 * 4. Runtime verification: Application queries run successfully against migrated schema without schema healing
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import {
  ensureCoreSchema,
  getProductTableColumns,
  ensureProductTableSchema,
  getOrderTableColumns,
  ensureOrderTableSchema,
  ensureSliderTableSchema,
  getAllProducts,
  getAllSliders,
  getAllOrders,
  getAllReviews,
  insertAuditLogInD1,
  insertProduct,
} from '../src/server/db';
import type { D1Database } from '../src/server/types';

async function runVerification() {
  console.log('================================================================');
  console.log('D1 MIGRATIONS & ZERO-RUNTIME-DDL VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [PASS] ${desc}`);
    } else {
      console.error(`❌ [FAIL] ${desc}`);
      process.exitCode = 1;
    }
  }

  // =========================================================================
  // SECTION 1: STATIC CODE AUDIT (ZERO RUNTIME DDL IN SRC/)
  // =========================================================================
  console.log('--- SECTION 1: STATIC CODE AUDIT (ZERO RUNTIME DDL IN SRC/) ---');

  function findSourceFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findSourceFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const srcFiles = findSourceFiles(path.join(process.cwd(), 'src'));
  const ddlPatterns = [
    /\bALTER\s+TABLE\b/i,
    /\bCREATE\s+TABLE\b/i,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
    /\bCREATE\s+TRIGGER\b/i,
    /\bDROP\s+TABLE\b/i,
  ];

  let foundDdlInSrc = 0;
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    // Strip comments to only check executable code
    const lines = content.split('\n');
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
        continue;
      }
      for (const pattern of ddlPatterns) {
        if (pattern.test(line)) {
          console.error(`[DDL DETECTED] File: ${file}:${lineNum + 1} -> ${line}`);
          foundDdlInSrc++;
        }
      }
    }
  }

  assert(foundDdlInSrc === 0, 'Production source tree (src/) contains ZERO executable DDL statements');

  // Verify runtime schema healing functions in db.ts are non-mutating
  const dbFileContent = fs.readFileSync(path.join(process.cwd(), 'src/server/db.ts'), 'utf-8');
  assert(!dbFileContent.includes("prepare('ALTER TABLE"), 'src/server/db.ts contains zero ALTER TABLE prepare calls');
  assert(!dbFileContent.includes("prepare('CREATE TABLE"), 'src/server/db.ts contains zero CREATE TABLE prepare calls');
  assert(!dbFileContent.includes("prepare('CREATE INDEX"), 'src/server/db.ts contains zero CREATE INDEX prepare calls');
  assert(!dbFileContent.includes("prepare('CREATE TRIGGER"), 'src/server/db.ts contains zero CREATE TRIGGER prepare calls');

  // =========================================================================
  // SECTION 2: D1 MIGRATION SUITE EXECUTION & VERIFICATION (0001..0021)
  // =========================================================================
  console.log('\n--- SECTION 2: ALL 21 MIGRATIONS EXECUTION & COMPLETION ---');

  const migrationDir = path.join(process.cwd(), 'migrations');
  const migrationFiles = fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort();
  assert(migrationFiles.length >= 21, `Found ${migrationFiles.length} migration files (expected >= 21)`);

  const db = new DatabaseSync(':memory:');

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf-8');
    try {
      db.exec(sql);
      assert(true, `Migration applied successfully: ${file}`);
    } catch (err: any) {
      assert(false, `Migration failed on ${file}: ${err.message}`);
    }
  }

  // =========================================================================
  // SECTION 3: SPECIFIC DOMAIN SCHEMA VERIFICATION
  // =========================================================================
  console.log('\n--- SECTION 3: SCHEMA AREA AUDIT (SPECIFIC CRITICAL DOMAINS) ---');

  const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const tableSet = new Set(tableRows.map((r) => r.name.toLowerCase()));

  function getTableColumns(tableName: string): Set<string> {
    const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[];
    return new Set(cols.map((c) => c.name.toLowerCase()));
  }

  function getTableIndexes(tableName: string): string[] {
    const idxs = db.prepare(`PRAGMA index_list("${tableName}")`).all() as { name: string }[];
    return idxs.map((i) => i.name);
  }

  function getTableTriggers(): string[] {
    const trgs = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[];
    return trgs.map((t) => t.name);
  }

  // 1. Products
  assert(tableSet.has('products'), "Area: Table 'products' exists");
  const prodCols = getTableColumns('products');
  assert(prodCols.has('id') && prodCols.has('title') && prodCols.has('price'), 'Area: Core product columns exist');

  // 2. Product Slug
  assert(prodCols.has('slug'), "Area: 'products.slug' column exists");
  const prodIndexes = getTableIndexes('products');
  assert(prodIndexes.includes('idx_products_slug'), "Area: Unique index 'idx_products_slug' exists on products");

  // 3. Product Slug History
  assert(tableSet.has('product_slug_history'), "Area: Table 'product_slug_history' exists");
  const slugHistoryCols = getTableColumns('product_slug_history');
  assert(
    slugHistoryCols.has('id') && slugHistoryCols.has('product_id') && slugHistoryCols.has('slug') && slugHistoryCols.has('created_at'),
    "Area: 'product_slug_history' table columns (id, product_id, slug, created_at) exist"
  );
  const slugHistoryIndexes = getTableIndexes('product_slug_history');
  assert(
    slugHistoryIndexes.includes('idx_product_slug_history_slug') && slugHistoryIndexes.includes('idx_product_slug_history_product_id'),
    "Area: Indexes 'idx_product_slug_history_slug' and 'idx_product_slug_history_product_id' exist"
  );

  // 4. Buying Price
  assert(prodCols.has('buying_price'), "Area: 'products.buying_price' column exists");
  const orderCols = getTableColumns('orders');
  assert(orderCols.has('total_cost') && orderCols.has('total_profit'), "Area: 'orders.total_cost' and 'orders.total_profit' exist");

  // 5. Featured Sort Order
  assert(prodCols.has('featured_sort_order'), "Area: 'products.featured_sort_order' column exists");
  assert(prodIndexes.includes('idx_products_featured_sort_order'), "Area: 'idx_products_featured_sort_order' index exists");

  // 6. Video URL
  assert(prodCols.has('video_url'), "Area: 'products.video_url' column exists");

  // 7. Orders
  assert(tableSet.has('orders'), "Area: Table 'orders' exists");
  assert(
    orderCols.has('order_number') && orderCols.has('customer_phone') && orderCols.has('total_amount'),
    'Area: Core order columns exist'
  );

  // 8. Advance Payment
  assert(
    orderCols.has('advance_payment') &&
    orderCols.has('advance_payment_method') &&
    orderCols.has('advance_payment_note') &&
    orderCols.has('advance_payment_updated_at') &&
    orderCols.has('advance_payment_updated_by'),
    'Area: All advance payment columns exist on orders table'
  );
  const orderIndexes = getTableIndexes('orders');
  assert(orderIndexes.includes('idx_orders_advance_payment'), "Area: Index 'idx_orders_advance_payment' exists on orders");

  // 9. Reviews
  assert(tableSet.has('reviews'), "Area: Table 'reviews' exists");
  const reviewCols = getTableColumns('reviews');
  assert(
    reviewCols.has('product_id') && reviewCols.has('rating') && reviewCols.has('comment') && reviewCols.has('verified_purchase'),
    'Area: Core review columns exist'
  );

  // 10. Review Moderation
  assert(
    reviewCols.has('status') && reviewCols.has('images_json') && reviewCols.has('updated_at'),
    "Area: Review moderation columns 'status', 'images_json', 'updated_at' exist"
  );
  const reviewIndexes = getTableIndexes('reviews');
  assert(
    reviewIndexes.includes('idx_reviews_status') &&
    reviewIndexes.includes('idx_reviews_product_status') &&
    reviewIndexes.includes('idx_reviews_created_at'),
    'Area: Review moderation and performance indexes exist'
  );

  // 11. Rate Limits
  assert(tableSet.has('rate_limits'), "Area: Table 'rate_limits' exists");
  const rateLimitCols = getTableColumns('rate_limits');
  assert(rateLimitCols.has('key') && rateLimitCols.has('count') && rateLimitCols.has('reset_at'), 'Area: Rate limits columns exist');

  // 12. Audit Logs
  assert(tableSet.has('audit_logs'), "Area: Table 'audit_logs' exists");
  const auditCols = getTableColumns('audit_logs');
  assert(
    auditCols.has('actor_id') && auditCols.has('actor_email') && auditCols.has('action') && auditCols.has('timestamp'),
    'Area: Audit logs columns exist'
  );

  // 13. Media Assets
  assert(tableSet.has('media_assets'), "Area: Table 'media_assets' exists");
  const mediaCols = getTableColumns('media_assets');
  assert(
    mediaCols.has('id') && mediaCols.has('content_type') && mediaCols.has('data') && mediaCols.has('size'),
    'Area: Media assets table columns exist'
  );

  // 14. Expenses
  assert(tableSet.has('expenses'), "Area: Table 'expenses' exists");
  const expenseCols = getTableColumns('expenses');
  assert(
    expenseCols.has('expense_type') && expenseCols.has('amount') && expenseCols.has('date'),
    'Area: Expenses table columns exist'
  );

  // 15. Webhook Replay Table
  assert(tableSet.has('webhook_replays'), "Area: Table 'webhook_replays' exists");
  const webhookCols = getTableColumns('webhook_replays');
  assert(
    webhookCols.has('fingerprint') && webhookCols.has('created_at') && webhookCols.has('expires_at'),
    'Area: Webhook replays table columns exist'
  );

  // 16. Inventory Negative-Stock Triggers
  const triggers = getTableTriggers();
  assert(triggers.includes('trg_prevent_negative_stock'), "Area: Trigger 'trg_prevent_negative_stock' exists");
  assert(triggers.includes('trg_prevent_negative_stock_insert'), "Area: Trigger 'trg_prevent_negative_stock_insert' exists");

  // Test negative stock triggers directly
  try {
    db.prepare('UPDATE products SET stock = -5 WHERE id = (SELECT id FROM products LIMIT 1)').run();
    assert(false, 'Negative stock UPDATE must be aborted by trigger');
  } catch (err: any) {
    assert(err.message.includes('INSUFFICIENT_STOCK'), 'Trigger trg_prevent_negative_stock correctly blocks negative stock UPDATE');
  }

  try {
    db.prepare("INSERT INTO products (id, title, category_id, stock) VALUES ('test-neg', 'Neg', 'cat-1', -1)").run();
    assert(false, 'Negative stock INSERT must be aborted by trigger');
  } catch (err: any) {
    assert(err.message.includes('INSUFFICIENT_STOCK'), 'Trigger trg_prevent_negative_stock_insert correctly blocks negative stock INSERT');
  }

  // =========================================================================
  // SECTION 4: RUNTIME QUERY EXECUTION WITHOUT RUNTIME DDL
  // =========================================================================
  console.log('\n--- SECTION 4: RUNTIME DATABASE OPERATIONS AGAINST MIGRATED SCHEMA ---');

  // Wrap node:sqlite into Cloudflare D1Database interface for testing
  let ddlExecutedAtRuntime = 0;
  const mockD1: D1Database = {
    prepare(query: string) {
      if (/^\s*(CREATE|ALTER|DROP)\b/i.test(query)) {
        ddlExecutedAtRuntime++;
        console.error(`[FORBIDDEN RUNTIME DDL EXECUTED] ${query}`);
      }
      return {
        bind(...args: any[]) {
          return {
            async all<T>() {
              const rows = db.prepare(query).all(...args) as T[];
              return { success: true, results: rows };
            },
            async first<T>(colName?: string) {
              const row = db.prepare(query).get(...args) as any;
              if (!row) return null;
              if (colName) return row[colName] as T;
              return row as T;
            },
            async run() {
              const res = db.prepare(query).run(...args);
              return { success: true, meta: { changes: res.changes } };
            },
          };
        },
        async all<T>() {
          const rows = db.prepare(query).all() as T[];
          return { success: true, results: rows };
        },
        async first<T>(colName?: string) {
          const row = db.prepare(query).get() as any;
          if (!row) return null;
          if (colName) return row[colName] as T;
          return row as T;
        },
        async run() {
          const res = db.prepare(query).run();
          return { success: true, meta: { changes: res.changes } };
        },
      } as any;
    },
    async batch(statements: any[]) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
    async exec(query: string) {
      if (/^\s*(CREATE|ALTER|DROP)\b/i.test(query)) {
        ddlExecutedAtRuntime++;
        console.error(`[FORBIDDEN RUNTIME DDL EXECUTED] ${query}`);
      }
      db.exec(query);
      return { count: 1, duration: 1 };
    },
  };

  // Test all server database operations
  await ensureCoreSchema(mockD1);
  assert(true, 'ensureCoreSchema() executed cleanly (read-only verification)');

  const prodColumns = await ensureProductTableSchema(mockD1);
  assert(prodColumns.has('slug') && prodColumns.has('buying_price'), 'ensureProductTableSchema() returned complete column set');

  const orderColumns = await ensureOrderTableSchema(mockD1);
  assert(orderColumns.has('advance_payment'), 'ensureOrderTableSchema() returned advance_payment column');

  const sliderColumns = await ensureSliderTableSchema(mockD1);
  assert(sliderColumns.has('is_active'), 'ensureSliderTableSchema() returned is_active column');

  const products = await getAllProducts(mockD1);
  assert(Array.isArray(products), `getAllProducts returned ${products.length} products`);

  const sliders = await getAllSliders(mockD1);
  assert(Array.isArray(sliders), `getAllSliders returned ${sliders.length} sliders`);

  const orders = await getAllOrders(mockD1);
  assert(Array.isArray(orders), `getAllOrders returned ${orders.length} orders`);

  const auditLogSuccess = await insertAuditLogInD1(mockD1, {
    actorEmail: 'admin@test.local',
    actorRole: 'admin',
    action: 'TEST_VERIFICATION',
    targetType: 'SYSTEM',
  });
  assert(Boolean(auditLogSuccess), 'insertAuditLogInD1 succeeded');

  assert(ddlExecutedAtRuntime === 0, 'ZERO runtime DDL statements were executed during all database operations');

  console.log('\n================================================================');
  console.log(`FINAL RESULT: ${passed} PASSED out of ${total} CHECKS (${total - passed} FAILED)`);
  console.log('================================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Fatal error during D1 migration verification:', err);
  process.exit(1);
});
