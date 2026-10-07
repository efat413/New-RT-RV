/**
 * Server-Side Request Forgery (SSRF) Protection Module
 * Hardens webhook test, trigger, and courier dispatch endpoints against internal network probing,
 * cloud metadata access, localhost traversal, and DNS rebinding / redirect attacks.
 */

// Blocked internal hostname patterns and SSRF / DNS-rebinding services
export const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.corp$/i,
  /\.home$/i,
  /\.arpa$/i,
  /\.test$/i,
  /\.invalid$/i,
  /\.example$/i,
  /\.onion$/i,
  /\.priv$/i,
  /\.domain$/i,
  // Cloud metadata hostnames
  /^metadata\.google\.internal$/i,
  /^metadata\.google$/i,
  /^metadata\.azure\.com$/i,
  /^instance-data$/i,
  /^instance-data\.ec2\.internal$/i,
  /^metadata\.packet\.net$/i,
  /^169\.254\.169\.254$/i,
  /^100\.100\.100\.200$/i,
  // DNS rebinding and wildcard IP resolution domains
  /^nip\.io$/i,
  /\.nip\.io$/i,
  /^sslip\.io$/i,
  /\.sslip\.io$/i,
  /^localtest\.me$/i,
  /\.localtest\.me$/i,
  /^lvh\.me$/i,
  /\.lvh\.me$/i,
  /^vcap\.me$/i,
  /\.vcap\.me$/i,
  /^fwh\.is$/i,
  /\.fwh\.is$/i,
  // Out-of-band / SSRF exfiltration test services
  /\.burpcollaborator\.net$/i,
  /\.oastify\.com$/i,
  /\.oast\.pro$/i,
  /\.oast\.live$/i,
  /\.oast\.site$/i,
  /\.oast\.online$/i,
  /\.oast\.fun$/i,
  /\.oast\.me$/i,
  /\.dnslog\.cn$/i,
];

// Single word internal names (e.g., "router", "intranet", "database", "redis")
export const SINGLE_WORD_HOSTNAME = /^[a-z0-9_-]+$/i;

// Allowed standard web ports
export const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/**
 * Checks if an IPv4 address belongs to a private, loopback, link-local,
 * multicast, or reserved range.
 * Strictly disallows leading zeros to eliminate octal-representation bypasses.
 */
export function isPrivateOrReservedIpv4(ip: string): boolean {
  const rawParts = ip.split('.');
  if (rawParts.length !== 4) {
    return true; // Malformed or short-form IPv4 is blocked
  }

  const parts: number[] = [];
  for (const p of rawParts) {
    // Disallow leading zeros (octal notation ambiguity e.g. 0177.0.0.1, 012.0.0.1)
    if (p.length > 1 && p.startsWith('0')) {
      return true;
    }
    if (!/^\d+$/.test(p)) {
      return true;
    }
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255) return true;
    parts.push(n);
  }

  const [a, b, c, d] = parts;

  // 0.0.0.0/8 (Current network / non-routable)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private network)
  if (a === 10) return true;

  // 100.64.0.0/10 (Shared address space / Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-local & AWS/GCP/Azure/OCI metadata: 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast)
  if (a === 192 && b === 88 && c === 99) return true;

  // 192.168.0.0/16 (Private network)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;

  // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved: 240.0.0.0 - 255.255.255.254)
  if (a >= 240) return true;

  // 255.255.255.255 (Broadcast)
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

/**
 * Checks if an IPv6 address belongs to private, loopback, link-local,
 * or reserved range.
 */
export function isPrivateOrReservedIpv6(rawIp: string): boolean {
  let ip = rawIp.toLowerCase().trim();
  // Strip enclosing brackets if present
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }

  // Loopback ::1 and unspecified ::
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // IPv4-mapped IPv6 ::ffff:a.b.c.d
  if (ip.startsWith('::ffff:') || ip.startsWith('0:0:0:0:0:ffff:')) {
    const ipv4Part = ip.split(':').pop();
    if (ipv4Part && ipv4Part.includes('.')) {
      return isPrivateOrReservedIpv4(ipv4Part);
    }
    return true;
  }

  // Unique local addresses fc00::/7 (fc00:: - fdff::)
  if (ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }

  // Link-local unicast fe80::/10 (fe80:: - febf::)
  if (
    ip.startsWith('fe8') ||
    ip.startsWith('fe9') ||
    ip.startsWith('fea') ||
    ip.startsWith('feb')
  ) {
    return true;
  }

  // Multicast ff00::/8
  if (ip.startsWith('ff')) {
    return true;
  }

  // Documentation prefix 2001:db8::/32
  if (ip.startsWith('2001:db8') || ip.startsWith('2001:0db8')) {
    return true;
  }

  // Discard prefix 100::/64
  if (ip.startsWith('100::')) {
    return true;
  }

  // Teredo prefix 2001::/32
  if (ip.startsWith('2001:0000:') || ip.startsWith('2001:0:')) {
    return true;
  }

  // 6to4 prefix 2002::/16
  if (ip.startsWith('2002:')) {
    return true;
  }

  return false;
}

