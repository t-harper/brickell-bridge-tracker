import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// These are the fields Terraform's AWS provider supplies, not AWS calls.
const environment = [{ variables: {
  APNS_TEAM_ID: 'NBZC7TH45V', APNS_KEY_ID: '245Y298G7X',
  APNS_BUNDLE_ID: 'net.travis-harper.bridgetracker',
  APNS_KEY_PARAM_NAME: '/bridge-tracker/prod/apns/p8',
  CURRENT_TABLE: 'bridge-tracker-current-prod', DEVICES_TABLE: 'bridge-tracker-devices-prod',
  HISTORY_BUCKET: 'bridge-tracker-history-prod', AWS_ENDPOINT_URL: '', CORS_ORIGIN: '*',
} }];
const digest = 'a'.repeat(64);
const otherDigest = 'b'.repeat(64);

function plan() {
  const changes = ['api', 'poller'].map(name => {
    const before = {
      function_name: `bridge-tracker-${name}-prod`,
      arn: `arn:aws:lambda:us-east-1:831473839640:function:bridge-tracker-${name}-prod`,
      role: 'arn:aws:iam::831473839640:role/bridge-tracker-lambda-prod',
      runtime: 'nodejs20.x', architectures: ['arm64'], handler: 'handler.handler',
      memory_size: name === 'api' ? 256 : 128, timeout: name === 'api' ? 15 : 60,
      environment: structuredClone(environment), s3_bucket: 'bridge-tracker-artifacts-prod',
      s3_key: `${name}-${digest}.zip`, source_code_hash: 'old-base64-hash',
      last_modified: '2026-10-13T13:02:37.000+0000',
    };
    return { address: `aws_lambda_function.${name}`, mode: 'managed', type: 'aws_lambda_function', name,
      change: { actions: ['update'], before,
        after: { ...structuredClone(before), s3_key: `${name}-${otherDigest}.zip`, source_code_hash: 'new-base64-hash', last_modified: null },
        after_unknown: { last_modified: true } } };
  });
  for (const name of ['api', 'poller']) {
    const before = { bucket: 'bridge-tracker-artifacts-prod', key: `${name}-${digest}.zip`,
      source: `./../packages/${name}/bundle.zip`, etag: 'old-etag',
      arn: `arn:aws:s3:::bridge-tracker-artifacts-prod/${name}-${digest}.zip`, id: 'old-id',
      acl: null, tags: {}, tags_all: {}, metadata: {}, server_side_encryption: 'AES256', storage_class: 'STANDARD' };
    changes.push({ address: `aws_s3_object.${name}_zip`, mode: 'managed', type: 'aws_s3_object', name: `${name}_zip`,
      change: { actions: ['delete', 'create'], before,
        after: { ...before, key: `${name}-${otherDigest}.zip`, etag: 'new-etag', arn: null, id: null,
          acl: null, tags: null, metadata: null, server_side_encryption: null, storage_class: null },
        after_unknown: { arn: true, id: true, acl: true, server_side_encryption: true, storage_class: true } } });
  }
  const apns = { name: '/bridge-tracker/prod/apns/p8',
    arn: 'arn:aws:ssm:us-east-1:831473839640:parameter/bridge-tracker/prod/apns/p8',
    type: 'SecureString', value: 'do-not-print-test-key' };
  changes.push({ address: 'aws_ssm_parameter.apns[0]', mode: 'managed', type: 'aws_ssm_parameter', name: 'apns',
    change: { actions: ['no-op'], before: apns, after: apns, after_unknown: {} } });
  return { format_version: '1.2', terraform_version: '1.9.0', errored: false,
    variables: { env: { value: 'prod' }, aws_region: { value: 'us-east-1' }, floci: { value: false },
      apns_team_id: { value: 'NBZC7TH45V' }, apns_key_id: { value: '245Y298G7X' },
      apns_bundle_id: { value: 'net.travis-harper.bridgetracker' }, apns_p8_pem: { value: 'do-not-print-test-key' } },
    resource_changes: changes,
    configuration: { root_module: { resources: ['api', 'poller'].map(name => ({
      address: `aws_s3_object.${name}_zip`, mode: 'managed', type: 'aws_s3_object',
      expressions: { bucket: { references: ['aws_s3_bucket.artifacts.bucket'] },
        key: { references: [`local.${name}_zip`] }, source: { references: [`local.${name}_zip`] },
        etag: { references: [`local.${name}_zip`] } },
    })) } },
    planned_values: { outputs: { frontend_bucket: { type: 'string', value: 'bridge-tracker-frontend-prod' },
      cloudfront_distribution_id: { type: 'string', value: 'E1240X8164GSZ3' } } },
    output_changes: {},
  };
}

