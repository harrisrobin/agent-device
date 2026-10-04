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
 * undefined for a provider whose credentials do not come from the environment.
 */
export function providerCredentialFingerprint(provider: string, env: EnvMap): string | undefined {
  const names = PROVIDER_CREDENTIAL_VARIABLES[provider];
  return names ? digestVariables(names, env) : undefined;
}

/** The fingerprint of every provider whose credentials come from the environment. */
export function providerCredentialFingerprints(env: EnvMap): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(PROVIDER_CREDENTIAL_VARIABLES).map(([provider, names]) => [
      provider,
      digestVariables(names, env),
    ]),
  );
}

function digestVariables(names: readonly string[], env: EnvMap): string {
  const pairs = names
    .map((name) => [name, env[name]?.trim()] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
    .sort(([left], [right]) => left.localeCompare(right));
  const digest = crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
  return `v1:${digest.slice(0, 16)}`;
}
