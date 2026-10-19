#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const account = '831473839640';
const region = 'us-east-1';
const artifactBucket = 'bridge-tracker-artifacts-prod';
const apns = { APNS_TEAM_ID: 'NBZC7TH45V', APNS_KEY_ID: '245Y298G7X',
  APNS_BUNDLE_ID: 'net.travis-harper.bridgetracker', APNS_KEY_PARAM_NAME: '/bridge-tracker/prod/apns/p8' };
const codeFields = new Set(['s3_key', 'source_code_hash', 'last_modified', 'code_sha256',
  'code_size', 'version', 'qualified_arn', 'qualified_invoke_arn', 'signing_job_arn', 'signing_profile_version_arn']);
const artifactComputed = new Set(['arn', 'id', 'acl', 'bucket_key_enabled', 'checksum_crc32',
  'checksum_crc32c', 'checksum_crc64nvme', 'checksum_sha1', 'checksum_sha256', 'content_type',
  'kms_key_id', 'server_side_encryption', 'storage_class', 'version_id']);
function reject(message) { throw new Error(message); }
function requireKnown(change, field, expected, label = field) {
  if (hasUnknown(change.after_unknown?.[field]) || !isDeepStrictEqual(change.after?.[field], expected)) reject(`Unsafe ${label}`);
}
function hasUnknown(value) {
  if (value === true) return true;
  return value !== null && typeof value === 'object' && Object.values(value).some(hasUnknown);
}
function artifactKey(value, name) { return typeof value === 'string' && new RegExp(`^${name}-[a-f0-9]{64}\\.zip$`).test(value); }
function validateLambda(resource, name) {
  const c = resource.change;
  if (!['no-op', 'update'].includes(c.actions.join(','))) reject(`Unsafe Lambda action: ${resource.address}`);
  requireKnown(c, 'function_name', `bridge-tracker-${name}-prod`);
  requireKnown(c, 'arn', `arn:aws:lambda:${region}:${account}:function:bridge-tracker-${name}-prod`);
  requireKnown(c, 'role', `arn:aws:iam::${account}:role/bridge-tracker-lambda-prod`);
  requireKnown(c, 'runtime', 'nodejs20.x');
  requireKnown(c, 'architectures', ['arm64']);
  requireKnown(c, 'handler', 'handler.handler');
  requireKnown(c, 's3_bucket', artifactBucket, 'artifact bucket');
  if (hasUnknown(c.after_unknown?.s3_key) || !artifactKey(c.after?.s3_key, name)) reject('Unsafe Lambda artifact key');
  const env = c.after?.environment?.[0]?.variables;
  if (hasUnknown(c.after_unknown?.environment) || !env || Object.entries(apns).some(([k, v]) => env[k] !== v)) reject('Unsafe Lambda environment/APNs configuration');
  if (!c.before || !isDeepStrictEqual(c.before.environment, c.after.environment)) reject('Unsafe Lambda environment change');
  for (const field of new Set([...Object.keys(c.before), ...Object.keys(c.after), ...Object.keys(c.after_unknown ?? {})])) {
    if (!codeFields.has(field) && (hasUnknown(c.after_unknown?.[field]) || !isDeepStrictEqual(c.before[field], c.after[field]))) reject(`Unsafe Lambda ${field} change`);
  }
}
function validateArtifact(resource, name, plan) {
  const c = resource.change;
  if (!['no-op', 'update', 'create', 'delete,create', 'create,delete'].includes(c.actions.join(','))) reject(`Unsafe artifact action: ${resource.address}`);
  const configuration = plan.configuration?.root_module?.resources?.find(r => r.address === resource.address);
  const expressions = configuration?.expressions;
  if (!expressions || Object.keys(expressions).sort().join(',') !== 'bucket,etag,key,source') reject('Unexpected artifact configuration');
  requireKnown(c, 'bucket', artifactBucket, 'artifact bucket');
  if (hasUnknown(c.after_unknown?.key) || !artifactKey(c.after?.key, name)) reject('Unsafe artifact key');
  requireKnown(c, 'source', `./../packages/${name}/bundle.zip`, 'artifact source');
  if (c.before && (c.before.bucket !== artifactBucket || !artifactKey(c.before.key, name))) reject('Unsafe previous artifact identity');
  for (const field of new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after), ...Object.keys(c.after_unknown ?? {})])) {
    if (['key', 'etag', 'source_hash'].includes(field)) continue;
    if (artifactComputed.has(field) && c.after_unknown?.[field] === true && c.after[field] == null) continue;
    // Provider defaults use null and empty maps interchangeably on replacement.
    const before = c.before?.[field]; const after = c.after[field];
    const emptyMap = value => value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
    if (field === 'tags_all' && emptyMap(before) && after == null && c.after_unknown?.[field] === true) continue;
    if (['tags', 'tags_all', 'metadata'].includes(field) && emptyMap(before) && emptyMap(after) && !hasUnknown(c.after_unknown?.[field])) continue;
    if (hasUnknown(c.after_unknown?.[field]) || (c.before && !isDeepStrictEqual(before, after))) reject(`Unsafe artifact ${field} change`);
    if (!c.before && !['bucket', 'key', 'source', 'etag'].includes(field) && after != null) reject(`Unexpected artifact ${field}`);
  }
}
export function verifyProductionPlan(plan, actualAccount) {
  if (actualAccount !== account) reject('Unexpected AWS account');
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || typeof plan.format_version !== 'string') reject('Invalid production plan JSON');
  if (plan.errored) reject('Terraform plan errored');
  const variable = name => plan.variables?.[name]?.value;
  if (variable('env') !== 'prod') reject('Expected prod environment');
  if (variable('aws_region') !== region) reject('Unexpected AWS region');
  if (variable('floci') !== false) reject('Floci must be disabled');
  for (const [name, expected] of [['apns_team_id', apns.APNS_TEAM_ID], ['apns_key_id', apns.APNS_KEY_ID], ['apns_bundle_id', apns.APNS_BUNDLE_ID]]) {
    if (variable(name) !== expected) reject('Unexpected APNs identity');
  }
  if (typeof variable('apns_p8_pem') !== 'string' || !variable('apns_p8_pem').trim()) reject('Missing production APNs key');
  for (const [name, expected] of [['frontend_bucket', 'bridge-tracker-frontend-prod'], ['cloudfront_distribution_id', 'E1240X8164GSZ3']]) {
    if (plan.planned_values?.outputs?.[name]?.value !== expected) reject(`Unexpected production output: ${name}`);
  }
  if (!plan.output_changes || typeof plan.output_changes !== 'object' || Array.isArray(plan.output_changes)) reject('Missing production output changes');
  for (const [name, change] of Object.entries(plan.output_changes)) {
    if (!isDeepStrictEqual(change.actions, ['no-op']) || hasUnknown(change.after_unknown) || !isDeepStrictEqual(change.before, change.after)) reject(`Unexpected output change: ${name}`);
  }
  if (!Array.isArray(plan.resource_changes)) reject('Missing resource changes');
  const seen = new Set();
  for (const r of plan.resource_changes) {
    if (!r || !r.change || !Array.isArray(r.change.actions) || r.change.actions.length === 0 || r.change.actions.some(x => !['no-op', 'read', 'create', 'update', 'delete'].includes(x))) reject('Unknown Terraform action');
    if (seen.has(r.address)) reject('Duplicate resource address'); seen.add(r.address);
    const actions = r.change.actions.join(',');
    if (r.mode === 'data') { if (!['read', 'no-op'].includes(actions)) reject('Unexpected data action'); continue; }
    if (r.mode !== 'managed') reject('Unknown resource mode');
    const lambdaName = /^aws_lambda_function\.(api|poller)$/.exec(r.address)?.[1];
    const artifactName = /^aws_s3_object\.(api|poller)_zip$/.exec(r.address)?.[1];
    if (lambdaName && r.type === 'aws_lambda_function') validateLambda(r, lambdaName);
    else if (artifactName && r.type === 'aws_s3_object') validateArtifact(r, artifactName, plan);
    else if (actions !== 'no-op' || hasUnknown(r.change.after_unknown) || !isDeepStrictEqual(r.change.before, r.change.after)) reject(`Unexpected managed change: ${r.address}`);
  }
  for (const name of ['api', 'poller']) {
    const lambda = plan.resource_changes.find(r => r.address === `aws_lambda_function.${name}`);
    const artifact = plan.resource_changes.find(r => r.address === `aws_s3_object.${name}_zip`);
    if (!lambda || !artifact) reject(`Missing required production resource: ${name}`);
    if (lambda.change.after.s3_key !== artifact.change.after.key) reject('Mismatched Lambda artifact key');
  }
  const parameter = plan.resource_changes.find(r => r.address === 'aws_ssm_parameter.apns[0]');
  if (!parameter || parameter.type !== 'aws_ssm_parameter' || parameter.change.after?.name !== apns.APNS_KEY_PARAM_NAME || parameter.change.after?.type !== 'SecureString' || parameter.change.after?.arn !== `arn:aws:ssm:${region}:${account}:parameter/bridge-tracker/prod/apns/p8`) reject('Missing or unexpected production APNs parameter');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    let plan;
    try { plan = JSON.parse(readFileSync(process.argv[2], 'utf8')); } catch { reject('Cannot read production plan JSON'); }
    verifyProductionPlan(plan, process.env.AWS_ACCOUNT_ID);
    console.log('Production plan verified: only scoped Lambda code and artifact changes.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
