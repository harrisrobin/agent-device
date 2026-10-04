import { expect, test } from 'vitest';
import type { SessionAction } from '@agent-device/contracts/session';
import { formatPortableActionLine } from '../script-formatting.ts';
import { parseReplayScriptDetailed } from '../script.ts';

test.each(['ios', 'android', 'harmonyos'] as const)(
  '%s runtime survives open and runtime set script roundtrips',
  (platform) => {
    const runtime = { platform, metroHost: 'localhost', metroPort: 8081 };
    const actions: SessionAction[] = [
      { ts: 0, command: 'runtime', positionals: ['set'], flags: runtime },
      { ts: 1, command: 'open', positionals: ['Demo'], flags: {}, runtime },
    ];
    const script = actions.map((action) => formatPortableActionLine(action)).join('\n');
    const parsed = parseReplayScriptDetailed(script);
    expect(parsed.actions[0]?.flags).toMatchObject(runtime);
    expect(parsed.actions[1]?.runtime).toMatchObject(runtime);
  },
);

// #3179: a grant aimed at an app the session never opened is only reproducible if the script says so.
test('a settings --app round-trips through a script line', () => {
  const actions: SessionAction[] = [
    {
      ts: 0,
      command: 'settings',
      positionals: ['permission', 'grant', 'camera'],
      flags: { targetApp: 'com.example.app' },
    },
    { ts: 1, command: 'settings', positionals: ['location', 'on'], flags: {} },
  ];
  const script = actions.map((action) => formatPortableActionLine(action)).join('\n');
  expect(script.split('\n')[0]).toContain('--app');
  expect(script.split('\n')[0]).toContain('com.example.app');
  const parsed = parseReplayScriptDetailed(script);
  expect(parsed.actions[0]).toMatchObject({
    command: 'settings',
    positionals: ['permission', 'grant', 'camera'],
    flags: { targetApp: 'com.example.app' },
  });
  expect(parsed.actions[1]?.flags.targetApp).toBeUndefined();
  expect(parsed.actions[1]?.positionals).toEqual(['location', 'on']);
});

test('a settings line with a valueless --app is refused instead of replaying app-less', () => {
  expect(() => parseReplayScriptDetailed('settings location on --app')).toThrow(/--app/);
});
