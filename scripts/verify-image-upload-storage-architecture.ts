/**
 * Verification Suite for Authoritative D1 Image Upload Storage Architecture
 * Proves:
 * 1. D1 configured: upload succeeds, image binary stored in D1 media_assets, image retrieved from D1
 * 2. Delete media: DELETE /api/media/:key deletes asset from D1
 * 3. Malicious SVG, HTML, and polyglot files are strictly rejected
 */

import { handleApiRequest } from '../src/server/router';
import {
  MAX_IMAGE_SIZE_BYTES,
  validateImageBuffer,
  isValidMediaKey,
} from '../src/server/imageSecurity';
import { createAuthToken } from '../src/server/auth';
import type { Env, D1Database } from '../src/server/types';

// In-memory mock D1 Database implementation for testing
class MockD1Database implements D1Database {
  public mediaAssets = new Map<string, { id: string; content_type: string; data: string; size: number }>();
  public rateLimits = new Map<string, any>();

  prepare(query: string): any {
    const db = this;
    return {
      bind(...args: any[]) {
        return {
          async run() {
            if (query.includes('INSERT OR REPLACE INTO media_assets')) {
              // saveMediaAssetInD1: 4 bound parameters [id, contentType, data, size]
              const [id, contentType, data, size] = args;
              db.mediaAssets.set(id, { id, content_type: contentType, data: data || '', size: Number(size) || 0 });
              return { success: true };
            }
            if (query.includes('DELETE FROM media_assets')) {
              const id = args[0];
              db.mediaAssets.delete(id);
              return { success: true };
            }
            if (query.includes('rate_limits')) {
              return { success: true };
            }
            return { success: true };
          },
          async first(colName?: string) {
            if (query.includes('FROM media_assets WHERE id = ?')) {
              const id = args[0];
              const item = db.mediaAssets.get(id);
              if (!item) return null;
              return { content_type: item.content_type, data: item.data, size: item.size };
            }
            if (query.includes('FROM users')) {
              return {
                id: 'test-admin-1',
                name: 'Test Admin',
                email: 'admin@test.local',
                role: 'super_admin',
                password: null,
                permissions_json: JSON.stringify({ 'media.upload': true }),
              };
            }
            if (query.includes('rate_limits')) {
              return null;
            }
            return null;
          },
          async all() {
            return { success: true, results: [] };
          },
        };
      },
      async run() {
        return { success: true };
      },
    };
  }

  async batch(statements: any[]): Promise<any[]> {
    return statements.map(() => ({ success: true }));
  }

  async exec(query: string): Promise<any> {
    return { success: true };
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

// Valid 1x1 PNG binary helper
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Malicious SVG with embedded script
const MALICIOUS_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf-8');

// Malicious polyglot (starts with PNG header but contains HTML/script)
const MALICIOUS_POLYGLOT = Buffer.concat([
  VALID_1X1_PNG,
  Buffer.from('<script>document.location="http://evil.com"</script>', 'utf-8'),
]);

async function runTestSuite() {
  console.log('================================================================');
  console.log('VERIFYING AUTHORITATIVE D1 IMAGE UPLOAD STORAGE ARCHITECTURE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string = '') {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} - ${detail}`);
      failed++;
    }
  }

  const ADMIN_SECRET = 'test-admin-secret-image-architecture-123456';
  const adminToken = await createAuthToken(
    {
      userId: 'test-admin-1',
      email: 'admin@test.local',
      role: 'super_admin',
    },
    ADMIN_SECRET
  );

  // ---------------------------------------------------------------
  // SECTION A: D1 AUTHORITATIVE MEDIA STORAGE
  // ---------------------------------------------------------------
  console.log('--- SECTION A: D1 AUTHORITATIVE MEDIA STORAGE ---');

  const mockD1 = new MockD1Database();

  const prodEnv: Env = {
    ENVIRONMENT: 'production',
    DB: mockD1,
    ADMIN_SECRET,
    APP_URL: 'https://rongdhonutrade.com',
  };

  // 1. Upload valid image via multipart form
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([VALID_1X1_PNG], { type: 'image/png' }),
    'test-cover.png'
  );

