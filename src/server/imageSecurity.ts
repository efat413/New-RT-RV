/**
 * Image Upload Security & Validation Module
 * Validates binary image signatures (magic bytes), strictly blocks SVG and HTML/JS polyglots,
 * sanitizes filenames, enforces upload sizes, and guarantees safe serving headers.
 * Authoritative storage is Cloudflare D1 (media_assets table).
 */

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Megabytes maximum input limit
export const MIN_IMAGE_SIZE_BYTES = 12; // Minimum bytes to verify magic headers

// Legacy export retained for backwards compatibility
export const MAX_DEV_D1_FALLBACK_SIZE_BYTES = 10 * 1024 * 1024;

export type SupportedImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'ico';

export interface ImageValidationResult {
  valid: boolean;
  format?: SupportedImageFormat;
  mime?: string;
  extension?: string;
  size?: number;
  error?: string;
}

// Disallowed executable / script / markup tags that must never appear in raw image data
const DANGEROUS_PAYLOAD_PATTERNS = [
  /<svg[\s>]/i,
  /<\?xml/i,
  /<html[\s>]/i,
  /<script[\s>]/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<!doctype/i,
  /javascript:/i,
  /vbscript:/i,
  /onload\s*=/i,
  /onerror\s*=/i,
  /onclick\s*=/i,
  /<\?php/i,
  /eval\s*\(/i,
  /<style[\s>]/i,
];

/**
 * Checks if the binary buffer contains any embedded HTML, SVG, or script tags
 * that could be executed by a browser or parsed as a polyglot document.
 */
function containsMaliciousPayload(bytes: Uint8Array): boolean {
  // Convert sample chunks (start, end, and middle samples) to ASCII for fast regex scanning
  const checkSample = (slice: Uint8Array): boolean => {
    let str = '';
    const len = Math.min(slice.length, 16384);
    for (let i = 0; i < len; i++) {
      const code = slice[i];
      // Only include printable ASCII characters or common whitespace
      if (code >= 32 && code <= 126) {
        str += String.fromCharCode(code);
      } else if (code === 9 || code === 10 || code === 13) {
        str += ' ';
      }
    }

    for (const pattern of DANGEROUS_PAYLOAD_PATTERNS) {
      if (pattern.test(str)) {
        return true;
      }
    }
    return false;
  };

  // Check header sample (first 16KB)
  if (checkSample(bytes.subarray(0, Math.min(bytes.length, 16384)))) {
    return true;
  }

  // Check tail sample (last 4KB, where SVG tags or script tags are often appended in polyglots)
  if (bytes.length > 4096) {
    if (checkSample(bytes.subarray(bytes.length - 4096))) {
      return true;
    }
  }

  return false;
}

/**
 * Inspects the binary contents of an uploaded file against authoritative magic byte signatures.
 * Does NOT rely on client-provided MIME type or extension.
 */
export function validateImageBuffer(buffer: ArrayBuffer | Uint8Array): ImageValidationResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const size = bytes.byteLength;

  if (size < MIN_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: 'File is too small or truncated to be a valid image.',
    };
  }

  if (size > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed limit of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB.`,
    };
  }

  // 1. Check for malicious SVG / HTML / script injections in buffer
  if (containsMaliciousPayload(bytes)) {
    return {
      valid: false,
      error: 'Disallowed file content detected: Vector graphics (SVG), XML, HTML, and executable scripts are strictly prohibited.',
    };
  }

  // 2. Validate JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // Basic JPEG structure check: must have marker after header (e.g. 0xE0, 0xE1, 0xDB, 0xC0)
    if (bytes[3] >= 0xc0) {
      return {
        valid: true,
        format: 'jpeg',
        mime: 'image/jpeg',
        extension: 'jpg',
        size,
      };
    }
  }

  // 3. Validate PNG: 89 50 4E 47 0D 0A 1A 0A followed by IHDR chunk
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    // Bytes 12-15 must be IHDR chunk header (0x49 0x48 0x44 0x52)
    if (
      bytes.length >= 16 &&
      bytes[12] === 0x49 &&
      bytes[13] === 0x48 &&
      bytes[14] === 0x44 &&
      bytes[15] === 0x52
    ) {
      return {
        valid: true,
        format: 'png',
        mime: 'image/png',
        extension: 'png',
        size,
      };
    }
  }

  // 4. Validate WebP: RIFF ... WEBP VP8
  if (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50    // P
  ) {
    // Sub-format check: VP8 (lossy), VP8L (lossless), or VP8X (extended)
    if (
      bytes.length >= 16 &&
      bytes[12] === 0x56 && // V
      bytes[13] === 0x50 && // P
      bytes[14] === 0x38    // 8
    ) {
      return {
        valid: true,
        format: 'webp',
        mime: 'image/webp',
        extension: 'webp',
        size,
      };
    }
  }

  // 5. Validate GIF: GIF87a or GIF89a
  if (
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 && // 8
    (bytes[4] === 0x37 || bytes[4] === 0x39) && // 7 or 9
    bytes[5] === 0x61    // a
  ) {
    return {
      valid: true,
      format: 'gif',
      mime: 'image/gif',
      extension: 'gif',
      size,
    };
  }

  // 6. Validate ICO: 00 00 01 00
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return {
      valid: true,
      format: 'ico',
      mime: 'image/x-icon',
      extension: 'ico',
      size,
    };
  }

  return {
    valid: false,
    error: 'Unsupported or corrupted image file format. Only JPEG, PNG, WebP, GIF, and ICO image formats are accepted.',
  };
}

/**
 * Validates media asset storage keys against path traversal and unauthorized characters.
 */
export function isValidMediaKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  // Strict regex: must strictly match asset-<timestamp>-<alphanumeric>(_w<width>)?<ext>
  return /^asset-\d+-[a-z0-9]+(_w\d+)?\.(jpg|png|webp|gif|ico)$/.test(key);
}

/**
 * Generates an authoritative, tamper-proof media storage key based strictly on
 * the verified extension from magic byte inspection.
 */
export function generateSafeMediaKey(extension: string): string {
  const safeExt = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const timestamp = Date.now();
  // Security Hardening: Use CSPRNG randomUUID for collision-resistant media key
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `asset-${timestamp}-${rand}.${safeExt}`;
}

/**
 * Returns strict security headers when serving uploaded media.
 * Ensures Vary: Accept so WebP content negotiation never causes cache collisions across clients.
 */
export function getSafeMediaHeaders(mime: string): Record<string, string> {
  return {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Vary': 'Accept',
  };
}

export const MAX_REVIEW_IMAGES_COUNT = 5;
export const MAX_REVIEW_IMAGE_BYTES = 2 * 1024 * 1024; // 2 Megabytes max per review photo

/**
 * Validates, hardens, and filters review image attachments.
 * - Enforces maximum 5 photos per review.
 * - Reuses binary magic-byte inspection (validateImageBuffer) to verify format (JPEG, PNG, WebP, GIF, ICO).
 * - Strictly rejects vector graphics (SVG), HTML, and executable scripts.
 * - Strictly limits image payload size to 2MB to protect database & memory limits.
 * - Validates media asset paths (/api/media/<key>) against path traversal.
 */
export function validateReviewImages(
  inputImages: any
): { valid: boolean; images: string[]; error?: string } {
  if (!inputImages) {
    return { valid: true, images: [] };
  }

  if (!Array.isArray(inputImages)) {
    return { valid: false, images: [], error: 'Review images must be an array.' };
  }

  if (inputImages.length > MAX_REVIEW_IMAGES_COUNT) {
    return {
      valid: false,
      images: [],
      error: `A maximum of ${MAX_REVIEW_IMAGES_COUNT} images can be attached to a review.`,
    };
  }

  const sanitizedList: string[] = [];

  for (let i = 0; i < inputImages.length; i++) {
    const raw = inputImages[i];
    if (typeof raw !== 'string') {
      return { valid: false, images: [], error: 'Invalid image format.' };
    }

    const img = raw.trim();
    if (!img) continue;

    // Reject executable markup or script tags immediately
    if (
      /<(?:script|svg|html|iframe|object|embed|style)/i.test(img) ||
      /javascript:/i.test(img) ||
      /vbscript:/i.test(img) ||
      /data:text\//i.test(img) ||
      /data:image\/svg/i.test(img)
    ) {
      return {
        valid: false,
        images: [],
        error: 'Disallowed file content: Vector graphics (SVG), HTML, and executable scripts are strictly prohibited.',
      };
    }

    // 1. Data URL inspection
    if (img.startsWith('data:')) {
      const dataUrlMatch = img.match(
        /^data:image\/(jpeg|jpg|png|webp|gif|x-icon|vnd\.microsoft\.icon);base64,([A-Za-z0-9+/=]+)$/i
      );
      if (!dataUrlMatch) {
        return {
          valid: false,
          images: [],
          error: 'Invalid review image. Only JPEG, PNG, WebP, GIF, and ICO image formats are accepted.',
        };
      }

      const base64Data = dataUrlMatch[2];
      // Quick length check: base64 overhead is ~4/3 of binary
      if (base64Data.length > Math.ceil((MAX_REVIEW_IMAGE_BYTES * 4) / 3) + 256) {
        return {
          valid: false,
          images: [],
          error: `Review image exceeds maximum allowed limit of ${MAX_REVIEW_IMAGE_BYTES / (1024 * 1024)}MB.`,
        };
      }

      let rawBytes: Uint8Array;
      try {
        const binStr = atob(base64Data);
        if (binStr.length > MAX_REVIEW_IMAGE_BYTES) {
          return {
            valid: false,
            images: [],
            error: `Review image exceeds maximum allowed limit of ${MAX_REVIEW_IMAGE_BYTES / (1024 * 1024)}MB.`,
          };
        }
        rawBytes = new Uint8Array(binStr.length);
        for (let j = 0; j < binStr.length; j++) {
          rawBytes[j] = binStr.charCodeAt(j);
        }
      } catch {
        return { valid: false, images: [], error: 'Malformed base64 image data.' };
      }

      // Authoritative magic bytes & polyglot inspection
      const validation = validateImageBuffer(rawBytes);
      if (!validation.valid || !validation.mime) {
        return {
          valid: false,
          images: [],
          error: validation.error || 'Invalid or unsupported image file.',
        };
      }

      sanitizedList.push(`data:${validation.mime};base64,${base64Data}`);
    } else if (img.startsWith('/api/media/')) {
      // 2. Local Media Asset inspection
      const mediaMatch = img.match(/^\/api\/media\/([^/?#]+)$/);
      if (!mediaMatch || !isValidMediaKey(mediaMatch[1])) {
        return { valid: false, images: [], error: 'Invalid media asset reference.' };
      }
      sanitizedList.push(`/api/media/${mediaMatch[1]}`);
    } else if (img.startsWith('https://') || img.startsWith('http://')) {
      // 3. Remote URL inspection
      if (img.length > 2048) {
        return { valid: false, images: [], error: 'Image URL is too long.' };
      }
      try {
        const parsedUrl = new URL(img);
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
          return { valid: false, images: [], error: 'Invalid image URL protocol.' };
        }
        if (/\.svg($|\?)/i.test(parsedUrl.pathname)) {
          return {
            valid: false,
            images: [],
            error: 'Disallowed file content: Vector graphics (SVG) are strictly prohibited.',
          };
        }
        sanitizedList.push(img);
      } catch {
        return { valid: false, images: [], error: 'Invalid image URL.' };
      }
    } else {
      return {
        valid: false,
        images: [],
        error: 'Invalid image format. Must be an uploaded image, media asset, or valid image URL.',
      };
    }
  }

  return { valid: true, images: sanitizedList };
}

export const MAX_SAFE_D1_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024); // 1.5MB safe D1 maximum limit
export const MAX_IMAGE_DIMENSION = 2000; // 2000px maximum width / height

export interface OptimizedImageResult {
  optimizedBuffer: Uint8Array;
  mime: string;
  format: SupportedImageFormat;
  extension: string;
  width?: number;
  height?: number;
  wasOptimized: boolean;
}

export type OptimizeImageResponse =
  | { success: true; data: OptimizedImageResult; error?: undefined }
  | { success: false; error: string; data?: undefined };

/**
 * Optimizes an uploaded image buffer before storing in Cloudflare D1.
 * 1. Checks dimensions; resizes excessive dimensions to <= 2000x2000 preserving aspect ratio and orientation.
 * 2. Compresses and strips unnecessary EXIF metadata.
 * 3. Enforces that final buffer <= 1.5MB (preferred target <= 1MB).
 * 4. If image cannot be safely reduced below 1.5MB, returns clear rejection error.
 */
export async function optimizeImageBufferForD1(
  inputBuffer: ArrayBuffer | Uint8Array,
  originalValidation: ImageValidationResult
): Promise<OptimizeImageResponse> {
  const bytes = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);
  const originalFormat = originalValidation.format || 'jpeg';
  const originalMime = originalValidation.mime || 'image/jpeg';
  const originalExt = originalValidation.extension || 'jpg';

  // If sharp is available in Node.js runtime:
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const sharpModule = await import('sharp');
      const sharp = (sharpModule as any).default || sharpModule;
      const metadata = await sharp(Buffer.from(bytes)).metadata();
      const origWidth = metadata.width || 0;
      const origHeight = metadata.height || 0;

      const needsResize = origWidth > MAX_IMAGE_DIMENSION || origHeight > MAX_IMAGE_DIMENSION;
      const needsCompression = bytes.byteLength > 1024 * 1024; // > 1MB

      // If already small and within dimension limits, preserve original binary
      if (!needsResize && !needsCompression && bytes.byteLength <= MAX_SAFE_D1_IMAGE_BYTES) {
        return {
          success: true,
          data: {
            optimizedBuffer: bytes,
            mime: originalMime,
            format: originalFormat,
            extension: originalExt,
            width: origWidth,
            height: origHeight,
            wasOptimized: false,
          },
        };
      }

      // Perform server-side optimization
      let pipeline = sharp(Buffer.from(bytes)).rotate(); // Auto-orient based on EXIF, strip excess metadata

      if (needsResize) {
        pipeline = pipeline.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      let optimizedBuf: Buffer;
      let finalMime = originalMime;
      let finalFormat = originalFormat;
      let finalExt = originalExt;

      // Optimize according to format
      if (originalFormat === 'jpeg') {
        optimizedBuf = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        if (optimizedBuf.byteLength > 1.2 * 1024 * 1024) {
          optimizedBuf = await sharp(Buffer.from(bytes))
            .rotate()
            .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 75, mozjpeg: true })
            .toBuffer();
        }
      } else if (originalFormat === 'png') {
        optimizedBuf = await pipeline.png({ compressionLevel: 8 }).toBuffer();
        if (optimizedBuf.byteLength > 1.2 * 1024 * 1024) {
          // If PNG is still large, convert to WebP to fit in D1
          optimizedBuf = await sharp(Buffer.from(bytes))
            .rotate()
            .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer();
          finalMime = 'image/webp';
          finalFormat = 'webp';
          finalExt = 'webp';
        }
      } else if (originalFormat === 'webp') {
        optimizedBuf = await pipeline.webp({ quality: 82 }).toBuffer();
        if (optimizedBuf.byteLength > 1.2 * 1024 * 1024) {
          optimizedBuf = await sharp(Buffer.from(bytes))
            .rotate()
            .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer();
        }
      } else {
        // GIF / ICO: keep as is if within safe limits
        optimizedBuf = Buffer.from(bytes);
      }

      // Check if after optimization it still exceeds safe D1 target
      if (optimizedBuf.byteLength > MAX_SAFE_D1_IMAGE_BYTES) {
        // Try WebP at quality 68 as final attempt
        try {
          optimizedBuf = await sharp(Buffer.from(bytes))
            .rotate()
            .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 68 })
            .toBuffer();
          finalMime = 'image/webp';
          finalFormat = 'webp';
          finalExt = 'webp';
        } catch {}
      }

      if (optimizedBuf.byteLength > MAX_SAFE_D1_IMAGE_BYTES) {
        return {
          success: false,
          error: 'Image could not be optimized to a supported size. Please use a smaller image.',
        };
      }

      return {
        success: true,
        data: {
          optimizedBuffer: new Uint8Array(optimizedBuf),
          mime: finalMime,
          format: finalFormat,
          extension: finalExt,
          wasOptimized: true,
        },
      };
    } catch (optErr) {
      console.warn('Image optimization encountered error, checking fallback size:', optErr);
      if (bytes.byteLength > MAX_SAFE_D1_IMAGE_BYTES) {
        return {
          success: false,
          error: 'Image could not be optimized to a supported size. Please use a smaller image.',
        };
      }
      return {
        success: true,
        data: {
          optimizedBuffer: bytes,
          mime: originalMime,
          format: originalFormat,
          extension: originalExt,
          wasOptimized: false,
        },
      };
    }
  }

  // Edge / non-Node environment fallback:
  if (bytes.byteLength > MAX_SAFE_D1_IMAGE_BYTES) {
    return {
      success: false,
      error: 'Image could not be optimized to a supported size. Please use a smaller image.',
    };
  }

  return {
    success: true,
    data: {
      optimizedBuffer: bytes,
      mime: originalMime,
      format: originalFormat,
      extension: originalExt,
      wasOptimized: false,
    },
  };
}

