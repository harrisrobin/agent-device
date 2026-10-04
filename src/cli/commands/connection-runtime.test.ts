import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import { materializeRemoteConnectionForCommand } from './connection-runtime.ts';
import {
  connectionWorkspace,
  createTestClient,
  recordedLeaseAllocate,
  seedConnectionState,
} from '../../__tests__/remote-connection.fixtures.ts';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test.for([['v1:0123456789abcdef'], [undefined]] as const)(
  'lease allocation carries the profile credential fingerprint %s',
  async ([providerCredentialFingerprint]) => {
    const { tempRoot, stateDir, remoteConfigPath } = connectionWorkspace(
      'agent-device-connection-runtime-fingerprint-',
    );
    tempRoots.push(tempRoot);
    fs.writeFileSync(remoteConfigPath, JSON.stringify({ providerCredentialFingerprint }));
    seedConnectionState({
      stateDir,
      state: {
        session: 'bs-android',
        remoteConfigPath,
        tenant: 'browserstack',
        runId: 'run-1',
        leaseProvider: 'browserstack',
        platform: 'android',
      },
    });
    const allocate = recordedLeaseAllocate({ leaseId: 'bs-lease-1', backend: 'android-instance' });

    await materializeRemoteConnectionForCommand({
      command: 'screenshot',
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir,
        remoteConfig: remoteConfigPath,
        session: 'bs-android',
        platform: 'android',
      },
      client: createTestClient({ allocate: allocate.stub }),
    });

    expect(allocate.request?.leaseProvider).toBe('browserstack');
    expect(allocate.request?.providerCredentialFingerprint).toBe(providerCredentialFingerprint);
  },
);
