'use strict';

const { parseJsonObject, cleanText } = require('./text');

// Daily rotation order. The tradition of the day is derived from the date so
// it is predictable and never repeats on consecutive days.
const TRADITIONS = ['kriya', 'buddhism', 'taoism', 'zen'];

const TRADITION_LABELS = {
  kriya: 'Kriya Yoga',
  buddhism: 'Buddhism',
  taoism: 'Taoism',
  zen: 'Zen'
};

const MIN_MINUTES = 5;
const MAX_MINUTES = 20;
const MIN_STEPS = 3;
const MAX_STEPS = 7;

function pad(number) {
  return String(number).padStart(2, '0');
}

// Local calendar date as YYYY-MM-DD (the cache key and rotation input).
function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 1-based day of the year using calendar arithmetic in UTC, so daylight
// saving changes cannot shift the result.
function dayOfYear(date) {
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const start = Date.UTC(date.getFullYear(), 0, 1);
  return Math.round((current - start) / 86400000) + 1;
}

function traditionForDate(date) {
  return TRADITIONS[(dayOfYear(date) - 1) % TRADITIONS.length];
}

function normalizePractice(rawText, tradition) {
  const raw = parseJsonObject(rawText);
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step) => cleanText(step, 400)).filter(Boolean).slice(0, MAX_STEPS)
    : [];
  if (steps.length < MIN_STEPS) throw new Error('El guru no entregó una práctica válida');

  const minutes = Math.round(Number(raw.durationMinutes));
  const durationMinutes = Number.isFinite(minutes)
    ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes))
    : 10;

  return {
    mode: 'practice',
    // The tradition always comes from the server rotation, never from the model.
    tradition: TRADITION_LABELS[tradition] || TRADITION_LABELS.zen,
    traditionKey: TRADITION_LABELS[tradition] ? tradition : 'zen',
    title: cleanText(raw.title, 160) || 'Práctica del día',
    purpose: cleanText(raw.purpose, 400),
    durationMinutes,
    steps,
    intention: cleanText(raw.intention, 300),
    safetyNote: cleanText(raw.safetyNote, 300)
  };
}

// Creates a per-day cache. Concurrent requests for the same day share one
// pending promise, and failures are not cached so the user can retry.
function createPracticeCache() {
  const entries = new Map();

  return function getPractice(date, fetchPractice) {
    const tradition = traditionForDate(date);
    const key = `${dateKey(date)}:${tradition}`;

    if (entries.has(key)) return entries.get(key);

    const pending = Promise.resolve()
      .then(() => fetchPractice(tradition))
      .catch((error) => {
        entries.delete(key);
        throw error;
      });
    entries.set(key, pending);

    // Keep only the current day in memory.
    for (const existing of entries.keys()) {
      if (!existing.startsWith(`${dateKey(date)}:`)) entries.delete(existing);
    }
    return pending;
  };
}

module.exports = {
  TRADITIONS,
  TRADITION_LABELS,
  dateKey,
  traditionForDate,
  normalizePractice,
  createPracticeCache
};
