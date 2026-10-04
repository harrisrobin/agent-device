import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveLimrunConnectProfile } from './limrun-profile.ts';
import { providerCredentialFingerprint } from '../../provider-credential-fingerprint.ts';
import { mkdtempForTestSync } from '../../__tests__/test-utils/tmp-dir.ts';

const ATTACH_ENV = {
  LIMRUN_API_KEY: 'lim-secret-key',
  LIM_IOS_INSTANCE_URL: 'https://region.limrun.example/v1/ios_x/api',
  LIM_IOS_INSTANCE_TOKEN: 'ios-secret-token',
};
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function resolveProfile(flags: { daemonBaseUrl?: string } = {}): Record<string, unknown> {
  const tempRoot = mkdtempForTestSync('agent-device-limrun-profile-');
  tempRoots.push(tempRoot);
  const stateDir = path.join(tempRoot, '.state');
  const resolved = resolveLimrunConnectProfile({
    stateDir,
    cwd: tempRoot,
    env: ATTACH_ENV,
    flags: { json: false, help: false, version: false, platform: 'ios', stateDir, ...flags },
  });
  return JSON.parse(fs.readFileSync(resolved.remoteConfigPath, 'utf8'));
}

test('a Limrun profile records the credential fingerprint and no credential value', () => {
  const profile = resolveProfile();

  expect(profile.providerCredentialFingerprint).toBe(
    providerCredentialFingerprint('limrun', ATTACH_ENV),
  );
  const contents = JSON.stringify(profile);
  for (const value of Object.values(ATTACH_ENV)) expect(contents).not.toContain(value);
});

test('a Limrun profile that targets a remote daemon records no fingerprint', () => {
  expect(
    resolveProfile({ daemonBaseUrl: 'https://daemon.example/agent-device' }),
  ).not.toHaveProperty('providerCredentialFingerprint');
});
