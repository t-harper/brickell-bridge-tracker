import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkTestflightReadiness,
  createToken,
  readConfiguration,
} from './testflight-preflight.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const env = {
  ASC_API_KEY_ID: 'TESTKEY123',
  ASC_API_ISSUER_ID: '11111111-2222-3333-4444-555555555555',
  ASC_API_KEY_P8: privateKey,
  APPLE_APP_ID: '6772673772',
};
const success = () => new Response(JSON.stringify({
  data: {
    type: 'apps',
    id: env.APPLE_APP_ID,
    attributes: { bundleId: 'net.travis-harper.bridgetracker' },
  },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });
const bodySecret = 'PRIVATE_RESPONSE_SENTINEL';

function expectSafeError(code, pattern) {
  return (error) => {
    assert.equal(error.code, code);
    assert.match(error.message, pattern);
    assert.ok(error.message.length < 500);
    assert.ok(!error.message.includes(bodySecret));
    assert.ok(!error.message.includes(env.ASC_API_KEY_P8));
    assert.ok(!error.message.includes(env.ASC_API_KEY_ID));
    return true;
  };
}

test('JWT is signed with the configured P-256 private key and valid ASC claims', () => {
  const token = createToken(readConfiguration(env), 1_800_000_000);
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  assert.equal(token.split('.').length, 3);
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, 'base64url')), {
    alg: 'ES256', kid: env.ASC_API_KEY_ID, typ: 'JWT',
  });
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url'));
  assert.equal(payload.iss, env.ASC_API_ISSUER_ID);
  assert.equal(payload.aud, 'appstoreconnect-v1');
  assert.equal(payload.iat, 1_800_000_000);
  assert.ok(payload.exp > payload.iat);
  assert.ok(payload.exp - payload.iat <= 1_200);
  assert.equal(Buffer.from(encodedSignature, 'base64url').length, 64);
  assert.ok(verify('sha256', Buffer.from(encodedHeader + '.' + encodedPayload), {
    key: publicKey, dsaEncoding: 'ieee-p1363',
  }, Buffer.from(encodedSignature, 'base64url')));
});

test('preflight performs one authenticated GET for the exact configured app', async () => {
  const requests = [];
  const result = await checkTestflightReadiness({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return success();
    },
  });
  assert.deepEqual(result, {
    appId: env.APPLE_APP_ID,
    bundleId: 'net.travis-harper.bridgetracker',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.appstoreconnect.apple.com/v1/apps/6772673772');
  assert.equal(requests[0].options.method, 'GET');
  assert.match(requests[0].options.headers.Authorization, /^Bearer [A-Za-z0-9_.-]+$/);
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test('agreement rejection stops after one request and directs the account holder to Apple', async () => {
  let attempts = 0;
  await assert.rejects(checkTestflightReadiness({
    env,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ errors: [
        { code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED', detail: bodySecret },
      ] }), { status: 403 });
    },
  }), (error) => {
    expectSafeError('ACCOUNT_AGREEMENTS', /account holder/i)(error);
    assert.match(error.message, /https:\/\/appstoreconnect\.apple\.com\/business/);
    assert.match(error.message, /https:\/\/developer\.apple\.com\/account\//);
    assert.doesNotMatch(error.message, /new key|replace|rotate|credential change/i);
    return true;
  });
  assert.equal(attempts, 1);
});

for (const [status, code, pattern] of [
  [401, 'AUTHENTICATION', /authentication.*HTTP 401/i],
  [403, 'AUTHORIZATION', /access.*HTTP 403/i],
  [404, 'APP_NOT_FOUND', /app.*HTTP 404/i],
  [429, 'HTTP', /HTTP 429/],
  [500, 'HTTP', /HTTP 500/],
]) {
  test('HTTP ' + status + ' produces a distinct safe failure without a retry', async () => {
    let attempts = 0;
    await assert.rejects(checkTestflightReadiness({
      env,
      fetchImpl: async () => {
        attempts += 1;
        return new Response(JSON.stringify({
          errors: [{ code: bodySecret, detail: bodySecret }],
        }), { status });
      },
    }), expectSafeError(code, pattern));
    assert.equal(attempts, 1);
  });
}

test('network errors do not expose thrown dependency messages or retry', async () => {
  let attempts = 0;
  await assert.rejects(checkTestflightReadiness({
    env,
    fetchImpl: async () => {
      attempts += 1;
      throw new Error(bodySecret + env.ASC_API_KEY_P8);
    },
  }), expectSafeError('NETWORK', /network/i));
  assert.equal(attempts, 1);
});

test('request deadline aborts a stalled HTTP request', async () => {
  let requestSignal;
  await assert.rejects(checkTestflightReadiness({
    env,
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error(bodySecret)), { once: true });
      });
    },
  }), expectSafeError('TIMEOUT', /timed out/i));
  assert.equal(requestSignal.aborted, true);
});

