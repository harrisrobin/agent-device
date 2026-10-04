import { PUBLIC_COMMANDS } from '@agent-device/command-registry/catalog';
import type { SettingsUpdateOptions } from '@agent-device/contracts/client';
import {
  APPEARANCE_ACTIONS,
  MACOS_PERMISSION_TARGETS,
  MOBILE_PERMISSION_TARGETS,
  parseTextSizeCategory,
  PERMISSION_ACTIONS,
  PERMISSION_MODES,
  SETTINGS_MACOS_PERMISSION_USAGE,
  SETTINGS_USAGE_OVERRIDE,
  type PermissionMode,
} from '@agent-device/contracts/settings';
import type { CommandSchemaOverride } from '@agent-device/command-registry/command-schema';
import type { FlagKey } from '@agent-device/command-registry/flag-types';
import type { CliFlags } from '@agent-device/contracts/command';
import { AppError } from '@agent-device/kernel/errors';
import { readLocationCoordinate } from '@agent-device/kernel/location-coordinates';
import { enumField, numberField, requiredField, stringField } from '../command-input.ts';
import {
  isOneOf,
  optionalString,
  request,
  selectionOptionsFromFlags,
  setOf,
} from '../cli-grammar/common.ts';
import type { CliReader, DaemonWriter } from '../cli-grammar/types.ts';
import { defineCommandFacet } from '../family/types.ts';
import { defineFieldCommandMetadata } from '../field-command-contract.ts';
import { messageOutput } from '../output-common.ts';

const SETTINGS_COMMAND_NAME = 'settings';
const settingsCommandDescription =
  'Read or change supported operating-system settings, animation scales, appearance, or app permissions on the selected target. Platform support varies by setting and action.';

const settingsCommandMetadata = defineFieldCommandMetadata(
  SETTINGS_COMMAND_NAME,
  settingsCommandDescription,
  {
    setting: requiredField(stringField()),
    // Optional because a readable setting answers with no state: `settings text-size` asks for the
    // value the target holds. Every other setting still requires one, which the command's own parse
    // and the daemon enforce per setting rather than the shared field map.
    state: stringField(),
    app: stringField(
      'App bundle id or Android package the change applies to: permission grant|deny|reset, iOS location on|off, and clear-app-state. Defaults to the app bound to the session, so no app has to be open; naming one for a device-wide setting is refused.',
    ),
    latitude: numberField(),
    longitude: numberField(),
    permission: stringField(),
    mode: enumField([...PERMISSION_MODES]),
  },
);

/**
 * Which `settings` action reads which option.
 *
 * `app` is the only action-scoped option this command has, and the row list is what makes the
 * refusal real: `settings wifi on --app com.example.app` would otherwise look like an app-scoped
 * Wi-Fi toggle and then have the name silently dropped by the daemon. Every other setting reads no
 * option, so its row is empty; `clear-app-state` reads `app` through its positional.
 *
 * The table keys on the action alone, so `location` admits `--app` for both `on|off` (an Apple
 * grant) and `set` (which moves the device). Only the target decides that one, so the daemon's
 * scope table is the backstop and the reader carries the app to it instead of guessing per branch.
 */
const SETTINGS_FLAGS_BY_ACTION: Readonly<Record<string, readonly FlagKey[]>> = {
  permission: ['targetApp'],
  location: ['targetApp'],
  'clear-app-state': ['targetApp'],
  wifi: [],
  airplane: [],
  animations: [],
  appearance: [],
  'text-size': [],
  faceid: [],
  touchid: [],
  fingerprint: [],
  'reset-keychain': [],
};

const SETTINGS_CLI_FLAGS: readonly FlagKey[] = [
  ...new Set(Object.values(SETTINGS_FLAGS_BY_ACTION).flat()),
];

const settingsCliSchema = {
  usageOverride: SETTINGS_USAGE_OVERRIDE,
  listUsageOverride: 'settings [area] [options]',
  positionalArgs: ['setting', 'state?', 'target?', 'mode?'],
  allowedFlags: SETTINGS_CLI_FLAGS,
  flagsByAction: SETTINGS_FLAGS_BY_ACTION,
  flagDescriptionOverrides: {
    targetApp:
      'Apply an app-scoped change to this bundle id or package without opening it: permission grant|deny|reset, iOS location on|off, clear-app-state. Refused for a setting the target serves device-wide.',
  },
} as const satisfies CommandSchemaOverride;

