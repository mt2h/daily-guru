'use strict';

const { parseJsonObject, cleanText } = require('./text');

// Rotation order for the conscious pauses.
const TRADITIONS = ['kriya', 'buddhism', 'taoism', 'zen'];

const TRADITION_LABELS = {
  kriya: 'Kriya Yoga',
  buddhism: 'Buddhism',
  taoism: 'Taoism',
  zen: 'Zen'
};

const MIN_MINUTES = 2;
const MAX_MINUTES = 10;
const DEFAULT_MINUTES = 5;
// Kinds of pause the guru can propose.
const KINDS = ['meditation', 'breathing', 'movement'];

const MIN_STEPS = 3;
const MAX_STEPS = 6;
const MAX_RECENT_TITLES = 5;

// 1-based day of the year using calendar arithmetic in UTC, so daylight
// saving changes cannot shift the result.
function dayOfYear(date) {
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const start = Date.UTC(date.getFullYear(), 0, 1);
  return Math.round((current - start) / 86400000) + 1;
}

// Index in TRADITIONS where the rotation starts on a given date.
function startIndexForDate(date) {
  return (dayOfYear(date) - 1) % TRADITIONS.length;
}

// Returns a function that yields the next tradition on every call. The first
// call of the day is predictable (derived from the date); every later call
// moves one step forward so consecutive pauses never share a tradition.
function createTraditionRotator(date) {
  let index = startIndexForDate(date || new Date());
  return function nextTradition() {
    const tradition = TRADITIONS[index];
    index = (index + 1) % TRADITIONS.length;
    return tradition;
  };
}

// Cleans the titles of recent pauses sent by the browser, so they can be
// placed in a prompt safely.
function cleanRecentTitles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((title) => cleanText(title, 160))
    .filter(Boolean)
    .slice(-MAX_RECENT_TITLES);
}

function normalizePractice(rawText, tradition) {
  const raw = parseJsonObject(rawText);
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step) => cleanText(step, 400)).filter(Boolean).slice(0, MAX_STEPS)
    : [];
  if (steps.length < MIN_STEPS) throw new Error('El guru no entregó una pausa válida');

  const minutes = Math.round(Number(raw.durationMinutes));
  const durationMinutes = Number.isFinite(minutes)
    ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes))
    : DEFAULT_MINUTES;

  return {
    mode: 'practice',
    // The tradition always comes from the server rotation, never from the model.
    tradition: TRADITION_LABELS[tradition] || TRADITION_LABELS.zen,
    traditionKey: TRADITION_LABELS[tradition] ? tradition : 'zen',
    kind: KINDS.includes(raw.kind) ? raw.kind : 'movement',
    title: cleanText(raw.title, 160) || 'Pausa consciente',
    purpose: cleanText(raw.purpose, 400),
    durationMinutes,
    steps,
    safetyNote: cleanText(raw.safetyNote, 300)
  };
}

module.exports = {
  TRADITIONS,
  TRADITION_LABELS,
  KINDS,
  createTraditionRotator,
  cleanRecentTitles,
  normalizePractice
};