/**
 * Resolves a hostname to its IP addresses and validates that none point to
 * private, loopback, or reserved networks.
 * Directly mitigates DNS rebinding attacks.
 */
export async function resolveAndValidateDns(hostname: string): Promise<{
  valid: boolean;
  resolvedIps?: string[];
  error?: string;
}> {
  const cleanHost = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');

  // 1. If the hostname itself is an IPv4 address
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(cleanHost)) {
    if (isPrivateOrReservedIpv4(cleanHost)) {
      return {
        valid: false,
        error: `Destination IP address (${cleanHost}) is private, loopback, or reserved.`,
      };
    }
    return { valid: true, resolvedIps: [cleanHost] };
  }

  // 2. If the hostname is an IPv6 address
  if (cleanHost.includes(':')) {
    if (isPrivateOrReservedIpv6(cleanHost)) {
      return {
        valid: false,
        error: `Destination IPv6 address (${cleanHost}) is private, loopback, or reserved.`,
      };
    }
    return { valid: true, resolvedIps: [cleanHost] };
  }

  // 3. Resolve DNS records via Node.js dns module if available (Node.js runtime / dev server)
  try {
    const dns = await import('node:dns');
    if (dns && dns.promises && typeof dns.promises.lookup === 'function') {
      const addresses = await dns.promises.lookup(cleanHost, { all: true });
      if (!addresses || addresses.length === 0) {
        return { valid: false, error: `Could not resolve hostname "${cleanHost}".` };
      }

      const ipList: string[] = [];
      for (const entry of addresses) {
        const ip = entry.address;
        ipList.push(ip);
        if (entry.family === 4) {
          if (isPrivateOrReservedIpv4(ip)) {
            return {
              valid: false,
              resolvedIps: ipList,
              error: `Hostname "${cleanHost}" resolved to private or reserved IP (${ip}) [DNS Rebinding Blocked].`,
            };
          }
        } else if (entry.family === 6) {
          if (isPrivateOrReservedIpv6(ip)) {
            return {
              valid: false,
              resolvedIps: ipList,
              error: `Hostname "${cleanHost}" resolved to private or reserved IPv6 (${ip}) [DNS Rebinding Blocked].`,
            };
          }
        }
      }
      return { valid: true, resolvedIps: ipList };
    }
  } catch (err: any) {
    if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') {
      return {
        valid: false,
        error: `Hostname "${cleanHost}" could not be resolved (DNS lookup failed).`,
      };
    }
    // In edge runtime without node:dns, continue to edge-safe fetch validation
  }

  return { valid: true };
}

// =========================================================================
// STEADFAST COURIER API DESTINATION ALLOWLIST & VALIDATOR
// =========================================================================

export const APPROVED_STEADFAST_HOSTNAMES = new Set([
  'portal.packzy.com',
  'packzy.com',
  'portal.steadfast.com.bd',
  'api.steadfast.com.bd',
  'steadfast.com.bd',
]);

/**
 * Strictly validates Steadfast API destination URLs.
 * Requirements:
 * 1. Never blindly trust user-provided baseUrl.
 * 2. Only explicitly allowlisted official Steadfast API hostnames permitted.
 * 3. Rejects arbitrary domains, IP addresses, localhost, link-local, private networks, metadata endpoints.
 * 4. Protects against redirect-based SSRF.
 * 5. Production credentials must NEVER be sent to user-controlled destinations.
 */
