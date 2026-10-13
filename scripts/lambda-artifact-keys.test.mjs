import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../infra/lambda.tf', import.meta.url), 'utf8');
let payload;
for (let i = 0; ; i++) {
  payload = Buffer.from(`bridge-artifact-key-fixture-${i}`);
  if (createHash('sha256').update(payload).digest('base64').includes('//')) break;
}
for (const name of ['api', 'poller']) {
  test(`${name} artifact key cannot be normalized into a different S3 key`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'bridge-artifact-key-test-'));
    try {
      const artifact = join(directory, 'bundle.zip');
      writeFileSync(artifact, payload);
      writeFileSync(join(directory, 'main.tf'), `locals {\n  api_zip = ${JSON.stringify(artifact)}\n  poller_zip = ${JSON.stringify(artifact)}\n}\n`);
      const expression = source.split(`resource "aws_s3_object" "${name}_zip" {`)[1].split('\n}')[0].match(/^  key\s*=\s*(.*)$/m)[1];
      const result = spawnSync(process.env.TERRAFORM_BINARY || 'terraform', ['console'], {
        cwd: directory, input: `${expression}\n`, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const key = JSON.parse(result.stdout.trim());
      assert.match(key, new RegExp(`^${name}-[0-9a-f]{64}\\.zip$`),
        'Content-addressed artifact keys must use path-safe hex, even when base64 has //');
      assert.equal(key, `${name}-${createHash('sha256').update(payload).digest('hex')}.zip`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
