import { handleApiRequest } from '../src/server/router';
import { getAllReviews, GetAllReviewsOptions } from '../src/server/db';
import { createAuthToken, computePasswordSignature } from '../src/server/auth';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(message);
  }
  console.log(`✅ [PASS] ${message}`);
}

// In-memory mock reviews dataset with mixed statuses and products
const mockDbReviews = [
  { id: 'rev-01', product_id: 'p-1', author_name: 'User 1', rating: 5, comment: 'Great product', status: 'approved', verified_purchase: 1, created_at: '2026-03-01T10:00:00Z' },
  { id: 'rev-02', product_id: 'p-1', author_name: 'User 2', rating: 4, comment: 'Nice', status: 'approved', verified_purchase: 0, created_at: '2026-03-01T11:00:00Z' },
  { id: 'rev-03', product_id: 'p-1', author_name: 'User 3', rating: 5, comment: 'Loved it', status: 'pending', verified_purchase: 0, created_at: '2026-03-01T12:00:00Z' }, // pending
  { id: 'rev-04', product_id: 'p-1', author_name: 'User 4', rating: 1, comment: 'Bad', status: 'rejected', verified_purchase: 0, created_at: '2026-03-01T13:00:00Z' }, // rejected
  { id: 'rev-05', product_id: 'p-2', author_name: 'User 5', rating: 5, comment: 'P2 item', status: 'approved', verified_purchase: 1, created_at: '2026-03-01T14:00:00Z' },
  { id: 'rev-06', product_id: 'p-2', author_name: 'User 6', rating: 3, comment: 'Average', status: 'hidden', verified_purchase: 0, created_at: '2026-03-01T15:00:00Z' }, // hidden
  { id: 'rev-07', product_id: 'p-1', author_name: 'User 7', rating: 4, comment: 'Good', status: 'approved', verified_purchase: 1, created_at: '2026-03-01T16:00:00Z' },
  { id: 'rev-08', product_id: 'p-1', author_name: 'User 8', rating: 5, comment: 'Superb', status: 'approved', verified_purchase: 0, created_at: '2026-03-01T17:00:00Z' },
];

// Add 55 more approved reviews for pagination limit testing
for (let i = 9; i <= 65; i++) {
  mockDbReviews.push({
    id: `rev-${i < 10 ? '0' + i : i}`,
    product_id: i % 2 === 0 ? 'p-1' : 'p-2',
    author_name: `Bulk Reviewer ${i}`,
    rating: (i % 5) + 1,
    comment: `Review number ${i} for testing`,
    status: 'approved',
    verified_purchase: i % 2 === 0 ? 1 : 0,
    created_at: new Date(Date.parse('2026-03-02T00:00:00Z') + i * 60000).toISOString(),
  });
}

class TestD1PreparedStatement {
  private query: string;
  private bindings: any[];

  constructor(query: string, bindings: any[] = []) {
    this.query = query;
    this.bindings = bindings;
  }

  bind(...values: any[]) {
    return new TestD1PreparedStatement(this.query, values);
  }

  async first<T = any>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results?.[0] || null;
  }

  async all<T = any>(): Promise<{ results: T[] }> {
    const q = this.query.toUpperCase();
    if (q.includes('FROM USERS')) {
      const email = this.bindings[0];
      if (email === 'admin@local.test' || email === 'admin-1') {
        return {
          results: [{
            id: 'admin-1',
            email: 'admin@local.test',
            name: 'Admin User',
            role: 'super_admin',
            permissions_json: '{"canManageSettings":true}',
            is_active: 1,
            password: '$2a$12$e6xI14b7eM8Yg5Q/nN0LceKxP0cZ1bF7p2j4u6w8y0z2a4c6e8g0i',
          } as any],
        };
      }
      if (email === 'customer@local.test' || email === 'cust-1') {
        return {
          results: [{
            id: 'cust-1',
            email: 'customer@local.test',
            name: 'Customer User',
            role: 'customer',
            permissions_json: '{}',
            is_active: 1,
            password: '$2a$12$e6xI14b7eM8Yg5Q/nN0LceKxP0cZ1bF7p2j4u6w8y0z2a4c6e8g0i',
          } as any],
        };
      }
      return { results: [] };
    }

    let filtered = [...mockDbReviews];

    // Filter by product_id
    if (q.includes('PRODUCT_ID = ?')) {
      const prodVal = this.bindings[0];
      filtered = filtered.filter((r) => r.product_id === prodVal);
    }

    // Filter status
    if (q.includes("STATUS = 'APPROVED'")) {
      filtered = filtered.filter((r) => r.status === 'approved' || !r.status);
    } else if (q.includes('STATUS = ?')) {
      const statusIdx = q.includes('PRODUCT_ID = ?') ? 1 : 0;
      const statusVal = this.bindings[statusIdx];
      if (statusVal && statusVal !== 'all') {
        filtered = filtered.filter((r) => r.status === statusVal);
      }
    }

    if (q.includes('COUNT(*)')) {
      return { results: [{ total: filtered.length } as any] };
    }

    // Sort
    if (q.includes('ORDER BY created_at ASC')) {
      filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    // Pagination: LIMIT and OFFSET
    if (q.includes('LIMIT ? OFFSET ?')) {
      const limitVal = this.bindings[this.bindings.length - 2];
      const offsetVal = this.bindings[this.bindings.length - 1];
      filtered = filtered.slice(offsetVal, offsetVal + limitVal);
    }

    return { results: filtered as any };
  }
}