export const settingsCliReader: CliReader = (positionals, flags) =>
  readSettingsOptionsFromPositionals(positionals, flags);

/**
 * The `app` the caller named rides `options.targetApp` to the daemon rather than being restated as a
 * settings-specific wire key: it is the same "aim this at an app I am not opening" the doctor already
 * carries, and `buildFlags` projects that one key onto the request. `--app` arrives on the same key
 * from the CLI reader, so both surfaces converge here. It is copied for every setting, including the
 * ones that cannot consume one, so the daemon is the single place that decides — and refuses —
 * rather than a writer that would have to duplicate the per-target table.
 */
export const settingsDaemonWriter: DaemonWriter = (input) => {
  const app = input.app;
  return request(
    PUBLIC_COMMANDS.settings,
    settingsPositionals(input as SettingsUpdateOptions),
    app === undefined ? input : { ...input, targetApp: app },
    input,
  );
};

export const settingsCommandFacet = defineCommandFacet({
  name: SETTINGS_COMMAND_NAME,
  text: {
    summary: 'Change OS settings and app permissions',
    cliDetail: `macOS supports only settings appearance <light|dark|toggle> and settings ${SETTINGS_MACOS_PERMISSION_USAGE}; wifi|airplane|location|animations|text-size remain unsupported on macOS. Mobile permission actions, iOS location on|off, and clear-app-state name the app they change with app/--app, defaulting to the session app so no app has to be open; naming one for a device-wide setting is refused rather than dropped. On Android, deny|reset of a permission the app currently holds kills a running app; the response reports priorGrantState (granted|not_granted|unknown) and warns for granted and unknown, with open <app> --relaunch to restore it. Permission changes require a resolvable foreground user and fail without mutating if adb cannot report one. Android settings airplane on|off is applied by the connectivity service (Android 11+) and reports the airplaneMode that service holds; older builds fail without changing device state. settings reset-keychain clear is iOS-simulator-only and resets the whole simulator keychain, not just the selected app: simctl exposes no per-app keychain reset, so every app on that simulator loses its keychain-backed credentials (e.g. Firebase auth). clear-app-state does not touch the keychain, so a full fresh-install reset needs both; relaunch the app afterward to observe the signed-out state. settings text-size reads the preferred text size the target holds and settings text-size <category> applies one, on iPhone and iPad simulators (simctl content size) and on Android targets (system font_scale); tvOS and visionOS simulators, physical Apple devices, and the macOS host refuse it. Android has no category ladder of its own, so the read names the nearest rung and reports the exact multiplier as platformValue; an already-running app adopts a changed size at its next configuration change, so relaunch the app under test to observe it.`,
  },
  metadata: settingsCommandMetadata,
  run: (client, input) => client.settings.update(input as SettingsUpdateOptions),
  cliSchema: settingsCliSchema,
  cliReader: settingsCliReader,
  daemonWriter: settingsDaemonWriter,
  // Android permission revokes append a relaunch warning (#1796); render it for humans too.
  cliOutputFormatter: messageOutput,
});

