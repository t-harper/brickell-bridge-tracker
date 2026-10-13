import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function terraformCommand(workflow, stepName) {
  const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
  const step = source.split(`      - name: ${stepName}\n`)[1]?.split(/\n      - (?:name:|uses:)/)[0];
  assert.ok(step, `Missing ${stepName} step`);
  const run = step.match(/^        run: (.*)$/m);
  assert.ok(run, `Missing ${stepName} command`);
  if (run[1] !== '|') return run[1];
  return step.slice(run.index + run[0].length).split('\n')
    .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
}

for (const [workflow, step] of [['plan.yml', 'Terraform plan'], ['deploy.yml', 'Terraform apply']]) {
  for (const [input, key, configured] of [['missing', '', false], ['whitespace-only', ' \t\n ', false], ['configured', 'test-only-key-marker', true]]) {
    test(`${workflow} ${configured ? 'runs Terraform with' : 'blocks Terraform without'} the production APNs key (${input})`, () => {
      const directory = mkdtempSync(join(tmpdir(), 'bridge-apns-guard-test-'));
      try {
        const executable = join(directory, 'terraform');
        const marker = join(directory, 'terraform-invoked');
        writeFileSync(executable, '#!/usr/bin/env bash\n: > "$TF_TEST_MARKER"\n', { mode: 0o700 });
        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', terraformCommand(workflow, step)], {
          cwd: directory, encoding: 'utf8',
          env: { ...process.env, BASH_ENV: '', ENV: '', PATH: `${directory}:${process.env.PATH}`, TF_TEST_MARKER: marker,
            TF_VAR_apns_p8_pem: key, GITHUB_OUTPUT: join(directory, 'github-output') },
        });
        assert.equal(existsSync(marker), configured, `Terraform invocation mismatch: ${result.stdout} ${result.stderr}`);
        assert.equal(result.status === 0, configured, 'Missing keys must fail the workflow step');
        if (workflow === 'plan.yml') {
          assert.equal(readFileSync(join(directory, 'github-output'), 'utf8').trim(),
            `exitcode=${configured ? 0 : 1}`, 'The final plan gate must fail despite continue-on-error');
        }
        assert.ok(!(result.stdout + result.stderr).includes('test-only-key-marker'), 'Key values must never be logged');
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  }
}

test('the final plan gate rejects an errored Terraform step without an exitcode output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bridge-apns-error-test-'));
  try {
    writeFileSync(join(directory, 'terraform'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o700 });
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', terraformCommand('plan.yml', 'Terraform plan')], {
      cwd: directory, encoding: 'utf8', env: { ...process.env, BASH_ENV: '', ENV: '',
        PATH: `${directory}:${process.env.PATH}`, TF_VAR_apns_p8_pem: 'test-only-key-marker',
        GITHUB_OUTPUT: join(directory, 'github-output') },
    });
    assert.notEqual(result.status, 0, 'Terraform errors must propagate from the step');
    assert.equal(existsSync(join(directory, 'github-output')), false, 'Bash errexit runs before the output assignment');
    const workflow = readFileSync(new URL('../.github/workflows/plan.yml', import.meta.url), 'utf8');
    const finalGate = workflow.split('      - name: Fail job if plan errored\n')[1];
    assert.match(finalGate, /if: steps\.plan\.outcome != 'success' \|\| steps\.plan\.outputs\.exitcode == '1'/,
      'continue-on-error must be checked via outcome, even when no exitcode was written');
    assert.ok(!(result.stdout + result.stderr).includes('test-only-key-marker'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