class TestD1Database {
  public executedQueries: Array<{ query: string; bindings: any[] }> = [];

  prepare(query: string) {
    this.executedQueries.push({ query, bindings: [] });
    return new TestD1PreparedStatement(query);
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('STARTING REVIEWS SERVER-SIDE PAGINATION & BOUNDED QUERY TESTS');
  console.log('===============================================================');

  const testDb = new TestD1Database() as any;
  const adminSecret = 'dev-secret-test-shared-999';
  const env: any = {
    DB: testDb,
    ADMIN_SECRET: adminSecret,
    COURIER_WEBHOOK_SECRET: 'test-webhook-secret',
  };

  const pwdHash = '$2a$12$e6xI14b7eM8Yg5Q/nN0LceKxP0cZ1bF7p2j4u6w8y0z2a4c6e8g0i';
  const pwdSig = await computePasswordSignature(pwdHash);

  const adminToken = await createAuthToken({
    userId: 'admin-1',
    email: 'admin@local.test',
    role: 'super_admin',
    pwdSig,
  }, adminSecret);

  const customerToken = await createAuthToken({
    userId: 'cust-1',
    email: 'customer@local.test',
    role: 'customer',
    pwdSig,
  }, adminSecret);

  // -------------------------------------------------------------------------
  // SECTION 1: PUBLIC REVIEWS API (TASK 1)
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 1: Public Reviews Endpoint (GET /api/reviews) ---');

  // 1.1 No parameters (default page 1, default limit 20)
  {
    const req = new Request('http://localhost:3000/api/reviews', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(res.status === 200, '1.1 Public reviews returns HTTP 200');
    assert(data.success === true, '1.1 Public reviews returns success: true');
    assert(data.page === 1, '1.1 Default page is 1');
    assert(data.limit === 20, '1.1 Default limit is 20');
    assert(Array.isArray(data.reviews), '1.1 data.reviews is an array');
    assert(data.reviews.length <= 20, `1.1 data.reviews.length is ${data.reviews.length} (<= 20)`);
    assert(data.total > 20, `1.1 Total reviews count is ${data.total}`);
    assert(data.totalPages >= 2, `1.1 Total pages is ${data.totalPages} (>= 2)`);
  }

  // 1.2 Page 2 with limit 20
  {
    const req = new Request('http://localhost:3000/api/reviews?page=2&limit=20', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.page === 2, '1.2 Page 2 returns page: 2');
    assert(data.limit === 20, '1.2 Page 2 returns limit: 20');
    assert(data.reviews.length > 0 && data.reviews.length <= 20, '1.2 Page 2 returns bounded items');
  }

  // 1.3 Maximum limit (50)
  {
    const req = new Request('http://localhost:3000/api/reviews?limit=50', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.limit === 50, '1.3 Limit 50 is accepted');
    assert(data.reviews.length <= 50, '1.3 Result is bounded by 50');
  }

  // 1.4 Excessive limit (limit=999999 capped to 50)
  {
    const req = new Request('http://localhost:3000/api/reviews?limit=999999', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.limit === 50, `1.4 Excessive limit 999999 is safely capped to 50 (got ${data.limit})`);
    assert(data.reviews.length <= 50, '1.4 Results capped to 50');
  }

  // 1.5 Invalid page & limit values
  {
    const req = new Request('http://localhost:3000/api/reviews?page=-5&limit=-10', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.page === 1, '1.5 Negative page normalized to 1');
    assert(data.limit === 20, '1.5 Negative limit normalized to 20');
  }

  {
    const req = new Request('http://localhost:3000/api/reviews?page=abc&limit=xyz', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.page === 1, '1.5 Non-numeric page normalized to 1');
    assert(data.limit === 20, '1.5 Non-numeric limit normalized to 20');
  }

  // 1.6 Product-specific reviews
  {
    const req = new Request('http://localhost:3000/api/reviews?productId=p-1&limit=20', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.success === true, '1.6 Product-specific query succeeds');
    for (const r of data.reviews) {
      assert(r.productId === 'p-1', `1.6 Review productId is p-1 (got ${r.productId})`);
    }
  }

  // 1.7 Strict filtering of unapproved/private reviews
  {
    const req = new Request('http://localhost:3000/api/reviews?limit=50', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    for (const r of data.reviews) {
      assert(r.status === 'approved' || !r.status, `1.7 Public review has status approved (got ${r.status})`);
      assert(r.id !== 'rev-03', '1.7 Pending review rev-03 is strictly hidden from public');
      assert(r.id !== 'rev-04', '1.7 Rejected review rev-04 is strictly hidden from public');
      assert(r.id !== 'rev-06', '1.7 Hidden review rev-06 is strictly hidden from public');
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 2: ADMIN REVIEWS API (TASK 2)
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 2: Admin Reviews Endpoint (GET /api/admin/reviews) ---');

  // 2.1 Unauthorized request without token
  {
    const req = new Request('http://localhost:3000/api/admin/reviews', { method: 'GET' });
    const res = await handleApiRequest(req, env);
    assert(res.status === 401, '2.1 Unauthenticated request returns HTTP 401');
  }

  // 2.2 Forbidden request with customer role
  {
    const req = new Request('http://localhost:3000/api/admin/reviews', {
      method: 'GET',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const res = await handleApiRequest(req, env);
    assert(res.status === 403, '2.2 Customer role returns HTTP 403 Forbidden');
  }

  // 2.3 Admin page 1 (default limit 50)
  {
    const req = new Request('http://localhost:3000/api/admin/reviews', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const res = await handleApiRequest(req, env);
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (res.status !== 200) {
      console.log('2.3 Failed with status:', res.status, text);
    }

    assert(res.status === 200, '2.3 Admin review fetch returns HTTP 200');
    assert(data.success === true, '2.3 Admin reviews returns success: true');
    assert(data.page === 1, '2.3 Admin default page is 1');
    assert(data.limit === 50, '2.3 Admin default limit is 50');
    assert(Array.isArray(data.reviews), '2.3 data.reviews is an array');
    assert(data.reviews.length <= 50, '2.3 Admin page 1 length <= 50');
  }

  // 2.4 Admin page 2
  {
    const req = new Request('http://localhost:3000/api/admin/reviews?page=2&limit=25', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.page === 2, '2.4 Admin page 2 returns page 2');
    assert(data.limit === 25, '2.4 Admin page 2 returns limit 25');
  }

  // 2.5 Admin max limit (100)
  {
    const req = new Request('http://localhost:3000/api/admin/reviews?limit=100', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.limit === 100, '2.5 Admin limit 100 accepted');
  }

  // 2.6 Admin excessive limit (999999 capped to 100)
  {
    const req = new Request('http://localhost:3000/api/admin/reviews?limit=999999', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.limit === 100, `2.6 Admin excessive limit 999999 capped to 100 (got ${data.limit})`);
  }

  // 2.7 Admin invalid page and limit
  {
    const req = new Request('http://localhost:3000/api/admin/reviews?page=-3&limit=-20', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const res = await handleApiRequest(req, env);
    const data = await res.json() as any;

    assert(data.page === 1, '2.7 Admin negative page normalized to 1');
    assert(data.limit === 50, '2.7 Admin negative limit normalized to 50');
  }

  // -------------------------------------------------------------------------
  // SECTION 3: BOUNDED SQL QUERY VERIFICATION (PARAMETERIZED LIMIT & OFFSET)
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 3: SQL Safety & Parameterization Checks ---');

  // Verify that all SELECT statements generated for reviews contain LIMIT ? OFFSET ?
  testDb.executedQueries = [];
  await getAllReviews(testDb, { page: 1, limit: 20 });

  const selectQueries = testDb.executedQueries.filter((q: any) =>
    q.query.toUpperCase().includes('SELECT * FROM REVIEWS')
  );
  assert(selectQueries.length > 0, '3.1 SELECT query executed');
  for (const q of selectQueries) {
    assert(
      q.query.includes('LIMIT ? OFFSET ?'),
      `3.2 Query contains parameterized LIMIT ? OFFSET ?: "${q.query}"`
    );
    assert(
      !q.query.match(/LIMIT\s+\d+/i),
      '3.3 Query does NOT concatenate raw unescaped limit numbers into SQL'
    );
  }

  const countQueries = testDb.executedQueries.filter((q: any) =>
    q.query.toUpperCase().includes('COUNT(*)')
  );
  assert(countQueries.length > 0, '3.4 COUNT(*) query executed');

  console.log('\n===============================================================');
  console.log('ALL REVIEWS PAGINATION & BOUNDED QUERY TESTS PASSED (100%)!');
  console.log('===============================================================');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
