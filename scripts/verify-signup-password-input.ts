import assert from 'assert';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:3000';

async function runVerification() {
  console.log('--- STARTING SIGN UP PASSWORD INPUT VERIFICATION ---');

  // STEP 1: Static Code Inspection of AuthModal.tsx
  console.log('\n[1] Inspecting AuthModal.tsx component code:');
  const authModalPath = path.resolve(process.cwd(), 'src/components/AuthModal.tsx');
  const authModalContent = fs.readFileSync(authModalPath, 'utf-8');

  // Verify minLength={8} and maxLength={128} on password input
  assert(authModalContent.includes('id="signup-password-input"'), 'Must have #signup-password-input');
  assert(authModalContent.includes('id="signup-confirm-password-input"'), 'Must have #signup-confirm-password-input');

  // Verify HTML minLength is 8, not 10
  const passwordInputBlock = authModalContent.slice(
    authModalContent.indexOf('id="signup-password-input"'),
    authModalContent.indexOf('id="signup-password-input"') + 400
  );
  console.log('signup-password-input attributes snippet:\n', passwordInputBlock);

  assert(passwordInputBlock.includes('minLength={8}'), 'Password input MUST have minLength={8}');
  assert(!passwordInputBlock.includes('minLength={10}'), 'Password input MUST NOT have minLength={10}');
  assert(passwordInputBlock.includes('maxLength={128}'), 'Password input MUST have maxLength={128}');

  // Verify confirm password input
  const confirmInputBlock = authModalContent.slice(
    authModalContent.indexOf('id="signup-confirm-password-input"'),
    authModalContent.indexOf('id="signup-confirm-password-input"') + 400
  );
  assert(confirmInputBlock.includes('minLength={8}'), 'Confirm password input MUST have minLength={8}');
  assert(confirmInputBlock.includes('maxLength={128}'), 'Confirm password input MUST have maxLength={128}');

  // Verify no UI text says "10 characters" in AuthModal.tsx
  assert(!authModalContent.includes('10 characters'), 'AuthModal.tsx MUST NOT mention 10 characters');
  assert(!authModalContent.includes('min 10'), 'AuthModal.tsx MUST NOT mention min 10');

  // Verify UI text/placeholder mentions "min 8 characters"
  assert(authModalContent.includes('min 8 characters'), 'AuthModal.tsx helper text must specify min 8 characters');

  // Verify React/form validation in handleRegister
  assert(authModalContent.includes('trimmedPass.length < 8'), 'handleRegister must check trimmedPass.length < 8');
  assert(authModalContent.includes('trimmedPass.length > 128'), 'handleRegister must check trimmedPass.length > 128');

  console.log('✅ AuthModal.tsx code inspection PASSED:');
  console.log('   - HTML minLength = 8, maxLength = 128');
  console.log('   - Helper text = "min 8 characters"');
  console.log('   - React form validation checks length < 8 and length > 128');

  // STEP 2: Functional API Tests (Sign Up behavior)
  console.log('\n[2] Testing Registration Form Behavior against backend:');

  // Test 1: Password = 1234567 (7 characters) -> Expected = rejected
  console.log('\n--> Test 1: Password = "1234567" (7 characters)');
  const res1 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test 7 Chars',
      email: `test7chars-${Date.now()}@example.com`,
      password: '1234567',
    }),
  });
  const data1 = await res1.json();
  console.log('Response status:', res1.status, 'Error:', data1.error);
  assert.strictEqual(res1.status, 400, 'Test 1: 7-character password must return 400');
  assert.strictEqual(data1.success, false, 'Test 1: 7-character password must fail');
  console.log('✅ Test 1 PASSED: Password = "1234567" was REJECTED');

  // Test 2: Password = 12345678 (8 characters) -> Expected = accepted
  console.log('\n--> Test 2: Password = "12345678" (8 characters)');
  const res2 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test 8 Chars',
      email: `test8chars-${Date.now()}@example.com`,
      password: '12345678',
    }),
  });
  const data2 = await res2.json();
  console.log('Response status:', res2.status, 'Success:', data2.success);
  assert.strictEqual(res2.status, 201, 'Test 2: Exactly 8-character password must return 201');
  assert.strictEqual(data2.success, true, 'Test 2: Exactly 8-character password must succeed');
  console.log('✅ Test 2 PASSED: Password = "12345678" was ACCEPTED');

  // Test 3: Password = 123456789 (9 characters) -> Expected = accepted
  console.log('\n--> Test 3: Password = "123456789" (9 characters)');
  const res3 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test 9 Chars',
      email: `test9chars-${Date.now()}@example.com`,
      password: '123456789',
    }),
  });
  const data3 = await res3.json();
  console.log('Response status:', res3.status, 'Success:', data3.success);
  assert.strictEqual(res3.status, 201, 'Test 3: 9-character password must return 201');
  assert.strictEqual(data3.success, true, 'Test 3: 9-character password must succeed');
  console.log('✅ Test 3 PASSED: Password = "123456789" was ACCEPTED');

  // Test 4: Password = 128 characters -> Expected = accepted
  console.log('\n--> Test 4: Password = 128 characters');
  const pass128 = 'A'.repeat(128);
  const res4 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test 128 Chars',
      email: `test128chars-${Date.now()}@example.com`,
      password: pass128,
    }),
  });
  const data4 = await res4.json();
  console.log('Response status:', res4.status, 'Success:', data4.success);
  assert.strictEqual(res4.status, 201, 'Test 4: 128-character password must return 201');
  assert.strictEqual(data4.success, true, 'Test 4: 128-character password must succeed');
  console.log('✅ Test 4 PASSED: Password = 128 characters was ACCEPTED');

  // Test 5: Password = 129 characters -> Expected = rejected
  console.log('\n--> Test 5: Password = 129 characters');
  const pass129 = 'B'.repeat(129);
  const res5 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test 129 Chars',
      email: `test129chars-${Date.now()}@example.com`,
      password: pass129,
    }),
  });
  const data5 = await res5.json();
  console.log('Response status:', res5.status, 'Error:', data5.error);
  assert.strictEqual(res5.status, 400, 'Test 5: 129-character password must return 400');
  assert.strictEqual(data5.success, false, 'Test 5: 129-character password must fail');
  console.log('✅ Test 5 PASSED: Password = 129 characters was REJECTED');

  console.log('\n🎉 ALL 5 TESTS PASSED SUCCESSFULLY! 🎉');
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
