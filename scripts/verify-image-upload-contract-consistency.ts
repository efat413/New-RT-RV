/**
 * Comprehensive Verification Suite for Image Upload Contract Consistency
 * PROMPT 3 Regression Tests:
 * 1. Valid JPEG within limit → accepted (HTTP 200)
 * 2. Valid PNG within limit → accepted (HTTP 200)
 * 3. Valid WebP within limit → accepted (HTTP 200)
 * 4. SVG → rejected (HTTP 400)
 * 5. HTML disguised as image → rejected (HTTP 400)
 * 6. Oversized image (>10MB) → rejected with HTTP 413
 * 7. UI message matches actual backend limit (10MB for general media, 2MB for reviews, 5MB for deposit slips)
 * 8. Review image limit remains correct (max 5 photos, max 2MB per photo, strictly rejects SVG)
 * 9. No frontend-only bypass (server authoritatively enforces all validation and limits)
 */

import { handleApiRequest } from '../src/server/router';
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_REVIEW_IMAGE_BYTES,
  MAX_REVIEW_IMAGES_COUNT,
  validateImageBuffer,
  validateReviewImages,
  isValidMediaKey,
} from '../src/server/imageSecurity';
import { createAuthToken } from '../src/server/auth';
import type { Env, D1Database, R2Bucket } from '../src/server/types';
import * as fs from 'fs';
import * as path from 'path';

// In-memory mock R2 Bucket implementation for testing
class MockR2Bucket implements R2Bucket {
  public store = new Map<string, { data: Uint8Array; metadata?: any }>();

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

// In-memory mock D1 Database implementation
class MockD1Database implements D1Database {
  public mediaAssets = new Map<string, { id: string; content_type: string; data: string; size: number }>();

  prepare(query: string): any {
    const db = this;
    return {
      bind(...args: any[]) {
        return {
          async run() {
            if (query.includes('INSERT OR REPLACE INTO media_assets')) {
              const [id, contentType, size] = args;
              db.mediaAssets.set(id, { id, content_type: contentType, data: '', size: Number(size) || 0 });
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
              const param = args[0];
              if (param === 'cust-123' || param === 'customer@test.local') {
                return {
                  id: 'cust-123',
                  name: 'Customer Test',
                  email: 'customer@test.local',
                  role: 'customer',
                  password: null,
                  permissions_json: JSON.stringify({}),
                };
              }
              return {
                id: 'admin-contract-test',
                name: 'Test Administrator',
                email: 'admin@rongdhonutrade.com',
                role: 'admin',
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

// Valid sample image binaries
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z8AARwgWXg4ArpMP8bh5W0YAAAAASUVORK5CYII=',
  'base64'
);

const VALID_1X1_JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALoAfAr/2Q==',
  'base64'
);

const VALID_1X1_WEBP = Buffer.from(
  'UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoEAAQAAUAmJaACdLoAA5gA/vtV4/+lwf/S4P/pcH/pcH8bss4bpAAA',
  'base64'
);

async function createAdminAuthHeader(secret: string): Promise<string> {
  const token = await createAuthToken(
    {
      userId: 'admin-contract-test',
      email: 'admin@rongdhonutrade.com',
      role: 'admin',
    },
    secret
  );
  return `Bearer ${token}`;
}

async function runContractVerification() {
  console.log('================================================================');
  console.log('IMAGE UPLOAD CONTRACT AUDIT & REGRESSION SUITE');
  console.log('================================================================\n');

  const secret = 'contract-test-secret-key-at-least-32-chars-long';
  const adminAuth = await createAdminAuthHeader(secret);

  const mockDb = new MockD1Database();
  const mockR2 = new MockR2Bucket();

  const env: Env = {
    DB: mockDb,
    R2: mockR2,
    BUCKET: mockR2,
    ADMIN_SECRET: secret,
    NODE_ENV: 'production',
  } as unknown as Env;

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, desc: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${desc}`);
    } else {
      console.error(`❌ [FAIL] ${desc}`);
      process.exitCode = 1;
    }
  }

  // =========================================================================
  // 1. Valid JPEG within limit → accepted
  // =========================================================================
  console.log('--- TEST 1: VALID JPEG WITHIN LIMIT ---');
  {
    const boundary = '----WebKitFormBoundaryJpgTest';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      VALID_1X1_JPEG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
        'Authorization': adminAuth,
      },
      body,
    });

    const res = await handleApiRequest(req, env);
    assert(res.status === 200, 'Valid JPEG returns HTTP 200');
    const data = await res.json() as any;
    assert(data.success === true, 'JPEG upload response indicates success: true');
    assert(typeof data.key === 'string' && data.key.endsWith('.jpg'), 'JPEG media key has .jpg extension');
    assert(mockR2.has(data.key), 'JPEG stored in authoritative R2 storage');
  }

  // =========================================================================
  // 2. Valid PNG within limit → accepted
  // =========================================================================
  console.log('\n--- TEST 2: VALID PNG WITHIN LIMIT ---');
  {
    const boundary = '----WebKitFormBoundaryPngTest';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n`),
      VALID_1X1_PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
        'Authorization': adminAuth,
      },
      body,
    });

    const res = await handleApiRequest(req, env);
    assert(res.status === 200, 'Valid PNG returns HTTP 200');
    const data = await res.json() as any;
    assert(data.success === true, 'PNG upload response indicates success: true');
    assert(typeof data.key === 'string' && data.key.endsWith('.png'), 'PNG media key has .png extension');
    assert(mockR2.has(data.key), 'PNG stored in authoritative R2 storage');
  }

  // =========================================================================
  // 3. Valid WebP within limit → accepted
  // =========================================================================
  console.log('\n--- TEST 3: VALID WEBP WITHIN LIMIT ---');
  {
    const boundary = '----WebKitFormBoundaryWebpTest';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.webp"\r\nContent-Type: image/webp\r\n\r\n`),
      VALID_1X1_WEBP,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
        'Authorization': adminAuth,
      },
      body,
    });

