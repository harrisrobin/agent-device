import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCloudWebDriverConnectProfile } from './cloud-webdriver-profile.ts';
import { providerCredentialFingerprint } from '../../provider-credential-fingerprint.ts';
import { mkdtempForTestSync } from '../../__tests__/test-utils/tmp-dir.ts';

const BROWSERSTACK_ENV = {
  BROWSERSTACK_USERNAME: 'browser-user',
  BROWSERSTACK_ACCESS_KEY: 'browser-secret-key',
};
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace(): { tempRoot: string; stateDir: string } {
  const tempRoot = mkdtempForTestSync('agent-device-cloud-webdriver-profile-');
  tempRoots.push(tempRoot);
  return { tempRoot, stateDir: path.join(tempRoot, '.state') };
}

function readProfile(remoteConfigPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(remoteConfigPath, 'utf8'));
}

test('a BrowserStack profile records the credential fingerprint and no credential value', () => {
  const { tempRoot, stateDir } = workspace();
  const resolved = resolveCloudWebDriverConnectProfile({
    provider: 'browserstack',
    stateDir,
    cwd: tempRoot,
    env: BROWSERSTACK_ENV,
    flags: {
      json: false,
      help: false,
      version: false,
      platform: 'android',
      device: 'Google Pixel 8',
      providerOsVersion: '14.0',
      providerApp: 'bs://app-id',
    },
  });
  const profile = readProfile(resolved.remoteConfigPath);

  expect(profile.providerCredentialFingerprint).toBe(
    providerCredentialFingerprint('browserstack', BROWSERSTACK_ENV),
  );
  const contents = JSON.stringify(profile);
  for (const value of Object.values(BROWSERSTACK_ENV)) expect(contents).not.toContain(value);
});

test('an AWS Device Farm profile records no fingerprint', () => {
  const { tempRoot, stateDir } = workspace();
  const resolved = resolveCloudWebDriverConnectProfile({
    provider: 'aws-device-farm',
    stateDir,
    cwd: tempRoot,
    env: { AWS_ACCESS_KEY_ID: 'aws-id', AWS_SECRET_ACCESS_KEY: 'aws-secret' },
    flags: {
      json: false,
      help: false,
      version: false,
      platform: 'android',
      awsProjectArn: 'arn:aws:devicefarm:us-west-2:111122223333:project:project-id',
      awsDeviceArn: 'arn:aws:devicefarm:us-west-2::device:device-id',
    },
  });

  expect(readProfile(resolved.remoteConfigPath)).not.toHaveProperty(
    'providerCredentialFingerprint',
  );
});
