import { test, expect, vi, afterEach, beforeEach } from 'vitest';
import { legacyDispatchCapture } from '../../__tests__/legacy-snapshot-capture-fixture.ts';
import { handleSnapshotCommands as handleProductionSnapshotCommands } from '../snapshot.ts';
import {
  isActiveProviderDevice,
  setActiveProviderDeviceRuntimes,
} from '../../../provider-device-runtime.ts';
import { installProviderDeviceAdmission } from '../../provider-device-admission.ts';

// The daemon reads provider ownership through its own typed admission seam; production
// installs it from root composition, and these tests compose it the same way.
installProviderDeviceAdmission({ isActive: isActiveProviderDevice });
import { platformResourceCleanup } from '../../../platform-runtime-resource-cleanup.ts';
import {
  fixtureSettingsMutations,
  fixtureSettingsReads,
  resetSnapshotRuntimeFixture,
  snapshotRuntimeFixture,
} from '../../__tests__/snapshot-runtime-fixture.ts';
import {
  androidDevice,
  iosSimulatorDevice,
  macOsDevice,
  makeSession,
  makeSessionStore,
  snapshotRequest,
  tvOsSimulatorDevice,
} from './snapshot-handler.fixtures.ts';
import { activateCompleteRefFrame, refFrameState } from '../../ref-frame.ts';

vi.mock('../../snapshot-interactor-capture.ts', async () => {
  const fixture = await import('../../__tests__/legacy-snapshot-capture-fixture.ts');
  return { captureSnapshotWithInteractor: fixture.captureSnapshotThroughLegacyDispatchFixture };
});
vi.mock('@agent-device/platform-apple/runner/operations', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@agent-device/platform-apple/runner/operations')>();
  return { ...actual, runAppleRunnerCommand: vi.fn(async () => ({})) };
});

// The real implementation shells out to simctl to probe for a hint-worthy
// unambiguous environment; that live-probe logic is covered by
// ios-app-session-hint.test.ts. Stubbed here so this suite stays hermetic and
// fast — defaults to "no enrichment", matching the current-behavior fallback.
vi.mock('../../ios-app-session-hint.ts', () => ({
  buildIosOpenCommandHint: vi.fn(async () => undefined),
}));

import { runAppleRunnerCommand } from '@agent-device/platform-apple/runner/operations';
import { buildIosOpenCommandHint } from '../../ios-app-session-hint.ts';

const mockRunnerCommand = vi.mocked(runAppleRunnerCommand);
const mockBuildIosOpenCommandHint = vi.mocked(buildIosOpenCommandHint);

function handleSnapshotCommands(
  params: Parameters<typeof handleProductionSnapshotCommands>[0],
): ReturnType<typeof handleProductionSnapshotCommands> {
  const runtime = snapshotRuntimeFixture(params.req.meta?.requestId);
  return handleProductionSnapshotCommands({
    ...params,
    inspectFacts: params.inspectFacts ?? runtime.inspectFacts,
    bindDevice: params.bindDevice ?? runtime.bindDevice,
    platformResourceCleanup: params.platformResourceCleanup ?? platformResourceCleanup,
  });
}

afterEach(() => {
  setActiveProviderDeviceRuntimes([]);
});

beforeEach(() => {
  resetSnapshotRuntimeFixture();
  legacyDispatchCapture.mockReset();
  legacyDispatchCapture.mockResolvedValue({});
  mockRunnerCommand.mockReset();
  mockRunnerCommand.mockResolvedValue({});
  mockBuildIosOpenCommandHint.mockReset();
  mockBuildIosOpenCommandHint.mockResolvedValue(undefined);
});

test('settings rejects unsupported iOS physical devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'apple',
      id: 'ios-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
  );

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['wifi', 'on'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('UNSUPPORTED_OPERATION');
    expect(response.error.message).toMatch(/settings is not supported/i);
  }
});

test('settings clear-app-state dispatches explicit app id without an active app session', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-clear-state';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['clear-app-state', 'org.reactnavigation.playground'],
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(fixtureSettingsMutations.at(-1)).toMatchObject({
    setting: 'clear-app-state',
    state: 'clear',
    appBundleId: 'org.reactnavigation.playground',
  });
});