function validate(value, account = '831473839640') {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-plan-test-'));
  try {
    const file = join(dir, 'plan.json');
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return spawnSync(process.execPath, [new URL('./verify-production-plan.mjs', import.meta.url).pathname, file], {
      encoding: 'utf8', env: { ...process.env, AWS_ACCOUNT_ID: account },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('accepts scoped Lambda code and artifact replacements', () => {
  const result = validate(plan());
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const [name, mutate, message] of [
  ['missing APNs key', p => { p.variables.apns_p8_pem.value = ''; }, /APNs/],
  ['blank APNs key', p => { p.variables.apns_p8_pem.value = ' \n\t '; }, /APNs/],
  ['wrong AWS account', p => {}, /account/],
  ['wrong region', p => { p.variables.aws_region.value = 'us-west-2'; }, /region/],
  ['wrong workspace environment', p => { p.variables.env.value = 'local'; }, /prod/],
  ['Floci endpoint', p => { p.variables.floci.value = true; }, /Floci/],
  ['missing resource changes', p => { delete p.resource_changes; }, /resource/],
  ['missing APNs resource', p => { p.resource_changes.pop(); }, /APNs/],
  ['APNs deletion', p => { p.resource_changes.at(-1).change.actions = ['delete']; }, /managed change/],
  ['IAM update', p => { p.resource_changes.push({ address: 'aws_iam_role_policy.lambda', mode: 'managed', type: 'aws_iam_role_policy', change: { actions: ['update'], before: {}, after: { policy: 'changed' } } }); }, /managed change/],
  ['history bucket deletion', p => { p.resource_changes.push({ address: 'aws_s3_bucket.history', mode: 'managed', type: 'aws_s3_bucket', change: { actions: ['delete'], before: {}, after: null } }); }, /managed change/],
  ['Lambda environment removal', p => { delete p.resource_changes[0].change.after.environment[0].variables.APNS_KEY_ID; }, /environment/],
  ['Lambda function identity change', p => { p.resource_changes[0].change.after.function_name = 'other-function'; }, /function_name/],
  ['Lambda role change', p => { p.resource_changes[0].change.after.role += '-different'; }, /role/],
  ['Lambda timeout change', p => { p.resource_changes[0].change.after.timeout += 1; }, /timeout/],
  ['unknown Lambda environment', p => { p.resource_changes[0].change.after_unknown.environment = true; }, /environment/],
  ['unknown Lambda identity', p => { p.resource_changes[0].change.after_unknown.function_name = true; }, /function_name/],
  ['Lambda replacement', p => { p.resource_changes[0].change.actions = ['delete', 'create']; }, /Lambda/],
  ['wrong artifact bucket', p => { p.resource_changes[2].change.after.bucket = 'other-artifacts-prod'; }, /bucket/],
  ['wrong Lambda artifact key', p => { p.resource_changes[0].change.after.s3_key = `poller-${otherDigest}.zip`; }, /artifact/],
  ['normalized artifact key', p => { p.resource_changes[2].change.after.key = 'api-a//b.zip'; }, /artifact/],
  ['unknown artifact key', p => { p.resource_changes[2].change.after_unknown.key = true; }, /artifact/],
  ['artifact ACL change', p => { p.resource_changes[2].change.after.acl = 'public-read'; delete p.resource_changes[2].change.after_unknown.acl; }, /acl/],
  ['artifact source redirect', p => { p.resource_changes[2].change.after.source = './../packages/poller/bundle.zip'; }, /source/],
  ['configured unknown artifact ACL', p => { p.configuration.root_module.resources[0].expressions.acl = { references: ['var.artifact_acl'] }; }, /artifact configuration/],
  ['configured unknown artifact encryption', p => { p.configuration.root_module.resources[0].expressions.kms_key_id = { references: ['var.key_id'] }; }, /artifact configuration/],
  ['missing artifact configuration', p => { delete p.configuration; }, /artifact configuration/],
  ['redirected frontend output', p => { p.planned_values.outputs.frontend_bucket.value = 'bridge-tracker-history-prod'; }, /output/],
  ['redirected distribution output', p => { p.planned_values.outputs.cloudfront_distribution_id.value = 'EOTHER'; }, /output/],
  ['unknown frontend output', p => { delete p.planned_values.outputs.frontend_bucket.value; }, /output/],
  ['unexpected output change', p => { p.output_changes.other = { actions: ['update'], before: 'old', after: 'new' }; }, /output/],
  ['unknown output change', p => { p.output_changes.other = { actions: ['no-op'], before: 'old', after: 'old', after_unknown: true }; }, /output/],
  ['unknown managed action', p => { p.resource_changes[0].change.actions = ['forget']; }, /action/],
  ['errored plan', p => { p.errored = true; }, /errored/],
]) {
  test(`rejects ${name}`, () => {
    const p = plan(); mutate(p);
    const result = validate(p, name === 'wrong AWS account' ? '000000000000' : '831473839640');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, message);
    assert.ok(!(result.stdout + result.stderr).includes('do-not-print-test-key'));
  });
}

test('accepts a no-change production plan', () => {
  const p = plan();
  for (const r of p.resource_changes) { r.change.actions = ['no-op']; r.change.after = r.change.before; r.change.after_unknown = {}; }
  assert.equal(validate(p).status, 0);
});

test('accepts data source reads without permitting managed drift', () => {
  const p = plan(); p.resource_changes.push({ address: 'data.aws_iam_policy_document.lambda_inline', mode: 'data', type: 'aws_iam_policy_document', change: { actions: ['read'], before: null, after: {} } });
  assert.equal(validate(p).status, 0);
});

test('accepts only empty provider-computed artifact tags during replacement', () => {
  const p = plan();
  p.resource_changes[2].change.after.tags_all = null;
  p.resource_changes[2].change.after_unknown.tags_all = true;
  assert.equal(validate(p).status, 0);
  p.resource_changes[2].change.before.tags_all = { security: 'retained' };
  const result = validate(p); assert.equal(result.status, 1); assert.match(result.stderr, /tags_all/);
});

for (const field of ['cache_control', 'content_disposition', 'content_encoding', 'content_language',
  'website_redirect', 'object_lock_legal_hold_status', 'object_lock_mode', 'object_lock_retain_until_date']) {
  test(`accepts only the observed absent ${field} replacement default`, () => {
    for (const [label, before, after, unknown, actions, exit] of [
      ['absent replacement', '', null, false, ['delete', 'create'], 0],
      ['create-before-delete replacement', '', null, false, ['create', 'delete'], 0],
      ['nonempty removal', 'retained-setting', null, false, ['delete', 'create'], 1],
      ['nonempty introduction', '', 'new-setting', false, ['delete', 'create'], 1],
      ['whitespace removal', ' ', null, false, ['delete', 'create'], 1],
      ['unknown value', '', null, true, ['delete', 'create'], 1],
      ['in-place change', '', null, false, ['update'], 1],
    ]) {
      const p = plan(); const change = p.resource_changes[2].change;
      change.before[field] = before; change.after[field] = after;
      change.after_unknown[field] = unknown; change.actions = actions;
      const result = validate(p);
      assert.equal(result.status, exit, `${label}: ${result.stdout} ${result.stderr}`);
      if (exit !== 0) assert.match(result.stderr, new RegExp(field));
    }
    const configured = plan();
    configured.configuration.root_module.resources[0].expressions[field] = { constant_value: 'nonempty-setting' };
    configured.resource_changes[2].change.before[field] = 'nonempty-setting';
    configured.resource_changes[2].change.after[field] = 'nonempty-setting';
    const result = validate(configured); assert.equal(result.status, 1); assert.match(result.stderr, /artifact configuration/);
  });
}

test('does not normalize an unlisted optional artifact field', () => {
  const p = plan(); const change = p.resource_changes[2].change;
  change.before.unreviewed_option = ''; change.after.unreviewed_option = null;
  const result = validate(p); assert.equal(result.status, 1); assert.match(result.stderr, /unreviewed_option/);
});

test('fails closed on malformed JSON', () => {
  const result = validate('{'); assert.equal(result.status, 1); assert.match(result.stderr, /JSON/);
});

test('deploy applies the saved plan only after validating it', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /terraform plan[^\n]*-out=prod\.tfplan/);
  assert.match(workflow, /terraform show -json prod\.tfplan > prod-plan\.json/);
  const verify = workflow.indexOf('node ../scripts/verify-production-plan.mjs prod-plan.json');
  assert.ok(verify > 0);
  assert.ok(workflow.indexOf('terraform apply -no-color prod.tfplan') > verify);
  assert.doesNotMatch(workflow, /terraform apply[^\n]*-var-file/);
});

for (const workflowName of ['plan.yml', 'deploy.yml']) {
  test(`${workflowName} always cleans private plans and preserves unrelated files`, () => {
    const workflow = readFileSync(new URL(`../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
    const step = workflow.split('      - name: Remove private production plan files\n')[1]?.split(/\n      - (?:name:|uses:)/)[0];
    assert.ok(step, 'Private plan cleanup must be present');
    assert.match(step, /if: always\(\)/, 'Cleanup must run when validation or apply fails');
    const command = step.match(/^        run: (.*)$/m)?.[1]; assert.ok(command);
    const dir = mkdtempSync(join(tmpdir(), 'bridge-plan-cleanup-'));
    try {
      const result = spawnSync('bash', ['-e', '-c', 'mkdir infra'], { cwd: dir }); assert.equal(result.status, 0);
      for (const file of ['prod.tfplan', 'prod-plan.json', 'plan.txt', 'keep.txt']) writeFileSync(join(dir, 'infra', file), 'do-not-print-test-key');
      const cleanup = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', command], { cwd: dir, encoding: 'utf8' });
      assert.equal(cleanup.status, 0, cleanup.stderr);
      for (const file of ['prod.tfplan', 'prod-plan.json', 'plan.txt']) assert.throws(() => readFileSync(join(dir, 'infra', file)));
      assert.equal(readFileSync(join(dir, 'infra', 'keep.txt'), 'utf8'), 'do-not-print-test-key');
      assert.ok(!(cleanup.stdout + cleanup.stderr).includes('do-not-print-test-key'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
