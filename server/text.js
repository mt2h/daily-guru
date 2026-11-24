'use strict';

// Extracts the first JSON object found in a model response. Returns {} when
// the text holds no parseable object.
function parseJsonObject(rawText) {
  const text = String(rawText || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return {};
  }
}

// Collapses control characters and whitespace, then truncates.
function cleanText(value, maximumLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}

module.exports = { parseJsonObject, cleanText };