// fallow-ignore-next-line complexity
function readSettingsOptionsFromPositionals(
  positionals: string[],
  flags: CliFlags,
): SettingsUpdateOptions {
  // `--app` rides every leg, not only the ones the parser let it through on: the reader is a
  // projection and the daemon's scope table is the one decision, so a named app reaches that table
  // instead of being dropped here depending on which branch the grammar happened to take.
  const base = { ...selectionOptionsFromFlags(flags), app: flags.targetApp };
  const setting = positionals[0];
  const state = positionals[1];
  if (isOneOf(setting, ON_OFF_SETTINGS) && isOneOf(state, ON_OFF_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'location' && state === 'set') {
    return {
      ...base,
      setting,
      state,
      latitude: readLocationCoordinate(positionals[2], 'latitude'),
      longitude: readLocationCoordinate(positionals[3], 'longitude'),
    };
  }
  if (setting === 'appearance' && isOneOf(state, APPEARANCE_STATES)) {
    return { ...base, setting, state };
  }
  // A bare `settings text-size` reads the category the target holds; a category applies it. The
  // category is parsed here rather than handed to the tool, which answers an unknown one with
  // success, and the refusal lists the whole ladder.
  if (setting === 'text-size') {
    return state === undefined
      ? { ...base, setting }
      : { ...base, setting, state: parseTextSizeCategory(state) };
  }
  if (isOneOf(setting, BIOMETRIC_SETTINGS) && isOneOf(state, BIOMETRIC_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'fingerprint' && isOneOf(state, FINGERPRINT_STATES)) {
    return { ...base, setting, state };
  }
  if (setting === 'permission' && isOneOf(state, PERMISSION_STATES)) {
    return {
      ...base,
      setting,
      state,
      permission: readPermission(positionals[2]),
      mode: readPermissionMode(positionals[3]),
    };
  }
  if (setting === 'clear-app-state') {
    // The positional this setting has always taken wins over the flag both spellings share.
    const positionalApp = state === 'clear' ? positionals[2] : state;
    return { ...base, setting, state: 'clear', app: positionalApp ?? flags.targetApp };
  }
  if (setting === 'reset-keychain' && state === 'clear' && positionals.length === 2) {
    return { ...base, setting, state };
  }
  throw new AppError('INVALID_ARGS', 'Invalid settings arguments.');
}

function settingsPositionals(input: SettingsUpdateOptions): string[] {
  if (input.setting === 'clear-app-state') {
    return [input.setting, ...optionalString(input.app)];
  }
  // No state is the read leg: the daemon admits the owner's read fact for a lone positional.
  if (input.setting === 'text-size') {
    return [input.setting, ...optionalString(input.state)];
  }
  if (input.setting === 'location' && input.state === 'set') {
    return [input.setting, input.state, String(input.latitude), String(input.longitude)];
  }
  if (input.setting === 'permission') {
    return [input.setting, input.state, input.permission, ...optionalString(input.mode)];
  }
  return [input.setting, input.state];
}

function readPermission(value: string | undefined): PermissionTarget {
  if (isOneOf(value, PERMISSION_TARGETS)) return value;
  throw new AppError('INVALID_ARGS', 'settings permission requires a permission target.');
}

function readPermissionMode(value: string | undefined): PermissionMode | undefined {
  if (value === undefined || isOneOf(value, PERMISSION_MODE_VALUES)) return value;
  throw new AppError('INVALID_ARGS', 'settings permission mode must be full or limited.');
}

type PermissionTarget = Extract<SettingsUpdateOptions, { setting: 'permission' }>['permission'];
type OnOffSetting = Extract<SettingsUpdateOptions, { state: 'on' | 'off' }>['setting'];
type OnOffState = Extract<SettingsUpdateOptions, { state: 'on' | 'off' }>['state'];
type BiometricSetting = Extract<
  SettingsUpdateOptions,
  { setting: 'faceid' | 'touchid' }
>['setting'];
type BiometricState = Extract<SettingsUpdateOptions, { setting: 'faceid' | 'touchid' }>['state'];
type FingerprintState = Extract<SettingsUpdateOptions, { setting: 'fingerprint' }>['state'];
type AppearanceState = Extract<SettingsUpdateOptions, { setting: 'appearance' }>['state'];

const ON_OFF_SETTINGS = setOf<OnOffSetting>('wifi', 'airplane', 'location', 'animations');
const ON_OFF_STATES = setOf<OnOffState>('on', 'off');
const APPEARANCE_STATES = setOf<AppearanceState>(...APPEARANCE_ACTIONS);
const BIOMETRIC_SETTINGS = setOf<BiometricSetting>('faceid', 'touchid');
const BIOMETRIC_STATES = setOf<BiometricState>('match', 'nonmatch', 'enroll', 'unenroll');
const FINGERPRINT_STATES = setOf<FingerprintState>('match', 'nonmatch');
const PERMISSION_MODE_VALUES = setOf(...PERMISSION_MODES);
const PERMISSION_STATES = setOf(...PERMISSION_ACTIONS);
const PERMISSION_TARGETS = setOf(...MOBILE_PERMISSION_TARGETS, ...MACOS_PERMISSION_TARGETS);
