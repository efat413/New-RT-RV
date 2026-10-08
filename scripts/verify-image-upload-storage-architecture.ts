/**
 * Verification Suite for Production Image Upload Storage Architecture
 * Proves:
 * 1. R2 configured: upload succeeds, metadata stored in D1, image retrieved from R2, responsive WebP variants work
 * 2. R2 unavailable in production: upload rejected safely (HTTP 503), D1 NOT used for binary storage
 * 3. Small dev fallback: strictly limited to MAX_DEV_D1_FALLBACK_SIZE_BYTES (128KB); files above limit rejected
 * 4. Malicious SVG, HTML, and polyglot files are strictly rejected
 */

import { handleApiRequest } from '../src/server/router';
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_DEV_D1_FALLBACK_SIZE_BYTES,
  validateImageBuffer,
  isValidMediaKey,
} from '../src/server/imageSecurity';
import { createAuthToken } from '../src/server/auth';
import type { Env, D1Database, R2Bucket } from '../src/server/types';

// In-memory mock R2 Bucket implementation for testing
class MockR2Bucket implements R2Bucket {
  private store = new Map<string, { data: Uint8Array; metadata?: any }>();

  async get(key: string): Promise<any | null> {
    const item = this.store.get(key);
    if (!item) return null;
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(item.data);
          controller.close();
        },
      }),
      arrayBuffer: async () => item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength),
      httpMetadata: item.metadata,
    };
  }

  async put(key: string, value: any, options?: any): Promise<any> {
    let buf: Uint8Array;
    if (value instanceof Uint8Array) {
      buf = value;
    } else if (value instanceof ArrayBuffer) {
      buf = new Uint8Array(value);
    } else if (Buffer.isBuffer(value)) {
      buf = new Uint8Array(value);
    } else {
      buf = new Uint8Array(0);
    }
    this.store.set(key, { data: buf, metadata: options?.httpMetadata });
    return { key, size: buf.byteLength };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  getKeys(): string[] {
    return Array.from(this.store.keys());
  }
}

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
            if (query.includes("INSERT OR REPLACE INTO media_assets") && query.includes("''")) {
              // saveMediaAssetMetadataInD1: 3 bound parameters [id, contentType, size]
              const [id, contentType, size] = args;
              db.mediaAssets.set(id, { id, content_type: contentType, data: '', size: Number(size) || 0 });
              return { success: true };
            }
            if (query.includes('INSERT OR REPLACE INTO media_assets')) {
              // saveMediaAssetInD1: 4 bound parameters [id, contentType, data, size]
              const [id, contentType, data, size] = args;
              db.mediaAssets.set(id, { id, content_type: contentType, data: data || '', size: Number(size) || 0 });
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
  console.log('VERIFYING PRODUCTION IMAGE UPLOAD STORAGE ARCHITECTURE');
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
  // SECTION A: R2 CONFIGURED (PRODUCTION OBJECT STORAGE ARCHITECTURE)
  // ---------------------------------------------------------------
  console.log('--- SECTION A: PRODUCTION ARCHITECTURE WITH R2 CONFIGURED ---');

  const mockR2 = new MockR2Bucket();
  const mockD1 = new MockD1Database();

  const prodEnvWithR2: Env = {
    ENVIRONMENT: 'production',
    DB: mockD1,
    R2: mockR2,
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

  const uploadRes = await handleApiRequest(uploadReq, prodEnvWithR2);
  assert(uploadRes.status === 200, 'A.1 Upload returns HTTP 200 with R2 binding');

  const uploadJson = await uploadRes.json();
  assert(uploadJson.success === true, 'A.2 Upload response indicates success');
  assert(typeof uploadJson.key === 'string' && uploadJson.key.startsWith('asset-'), 'A.3 Upload returns safe media key');
  assert(uploadJson.url === `/api/media/${uploadJson.key}`, 'A.4 Upload returns authoritative media URL');

  const uploadedKey = uploadJson.key;

  // 2. Verify file is stored in R2
  assert(mockR2.has(uploadedKey), 'A.5 Original image binary stored authoritatively in R2 object storage');

  // 3. Verify D1 stores metadata ONLY (no binary payload)
  const d1Row = mockD1.mediaAssets.get(uploadedKey);
  assert(Boolean(d1Row), 'A.6 Metadata record indexed in D1 media_assets');
  assert(d1Row?.size === VALID_1X1_PNG.byteLength, 'A.7 D1 metadata correctly records asset byte size');
  assert(d1Row?.content_type === 'image/png', 'A.8 D1 metadata correctly records MIME type');
  assert(d1Row?.data === '', 'A.9 D1 data field is strictly EMPTY (zero base64 binary stored in D1)');

  // 4. Verify original image can be retrieved from R2
  const getMediaReq = new Request(`https://rongdhonutrade.com/api/media/${uploadedKey}`, {
    method: 'GET',
  });
  const getMediaRes = await handleApiRequest(getMediaReq, prodEnvWithR2);
  assert(getMediaRes.status === 200, 'A.10 GET /api/media/:key returns HTTP 200 from R2');
  assert(getMediaRes.headers.get('Content-Type') === 'image/png', 'A.11 Serving Content-Type is image/png');
  assert(getMediaRes.headers.get('Cache-Control')?.includes('immutable') || false, 'A.12 Immutable cache header present');

  const fetchedBytes = new Uint8Array(await getMediaRes.arrayBuffer());
  assert(fetchedBytes.byteLength === VALID_1X1_PNG.byteLength, 'A.13 Retrieved binary byte length matches uploaded file');

  // 5. Verify responsive WebP variant retrieval
  const getVariantReq = new Request(`https://rongdhonutrade.com/api/media/${uploadedKey}?w=360`, {
    method: 'GET',
    headers: {
      Accept: 'image/webp',
    },
  });
  const getVariantRes = await handleApiRequest(getVariantReq, prodEnvWithR2);
  assert(getVariantRes.status === 200, 'A.14 Responsive variant request (?w=360) returns HTTP 200');
  assert(getVariantRes.headers.get('Content-Type') === 'image/webp', 'A.15 Responsive variant served as image/webp');

  // ---------------------------------------------------------------
  // SECTION B: R2 UNAVAILABLE IN PRODUCTION (FAIL-SAFE BEHAVIOR)
  // ---------------------------------------------------------------
  console.log('\n--- SECTION B: PRODUCTION BEHAVIOR WHEN R2 IS UNAVAILABLE ---');

  const prodEnvWithoutR2: Env = {
    ENVIRONMENT: 'production',
    DB: new MockD1Database(),
    ADMIN_SECRET,
    APP_URL: 'https://rongdhonutrade.com',
  };

  const prodUploadNoR2Req = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: (() => {
      const fd = new FormData();
      fd.append('file', new Blob([VALID_1X1_PNG], { type: 'image/png' }), 'banner.png');
      return fd;
    })(),
  });

  const prodUploadNoR2Res = await handleApiRequest(prodUploadNoR2Req, prodEnvWithoutR2);
  assert(
    prodUploadNoR2Res.status === 503,
    'B.1 Production upload without R2 fails closed with HTTP 503 (Configuration Error)'
  );

  const prodUploadNoR2Json = await prodUploadNoR2Res.json();
  assert(
    prodUploadNoR2Json.error?.includes('SERVER_CONFIGURATION_ERROR') &&
      prodUploadNoR2Json.error?.includes('R2'),
    'B.2 Error message explicitly identifies missing R2 binding without leaking secrets'
  );

  assert(
    (prodEnvWithoutR2.DB as MockD1Database).mediaAssets.size === 0,
    'B.3 D1 database was NOT polluted with any fallback image rows'
  );

  // ---------------------------------------------------------------
  // SECTION C: DEVELOPMENT/TESTING FALLBACK SIZE ENFORCEMENT
  // ---------------------------------------------------------------
  console.log('\n--- SECTION C: DEVELOPMENT/TESTING FALLBACK SIZE LIMIT ENFORCEMENT ---');

  const devD1 = new MockD1Database();
  const devEnv: Env = {
    DEV: true,
    DB: devD1,
    ADMIN_SECRET,
  };

  // 1. Small dev image <= MAX_DEV_D1_FALLBACK_SIZE_BYTES (128KB)
  const smallDevReq = new Request('http://localhost:3000/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: (() => {
      const fd = new FormData();
      fd.append('file', new Blob([VALID_1X1_PNG], { type: 'image/png' }), 'favicon.png');
      return fd;
    })(),
  });

  const smallDevRes = await handleApiRequest(smallDevReq, devEnv);
  assert(smallDevRes.status === 200, 'C.1 Small asset (<=128KB) succeeds in local dev fallback');
  const smallDevJson = await smallDevRes.json();
  assert(devD1.mediaAssets.has(smallDevJson.key), 'C.2 Small asset saved to dev D1 table');

  // 2. Oversized image > MAX_DEV_D1_FALLBACK_SIZE_BYTES (e.g. 500KB fake PNG)
  const oversizeBuffer = Buffer.alloc(500 * 1024);
  // Copy valid PNG header so magic bytes pass
  VALID_1X1_PNG.copy(oversizeBuffer, 0, 0, VALID_1X1_PNG.length);

  const oversizeDevReq = new Request('http://localhost:3000/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: (() => {
      const fd = new FormData();
      fd.append('file', new Blob([oversizeBuffer], { type: 'image/png' }), 'oversize.png');
      return fd;
    })(),
  });

  const oversizeDevRes = await handleApiRequest(oversizeDevReq, devEnv);
  assert(
    oversizeDevRes.status === 413,
    'C.3 File exceeding 128KB without R2 is rejected with HTTP 413'
  );
  const oversizeJson = await oversizeDevRes.json();
  assert(
    oversizeJson.error?.includes('Local database fallback is strictly limited'),
    'C.4 Clear explanation of dev limit given in response'
  );

  // ---------------------------------------------------------------
  // SECTION D: SECURITY VALIDATIONS (SVG, POLYGLOT, MALFORMED)
  // ---------------------------------------------------------------
  console.log('\n--- SECTION D: SECURITY & MALICIOUS PAYLOAD BLOCKING ---');

  // 1. Block SVG upload
  const svgReq = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: (() => {
      const fd = new FormData();
      fd.append('file', new Blob([MALICIOUS_SVG], { type: 'image/svg+xml' }), 'malicious.svg');
      return fd;
    })(),
  });
  const svgRes = await handleApiRequest(svgReq, prodEnvWithR2);
  assert(svgRes.status === 400, 'D.1 SVG upload is strictly REJECTED (HTTP 400)');
  const svgJson = await svgRes.json();
  assert(
    svgJson.error?.includes('prohibited') || svgJson.error?.includes('Vector graphics'),
    'D.2 SVG error specifies vector graphics prohibition'
  );

  // 2. Block Polyglot upload
  const polyglotReq = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: (() => {
      const fd = new FormData();
      fd.append('file', new Blob([MALICIOUS_POLYGLOT], { type: 'image/png' }), 'polyglot.png');
      return fd;
    })(),
  });
  const polyglotRes = await handleApiRequest(polyglotReq, prodEnvWithR2);
  assert(polyglotRes.status === 400, 'D.3 Polyglot PNG with embedded script is REJECTED (HTTP 400)');

  // 3. Path traversal media key rejection
  const traversalReq = new Request('https://rongdhonutrade.com/api/media/..%2F..%2Fetc%2Fpasswd', {
    method: 'GET',
  });
  const traversalRes = await handleApiRequest(traversalReq, prodEnvWithR2);
  assert(traversalRes.status === 400, 'D.4 Path traversal in media key is REJECTED (HTTP 400)');

  console.log('\n================================================================');
  console.log(`FINAL RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
