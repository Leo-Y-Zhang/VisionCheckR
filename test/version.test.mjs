// version.test.mjs
// The scoring-core VERSION and package.json version stay in lockstep at the v2 release.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { VERSION } from '../scoring.mjs';

test('scoring VERSION is the v2.2 release', () => {
  assert.equal(VERSION, '2.2.0');
});

test('scoring VERSION matches package.json version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, VERSION);
});

test('the app UI does not stamp the release with a stale older version', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('Version 1'), false, 'index.html should not say Version 1');
});