    const res = await handleApiRequest(req, env);
    assert(res.status === 200, 'Valid WebP returns HTTP 200');
    const data = await res.json() as any;
    assert(data.success === true, 'WebP upload response indicates success: true');
    assert(typeof data.key === 'string' && data.key.endsWith('.webp'), 'WebP media key has .webp extension');
    assert(mockR2.has(data.key), 'WebP stored in authoritative R2 storage');
  }

  // =========================================================================
  // 4. SVG → rejected
  // =========================================================================
  console.log('\n--- TEST 4: SVG STRICTLY REJECTED ---');
  {
    const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>');
    const boundary = '----WebKitFormBoundarySvgTest';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.svg"\r\nContent-Type: image/svg+xml\r\n\r\n`),
      svgPayload,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
        'Authorization': adminAuth,
      },
      body,
    });

    const res = await handleApiRequest(req, env);
    assert(res.status === 400, 'SVG upload returns HTTP 400');
    const data = await res.json() as any;
    assert(data.success === false, 'SVG upload response indicates failure');
    assert(
      data.error.includes('Vector graphics (SVG)') || data.error.includes('prohibited'),
      'SVG rejection error message explicitly states SVG/vector graphics prohibition'
    );
  }

  // =========================================================================
  // 5. HTML disguised as image → rejected
  // =========================================================================
  console.log('\n--- TEST 5: HTML DISGUISED AS IMAGE REJECTED ---');
  {
    const htmlPayload = Buffer.from('<!DOCTYPE html><html><body><h1>Fake Image</h1><script>steal()</script></body></html>');
    const boundary = '----WebKitFormBoundaryHtmlTest';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      htmlPayload,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
        'Authorization': adminAuth,
      },
      body,
    });

    const res = await handleApiRequest(req, env);
    assert(res.status === 400, 'Disguised HTML returns HTTP 400');
    const data = await res.json() as any;
    assert(data.success === false, 'HTML upload rejected');
    assert(data.error.includes('Disallowed file content') || data.error.includes('Invalid or unsupported'), 'Error mentions disallowed content or invalid image');
  }

  // =========================================================================
  // 6. Oversized image (>10MB) → rejected with HTTP 413
  // =========================================================================
  console.log('\n--- TEST 6: OVERSIZED IMAGE (>10MB) REJECTED WITH HTTP 413 ---');
  {
    // A: Via Content-Length header pre-check
    const oversizedLength = 11 * 1024 * 1024;
    const reqContentLength = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----boundary',
        'Content-Length': String(oversizedLength),
        'Authorization': adminAuth,
      },
      body: new Uint8Array(10), // Small dummy body to trigger Content-Length check
    });

    const resContentLength = await handleApiRequest(reqContentLength, env);
    assert(resContentLength.status === 413, 'Pre-check Content-Length > 10MB returns HTTP 413');
    const dataCL = await resContentLength.json() as any;
    assert(dataCL.error.includes('10MB'), 'Content-Length error message states authoritative 10MB limit');

    // B: Via multipart form data file size
    const boundary = '----WebKitFormBoundaryOversized';
    const fakeOversizedFile = new Uint8Array(10.5 * 1024 * 1024);
    // Write JPEG header
    fakeOversizedFile[0] = 0xff;
    fakeOversizedFile[1] = 0xd8;
    fakeOversizedFile[2] = 0xff;
    fakeOversizedFile[3] = 0xe0;

    const formData = new FormData();
    formData.append('file', new File([fakeOversizedFile], 'giant.jpg', { type: 'image/jpeg' }));

    const reqFormData = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': adminAuth,
      },
      body: formData,
    });

    const resFormData = await handleApiRequest(reqFormData, env);
    assert(resFormData.status === 413, 'Multipart File > 10MB returns HTTP 413');
    const dataFD = await resFormData.json() as any;
    assert(dataFD.error.includes('10MB'), 'Multipart error message states authoritative 10MB limit');
  }

  // =========================================================================
  // 7. UI message matches actual backend limit
  // =========================================================================
  console.log('\n--- TEST 7: UI MESSAGES MATCH BACKEND AUTHORITATIVE CONTRACTS ---');
  {
    // A. Check ImageUploadField.tsx
    const imageUploadFieldContent = fs.readFileSync(path.join(process.cwd(), 'src/components/ImageUploadField.tsx'), 'utf-8');
    assert(
      imageUploadFieldContent.includes('Supports PNG, JPG, WEBP, GIF, ICO up to 10MB'),
      'ImageUploadField UI displays "Supports PNG, JPG, WEBP, GIF, ICO up to 10MB"'
    );
    assert(
      !imageUploadFieldContent.includes('SVG up to'),
      'ImageUploadField does NOT claim SVG is supported'
    );
    assert(
      imageUploadFieldContent.includes('10 * 1024 * 1024'),
      'ImageUploadField enforces 10MB check in client validation'
    );

    // B. Check AdminPanel.tsx
    const adminPanelContent = fs.readFileSync(path.join(process.cwd(), 'src/components/AdminPanel.tsx'), 'utf-8');
    assert(
      adminPanelContent.includes('Supports JPG, PNG, WebP, GIF, ICO up to 10MB'),
      'AdminPanel product upload UI displays "Supports JPG, PNG, WebP, GIF, ICO up to 10MB"'
    );
    assert(
      !adminPanelContent.includes('Supports JPG, PNG, WebP, GIF, SVG (up to 15MB)'),
      'AdminPanel does NOT contain outdated 15MB or SVG support text'
    );
    assert(
      adminPanelContent.includes('Maximum allowed is 10MB'),
      'AdminPanel error message reports authoritative 10MB limit'
    );
    assert(
      !adminPanelContent.includes('Maximum allowed is 15MB'),
      'AdminPanel has eliminated all references to 15MB'
    );

    // C. Check CheckoutSection.tsx
    const checkoutContent = fs.readFileSync(path.join(process.cwd(), 'src/components/CheckoutSection.tsx'), 'utf-8');
    assert(
      checkoutContent.includes('Deposit slip image size must be under 5MB.'),
      'CheckoutSection deposit slip UI displays and validates 5MB limit'
    );
    assert(
      checkoutContent.includes('Vector graphics (SVG) are strictly prohibited'),
      'CheckoutSection strictly rejects SVG deposit slips'
    );
  }

  // =========================================================================
  // 8. Review image limit remains correct
  // =========================================================================
  console.log('\n--- TEST 8: REVIEW IMAGE CONTRACT (<=2MB, <=5 PHOTOS, NO SVG) ---');
  {
    // A. Backend constant checks
    assert(MAX_REVIEW_IMAGES_COUNT === 5, 'MAX_REVIEW_IMAGES_COUNT is authoritative 5 photos');
    assert(MAX_REVIEW_IMAGE_BYTES === 2 * 1024 * 1024, 'MAX_REVIEW_IMAGE_BYTES is authoritative 2MB');

    // B. Valid review image attachments (PNG, JPEG, WebP)
    const validDataUrl = `data:image/png;base64,${VALID_1X1_PNG.toString('base64')}`;
    const validRes = validateReviewImages([validDataUrl]);
    assert(validRes.valid === true, 'Valid 1x1 PNG review image attachment passes validation');
    assert(validRes.images.length === 1, 'Valid review image array retained');

    // C. More than 5 images rejected
    const sixImages = [validDataUrl, validDataUrl, validDataUrl, validDataUrl, validDataUrl, validDataUrl];
    const sixRes = validateReviewImages(sixImages);
    assert(sixRes.valid === false, '6 review images rejected by server');
    assert(sixRes.error!.includes('maximum of 5 images'), 'Error states maximum of 5 images allowed');

    // D. Review image > 2MB rejected
    const oversizedReviewBuf = Buffer.alloc(2.5 * 1024 * 1024);
    // Write valid PNG header
    VALID_1X1_PNG.copy(oversizedReviewBuf, 0, 0, VALID_1X1_PNG.length);
    const oversizedReviewDataUrl = `data:image/png;base64,${oversizedReviewBuf.toString('base64')}`;
    const oversizedRes = validateReviewImages([oversizedReviewDataUrl]);
    assert(oversizedRes.valid === false, 'Review image > 2MB rejected by server');
    assert(oversizedRes.error!.includes('2MB'), 'Error states 2MB limit for review images');

    // E. SVG review image rejected
    const svgReviewDataUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const svgRes = validateReviewImages([svgReviewDataUrl]);
    assert(svgRes.valid === false, 'SVG in review images rejected by server');
    assert(svgRes.error!.includes('prohibited') || svgRes.error!.includes('Invalid'), 'Error identifies prohibited SVG content');

    // F. Script tag inside review image string rejected
    const xssReviewDataUrl = 'data:image/png;base64,<script>alert(1)</script>';
    const xssRes = validateReviewImages([xssReviewDataUrl]);
    assert(xssRes.valid === false, 'Script markup in review images rejected');

    // G. Frontend ProductDetailView.tsx matches backend
    const productDetailContent = fs.readFileSync(path.join(process.cwd(), 'src/components/ProductDetailView.tsx'), 'utf-8');
    assert(
      productDetailContent.includes('Each review photo must be under 2MB.'),
      'ProductDetailView validates and informs user each photo must be under 2MB'
    );
    assert(
      productDetailContent.includes('Supports JPG, PNG, WebP, GIF, ICO up to 2MB each (max 5 photos). SVG files prohibited.'),
      'ProductDetailView helper text accurately states 2MB each, max 5, SVG prohibited'
    );
  }

  // =========================================================================
  // 9. No frontend-only bypass
  // =========================================================================
  console.log('\n--- TEST 9: NO FRONTEND-ONLY BYPASS (SERVER-SIDE ENFORCEMENT) ---');
  {
    // A. Attacker sends raw HTTP POST with SVG to /api/upload bypassing client form
    const directSvgReq = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/svg+xml',
        'Authorization': adminAuth,
      },
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("bypass")</script></svg>'),
    });
    const directSvgRes = await handleApiRequest(directSvgReq, env);
    assert(directSvgRes.status === 400, 'Direct SVG POST bypassing client form is strictly blocked with HTTP 400');

    // B. Attacker sends 12MB raw buffer to /api/upload bypassing client form
    const directOversizedReq = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(12 * 1024 * 1024),
        'Authorization': adminAuth,
      },
      body: new Uint8Array(10),
    });
    const directOversizedRes = await handleApiRequest(directOversizedReq, env);
    assert(directOversizedRes.status === 413, 'Direct 12MB upload bypassing client form is strictly blocked with HTTP 413');

    // C. Non-privileged user (customer) attempting upload via API is blocked with HTTP 403
    const customerToken = await createAuthToken(
      {
        userId: 'cust-123',
        email: 'customer@test.local',
        role: 'customer',
      },
      secret
    );
    const customerReq = new Request('https://rongdhonutrade.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'Authorization': `Bearer ${customerToken}`,
      },
      body: VALID_1X1_PNG,
    });
    const customerRes = await handleApiRequest(customerReq, env);
    assert(customerRes.status === 403, 'Customer role attempting direct upload API call is blocked with HTTP 403');
  }

  console.log('\n================================================================');
  console.log(`FINAL RESULT: ${passedTests} PASSED out of ${totalTests} CHECKS (${totalTests - passedTests} FAILED)`);
  console.log('================================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runContractVerification().catch((err) => {
  console.error('Fatal error during contract verification:', err);
  process.exit(1);
});
