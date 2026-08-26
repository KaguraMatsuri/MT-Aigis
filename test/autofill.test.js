const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getAutofillSuggestion,
  getAutofillValues,
  isTrustedAutofillUrl,
} = require('../lib/autofill');
const { planTotpValues } = require('../resources/dmm-autofill-preload');

test('only trusts the exact HTTPS DMM accounts hosts', () => {
  assert.equal(isTrustedAutofillUrl('https://accounts.dmm.com/service/login/password'), true);
  assert.equal(isTrustedAutofillUrl('https://accounts.dmm.com/service/login/totp'), true);
  assert.equal(isTrustedAutofillUrl('https://accounts.dmm.co.jp/service/login/password'), true);
  assert.equal(isTrustedAutofillUrl('http://accounts.dmm.com/service/login/password'), false);
  assert.equal(isTrustedAutofillUrl('https://accounts.dmm.com.example.com/login'), false);
  assert.equal(isTrustedAutofillUrl('https://accounts.dmm.com/service/register'), false);
  assert.equal(isTrustedAutofillUrl('https://play.games.dmm.com/game/aigisc'), false);
  assert.equal(isTrustedAutofillUrl('not a url'), false);
});

test('exposes suggestion metadata without password or TOTP secret', () => {
  const suggestion = getAutofillSuggestion({
    email: 'aigis@example.com',
    password: 'secret-password',
    twofa: 'SECRETSECRETVALUE',
  });

  assert.deepEqual(suggestion, {
    available: true,
    label: 'aigis@example.com',
    fields: { username: true, password: true, totp: true },
  });
  assert.equal(JSON.stringify(suggestion).includes('secret-password'), false);
  assert.equal(JSON.stringify(suggestion).includes('SECRETSECRETVALUE'), false);
});

test('returns the login pair together and TOTP separately', () => {
  const vault = {
    email: 'aigis@example.com',
    password: 'secret-password',
    twofa: 'SECRETSECRETVALUE',
  };

  assert.deepEqual(getAutofillValues(vault, 'login', () => '000000'), {
    username: 'aigis@example.com',
    password: 'secret-password',
  });
  assert.deepEqual(getAutofillValues(vault, 'totp', () => '123456'), { totp: '123456' });
  assert.throws(() => getAutofillValues(vault, 'other', () => ''), /Unknown autofill field/);
});

test('keeps a single TOTP field intact and splits segmented fields by digit', () => {
  assert.deepEqual(planTotpValues('123456', 1, false), ['123456']);
  assert.deepEqual(planTotpValues('123456', 6, true), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(planTotpValues('123 456', 6, true), ['1', '2', '3', '4', '5', '6']);
});
