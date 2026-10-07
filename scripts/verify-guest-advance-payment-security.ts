/**
 * Verification test for Guest Advance Payment Manipulation Defense
 *
 * Requirements:
 * 1. A guest/customer must NOT be able to authoritatively set a confirmed advance-payment amount.
 * 2. Client-provided payment status (e.g. "Paid", "PARTIAL") is never trusted.
 * 3. A fake full advance payment must not reduce COD to zero.
 * 4. advancePaymentMethod, advancePaymentNote, and advancePaymentUpdatedBy cannot be spoofed.
 * 5. Legitimate admin payment workflows (PATCH /api/orders/:id and trusted admin creation) are preserved.
 */

import { handleApiRequest } from '../src/server/router';
import { INITIAL_PRODUCTS } from '../src/data/seedData';
import { createAuthToken } from '../src/server/auth';
import { Env } from '../src/server/types';

class MockD1Statement {
  private sql: string;
  private bindings: any[] = [];
  constructor(sql: string, bindings: any[] = []) {
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...vals: any[]) {
    return new MockD1Statement(this.sql, vals);
  }
  async first<T = any>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results?.[0] || null;
  }
  async all<T = any>(): Promise<{ results: T[]; success: boolean }> {
    const s = this.sql.toUpperCase();
    if (s.includes('FROM PRODUCTS WHERE ID = ?') || s.includes('FROM PRODUCTS WHERE ID IN')) {
      return { results: [INITIAL_PRODUCTS[0]] as any, success: true };
    }
    if (s.includes('FROM STORE_SETTINGS')) {
      return {
        results: [{
          outside_dhaka_fee: 150,
          inside_dhaka_fee: 80,
          anti_spam_enabled: 0,
        }] as any,
        success: true,
      };
    }
    if (s.includes('FROM COUPONS')) {
      return { results: [] as any, success: true };
    }
    if (s.includes('FROM USERS')) {
      return { results: [] as any, success: true };
    }
    if (s.includes('FROM RATE_LIMITS')) {
      return { results: [] as any, success: true };
    }
    return { results: [] as any, success: true };
  }
  async run() {
    return { success: true, meta: { changes: 1 } };
  }
}

class MockD1Database {
  public insertedOrderRow: any = null;
  public stockUpdates: any[] = [];

  prepare(sql: string) {
    return new MockD1Statement(sql);
  }

  async batch(stmts: any[]) {
    for (const stmt of stmts) {
      const sql = (stmt as any).sql?.toUpperCase() || '';
      if (sql.includes('INSERT INTO ORDERS')) {
        this.insertedOrderRow = (stmt as any).bindings;
      } else if (sql.includes('UPDATE PRODUCTS SET STOCK')) {
        this.stockUpdates.push((stmt as any).bindings);
      }
    }
    return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
  }
}

async function runTest() {
  console.log('================================================================');
  console.log('VERIFYING GUEST ADVANCE PAYMENT MANIPULATION DEFENSE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, name: string) {
    if (cond) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name}`);
      failed++;
    }
  }

  const mockDb = new MockD1Database();
  const env: Env = {
    DB: mockDb as any,
    ADMIN_SECRET: 'test-admin-secret-which-is-sufficiently-long-for-jwt-signing-1234567890',
  };

  // Mock getOrderById return based on mockDb.insertedOrderRow
  const originalPrepare = mockDb.prepare;
  mockDb.prepare = function (sql: string) {
    const s = sql.toUpperCase();
    if (s.includes('SELECT') && s.includes('FROM ORDERS WHERE ID = ?')) {
      return {
        bind: (...args: any[]) => ({
          first: async () => {
            if (!mockDb.insertedOrderRow) return null;
            const b = mockDb.insertedOrderRow;
            return {
              id: b[0],
              order_number: b[1],
              user_id: b[2],
              user_email: b[3],
              customer_name: b[4],
              customer_phone: b[5],
              customer_address: b[6],
              customer_district: b[7],
              customer_zone: b[8],
              customer_notes: b[9],
              items_json: b[10],
              subtotal: b[11],
              delivery_fee: b[12],
              total_amount: b[13],
              coupon_code: b[14],
              discount_amount: b[15],
              payment_method: b[16],
              payment_status: b[17],
              transaction_id: b[18],
              shipping_status: b[19],
              total_cost: b[28],
              total_profit: b[29],
              advance_payment: b[30],
              advance_payment_method: b[31],
              advance_payment_note: b[32],
              advance_payment_updated_at: b[33],
              advance_payment_updated_by: b[34],
              created_at: b[35],
            };
          },
          all: async () => ({ results: [], success: true }),
        }),
      } as any;
    }
    return originalPrepare.call(this, sql);
  };

  // 1. Guest checkout with spoofed full advancePayment and paymentStatus = "Paid"
  const spoofedGuestOrder = {
    customer: {
      fullName: 'Attacker John',
      phone: '01712345678',
      fullAddress: 'Dhanmondi 32, Dhaka',
      district: 'Dhaka',
      deliveryZone: 'inside_dhaka',
    },
    items: [{
      product: INITIAL_PRODUCTS[0],
      quantity: 1,
    }],
    paymentMethod: 'COD',
    // Attacker claims 5000 Tk advance payment and "Paid" status to reduce COD to 0
    advancePayment: 5000,
    advancePaymentMethod: 'bKash',
    advancePaymentNote: 'Already received in cash/bKash by attacker',
    advancePaymentUpdatedBy: 'super_admin',
    paymentStatus: 'Paid',
  };

  const guestReq = new Request('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: spoofedGuestOrder }),
  });

  const guestRes = await handleApiRequest(guestReq, env);
  assert(guestRes.status === 201, 'Guest order submission succeeds with HTTP 201');

  const guestData = await guestRes.json();
  const order = guestData.order;

  assert(order.advancePayment === 0, 'Guest order advancePayment is strictly forced to 0');
  assert(order.advancePaymentMethod === undefined, 'Guest order advancePaymentMethod is stripped');
  assert(order.advancePaymentNote === undefined, 'Guest order advancePaymentNote is stripped');
  assert(order.advancePaymentUpdatedBy === undefined, 'Guest order advancePaymentUpdatedBy is stripped');
  assert(order.paymentStatus === 'Pending' || order.paymentStatus === 'DUE', 'Guest paymentStatus is forced to Pending/DUE, ignoring spoofed "Paid"');
  assert(order.customerDue > 0 && order.customerDue === order.totalAmount, 'Guest customerDue equals the authoritative total amount (COD is NOT reduced to 0)');
  assert(order.dueAmount === order.totalAmount, 'Guest dueAmount equals the authoritative total amount');

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