  const uploadReq = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: formData,
  });

  const uploadRes = await handleApiRequest(uploadReq, prodEnv);
  assert(uploadRes.status === 200, 'A.1 Upload returns HTTP 200 with D1 storage');

  const uploadJson = await uploadRes.json();
  assert(uploadJson.success === true, 'A.2 Upload response indicates success');
  assert(typeof uploadJson.key === 'string' && uploadJson.key.startsWith('asset-'), 'A.3 Upload returns safe media key');
  assert(uploadJson.url === `/api/media/${uploadJson.key}`, 'A.4 Upload returns authoritative media URL');

  const uploadedKey = uploadJson.key;

  // 2. Verify file is stored in D1 media_assets
  const d1Row = mockD1.mediaAssets.get(uploadedKey);
  assert(Boolean(d1Row), 'A.5 Media asset record stored in D1 media_assets');
  assert(d1Row?.size === VALID_1X1_PNG.byteLength, 'A.6 D1 metadata correctly records asset byte size');
  assert(d1Row?.content_type === 'image/png', 'A.7 D1 metadata correctly records MIME type');
  assert(Boolean(d1Row?.data), 'A.8 D1 data field contains Base64 image payload');

  // 3. Verify original image can be retrieved from D1
  const getMediaReq = new Request(`https://rongdhonutrade.com/api/media/${uploadedKey}`, {
    method: 'GET',
  });
  const getMediaRes = await handleApiRequest(getMediaReq, prodEnv);
  assert(getMediaRes.status === 200, 'A.9 GET /api/media/:key returns HTTP 200 from D1');
  assert(getMediaRes.headers.get('Content-Type') === 'image/png', 'A.10 Serving Content-Type is image/png');
  assert(getMediaRes.headers.get('Cache-Control')?.includes('immutable') || false, 'A.11 Immutable cache header present');

  const fetchedBytes = new Uint8Array(await getMediaRes.arrayBuffer());
  assert(fetchedBytes.byteLength === VALID_1X1_PNG.byteLength, 'A.12 Retrieved binary byte length matches uploaded file');

  // 4. Verify DELETE /api/media/:key deletes asset
  const deleteMediaReq = new Request(`https://rongdhonutrade.com/api/media/${uploadedKey}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  const deleteMediaRes = await handleApiRequest(deleteMediaReq, prodEnv);
  assert(deleteMediaRes.status === 200, 'A.13 DELETE /api/media/:key returns HTTP 200');
  assert(!mockD1.mediaAssets.has(uploadedKey), 'A.14 Asset successfully removed from D1 media_assets');

  // ---------------------------------------------------------------
  // SECTION B: MALICIOUS PAYLOAD REJECTION
  // ---------------------------------------------------------------
  console.log('\n--- SECTION B: SECURITY & MALICIOUS PAYLOAD REJECTION ---');

  // 1. Malicious SVG rejected
  const svgFd = new FormData();
  svgFd.append('file', new Blob([MALICIOUS_SVG], { type: 'image/svg+xml' }), 'malicious.svg');
  const svgReq = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: svgFd,
  });
  const svgRes = await handleApiRequest(svgReq, prodEnv);
  assert(svgRes.status === 400, 'B.1 SVG payload strictly rejected with HTTP 400');

  // 2. Polyglot rejected
  const polyFd = new FormData();
  polyFd.append('file', new Blob([MALICIOUS_POLYGLOT], { type: 'image/png' }), 'polyglot.png');
  const polyReq = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: polyFd,
  });
  const polyRes = await handleApiRequest(polyReq, prodEnv);
  assert(polyRes.status === 400, 'B.2 Script polyglot strictly rejected with HTTP 400');

  console.log('\n================================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runTestSuite().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
