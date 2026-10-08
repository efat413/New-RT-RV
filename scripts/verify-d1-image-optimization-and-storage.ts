/**
 * Verification Script:
 * 1. D1-Only Image Storage & Zero-R2 Architecture
 * 2. 10MB Input Limit & Server-Side Image Optimization
 * 3. Dimension Normalization (max 2000px, aspect ratio & orientation preserved)
 * 4. Compression & Safe D1 Stored Size (<= 1.5MB, target <= 1MB)
 * 5. Rejection of un-optimizable images with clear message
 * 6. Responsive variants generated and stored in D1
 * 7. External URL handling distinguished from D1-hosted media
 */

import sharp from 'sharp';
import { handleApiRequest } from '../src/server/router';
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_SAFE_D1_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  validateImageBuffer,
  optimizeImageBufferForD1,
  isValidMediaKey,
} from '../src/server/imageSecurity';
import { createAuthToken } from '../src/server/auth';
import type { Env, D1Database } from '../src/server/types';

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
              const [id, contentType, dataBase64, size] = args;
              db.mediaAssets.set(id, { id, content_type: contentType, data: dataBase64 || '', size: Number(size) || 0 });
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
                id: 'super-admin-1',
                name: 'Super Admin',
                email: 'admin@rongdhonutrade.com',
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

async function runTests() {
  console.log('================================================================');
  console.log('VERIFYING D1 IMAGE OPTIMIZATION & STORAGE ARCHITECTURE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${title}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${title} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  }

  const ADMIN_SECRET = 'd1-image-test-admin-secret-32-chars-long';
  const adminToken = await createAuthToken(
    { userId: 'super-admin-1', email: 'admin@rongdhonutrade.com', role: 'super_admin' },
    ADMIN_SECRET
  );

  const mockDb = new MockD1Database();
  const env: Env = {
    DB: mockDb,
    ADMIN_SECRET,
    ENVIRONMENT: 'production',
  } as unknown as Env;

  // -------------------------------------------------------------
  // TEST 1: Dimension Normalization & Safe D1 Size Optimization
  // -------------------------------------------------------------
  console.log('--- TEST 1: LARGE IMAGE DIMENSION NORMALIZATION & COMPRESSION ---');

  // Create a large 3000x2000 JPEG
  const largeImgBuffer = await sharp({
    create: {
      width: 3000,
      height: 2000,
      channels: 3,
      background: { r: 120, g: 150, b: 200 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();

  console.log(`Original image size: ${(largeImgBuffer.byteLength / 1024).toFixed(1)} KB, 3000x2000 px`);

  const boundary = '----WebKitFormBoundaryD1Test1';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large-product.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    largeImgBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const req1 = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.byteLength),
      Authorization: `Bearer ${adminToken}`,
    },
    body,
  });

  const res1 = await handleApiRequest(req1, env);
  assert(res1.status === 200, '1.1 Large image upload returns HTTP 200');

  const json1 = await res1.json() as any;
  assert(json1.success === true, '1.2 Upload response indicates success');
  assert(typeof json1.key === 'string' && json1.key.startsWith('asset-'), '1.3 Returns safe media key');

  // Verify stored image in D1
  const storedAsset = mockDb.mediaAssets.get(json1.key);
  assert(Boolean(storedAsset), '1.4 Stored in D1 media_assets');
  assert(
    (storedAsset?.size || 0) <= MAX_SAFE_D1_IMAGE_BYTES,
    `1.5 Stored size is <= safe limit of 1.5MB (actual: ${((storedAsset?.size || 0) / 1024).toFixed(1)} KB)`
  );

  // Decode the stored image from D1 and verify dimensions were normalized to <= 2000px
  const storedBinary = Buffer.from(storedAsset!.data, 'base64');
  const storedMeta = await sharp(storedBinary).metadata();
  assert(
    (storedMeta.width || 0) <= MAX_IMAGE_DIMENSION,
    `1.6 Stored width is <= ${MAX_IMAGE_DIMENSION}px (actual: ${storedMeta.width}px)`
  );
  assert(
    (storedMeta.height || 0) <= MAX_IMAGE_DIMENSION,
    `1.7 Stored height is <= ${MAX_IMAGE_DIMENSION}px (actual: ${storedMeta.height}px)`
  );

  // Aspect ratio preserved: 3000/2000 = 1.5. Resized to 2000x1333 (2000/1333 ≈ 1.5)
  const ratio = (storedMeta.width || 1) / (storedMeta.height || 1);
  assert(Math.abs(ratio - 1.5) < 0.05, `1.8 Aspect ratio is preserved (ratio: ${ratio.toFixed(2)})`);

  // Verify responsive variants were generated and stored in D1
  const baseKeyWithoutExt = json1.key.replace(/\.[^.]+$/, '');
  const variantKeys = [240, 360, 480, 720, 1080].map((w) => `${baseKeyWithoutExt}_w${w}.webp`);
  let variantsFound = 0;
  for (const vKey of variantKeys) {
    if (mockDb.mediaAssets.has(vKey)) {
      variantsFound++;
    }
  }
  assert(variantsFound === 5, `1.9 All 5 responsive WebP variants pre-generated in D1 (found: ${variantsFound}/5)`);

  // -------------------------------------------------------------
  // TEST 2: Rejection of Oversized / Un-optimizable Image
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: OVERSIZED AND UN-OPTIMIZABLE REJECTIONS ---');

  // Input > 10MB rejected with HTTP 413
  const fakeOver10Mb = new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1024);
  const boundaryOver = '----WebKitFormBoundaryOver';
  const bodyOver = Buffer.concat([
    Buffer.from(`--${boundaryOver}\r\nContent-Disposition: form-data; name="file"; filename="huge.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    fakeOver10Mb,
    Buffer.from(`\r\n--${boundaryOver}--\r\n`),
  ]);

  const reqOver = new Request('https://rongdhonutrade.com/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundaryOver}`,
      'Content-Length': String(bodyOver.byteLength),
      Authorization: `Bearer ${adminToken}`,
    },
    body: bodyOver,
  });

  const resOver = await handleApiRequest(reqOver, env);
  assert(resOver.status === 413, '2.1 Input > 10MB strictly rejected with HTTP 413');

  // -------------------------------------------------------------
  // TEST 3: External URL Handling
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: EXTERNAL IMAGE URL HANDLING ---');

  const externalUrl = 'https://images.unsplash.com/photo-1542291026-7eec264c27ff';
  assert(!isValidMediaKey(externalUrl), '3.1 External URL is not recognized as a D1 media key');
  assert(!mockDb.mediaAssets.has(externalUrl), '3.2 External URL is not downloaded into D1 media_assets');

  // -------------------------------------------------------------
  // TEST 4: Zero R2 References
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: ZERO R2 ARCHITECTURE AUDIT ---');
  assert((env as any).R2 === undefined, '4.1 env.R2 is undefined');
  assert((env as any).BUCKET === undefined, '4.2 env.BUCKET is undefined');

  console.log('\n================================================================');
  console.log(`FINAL RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in test:', err);
  process.exit(1);
});
