// tooling.test.mjs
// Baseline re-affirm: the pure scoring core imports cleanly and the canonical
// DISCLAIMER stays HONEST (educational / non-diagnostic). This is a cheap guard
// so a doc/wording drift that weakens the honesty framing fails the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DISCLAIMER } from '../scoring.mjs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('baseline: the scoring core is importable and DISCLAIMER is a non-empty string', () => {
  assert.equal(typeof DISCLAIMER, 'string');
  assert.ok(DISCLAIMER.length > 0);
});

test('honesty: the canonical DISCLAIMER stays educational and non-diagnostic', () => {
  const d = DISCLAIMER.toLowerCase();
  assert.ok(d.includes('not a medical device'), 'must disclaim medical-device status');
  assert.ok(d.includes('professional'), 'must point to a professional eye exam');
  assert.ok(
    d.includes('educational') || d.includes('screening'),
    'must frame results as educational / screening',
  );
});

// The disclaimer is only protective if a reader meets it BEFORE using the tool.
// These two guards pin its placement so a later layout or docs edit cannot quietly
// demote it to a footer, where someone could take a screening result for an exam.

test('placement: index.html shows the not-a-medical-device notice above the app, not in the footer', () => {
  const html = read('index.html');
  const mainAt = html.indexOf('<main');
  const footerAt = html.indexOf('<footer');
  assert.ok(mainAt > 0, 'index.html must have a <main> app region');

  const noticeAt = html.toLowerCase().indexOf('not a medical device');
  assert.ok(noticeAt > 0, 'index.html must carry the not-a-medical-device notice');
  assert.ok(
    noticeAt < mainAt,
    'the notice must appear before the interactive app, not after it',
  );
  if (footerAt > 0) {
    assert.ok(noticeAt < footerAt, 'the notice must not be buried in the footer');
  }

  const head = html.slice(0, noticeAt).toLowerCase();
  assert.ok(head.includes('<body'), 'the notice must be rendered body content, not only a meta tag');

  const notice = html.slice(noticeAt, noticeAt + 700).toLowerCase();
  assert.ok(
    notice.includes('optometrist') || notice.includes('ophthalmologist'),
    'the notice must point at a qualified professional',
  );
  assert.ok(
    notice.includes('cannot diagnose') || notice.includes('not a substitute'),
    'the notice must deny diagnostic power',
  );
});

test('placement: the README carries the disclaimer in its first screenful', () => {
  const firstScreenful = read('README.md').split(/\r?\n/).slice(0, 25).join('\n').toLowerCase();
  assert.ok(
    firstScreenful.includes('not a medical device'),
    'README must disclaim medical-device status within the first 25 lines',
  );
  assert.ok(
    firstScreenful.includes('optometrist') || firstScreenful.includes('ophthalmologist'),
    'README must point at a qualified professional in the first 25 lines',
  );
});
