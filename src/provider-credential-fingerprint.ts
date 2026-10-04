import crypto from 'node:crypto';
import {
  BROWSERSTACK_CREDENTIAL_VARIABLES,
  CLOUD_WEBDRIVER_PROVIDERS,
} from '@agent-device/provider-webdriver/providers';
import type { LIMRUN_PROVIDER } from '@agent-device/provider-limrun';
import type { EnvMap } from '@agent-device/kernel/source-value';
import { LIMRUN_CREDENTIAL_VARIABLES } from './provider-limrun-credentials.ts';

// AWS Device Farm is absent: it reads the AWS CLI credential chain, which no env hash identifies.
const PROVIDER_CREDENTIAL_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  ['limrun' satisfies typeof LIMRUN_PROVIDER]: LIMRUN_CREDENTIAL_VARIABLES,
  [CLOUD_WEBDRIVER_PROVIDERS.browserStack]: Object.values(BROWSERSTACK_CREDENTIAL_VARIABLES),
};

/**
 * A versioned, non-reversible digest of the credential variables a provider reads from `env`, or
 * undefined when `env` sets none of them or the provider's credentials do not come from the
 * environment. A caller without credentials cannot hold credentials that compete with the daemon's.
 */
export function providerCredentialFingerprint(provider: string, env: EnvMap): string | undefined {
  const names = PROVIDER_CREDENTIAL_VARIABLES[provider];
  const pairs = names ? readCredentialPairs(names, env) : [];
  return pairs.length > 0 ? digestPairs(pairs) : undefined;
}

/** The provider credentials a daemon started with, and the state dir that names that daemon. */
export type DaemonProviderCredentials = Readonly<{
  fingerprints: Readonly<Record<string, string>>;
  stateDir: string;
}>;

export function readDaemonProviderCredentials(
  env: EnvMap,
  stateDir: string,
): DaemonProviderCredentials {
  const fingerprints = Object.fromEntries(
    Object.entries(PROVIDER_CREDENTIAL_VARIABLES).map(([provider, names]) => [
      provider,
      digestPairs(readCredentialPairs(names, env)),
    ]),
  );
  return { fingerprints, stateDir };
}

function readCredentialPairs(
  names: readonly string[],
  env: EnvMap,
): ReadonlyArray<readonly [string, string]> {
  return names
    .map((name) => [name, env[name]?.trim()] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
    .sort(([left], [right]) => left.localeCompare(right));
}

function digestPairs(pairs: ReadonlyArray<readonly [string, string]>): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
  return `v1:${digest.slice(0, 16)}`;
}
