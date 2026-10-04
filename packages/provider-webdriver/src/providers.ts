import { AppError } from '@agent-device/kernel/errors';

export const CLOUD_WEBDRIVER_PROVIDERS = {
  browserStack: 'browserstack',
  awsDeviceFarm: 'aws-device-farm',
} as const;

export type CloudWebDriverKnownProviderName =
  (typeof CLOUD_WEBDRIVER_PROVIDERS)[keyof typeof CLOUD_WEBDRIVER_PROVIDERS];

const CLOUD_WEBDRIVER_KNOWN_PROVIDERS = new Set<string>(Object.values(CLOUD_WEBDRIVER_PROVIDERS));

export function isCloudWebDriverProviderName(
  provider: string | undefined,
): provider is CloudWebDriverKnownProviderName {
  return provider !== undefined && CLOUD_WEBDRIVER_KNOWN_PROVIDERS.has(provider);
}

/** The environment variables that hold BrowserStack credentials. */
export const BROWSERSTACK_CREDENTIAL_VARIABLES = {
  username: 'BROWSERSTACK_USERNAME',
  accessKey: 'BROWSERSTACK_ACCESS_KEY',
} as const;

/** The one reader of BrowserStack credentials in the environment. */
export function requireBrowserStackCredentials(
  env: Readonly<Record<string, string | undefined>>,
  consumer: string,
): { username: string; accessKey: string } {
  const read = (name: string): string => {
    const value = env[name];
    if (value) return value;
    throw new AppError('INVALID_ARGS', `${consumer} requires ${name} in the environment.`);
  };
  return {
    username: read(BROWSERSTACK_CREDENTIAL_VARIABLES.username),
    accessKey: read(BROWSERSTACK_CREDENTIAL_VARIABLES.accessKey),
  };
}

const BROWSERSTACK_APP_SCHEME = 'bs://';

/**
 * URI schemes are case-insensitive, but BrowserStack only matches the lower-case spelling, so
 * `BS://id` is returned as `bs://id`. Anything without the scheme returns undefined.
 */
export function canonicalBrowserStackAppReference(app: string): string | undefined {
  if (app.slice(0, BROWSERSTACK_APP_SCHEME.length).toLowerCase() !== BROWSERSTACK_APP_SCHEME) {
    return undefined;
  }
  return `${BROWSERSTACK_APP_SCHEME}${app.slice(BROWSERSTACK_APP_SCHEME.length)}`;
}

/** An id outside this grammar would pass every local check and fail only at session creation. */
export function isBrowserStackAppReference(reference: string): boolean {
  return /^bs:\/\/[\w.-]+$/.test(reference);
}
