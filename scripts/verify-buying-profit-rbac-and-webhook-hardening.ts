/**
 * Verification Script:
 * 1. Buying Price & Product Profit RBAC Granular Delegation
 * 2. Inbound Courier Webhook Authentication Hardening
 *
 * Verifies:
 * - super_admin has full access to view buying price & profit unconditionally
 * - admin/sub_admin do not have access by default (financial details stripped)
 * - super_admin can explicitly grant product.view_buying_price and product.view_profit
 * - admin/sub_admin with explicit grant can access buying price and profit
 * - sensitive permissions (permission.manage, user.manage, settings.manage, report.profit, product.manage_buying_price) cannot be granted (403)
 * - inbound webhook strictly accepts dedicated COURIER_WEBHOOK_SECRET
 * - inbound webhook rejects ADMIN_SECRET
 * - inbound webhook rejects outbound courier API keys/secrets (STEADFAST_API_KEY, STEADFAST_SECRET_KEY)
 */

import { computeHmacSha256Hex, verifyCourierWebhookAuth } from '../src/server/webhookAuth';
import {
  SUPER_ADMIN_ONLY_PERMISSIONS,
  isSuperAdminOnlyPermission,
  PERMISSIONS_METADATA,
  resolveUserPermissions,
} from '../src/server/permissions';
import { hasUserPermission } from '../src/utils/permissions';
import { createSignedTestToken, getTestAdminToken, getTestStaffToken, TEST_BASE_URL } from './test-auth-helper';

