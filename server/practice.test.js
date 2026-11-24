'use strict';

const assert = require('assert');
const {
  traditionForDate,
  normalizePractice,
  createPracticeCache
} = require('./practice');

const valid = (overrides) => JSON.stringify(Object.assign({
  title: 'Respiración suave',
  purpose: 'Calmar la mente',
  durationMinutes: 10,
  steps: ['Siéntate', 'Respira', 'Observa'],
  intention: 'Hoy estaré presente',
  safetyNote: 'Detente si te mareas'
}, overrides));

// Rotation: Jan 1 is kriya, then it cycles every four days.
assert.strictEqual(traditionForDate(new Date(2026, 0, 1)), 'kriya');
assert.strictEqual(traditionForDate(new Date(2026, 0, 2)), 'buddhism');
assert.strictEqual(traditionForDate(new Date(2026, 0, 3)), 'taoism');
assert.strictEqual(traditionForDate(new Date(2026, 0, 4)), 'zen');
assert.strictEqual(traditionForDate(new Date(2026, 0, 5)), 'kriya');
// Day 365 of a non-leap year: (365 - 1) % 4 === 0.
assert.strictEqual(traditionForDate(new Date(2026, 11, 31)), 'kriya');
// Leap year: Mar 1 is day 61 -> (61 - 1) % 4 === 0.
assert.strictEqual(traditionForDate(new Date(2028, 2, 1)), 'kriya');
// Daylight saving transition days must still advance by exactly one.
// Mar 8 2026 is day 67 -> (67 - 1) % 4 === 2 (taoism), Mar 9 is zen.
assert.strictEqual(traditionForDate(new Date(2026, 2, 8)), 'taoism');
assert.strictEqual(traditionForDate(new Date(2026, 2, 9)), 'zen');

// Normalization: valid payload.
const practice = normalizePractice(valid(), 'kriya');
assert.strictEqual(practice.tradition, 'Kriya Yoga');
assert.strictEqual(practice.traditionKey, 'kriya');
assert.strictEqual(practice.durationMinutes, 10);
assert.strictEqual(practice.steps.length, 3);

// Normalization: model text wrapped in prose and fences is still parsed.
assert.strictEqual(normalizePractice(`Aquí:\n\`\`\`json\n${valid()}\n\`\`\``, 'zen').title, 'Respiración suave');

// Normalization: duration clamped, and defaults when missing.
assert.strictEqual(normalizePractice(valid({ durationMinutes: 90 }), 'zen').durationMinutes, 20);
assert.strictEqual(normalizePractice(valid({ durationMinutes: 1 }), 'zen').durationMinutes, 5);
assert.strictEqual(normalizePractice(valid({ durationMinutes: 'x' }), 'zen').durationMinutes, 10);

// Normalization: steps capped at seven and blanks dropped.
const many = normalizePractice(valid({ steps: ['a', '', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }), 'zen');
assert.strictEqual(many.steps.length, 7);

// Normalization: rejects broken JSON and too few steps.
assert.throws(() => normalizePractice('not json', 'zen'));
assert.throws(() => normalizePractice(valid({ steps: ['only one'] }), 'zen'));
assert.throws(() => normalizePractice(valid({ steps: [] }), 'zen'));

// Unknown tradition falls back to zen rather than echoing model input.
assert.strictEqual(normalizePractice(valid(), 'evil').traditionKey, 'zen');

(async () => {
  // Cache: same day -> one call; concurrent calls share the promise.
  const getPractice = createPracticeCache();
  let calls = 0;
  const fetcher = async (tradition) => { calls += 1; return { tradition }; };
  const day = new Date(2026, 0, 1, 8);
  const [a, b] = await Promise.all([getPractice(day, fetcher), getPractice(day, fetcher)]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(a, b);
  await getPractice(new Date(2026, 0, 1, 22), fetcher);
  assert.strictEqual(calls, 1);

  // Cache: another day triggers a new call with that day's tradition.
  const next = await getPractice(new Date(2026, 0, 2), fetcher);
  assert.strictEqual(calls, 2);
  assert.strictEqual(next.tradition, 'buddhism');

  // Cache: failures are not cached.
  let attempts = 0;
  const flaky = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('boom');
    return 'ok';
  };
  const later = new Date(2026, 0, 3);
  await assert.rejects(() => getPractice(later, flaky), /boom/);
  assert.strictEqual(await getPractice(later, flaky), 'ok');
  assert.strictEqual(attempts, 2);

  console.log('practice tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
