import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cepageForEffectiveMode,
  isThemeCepage,
  isThemeMode,
  resolveEffectiveThemeMode,
} from '../theme.js';

test('resolveEffectiveThemeMode is direct for light and dark', () => {
  assert.equal(resolveEffectiveThemeMode('light'), 'light');
  assert.equal(resolveEffectiveThemeMode('dark'), 'dark');
});

test('resolveEffectiveThemeMode uses prefersDark override for system', () => {
  assert.equal(resolveEffectiveThemeMode('system', true), 'dark');
  assert.equal(resolveEffectiveThemeMode('system', false), 'light');
});

test('isThemeMode accepts known values', () => {
  assert.equal(isThemeMode('system'), true);
  assert.equal(isThemeMode('dark'), true);
  assert.equal(isThemeMode('bogus'), false);
});

test('isThemeCepage accepts known cépages', () => {
  assert.equal(isThemeCepage('cabernet'), true);
  assert.equal(isThemeCepage('chardonnay'), true);
  assert.equal(isThemeCepage('slate'), false);
  assert.equal(isThemeCepage(''), false);
});

test('cepageForEffectiveMode picks cabernet for dark and chardonnay for light', () => {
  assert.equal(cepageForEffectiveMode('dark'), 'cabernet');
  assert.equal(cepageForEffectiveMode('light'), 'chardonnay');
});