export function validateSteadfastApiUrl(targetUrl?: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
    // Default official gateway is valid
    return { valid: true, normalizedUrl: 'https://portal.packzy.com/api/v1' };
  }

  const trimmed = targetUrl.trim();

  // Strict HTTPS protocol requirement
  if (!trimmed.startsWith('https://')) {
    return {
      valid: false,
      error: 'Steadfast API requests must strictly use HTTPS protocol.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid Steadfast API URL format.' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Steadfast API requests must strictly use HTTPS.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'Steadfast API URL must not contain embedded user credentials.',
    };
  }

  if (parsed.port && parsed.port !== '443') {
    return {
      valid: false,
      error: 'Steadfast API URL must use standard HTTPS port (443). Custom ports are not allowed.',
    };
  }

  let hostname = parsed.hostname.toLowerCase().trim();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Reject any IP address representations
  if (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.includes(':') ||
    /^0x[0-9a-f]+$/i.test(hostname) ||
    /^\d+$/.test(hostname)
  ) {
    return {
      valid: false,
      error: 'Steadfast API requests cannot be sent to IP addresses. Only official Steadfast domain names are permitted.',
    };
  }

  // Reject blocked hostnames (localhost, .local, .internal, metadata, etc.)
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        valid: false,
        error: 'Destination hostname is restricted or internal.',
      };
    }
  }

  // Enforce explicitly approved Steadfast hostnames
  const isApproved =
    APPROVED_STEADFAST_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.packzy.com') ||
    hostname.endsWith('.steadfast.com.bd');

  if (!isApproved) {
    return {
      valid: false,
      error: `Restricted destination: "${hostname}" is not an authorized Steadfast API host. Steadfast requests are only permitted to official domains (portal.packzy.com, portal.steadfast.com.bd, api.steadfast.com.bd).`,
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString().replace(/\/+$/, ''),
  };
}

// =========================================================================
// COURIER DISPATCH DESTINATION ALLOWLIST & VALIDATOR
// =========================================================================

export const APPROVED_COURIER_DOMAINS = [
  // Steadfast / Packzy
  'portal.packzy.com',
  'packzy.com',
  'portal.steadfast.com.bd',
  'api.steadfast.com.bd',
  'steadfast.com.bd',
  // Pathao Courier
  'api.pathao.com',
  'api-hermes.pathao.com',
  'courier-api.pathao.com',
  'pathao.com',
  // RedX Logistics
  'openapi.redx.com.bd',
  'api.redx.com.bd',
  'redx.com.bd',
  // Paperfly Express
  'api.paperfly.com.bd',
  'paperfly.com.bd',
  // eCourier
  'api.ecourier.com.bd',
  'ecourier.com.bd',
];

/**
 * Validates courier dispatch destination URLs to prevent SSRF and PII exfiltration.
 * Customer order data (name, phone, address, COD amount) must only be dispatched to
 * explicitly approved courier partner API endpoints.
 */