test('settings clear-app-state rejects missing app id when no app session is bound', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-clear-state-missing-app';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['clear-app-state'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response?.ok === false) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/requires an app id/i);
  }
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('settings reset-keychain dispatches without an app id or active app session', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-reset-keychain';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['reset-keychain', 'clear'],
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(fixtureSettingsMutations.at(-1)).toMatchObject({
    setting: 'reset-keychain',
    state: 'clear',
  });
});

test('settings reset-keychain rejects an extra app argument instead of dropping it', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-reset-keychain-extra-arg';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['reset-keychain', 'clear', 'com.example.app'],
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response?.ok === false) {
    expect(response.error.code).toBe('INVALID_ARGS');
  }
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('settings text-size reads the category the owner holds without mutating anything', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-text-size-read';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['text-size'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(response?.ok && response.data).toMatchObject({
    setting: 'text-size',
    category: 'extra-extra-large',
    platformValue: 'extra-extra-large',
    message: 'Text size is extra-extra-large',
  });
  expect(fixtureSettingsReads).toMatchObject([{ setting: 'text-size' }]);
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('settings text-size refuses the macOS host on both legs with the same code', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-text-size-read';
  sessionStore.set(sessionName, makeSession(sessionName, macOsDevice));

  const read = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['text-size'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });
  const write = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['text-size', 'large'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  for (const response of [read, write]) {
    expect(response?.ok).toBe(false);
    if (response && !response.ok) {
      expect(response.error.code).toBe('INVALID_ARGS');
      expect(response.error.message).toMatch(/Unsupported macOS setting: text-size/i);
    }
  }
  expect(fixtureSettingsReads).toHaveLength(0);
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('settings text-size applies a ladder category through the write leg', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-text-size-write';
  const session = makeSession(sessionName, iosSimulatorDevice);
  activateCompleteRefFrame(session);
  sessionStore.set(sessionName, session);

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['text-size', 'accessibility-extra-large'],
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(response?.ok && response.data).toMatchObject({
    setting: 'text-size',
    state: 'accessibility-extra-large',
    message: 'Text size set to accessibility-extra-large',
  });
  expect(fixtureSettingsMutations.at(-1)).toMatchObject({
    setting: 'text-size',
    state: 'accessibility-extra-large',
  });
  expect(fixtureSettingsReads).toHaveLength(0);
  // ADR 0014: the admitted mutation leg expires the frame it is about to invalidate.
  expect(refFrameState(session)).toBe('expired');
});

test('settings text-size refuses an Apple leaf with no content size before it expires the frame', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'tvos-text-size';
  const session = makeSession(sessionName, tvOsSimulatorDevice);
  activateCompleteRefFrame(session);
  sessionStore.set(sessionName, session);

  for (const positionals of [['text-size'], ['text-size', 'large']]) {
    const response = await handleSnapshotCommands({
      req: snapshotRequest(sessionName, 'settings', { positionals }),
      sessionName,
      logPath: '/tmp/daemon.log',
      sessionStore,
    });
    expect(response?.ok).toBe(false);
    if (response && !response.ok) {
      expect(response.error.code).toBe('UNSUPPORTED_OPERATION');
      expect(response.error.message).toMatch(/iOS and iPadOS simulators/i);
    }
  }
  // The refusal is the point of checking before admission: the write leg expires the frame the
  // moment it binds, so a request that never reached a device would otherwise have taken down a
  // frame no mutation invalidated.
  expect(refFrameState(session)).toBe('active');
  expect(fixtureSettingsReads).toHaveLength(0);
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('settings text-size refuses an off-ladder category with the whole ladder', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-text-size-invalid';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['text-size', 'gigantic'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/Invalid text size: gigantic/);
    expect(response.error.message).toMatch(/extra-small\|small\|medium\|large/);
    expect(response.error.message).toMatch(/accessibility-extra-extra-extra-large/);
  }
  // `simctl ui <device> content_size <bogus>` answers "Invalid argument" with exit 0, so a category
  // this gate let through would have been reported back as a change that changed nothing.
  expect(fixtureSettingsMutations).toHaveLength(0);
  expect(fixtureSettingsReads).toHaveLength(0);
});

test('settings usage hint documents canonical faceid states', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSnapshotCommands({
    req: snapshotRequest('default', 'settings'),
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/appearance <light\|dark\|toggle>/);
    expect(response.error.message).toMatch(/match\|nonmatch\|enroll\|unenroll/);
    expect(response.error.message).toMatch(/grant\|deny\|reset/);
    expect(response.error.message).not.toMatch(/validate\|unvalidate/);
  }
});

