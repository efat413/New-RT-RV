/**
 * Comprehensive Verification Suite for Steadfast API Credential Leak & Courier Dispatch SSRF Fixes
 * Tests all requirements from security audit:
 * 1. POST /api/courier/steadfast/test SSRF & credential leak protection
 * 2. POST /api/courier/dispatch SSRF & customer PII exfiltration protection
 * 3. General SSRF engine hardening (DNS rebinding, octal/hex IP bypasses, metadata endpoints)
 */

import {
  validateSteadfastApiUrl,
  validateCourierApiUrl,
  validateWebhookDestination,
  resolveAndValidateDns,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  APPROVED_STEADFAST_HOSTNAMES,
  APPROVED_COURIER_DOMAINS,
} from '../src/server/ssrf';
import { resolveSteadfastBaseUrls, callSteadfastApi } from '../src/server/courier';
import { getTestAdminToken } from './test-auth-helper';

async function runCourierSsrfVerification() {
  console.log('================================================================');
  console.log('STARTING COURIER SSRF & CREDENTIAL LEAK SECURITY AUDIT SUITE');
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

  // =========================================================================
  // 1. UNIT TESTS: validateSteadfastApiUrl
  // =========================================================================
  console.log('--- 1. STEADFAST API DESTINATION VALIDATION (UNIT) ---');

  // 1.1 Official Steadfast gateways allowed
  const packzyRes = validateSteadfastApiUrl('https://portal.packzy.com/api/v1');
  assert(packzyRes.valid && packzyRes.normalizedUrl?.includes('portal.packzy.com'), '1.1 https://portal.packzy.com/api/v1 is accepted');

  const sfLegacyRes = validateSteadfastApiUrl('https://portal.steadfast.com.bd/api/v1');
  assert(sfLegacyRes.valid && sfLegacyRes.normalizedUrl?.includes('portal.steadfast.com.bd'), '1.2 https://portal.steadfast.com.bd/api/v1 is accepted');

  const sfApiRes = validateSteadfastApiUrl('https://api.steadfast.com.bd');
  assert(sfApiRes.valid, '1.3 https://api.steadfast.com.bd is accepted');

  const emptyRes = validateSteadfastApiUrl('');
  assert(emptyRes.valid && emptyRes.normalizedUrl === 'https://portal.packzy.com/api/v1', '1.4 Empty/omitted baseUrl defaults to official gateway');

  // 1.2 Reject HTTP (unencrypted)
  const httpRes = validateSteadfastApiUrl('http://portal.packzy.com/api/v1');
  assert(!httpRes.valid && httpRes.error?.includes('HTTPS'), '1.5 HTTP protocol is strictly rejected for Steadfast credentials');

  // 1.3 Reject attacker-controlled arbitrary domain
  const attackerRes = validateSteadfastApiUrl('https://attacker-controlled-server.com/api/v1');
  assert(!attackerRes.valid && attackerRes.error?.includes('not an authorized Steadfast API host'), '1.6 Arbitrary attacker domain is strictly rejected');

  // 1.4 Reject localhost & loopback
  const localhostRes = validateSteadfastApiUrl('https://localhost:8080/api');
  assert(!localhostRes.valid, '1.7 https://localhost is strictly rejected');

  const loopbackIpRes = validateSteadfastApiUrl('https://127.0.0.1:3000');
  assert(!loopbackIpRes.valid, '1.8 https://127.0.0.1 is strictly rejected');

  const ipv6LoopbackRes = validateSteadfastApiUrl('https://[::1]:3000');
  assert(!ipv6LoopbackRes.valid, '1.9 https://[::1] is strictly rejected');

  // 1.5 Reject Cloud Metadata & Link-Local endpoints
  const metadataRes = validateSteadfastApiUrl('https://169.254.169.254/latest/meta-data');
  assert(!metadataRes.valid, '1.10 AWS/GCP/Azure 169.254.169.254 metadata endpoint is rejected');

  // 1.6 Reject private IPv4
  const privateIp10 = validateSteadfastApiUrl('https://10.0.0.1/api');
  assert(!privateIp10.valid, '1.11 Private 10.0.0.1 is rejected');

  const privateIp192 = validateSteadfastApiUrl('https://192.168.1.1/api');
  assert(!privateIp192.valid, '1.12 Private 192.168.1.1 is rejected');

  // 1.7 Reject embedded credentials in URL
  const userPassRes = validateSteadfastApiUrl('https://admin:secret@portal.packzy.com/api/v1');
  assert(!userPassRes.valid && userPassRes.error?.includes('user credentials'), '1.13 Embedded credentials in URL are rejected');

  // 1.8 Reject DNS wildcard spoofing domains (e.g. *.nip.io)
  const nipRes = validateSteadfastApiUrl('https://portal.packzy.com.nip.io');
  assert(!nipRes.valid, '1.14 Suffix wildcard domain (portal.packzy.com.nip.io) is rejected');

  // 1.9 resolveSteadfastBaseUrls throws on malicious customBaseUrl
  let resolveThrew = false;
  try {
    resolveSteadfastBaseUrls('https://malicious-site.com/steal-keys');
  } catch (err: any) {
    resolveThrew = true;
  }
  assert(resolveThrew, '1.15 resolveSteadfastBaseUrls throws exception when passed malicious customBaseUrl');

  // =========================================================================
  // 2. UNIT TESTS: validateCourierApiUrl (Courier Dispatch PII Protection)
  // =========================================================================
  console.log('\n--- 2. COURIER DISPATCH DESTINATION VALIDATION (UNIT) ---');

  // 2.1 Approved courier partner domains allowed
  const pathaoRes = validateCourierApiUrl('https://api-hermes.pathao.com/aladdin/api/v1');
  assert(pathaoRes.valid, '2.1 Approved Pathao Hermes gateway is allowed');

  const redxRes = validateCourierApiUrl('https://openapi.redx.com.bd/v1.0.0-beta');
  assert(redxRes.valid, '2.2 Approved RedX gateway is allowed');

  const paperflyRes = validateCourierApiUrl('https://api.paperfly.com.bd/api/v1');
  assert(paperflyRes.valid, '2.3 Approved Paperfly gateway is allowed');

  const ecourierRes = validateCourierApiUrl('https://api.ecourier.com.bd/apiv2');
  assert(ecourierRes.valid, '2.4 Approved eCourier gateway is allowed');

  // 2.2 Arbitrary external URLs rejected
  const arbitraryDispatch = validateCourierApiUrl('https://webhook.site/steal-customer-data');
  assert(!arbitraryDispatch.valid && arbitraryDispatch.error?.includes('not an authorized courier partner'), '2.5 Arbitrary external webhook (webhook.site) is rejected for dispatch');

  const attackerDispatch = validateCourierApiUrl('https://attacker.com/receive-pii');
  assert(!attackerDispatch.valid, '2.6 Attacker destination is rejected for dispatch');

  // 2.3 Localhost & Private networks rejected for dispatch
  const localDispatch = validateCourierApiUrl('http://127.0.0.1:3000/api/internal');
  assert(!localDispatch.valid, '2.7 Localhost is rejected for dispatch');

  const metaDispatch = validateCourierApiUrl('http://169.254.169.254/latest/meta-data');
  assert(!metaDispatch.valid, '2.8 Cloud metadata is rejected for dispatch');

  // =========================================================================
  // 3. UNIT TESTS: DNS Rebinding & IP Encoding Hardening
  // =========================================================================
  console.log('\n--- 3. SSRF ENGINE HARDENING: IP ENCODING & DNS REBINDING ---');

  // 3.1 Octal leading-zero IPv4 rejection
  assert(isPrivateOrReservedIpv4('0177.0.0.1'), '3.1 Octal representation 0177.0.0.1 is blocked');
  assert(isPrivateOrReservedIpv4('012.0.0.1'), '3.2 Octal representation 012.0.0.1 is blocked');

  // 3.2 Loopback & Private IPv4 ranges
  assert(isPrivateOrReservedIpv4('127.0.0.1'), '3.3 127.0.0.1 is blocked');
  assert(isPrivateOrReservedIpv4('127.255.255.255'), '3.4 127.255.255.255 is blocked');
  assert(isPrivateOrReservedIpv4('10.254.0.1'), '3.5 10.254.0.1 is blocked');
  assert(isPrivateOrReservedIpv4('172.16.5.5'), '3.6 172.16.5.5 is blocked');
  assert(isPrivateOrReservedIpv4('192.168.100.1'), '3.7 192.168.100.1 is blocked');
  assert(isPrivateOrReservedIpv4('169.254.169.254'), '3.8 169.254.169.254 metadata IP is blocked');
  assert(isPrivateOrReservedIpv4('0.0.0.0'), '3.9 0.0.0.0 is blocked');

  // 3.3 Public IPv4 allowed
  assert(!isPrivateOrReservedIpv4('8.8.8.8'), '3.10 Public IP 8.8.8.8 is NOT blocked');
  assert(!isPrivateOrReservedIpv4('1.1.1.1'), '3.11 Public IP 1.1.1.1 is NOT blocked');

  // 3.4 IPv6 Loopback & Private ranges
  assert(isPrivateOrReservedIpv6('::1'), '3.12 IPv6 loopback ::1 is blocked');
  assert(isPrivateOrReservedIpv6('::'), '3.13 IPv6 unspecified :: is blocked');
  assert(isPrivateOrReservedIpv6('fe80::1'), '3.14 IPv6 link-local fe80::1 is blocked');
  assert(isPrivateOrReservedIpv6('fc00::1'), '3.15 IPv6 unique local fc00::1 is blocked');
  assert(isPrivateOrReservedIpv6('::ffff:127.0.0.1'), '3.16 IPv4-mapped IPv6 ::ffff:127.0.0.1 is blocked');

  // 3.5 DNS resolution verification function
  const localDns = await resolveAndValidateDns('localhost');
  assert(!localDns.valid, '3.17 resolveAndValidateDns("localhost") resolves to loopback and is blocked');

  const ipDns = await resolveAndValidateDns('127.0.0.1');
  assert(!ipDns.valid, '3.18 resolveAndValidateDns("127.0.0.1") is blocked');

  // =========================================================================
  // 4. INTEGRATION TESTS: POST /api/courier/steadfast/test (Live Server)
  // =========================================================================
  console.log('\n--- 4. INTEGRATION: POST /api/courier/steadfast/test ---');

  const serverBase = 'http://127.0.0.1:3000';
  const adminToken = await getTestAdminToken();

  // 4.1 Attempting Steadfast test with arbitrary attacker-controlled baseUrl
  const sfAttackerRes = await fetch(`${serverBase}/api/courier/steadfast/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      apiKey: 'test-api-key-123',
      secretKey: 'test-secret-key-123',
      baseUrl: 'https://attacker-controlled-server.com/collect-keys',
    }),
  });
  const sfAttackerJson = await sfAttackerRes.json().catch(() => ({}));

  assert(
    sfAttackerRes.status === 400 &&
      sfAttackerJson.success === false &&
      (sfAttackerJson.error?.includes('authorized Steadfast API host') || sfAttackerJson.error?.includes('official domains') || sfAttackerJson.error?.includes('permitted')),
    `4.1 POST /api/courier/steadfast/test with attacker baseUrl is rejected with HTTP 400 (status=${sfAttackerRes.status})`
  );

  // 4.2 Attempting Steadfast test with localhost / internal IP baseUrl
  const sfLocalRes = await fetch(`${serverBase}/api/courier/steadfast/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      apiKey: 'test-api-key-123',
      secretKey: 'test-secret-key-123',
      baseUrl: 'http://127.0.0.1:8080',
    }),
  });
  const sfLocalJson = await sfLocalRes.json().catch(() => ({}));

  assert(
    sfLocalRes.status === 400 &&
      sfLocalJson.success === false,
    `4.2 POST /api/courier/steadfast/test with 127.0.0.1 baseUrl is rejected with HTTP 400 (status=${sfLocalRes.status})`
  );

  // 4.3 Attempting Steadfast test with AWS metadata IP baseUrl
  const sfMetaRes = await fetch(`${serverBase}/api/courier/steadfast/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      apiKey: 'test-api-key-123',
      secretKey: 'test-secret-key-123',
      baseUrl: 'http://169.254.169.254/latest/meta-data',
    }),
  });
  const sfMetaJson = await sfMetaRes.json().catch(() => ({}));

  assert(
    sfMetaRes.status === 400 && sfMetaJson.success === false,
    `4.3 POST /api/courier/steadfast/test with metadata IP baseUrl is rejected with HTTP 400 (status=${sfMetaRes.status})`
  );

  // 4.4 Steadfast test without baseUrl uses official Packzy gateway
  const sfDefaultRes = await fetch(`${serverBase}/api/courier/steadfast/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      apiKey: 'mock-test-key-safe',
      secretKey: 'mock-test-secret-safe',
    }),
  });
  const sfDefaultJson = await sfDefaultRes.json().catch(() => ({}));

  // Should proceed to call official Steadfast gateway (which will return 400/401/error because mock keys are invalid, but NOT fail URL validation)
  assert(
    sfDefaultRes.status !== 500 && !sfDefaultJson.error?.includes('baseUrl'),
    `4.4 POST /api/courier/steadfast/test without baseUrl safely targets official gateway (status=${sfDefaultRes.status})`
  );

  // =========================================================================
  // 5. INTEGRATION TESTS: POST /api/courier/dispatch (Customer PII Protection)
  // =========================================================================
  console.log('\n--- 5. INTEGRATION: POST /api/courier/dispatch ---');

  const testOrder = {
    id: 'ord-test-ssrf-001',
    orderNumber: 'ORD-SSRF-001',
    customer: {
      fullName: 'VIP Customer Person',
      phone: '01711998877',
      district: 'Dhaka',
      fullAddress: 'House 1, Road 2, Gulshan 1, Dhaka',
    },
    items: [
      {
        product: { id: 'p1', title: 'Luxury Leather Wallet', price: 1500 },
        quantity: 1,
      },
    ],
    subtotal: 1500,
    deliveryFee: 80,
    totalAmount: 1580,
    paymentStatus: 'DUE',
    shippingStatus: 'Pending',
    createdAt: new Date().toISOString(),
  };

  // 5.1 Non-Steadfast courier dispatch with arbitrary attacker destination URL
  const dispatchAttackerRes = await fetch(`${serverBase}/api/courier/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      order: testOrder,
      courier: {
        code: 'CustomCourier',
        name: 'Attacker Courier Service',
        apiKey: 'attacker-courier-key',
        baseUrl: 'https://webhook.site/exfiltrate-customer-pii',
      },
    }),
  });
  const dispatchAttackerJson = await dispatchAttackerRes.json().catch(() => ({}));

  assert(
    dispatchAttackerRes.status === 400 &&
      dispatchAttackerJson.success === false &&
      (dispatchAttackerJson.error?.includes('authorized courier partner') || dispatchAttackerJson.error?.includes('prohibited') || dispatchAttackerJson.error?.includes('approved')),
    `5.1 POST /api/courier/dispatch with attacker URL is blocked from customer PII exfiltration (status=${dispatchAttackerRes.status})`
  );

  // 5.2 Non-Steadfast courier dispatch with localhost / internal destination
  const dispatchLocalRes = await fetch(`${serverBase}/api/courier/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      order: testOrder,
      courier: {
        code: 'CustomCourier',
        name: 'Local Probe',
        apiKey: 'key',
        baseUrl: 'http://127.0.0.1:3000/internal-api',
      },
    }),
  });
  const dispatchLocalJson = await dispatchLocalRes.json().catch(() => ({}));

  assert(
    dispatchLocalRes.status === 400 && dispatchLocalJson.success === false,
    `5.2 POST /api/courier/dispatch with localhost URL is blocked (status=${dispatchLocalRes.status})`
  );

  // 5.3 Steadfast courier dispatch with custom arbitrary baseUrl
  const dispatchSfBadRes = await fetch(`${serverBase}/api/courier/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      order: testOrder,
      courier: {
        code: 'Steadfast',
        name: 'Steadfast Courier',
        baseUrl: 'https://evil-steadfast-clone.com/api',
      },
    }),
  });
  const dispatchSfBadJson = await dispatchSfBadRes.json().catch(() => ({}));

  assert(
    dispatchSfBadRes.status === 400 &&
      dispatchSfBadJson.success === false &&
      (dispatchSfBadJson.error?.includes('authorized Steadfast API host') || dispatchSfBadJson.error?.includes('official') || dispatchSfBadJson.error?.includes('permitted')),
    `5.3 POST /api/courier/dispatch for Steadfast with unauthorized baseUrl is blocked (status=${dispatchSfBadRes.status})`
  );

  console.log('\n================================================================');
  console.log(`FINAL RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runCourierSsrfVerification().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
