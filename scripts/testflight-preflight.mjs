#!/usr/bin/env node
import { createPrivateKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const EXPECTED_BUNDLE_ID = 'net.travis-harper.bridgetracker';
const REQUIRED_ENV = [
  'ASC_API_KEY_ID',
  'ASC_API_ISSUER_ID',
  'ASC_API_KEY_P8',
  'APPLE_APP_ID',
];

export class TestflightPreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TestflightPreflightError';
    this.code = code;
  }
}

export function readConfiguration(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) =>
    typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) {
    throw new TestflightPreflightError('CONFIGURATION',
      'TestFlight preflight configuration is missing: ' + missing.join(', ') + '.');
  }
  const appId = env.APPLE_APP_ID.trim();
  if (!/^\d+$/.test(appId)) {
    throw new TestflightPreflightError('CONFIGURATION',
      'TestFlight preflight configuration APPLE_APP_ID must contain only digits.');
  }
  return {
    keyId: env.ASC_API_KEY_ID.trim(),
    issuerId: env.ASC_API_ISSUER_ID.trim(),
    privateKey: env.ASC_API_KEY_P8,
    appId,
  };
}

export function createToken(config, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    const key = createPrivateKey(config.privateKey);
    if (key.asymmetricKeyType !== 'ec' ||
        key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('Unsupported signing key');
    }
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'ES256', kid: config.keyId, typ: 'JWT' });
    const payload = encode({
      iss: config.issuerId,
      iat: nowSeconds,
      exp: nowSeconds + 600,
      aud: 'appstoreconnect-v1',
    });
    const input = header + '.' + payload;
    const signature = sign('sha256', Buffer.from(input), {
      key, dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    return input + '.' + signature;
  } catch {
    throw new TestflightPreflightError('CONFIGURATION',
      'TestFlight preflight requires a valid P-256 App Store Connect private key.');
  }
}

function httpError(status, payload) {
  if (status === 403 && Array.isArray(payload?.errors) &&
      payload.errors.some((error) =>
        error?.code === 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED')) {
    return new TestflightPreflightError('ACCOUNT_AGREEMENTS',
      'Apple blocked App Store Connect access because required agreements are missing or expired (HTTP 403). ' +
      'The account holder should review https://appstoreconnect.apple.com/business and https://developer.apple.com/account/.');
  }
  if (status === 401) {
    return new TestflightPreflightError('AUTHENTICATION',
      'App Store Connect rejected authentication (HTTP 401).');
  }
  if (status === 403) {
    return new TestflightPreflightError('AUTHORIZATION',
      'App Store Connect denied access to the configured app (HTTP 403).');
  }
  if (status === 404) {
    return new TestflightPreflightError('APP_NOT_FOUND',
      'App Store Connect did not find the configured app (HTTP 404).');
  }
  return new TestflightPreflightError('HTTP',
    'App Store Connect preflight failed (HTTP ' + status + ').');
}

export async function checkTestflightReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
} = {}) {
  const config = readConfiguration(env);
  const token = createToken(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      'https://api.appstoreconnect.apple.com/v1/apps/' + config.appId,
      {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
      },
    );
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (response.ok) {
        throw new TestflightPreflightError('RESPONSE',
          'App Store Connect returned an unreadable app response.');
      }
    }
    if (!response.ok) throw httpError(response.status, payload);
    if (payload?.data?.id !== config.appId) {
      throw new TestflightPreflightError('APP_MISMATCH',
        'App Store Connect returned a response that does not match the configured app.');
    }
    if (payload?.data?.attributes?.bundleId !== EXPECTED_BUNDLE_ID) {
      throw new TestflightPreflightError('APP_MISMATCH',
        'App Store Connect app does not have the expected bundle ID ' + EXPECTED_BUNDLE_ID + '.');
    }
    return { appId: config.appId, bundleId: EXPECTED_BUNDLE_ID };
  } catch (error) {
    if (error instanceof TestflightPreflightError) throw error;
    if (controller.signal.aborted) {
      throw new TestflightPreflightError('TIMEOUT',
        'App Store Connect preflight timed out.');
    }
    throw new TestflightPreflightError('NETWORK',
      'App Store Connect preflight could not complete the network request.');
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkTestflightReadiness().then(({ appId, bundleId }) => {
    console.log('App Store Connect preflight passed for app ' + appId + ' (' + bundleId + ').');
  }).catch((error) => {
    console.error(error instanceof TestflightPreflightError
      ? error.message
      : 'TestFlight preflight failed unexpectedly.');
    process.exitCode = 1;
  });
}