test('settings on macOS rejects wifi before dispatch with explicit subset guidance', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-settings-wifi';
  sessionStore.set(sessionName, makeSession(sessionName, macOsDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['wifi', 'on'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  expect(fixtureSettingsMutations).toHaveLength(0);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/Unsupported macOS setting: wifi/i);
    expect(response.error.message).toMatch(/appearance <light\|dark\|toggle>/);
    expect(response.error.message).toMatch(
      /permission <grant\|reset> <accessibility\|screen-recording\|input-monitoring>/,
    );
    expect(response.error.message).toMatch(
      /wifi\|airplane\|location\|animations\|text-size remain unsupported on macOS/i,
    );
  }
});

// #3179: an app-scoped change can name the app it targets, so no app has to be open in session.
test('settings permission dispatches an explicit app with no app bound to the session', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-permission-explicit-app';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['permission', 'grant', 'camera'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(fixtureSettingsMutations.at(-1)).toMatchObject({
    setting: 'permission',
    state: 'grant',
    appBundleId: 'com.example.app',
    options: { permissionTarget: 'camera' },
  });
});

test('settings permission prefers an explicit app over the session app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-permission-app-over-session';
  const session = makeSession(sessionName, iosSimulatorDevice);
  session.appBundleId = 'com.session.app';
  sessionStore.set(sessionName, session);

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['permission', 'deny', 'photos'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(fixtureSettingsMutations.at(-1)?.appBundleId).toBe('com.example.app');
});

test('settings location on dispatches an explicit app on an iOS simulator', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-location-explicit-app';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['location', 'on'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(fixtureSettingsMutations.at(-1)).toMatchObject({
    setting: 'location',
    state: 'on',
    appBundleId: 'com.example.app',
  });
});

test('settings location on refuses an app on Android, where the toggle is device-wide', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-location-explicit-app';
  sessionStore.set(sessionName, makeSession(sessionName, androidDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['location', 'on'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.details?.reason).toBe('setting_app_not_consumed');
    expect(response.error.details?.app).toBe('com.example.app');
    expect(response.error.details?.dispatched).toBe('no');
  }
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('settings permission refuses an app on macOS, whose permissions are host-level', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-permission-explicit-app';
  sessionStore.set(sessionName, makeSession(sessionName, macOsDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['permission', 'grant', 'screen-recording'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.details?.reason).toBe('setting_app_not_consumed');
  }
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('settings location set refuses an app, which moves the device rather than an app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-location-set-explicit-app';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['location', 'set', '37.77', '-122.42'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.details?.reason).toBe('setting_app_not_consumed');
  }
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('an app-scoped refusal leaves a live ref frame standing', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-location-frame';
  const session = makeSession(sessionName, androidDevice);
  sessionStore.set(sessionName, session);
  activateCompleteRefFrame(session);

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['location', 'on'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  // The refusal is the point: the write leg expires the frame the moment it is admitted, so a
  // request that never reached a device must leave the frame standing.
  expect(refFrameState(session)).toBe('active');
});

test('a blank app is refused rather than dropped onto the session app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-permission-blank-app';
  const session = makeSession(sessionName, iosSimulatorDevice);
  session.appBundleId = 'com.session.app';
  sessionStore.set(sessionName, session);

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['permission', 'grant', 'camera'],
      flags: { targetApp: '   ' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.details?.reason).toBe('setting_app_not_named');
    expect(response.error.details?.dispatched).toBe('no');
  }
  expect(fixtureSettingsMutations).toHaveLength(0);
});

test('a named app on a settings read is refused rather than ignored', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-text-size-read-with-app';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', {
      positionals: ['text-size'],
      flags: { targetApp: 'com.example.app' },
    }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.details?.reason).toBe('setting_app_not_consumed');
  }
  expect(fixtureSettingsReads).toHaveLength(0);
});

test('a settings read still answers when only the session carries an app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-text-size-read-session-app';
  const session = makeSession(sessionName, iosSimulatorDevice);
  session.appBundleId = 'com.session.app';
  sessionStore.set(sessionName, session);

  const response = await handleSnapshotCommands({
    req: snapshotRequest(sessionName, 'settings', { positionals: ['text-size'] }),
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  expect(response?.ok).toBe(true);
  expect(fixtureSettingsReads).toHaveLength(1);
});