export function validateCourierApiUrl(targetUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return { valid: false, error: 'Courier destination URL is required.' };
  }

  const trimmed = targetUrl.trim();

  // Protocol MUST be HTTPS for dispatching customer PII
  if (!trimmed.startsWith('https://')) {
    return {
      valid: false,
      error: 'Courier dispatch endpoints must strictly use secure HTTPS protocol to protect customer data.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid courier URL format.' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Courier dispatch endpoints must strictly use HTTPS.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'Courier URL must not contain embedded user credentials.',
    };
  }

  if (parsed.port && parsed.port !== '443') {
    return {
      valid: false,
      error: 'Courier dispatch URL must use standard HTTPS port 443.',
    };
  }

  let hostname = parsed.hostname.toLowerCase().trim();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Block any IP addresses
  if (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.includes(':') ||
    /^0x[0-9a-f]+$/i.test(hostname) ||
    /^\d+$/.test(hostname)
  ) {
    return {
      valid: false,
      error: 'Courier dispatch cannot be sent to IP addresses. Only approved courier partner domains are permitted.',
    };
  }

  // Block internal/restricted hostnames
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        valid: false,
        error: 'Destination hostname is restricted or internal.',
      };
    }
  }

  // Check against approved courier domains
  const isApproved = APPROVED_COURIER_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`)
  );

  if (!isApproved) {
    return {
      valid: false,
      error: `Restricted destination: "${hostname}" is not an authorized courier partner. Courier dispatch is only permitted to approved logistics providers (Steadfast, Pathao, RedX, Paperfly, eCourier). Arbitrary external destinations are prohibited.`,
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}

export interface SafeFetchCourierDispatchOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeFetchCourierDispatchResult {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}

/**
 * Hardened HTTP client for courier dispatch.
 * Enforces:
 * 1. Destination URL check against courier allowlist.
 * 2. DNS rebinding validation.
 * 3. Manual redirect validation on every hop (redirect target must also be approved courier domain).
 * 4. Strict timeout.
 * 5. Sanitized error messages.
 */
export async function safeFetchCourierDispatch(
  options: SafeFetchCourierDispatchOptions
): Promise<SafeFetchCourierDispatchResult> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    timeoutMs = 12000,
    maxRedirects = 3,
  } = options;

  let currentUrl = url;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    // 1. Validate courier destination
    const validation = validateCourierApiUrl(currentUrl);
    if (!validation.valid) {
      return {
        ok: false,
        status: 400,
        error: validation.error || 'Courier destination URL is not permitted.',
      };
    }

    // 2. DNS resolution check (DNS rebinding protection)
    const parsed = new URL(currentUrl);
    const dnsCheck = await resolveAndValidateDns(parsed.hostname);
    if (!dnsCheck.valid) {
      return {
        ok: false,
        status: 400,
        error: dnsCheck.error || 'Destination failed DNS security validation.',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(currentUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; RongdhonuTrade/1.0; +https://rongdhonutrade.com)',
          ...headers,
        },
        body,
        redirect: 'manual', // Enforce manual redirect handling
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Handle Redirects
      if ([301, 302, 303, 307, 308].includes(resp.status)) {
        const location = resp.headers.get('location');
        if (!location) {
          return {
            ok: false,
            status: resp.status,
            error: 'Courier API returned redirect without Location header.',
          };
        }

        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return {
            ok: false,
            status: resp.status,
            error: 'Courier API returned malformed redirect Location.',
          };
        }

        // Validate that next hop is ALSO an approved courier endpoint
        const nextVal = validateCourierApiUrl(nextUrl);
        if (!nextVal.valid) {
          return {
            ok: false,
            status: 400,
            error: `Courier API redirect to unauthorized destination blocked: ${nextVal.error}`,
          };
        }

        currentUrl = nextUrl;
        redirectsCount++;
        continue;
      }

      let parsedData: any = null;
      try {
        parsedData = await resp.json();
      } catch {
        const text = await resp.text().catch(() => '');
        parsedData = { raw: text };
      }

      return {
        ok: resp.ok,
        status: resp.status,
        data: parsedData,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');
      return {
        ok: false,
        status: 0,
        error: isTimeout
          ? 'Courier dispatch timed out.'
          : 'Failed to communicate with courier gateway.',
      };
    }
  }

  return {
    ok: false,
    status: 400,
    error: 'Courier API exceeded maximum redirect limit.',
  };
}

// =========================================================================
// GENERAL WEBHOOK DESTINATION VALIDATOR & DISPATCHER
// =========================================================================

export interface WebhookUrlValidationResult {
  valid: boolean;
  isInternalReceiver?: boolean;
  internalPath?: string;
  normalizedUrl?: string;
  error?: string;
}

/**
 * Validates a webhook destination URL against SSRF vulnerabilities.
 */
export function validateWebhookDestination(
  targetUrl: string,
  requestOrigin?: string
): WebhookUrlValidationResult {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return { valid: false, error: 'Webhook URL is required.' };
  }

  const trimmed = targetUrl.trim();

  // Allow relative URL strictly targeting the built-in courier webhook receiver
  if (trimmed.startsWith('/')) {
    // Prevent path traversal or access to arbitrary internal API routes
    const norm = trimmed.replace(/\/+/g, '/').replace(/\/+$/, '');
    if (
      norm === '/api/webhook/courier' ||
      norm === '/api/webhook' ||
      norm === '/api/courier/webhook' ||
      norm === '/api/webhook/steadfast' ||
      norm === '/api/webhooks' ||
      norm === '' ||
      norm === '/'
    ) {
      return {
        valid: true,
        isInternalReceiver: true,
        internalPath: '/api/webhook/courier',
        normalizedUrl: '/api/webhook/courier',
      };
    }
    return {
      valid: false,
      error: 'Relative webhook URL must target the store webhook receiver (/api/webhook/courier). Access to other internal paths is prohibited.',
    };
  }

  // Only allow HTTP and HTTPS protocols
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return {
      valid: false,
      error: 'Webhook destination must use http:// or https:// protocol.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }

  // Protocol strictly http: or https:
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Only HTTP and HTTPS protocols are allowed for webhooks.',
    };
  }

  // Reject credentials in URL
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'Webhook destination URL must not contain embedded user credentials.',
    };
  }

  // Enforce allowed ports
  if (!ALLOWED_PORTS.has(parsed.port)) {
    return {
      valid: false,
      error: 'Webhook destination port is not permitted. Only standard web ports (80, 443, 8080, 8443) are allowed.',
    };
  }

  let hostname = parsed.hostname.toLowerCase().trim();

  // Strip brackets from IPv6 hostnames
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  if (!hostname || hostname.endsWith('.')) {
    return { valid: false, error: 'Invalid hostname in webhook URL.' };
  }

  // Check if target points to the current application origin / deployed host
  // If so, safely route to the built-in receiver instead of making an external loopback HTTP call
  if (requestOrigin) {
    try {
      const origUrl = new URL(requestOrigin);
      if (origUrl.hostname.toLowerCase() === hostname) {
        return {
          valid: true,
          isInternalReceiver: true,
          internalPath: parsed.pathname.startsWith('/api/webhook') ? parsed.pathname : '/api/webhook/courier',
          normalizedUrl: '/api/webhook/courier',
        };
      }
    } catch {}
  }

  // Check known app hostnames (safe routing to built-in store receiver)
  if (
    hostname === 'rongdhonutrade.com' ||
    hostname === 'www.rongdhonutrade.com'
  ) {
    return {
      valid: true,
      isInternalReceiver: true,
      internalPath: parsed.pathname.startsWith('/api/webhook') ? parsed.pathname : '/api/webhook/courier',
      normalizedUrl: '/api/webhook/courier',
    };
  }

  // Reject blocked hostnames (localhost, cloud metadata, .internal, etc.)
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        valid: false,
        error: 'Destination hostname is restricted or internal and cannot be reached.',
      };
    }
  }

  // Reject single-word hostnames without dot (internal network services)
  if (!hostname.includes('.') && !hostname.includes(':')) {
    return {
      valid: false,
      error: 'Single-label internal hostnames are not permitted as webhook destinations.',
    };
  }

  // Reject private IPv4 ranges
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (ipv4Regex.test(hostname)) {
    if (isPrivateOrReservedIpv4(hostname)) {
      return {
        valid: false,
        error: 'Webhook destination points to a private, loopback, or reserved IP address.',
      };
    }
  }

  // Reject private IPv6 ranges
  if (hostname.includes(':')) {
    if (isPrivateOrReservedIpv6(hostname)) {
      return {
        valid: false,
        error: 'Webhook destination points to a private, loopback, or reserved IPv6 address.',
      };
    }
  }

  // Reject decimal / octal / hex / short-form encoded IP representations (e.g. 2130706433 = 127.0.0.1, 0177.0.0.1, 127.1)
  if (
    /^0x[0-9a-f]+$/i.test(hostname) ||
    /^\d+$/.test(hostname) ||
    /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,2}$/i.test(hostname)
  ) {
    return {
      valid: false,
      error: 'Integer, octal, or short-form IP addresses are not permitted.',
    };
  }

  return {
    valid: true,
    isInternalReceiver: false,
    normalizedUrl: parsed.toString(),
  };
}

export interface SafeFetchWebhookOptions {
  url: string;
  headers?: Record<string, string>;
  body: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
}

export interface SafeFetchWebhookResult {
  success: boolean;
  status: number;
  latencyMs: number;
  responsePreview: string;
  message: string;
  error?: string;
}

/**
 * Executes a hardened HTTP POST request to a webhook destination.
 * Strictly enforces:
 * 1. Pre-fetch SSRF hostname & IP check
 * 2. DNS rebinding validation against resolved IPs
 * 3. Manual redirect resolution with SSRF & DNS validation on EVERY hop
 * 4. 5-second strict AbortController timeout
 * 5. Response body size limit (1KB)
 * 6. Sanitized error messages that do not expose internal network topology
 */
export async function safeFetchWebhook(
  options: SafeFetchWebhookOptions
): Promise<SafeFetchWebhookResult> {
  const {
    url,
    headers = {},
    body,
    timeoutMs = 5000,
    maxRedirects = 3,
    maxResponseBytes = 1024,
  } = options;

  let currentUrl = url;
  let redirectsCount = 0;
  const start = Date.now();

  while (redirectsCount <= maxRedirects) {
    const valResult = validateWebhookDestination(currentUrl);
    if (!valResult.valid || valResult.isInternalReceiver) {
      return {
        success: false,
        status: 0,
        latencyMs: Date.now() - start,
        responsePreview: 'Destination blocked by SSRF filter',
        message: valResult.error || 'Destination URL is not permitted.',
        error: valResult.error || 'Destination URL is not permitted.',
      };
    }

    // DNS rebinding protection: resolve hostname and verify resolved IPs
    const parsedCurrent = new URL(currentUrl);
    const dnsCheck = await resolveAndValidateDns(parsedCurrent.hostname);
    if (!dnsCheck.valid) {
      return {
        success: false,
        status: 0,
        latencyMs: Date.now() - start,
        responsePreview: 'Destination blocked by DNS SSRF filter',
        message: dnsCheck.error || 'Destination failed DNS security validation.',
        error: dnsCheck.error || 'DNS validation failed',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(currentUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'User-Agent': 'RongdhonuTrade-Webhook-Validator/1.0',
        },
        body,
        redirect: 'manual', // CRITICAL: Manual redirect handling to validate every hop
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Handle HTTP redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(resp.status)) {
        const location = resp.headers.get('location');
        if (!location) {
          return {
            success: false,
            status: resp.status,
            latencyMs: Date.now() - start,
            responsePreview: 'Redirect without Location header',
            message: `Endpoint returned HTTP ${resp.status} redirect without a Location header.`,
            error: 'Redirect missing Location header',
          };
        }

        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return {
            success: false,
            status: resp.status,
            latencyMs: Date.now() - start,
            responsePreview: 'Malformed redirect Location',
            message: 'Destination redirected to an invalid URL.',
            error: 'Malformed redirect URL',
          };
        }

        // Validate the next hop before following
        const nextValidation = validateWebhookDestination(nextUrl);
        if (!nextValidation.valid || nextValidation.isInternalReceiver) {
          return {
            success: false,
            status: 0,
            latencyMs: Date.now() - start,
            responsePreview: 'Redirect blocked by SSRF filter',
            message: 'Redirect to an internal or restricted destination was blocked for security.',
            error: 'Redirect to restricted host blocked',
          };
        }

        const nextDnsCheck = await resolveAndValidateDns(new URL(nextUrl).hostname);
        if (!nextDnsCheck.valid) {
          return {
            success: false,
            status: 0,
            latencyMs: Date.now() - start,
            responsePreview: 'Redirect blocked by DNS filter',
            message: nextDnsCheck.error || 'Redirect destination failed DNS security validation.',
            error: 'Redirect DNS validation failed',
          };
        }

        currentUrl = nextUrl;
        redirectsCount++;
        continue;
      }

      const latencyMs = Date.now() - start;

      // Safely read response with size ceiling
      let previewText = '';
      try {
        const rawText = await resp.text();
        previewText = rawText.slice(0, maxResponseBytes);
      } catch {
        previewText = '';
      }

      const isSuccess = resp.ok;
      return {
        success: isSuccess,
        status: resp.status,
        latencyMs,
        responsePreview: previewText || (isSuccess ? 'OK (Empty response)' : `HTTP Error ${resp.status}`),
        message: isSuccess
          ? `Webhook delivered successfully with status HTTP ${resp.status} (${latencyMs}ms)`
          : resp.status === 404
            ? `Destination server returned HTTP 404 (Not Found). Verify webhook path accepts HTTP POST.`
            : `Destination server returned HTTP status ${resp.status}`,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');

      return {
        success: false,
        status: 0,
        latencyMs,
        responsePreview: isTimeout ? 'Request timed out (5s limit)' : 'Delivery failed',
        message: isTimeout
          ? 'Webhook test timed out after 5 seconds.'
          : 'Unable to deliver webhook to destination server. Ensure the URL is publicly reachable.',
        error: isTimeout ? 'Request timed out' : 'Connection failed',
      };
    }
  }

  return {
    success: false,
    status: 0,
    latencyMs: Date.now() - start,
    responsePreview: 'Too many redirects',
    message: 'Destination exceeded maximum allowed redirects (limit: 3).',
    error: 'Maximum redirect limit exceeded',
  };
}