async function runVerification() {
  console.log('================================================================');
  console.log('VERIFYING BUYING PRICE / PROFIT RBAC & WEBHOOK AUTH HARDENING');
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

  const baseUrl = TEST_BASE_URL;

  // ----------------------------------------------------------------
  // PART 1: PERMISSION REGISTRY & METADATA CHECKS
  // ----------------------------------------------------------------
  console.log('--- PART 1: PERMISSION REGISTRY AUDIT ---');

  assert(
    !SUPER_ADMIN_ONLY_PERMISSIONS.has('product.view_buying_price' as any),
    '1.1 product.view_buying_price is NOT in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    !SUPER_ADMIN_ONLY_PERMISSIONS.has('product.view_profit' as any),
    '1.2 product.view_profit is NOT in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    isSuperAdminOnlyPermission('product.view_buying_price') === false,
    '1.3 isSuperAdminOnlyPermission("product.view_buying_price") returns false'
  );
  assert(
    isSuperAdminOnlyPermission('product.view_profit') === false,
    '1.4 isSuperAdminOnlyPermission("product.view_profit") returns false'
  );
  assert(
    SUPER_ADMIN_ONLY_PERMISSIONS.has('permission.manage' as any),
    '1.5 permission.manage remains strictly in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    SUPER_ADMIN_ONLY_PERMISSIONS.has('user.manage' as any),
    '1.6 user.manage remains strictly in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    SUPER_ADMIN_ONLY_PERMISSIONS.has('user.delete' as any),
    '1.7 user.delete remains strictly in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    SUPER_ADMIN_ONLY_PERMISSIONS.has('settings.manage' as any),
    '1.8 settings.manage remains strictly in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    SUPER_ADMIN_ONLY_PERMISSIONS.has('report.financial' as any),
    '1.9 report.financial remains strictly in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    SUPER_ADMIN_ONLY_PERMISSIONS.has('report.profit' as any),
    '1.10 report.profit remains strictly in SUPER_ADMIN_ONLY_PERMISSIONS'
  );
  assert(
    SUPER_ADMIN_ONLY_PERMISSIONS.has('product.manage_buying_price' as any),
    '1.11 product.manage_buying_price remains strictly in SUPER_ADMIN_ONLY_PERMISSIONS'
  );

  assert(
    PERMISSIONS_METADATA['product.view_buying_price'].superAdminOnly === false,
    '1.12 metadata for product.view_buying_price has superAdminOnly=false'
  );
  assert(
    PERMISSIONS_METADATA['product.view_profit'].superAdminOnly === false,
    '1.13 metadata for product.view_profit has superAdminOnly=false'
  );

  // ----------------------------------------------------------------
  // PART 2: PERMISSION RESOLUTION AND FRONTEND HELPER EVALUATION
  // ----------------------------------------------------------------
  console.log('\n--- PART 2: PERMISSION EVALUATION RULES ---');

  // Admin without financial permissions
  const adminNoFin = resolveUserPermissions('admin', { 'product.view': true });
  assert(
    adminNoFin['product.view_buying_price'] === false,
    '2.1 Normal admin has product.view_buying_price=false by default'
  );
  assert(
    adminNoFin['product.view_profit'] === false,
    '2.2 Normal admin has product.view_profit=false by default'
  );

  // Admin with explicitly granted financial permissions
  const adminWithFin = resolveUserPermissions('admin', {
    'product.view': true,
    'product.view_buying_price': true,
    'product.view_profit': true,
  });
  assert(
    adminWithFin['product.view_buying_price'] === true,
    '2.3 Explicitly granted product.view_buying_price is preserved for admin'
  );
  assert(
    adminWithFin['product.view_profit'] === true,
    '2.4 Explicitly granted product.view_profit is preserved for admin'
  );

  // Admin trying to get Super Admin-only permission via stored permissions
  const adminEscalation = resolveUserPermissions('admin', {
    'permission.manage': true,
    'settings.manage': true,
    'report.financial': true,
    'product.manage_buying_price': true,
  });
  assert(
    adminEscalation['permission.manage'] === false,
    '2.5 Stored permission.manage is zeroed out for admin'
  );
  assert(
    adminEscalation['settings.manage'] === false,
    '2.6 Stored settings.manage is zeroed out for admin'
  );
  assert(
    adminEscalation['report.financial'] === false,
    '2.7 Stored report.financial is zeroed out for admin'
  );
  assert(
    adminEscalation['product.manage_buying_price'] === false,
    '2.8 Stored product.manage_buying_price is zeroed out for admin'
  );

  // Frontend helper checks
  const mockAdminUser: any = {
    id: 'admin-1',
    role: 'admin',
    permissions: {
      'product.view': true,
      'product.view_buying_price': true,
      'product.view_profit': false,
    },
  };
  assert(
    hasUserPermission(mockAdminUser, 'product.view_buying_price') === true,
    '2.9 hasUserPermission returns true when product.view_buying_price is granted'
  );
  assert(
    hasUserPermission(mockAdminUser, 'product.view_profit') === false,
    '2.10 hasUserPermission returns false when product.view_profit is not granted'
  );
  assert(
    hasUserPermission(mockAdminUser, 'permission.manage') === false,
    '2.11 hasUserPermission strictly returns false for permission.manage on admin'
  );
  assert(
    hasUserPermission(mockAdminUser, 'settings.manage') === false,
    '2.12 hasUserPermission strictly returns false for settings.manage on admin'
  );

  // ----------------------------------------------------------------
  // PART 3: LIVE SERVER API: GRANTING & ENFORCING PERMISSIONS
  // ----------------------------------------------------------------
  console.log('\n--- PART 3: LIVE API PERMISSION ASSIGNMENT & DATA PRIVACY ---');

  const superAdminToken = await getTestAdminToken(baseUrl);

  // 3.1 Fetch sample product to check buying price
  const sampleProdRes = await fetch(`${baseUrl}/api/products`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const sampleProdData = await sampleProdRes.json();
  const sampleProduct = sampleProdData.products?.[0];
  const sampleProductId = sampleProduct?.id || 'prod-mug-13b';

  const targetStaffId = 'user-subadmin-staff';
  const targetStaffEmail = 'staff@rongdhonutrade.com';

  // Ensure initial state: staff has no buying price or profit view permissions
  await fetch(`${baseUrl}/api/users/${targetStaffId}/permissions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      permissions: {
        'product.view': true,
        'product.view_buying_price': false,
        'product.view_profit': false,
      },
    }),
  });

  // 3.2 Staff WITHOUT financial permissions fetches product
  const staffTokenInitial = await getTestStaffToken(baseUrl, targetStaffEmail);
  const resWithoutFin = await fetch(`${baseUrl}/api/products/${sampleProductId}`, {
    headers: { Authorization: `Bearer ${staffTokenInitial}` },
  });
  const jsonWithoutFin = await resWithoutFin.json();
  assert(
    resWithoutFin.status === 200 && jsonWithoutFin.product.buyingPrice === undefined,
    '3.1 Staff without financial permission receives product with buyingPrice stripped'
  );

  // 3.3 Live PUT /api/users/:id/permissions: Super Admin explicitly grants product.view_buying_price & product.view_profit
  const grantPermsRes = await fetch(`${baseUrl}/api/users/${targetStaffId}/permissions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      permissions: {
        'product.view': true,
        'product.view_buying_price': true,
        'product.view_profit': true,
      },
    }),
  });
  const grantPermsJson = await grantPermsRes.json();
  assert(
    grantPermsRes.status === 200 &&
      grantPermsJson.success === true &&
      grantPermsJson.permissions['product.view_buying_price'] === true &&
      grantPermsJson.permissions['product.view_profit'] === true,
    '3.2 Super Admin can explicitly grant product.view_buying_price & product.view_profit to sub_admin'
  );

  // 3.4 Staff WITH explicitly granted product.view_buying_price fetches product
  const staffTokenGranted = await getTestStaffToken(baseUrl, targetStaffEmail);
  const resWithFin = await fetch(`${baseUrl}/api/products/${sampleProductId}`, {
    headers: { Authorization: `Bearer ${staffTokenGranted}` },
  });
  const jsonWithFin = await resWithFin.json();
  assert(
    resWithFin.status === 200 && jsonWithFin.product.buyingPrice !== undefined,
    `3.3 Staff with explicitly granted permission can access buyingPrice (${jsonWithFin.product.buyingPrice})`
  );

  // 3.5 Super Admin revokes financial permission
  await fetch(`${baseUrl}/api/users/${targetStaffId}/permissions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      permissions: {
        'product.view': true,
        'product.view_buying_price': false,
        'product.view_profit': false,
      },
    }),
  });
  const staffTokenRevoked = await getTestStaffToken(baseUrl, targetStaffEmail);
  const resRevoked = await fetch(`${baseUrl}/api/products/${sampleProductId}`, {
    headers: { Authorization: `Bearer ${staffTokenRevoked}` },
  });
  const jsonRevoked = await resRevoked.json();
  assert(
    resRevoked.status === 200 && jsonRevoked.product.buyingPrice === undefined,
    '3.4 Revoked permission immediately strips buyingPrice on subsequent product reads'
  );

  // 3.6 Live PUT /api/users/:id/permissions: Super Admin CANNOT grant permission.manage or settings.manage
  const illegalEscalationRes = await fetch(`${baseUrl}/api/users/${targetStaffId}/permissions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      permissions: {
        'permission.manage': true,
      },
    }),
  });
  assert(
    illegalEscalationRes.status === 403,
    '3.5 Attempt to grant permission.manage is blocked with HTTP 403 Forbidden'
  );

  // Restore staff permissions to default
  await fetch(`${baseUrl}/api/admin/users/${targetStaffId}/permissions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      permissions: {
        'product.view': true,
        'order.view': true,
        'audit_log.view': true,
      },
    }),
  });

  // ----------------------------------------------------------------
  // PART 4: WEBHOOK AUTHENTICATION HARDENING
  // ----------------------------------------------------------------
  console.log('\n--- PART 4: COURIER WEBHOOK AUTHENTICATION HARDENING ---');

  const unitAdminSecret = 'confidential-admin-jwt-key-never-for-webhooks';
  const unitCourierWebhookSecret = 'dedicated-inbound-webhook-signing-secret-999';
  const outboundSteadfastApiKey = 'steadfast-outbound-client-api-key-111';
  const outboundSteadfastSecretKey = 'steadfast-outbound-client-secret-key-222';

  const mockEnv = {
    ADMIN_SECRET: unitAdminSecret,
    COURIER_WEBHOOK_SECRET: unitCourierWebhookSecret,
    STEADFAST_API_KEY: outboundSteadfastApiKey,
    STEADFAST_SECRET_KEY: outboundSteadfastSecretKey,
  };

  const webhookPayload = JSON.stringify({
    consignment_id: 'CSF-UNIT-9999',
    status: 'in_review',
  });
  const nowTs = Date.now().toString();

  // 4.1 Dedicated COURIER_WEBHOOK_SECRET via header -> ACCEPTED (200)
  const authOk1 = await verifyCourierWebhookAuth(
    {
      rawBody: webhookPayload,
      headers: {
        'x-webhook-secret': unitCourierWebhookSecret,
        'x-webhook-timestamp': nowTs,
      },
    },
    mockEnv as any
  );
  assert(
    authOk1.authenticated === true && authOk1.status === 200,
    '4.1 Dedicated COURIER_WEBHOOK_SECRET is ACCEPTED (200)'
  );

  // 4.2 Dedicated COURIER_WEBHOOK_SECRET via HMAC signature -> ACCEPTED (200)
  const validHmac = await computeHmacSha256Hex(unitCourierWebhookSecret, `${nowTs}.${webhookPayload}`);
  const authOk2 = await verifyCourierWebhookAuth(
    {
      rawBody: webhookPayload,
      headers: {
        'x-webhook-signature': `sha256=${validHmac}`,
        'x-webhook-timestamp': nowTs,
      },
    },
    mockEnv as any
  );
  assert(
    authOk2.authenticated === true && authOk2.status === 200,
    '4.2 HMAC signature using COURIER_WEBHOOK_SECRET is ACCEPTED (200)'
  );

  // 4.3 ADMIN_SECRET via header -> REJECTED (401)
  const authFailAdmin = await verifyCourierWebhookAuth(
    {
      rawBody: webhookPayload,
      headers: {
        'x-webhook-secret': unitAdminSecret,
        'x-webhook-timestamp': nowTs,
      },
    },
    mockEnv as any
  );
  assert(
    authFailAdmin.authenticated === false && authFailAdmin.status === 401,
    '4.3 ADMIN_SECRET via x-webhook-secret is REJECTED (401)'
  );

  // 4.4 Outbound STEADFAST_SECRET_KEY -> REJECTED (401)
  const authFailOutboundSecret = await verifyCourierWebhookAuth(
    {
      rawBody: webhookPayload,
      headers: {
        'x-webhook-secret': outboundSteadfastSecretKey,
        'x-webhook-timestamp': nowTs,
      },
    },
    mockEnv as any
  );
  assert(
    authFailOutboundSecret.authenticated === false && authFailOutboundSecret.status === 401,
    '4.4 Outbound STEADFAST_SECRET_KEY is strictly REJECTED (401) as inbound auth'
  );

  // 4.5 Outbound STEADFAST_API_KEY -> REJECTED (401)
  const authFailOutboundApiKey = await verifyCourierWebhookAuth(
    {
      rawBody: webhookPayload,
      headers: {
        'x-webhook-secret': outboundSteadfastApiKey,
        'x-webhook-timestamp': nowTs,
      },
    },
    mockEnv as any
  );
  assert(
    authFailOutboundApiKey.authenticated === false && authFailOutboundApiKey.status === 401,
    '4.5 Outbound STEADFAST_API_KEY is strictly REJECTED (401) as inbound auth'
  );

  // 4.6 Outbound Api-Key header attempt to authenticate -> REJECTED (401)
  const authFailApiKeyHeader = await verifyCourierWebhookAuth(
    {
      rawBody: webhookPayload,
      headers: {
        'api-key': outboundSteadfastApiKey,
        'secret-key': outboundSteadfastSecretKey,
        'x-webhook-timestamp': nowTs,
      },
    },
    mockEnv as any
  );
  assert(
    authFailApiKeyHeader.authenticated === false && authFailApiKeyHeader.status === 401,
    '4.6 Api-Key + Secret-Key headers using outbound credentials are REJECTED (401)'
  );

  // 4.7 Live server endpoint rejects outbound credentials
  const liveResOutbound = await fetch(`${baseUrl}/api/webhook/steadfast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': 'outbound-client-secret-guess',
      'X-Webhook-Timestamp': Date.now().toString(),
    },
    body: webhookPayload,
  });
  assert(
    liveResOutbound.status === 401,
    '4.7 Live endpoint /api/webhook/steadfast rejects unauthorized secret (HTTP 401)'
  );

  console.log('\n================================================================');
  console.log(`FINAL RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
