'use strict';

const assert = require('assert');
const {
  createTraditionRotator,
  cleanRecentTitles,
  normalizePractice
} = require('./practice');

const valid = (overrides) => JSON.stringify(Object.assign({
  title: 'Cuello suelto',
  purpose: 'Soltar la tensión del cuello',
  durationMinutes: 3,
  steps: ['Siéntate', 'Inclina la cabeza', 'Respira'],
  safetyNote: 'Detente si sientes dolor'
}, overrides));

const firstOf = (date) => createTraditionRotator(date)();

// Rotation start: Jan 1 is kriya, then it cycles every four days.
assert.strictEqual(firstOf(new Date(2026, 0, 1)), 'kriya');
assert.strictEqual(firstOf(new Date(2026, 0, 2)), 'buddhism');
assert.strictEqual(firstOf(new Date(2026, 0, 3)), 'taoism');
assert.strictEqual(firstOf(new Date(2026, 0, 4)), 'zen');
assert.strictEqual(firstOf(new Date(2026, 0, 5)), 'kriya');
// Day 365 of a non-leap year: (365 - 1) % 4 === 0.
assert.strictEqual(firstOf(new Date(2026, 11, 31)), 'kriya');
// Leap year: Mar 1 is day 61 -> (61 - 1) % 4 === 0.
assert.strictEqual(firstOf(new Date(2028, 2, 1)), 'kriya');
// Mar 8 2026 is day 67 -> taoism; Mar 9 is zen (DST must not shift it).
assert.strictEqual(firstOf(new Date(2026, 2, 8)), 'taoism');
assert.strictEqual(firstOf(new Date(2026, 2, 9)), 'zen');

// Rotation: each call advances one step and wraps around.
const next = createTraditionRotator(new Date(2026, 0, 3));
assert.deepStrictEqual(
  [next(), next(), next(), next(), next()],
  ['taoism', 'zen', 'kriya', 'buddhism', 'taoism']
);

// Rotation: consecutive calls never repeat a tradition.
const many = createTraditionRotator(new Date(2026, 5, 15));
let previous = many();
for (let index = 0; index < 20; index += 1) {
  const current = many();
  assert.notStrictEqual(current, previous);
  previous = current;
}

// Recent titles: cleaned, limited to the last five, tolerant of bad input.
assert.deepStrictEqual(cleanRecentTitles('nope'), []);
assert.deepStrictEqual(cleanRecentTitles(undefined), []);
assert.deepStrictEqual(cleanRecentTitles(['a', '', 5, 'b\n\nc']), ['a', 'b c']);
assert.deepStrictEqual(
  cleanRecentTitles(['1', '2', '3', '4', '5', '6', '7']),
  ['3', '4', '5', '6', '7']
);

// Normalization: valid payload.
const practice = normalizePractice(valid(), 'kriya');
assert.strictEqual(practice.tradition, 'Kriya Yoga');
assert.strictEqual(practice.traditionKey, 'kriya');
assert.strictEqual(practice.durationMinutes, 3);
assert.strictEqual(practice.steps.length, 3);

// Normalization: model text wrapped in prose and fences is still parsed.
assert.strictEqual(normalizePractice(`Aquí:\n\`\`\`json\n${valid()}\n\`\`\``, 'zen').title, 'Cuello suelto');

// Normalization: duration clamped to 2-5, default 3 when missing.
assert.strictEqual(normalizePractice(valid({ durationMinutes: 90 }), 'zen').durationMinutes, 5);
assert.strictEqual(normalizePractice(valid({ durationMinutes: 0 }), 'zen').durationMinutes, 2);
assert.strictEqual(normalizePractice(valid({ durationMinutes: 'x' }), 'zen').durationMinutes, 3);

// Normalization: steps capped at six and blanks dropped.
const capped = normalizePractice(valid({ steps: ['a', '', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }), 'zen');
assert.strictEqual(capped.steps.length, 6);

// Normalization: rejects broken JSON and too few steps.
assert.throws(() => normalizePractice('not json', 'zen'));
assert.throws(() => normalizePractice(valid({ steps: ['only one'] }), 'zen'));
assert.throws(() => normalizePractice(valid({ steps: [] }), 'zen'));

// Unknown tradition falls back to zen rather than echoing model input.
assert.strictEqual(normalizePractice(valid(), 'evil').traditionKey, 'zen');

console.log('practice tests passed');