test('request deadline also bounds reading the response body', async () => {
  await assert.rejects(checkTestflightReadiness({
    env,
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error(bodySecret)), { once: true });
      }),
    }),
  }), expectSafeError('TIMEOUT', /timed out/i));
});

test('a different bundle ID cannot pass preflight', async () => {
  await assert.rejects(checkTestflightReadiness({
    env,
    fetchImpl: async () => new Response(JSON.stringify({
      data: { type: 'apps', id: env.APPLE_APP_ID, attributes: { bundleId: bodySecret } },
    }), { status: 200 }),
  }), expectSafeError('APP_MISMATCH', /expected.*net\.travis-harper\.bridgetracker/i));
});

test('a response for another app ID cannot pass preflight', async () => {
  await assert.rejects(checkTestflightReadiness({
    env,
    fetchImpl: async () => new Response(JSON.stringify({
      data: { type: 'apps', id: '123', attributes: { bundleId: 'net.travis-harper.bridgetracker' } },
    }), { status: 200 }),
  }), expectSafeError('APP_MISMATCH', /configured app/i));
});

test('malformed response JSON produces a safe response error', async () => {
  await assert.rejects(checkTestflightReadiness({
    env,
    fetchImpl: async () => new Response(bodySecret, { status: 200 }),
  }), expectSafeError('RESPONSE', /response/i));
});

test('missing configuration fails before performing HTTP', async () => {
  for (const name of Object.keys(env)) {
    const incomplete = { ...env };
    delete incomplete[name];
    let requested = false;
    await assert.rejects(checkTestflightReadiness({
      env: incomplete,
      fetchImpl: async () => { requested = true; return success(); },
    }), expectSafeError('CONFIGURATION', new RegExp(name)));
    assert.equal(requested, false);
  }
});

test('non-numeric app ID fails before creating any request', async () => {
  let requested = false;
  await assert.rejects(checkTestflightReadiness({
    env: { ...env, APPLE_APP_ID: '../apps?secret=' + bodySecret },
    fetchImpl: async () => { requested = true; return success(); },
  }), expectSafeError('CONFIGURATION', /APPLE_APP_ID/));
  assert.equal(requested, false);
});

test('invalid signing key fails safely before performing HTTP', async () => {
  let requested = false;
  await assert.rejects(checkTestflightReadiness({
    env: { ...env, ASC_API_KEY_P8: bodySecret },
    fetchImpl: async () => { requested = true; return success(); },
  }), expectSafeError('CONFIGURATION', /P-256.*private key/i));
  assert.equal(requested, false);
});

test('a non-P-256 key cannot masquerade as ES256', () => {
  const { privateKey: wrongKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp384r1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  assert.throws(() => createToken(readConfiguration({
    ...env, ASC_API_KEY_P8: wrongKey,
  })), expectSafeError('CONFIGURATION', /P-256.*private key/i));
});

test('CLI exits nonzero with a safe configuration message when secrets are missing', () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./testflight-preflight.mjs', import.meta.url)),
  ], { env: {}, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /configuration.*missing/i);
  assert.doesNotMatch(result.stderr, /at |BEGIN PRIVATE KEY|Error:/);
});