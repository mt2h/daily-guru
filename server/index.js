'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { AcpClient } = require('./acp-client');

const projectRoot = path.resolve(__dirname, '..');
const webRoot = path.join(projectRoot, 'web');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4273);
const acp = new AcpClient({
  cwd: projectRoot,
  agent: 'daily-guru',
  command: process.env.KIRO_CLI_PATH
});

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);

  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { status: 'ok', acp: acp.status });
    }

    if (request.method === 'POST' && url.pathname === '/api/teaching') {
      assertLocalOrigin(request);
      const result = await acp.prompt([
        'Mode: teaching.',
        'Share one short daily teaching from Buddhist or Hindu wisdom for the user starting their day.',
        'Respond in Spanish unless the user clearly prefers English.',
        'Return only the teaching JSON object defined in the daily-guidance skill.'
      ].join('\n'));
      return sendJson(response, 200, { teaching: normalizeTeaching(result.text) });
    }

    if (request.method === 'POST' && url.pathname === '/api/advice') {
      assertLocalOrigin(request);
      const body = await readJsonBody(request);
      const dayText = cleanText(body.day, 4000);
      if (!dayText) return sendJson(response, 400, { error: 'Cuéntame cómo estuvo tu día primero' });

      const result = await acp.prompt([
        'Mode: advice.',
        'The user is telling you about their day. Listen with warmth and give gentle guru guidance.',
        '<user_day>',
        dayText,
        '</user_day>',
        'Respond in Spanish unless the user clearly wrote in English.',
        'Return only the advice JSON object defined in the daily-guidance skill.'
      ].join('\n'));
      return sendJson(response, 200, { advice: normalizeAdvice(result.text) });
    }

    if (request.method === 'POST' && url.pathname === '/api/cancel') {
      assertLocalOrigin(request);
      return sendJson(response, 200, { cancelled: acp.cancel() });
    }

    if (request.method === 'GET') return serveStatic(url.pathname, response);
    return sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error(error);
    return sendJson(response, status, { error: error.message || 'Unexpected server error' });
  }
});

server.listen(port, host, () => {
  console.log(`Daily Guru: http://${host}:${port}`);
  console.log('Kiro ACP will start when you open the app and receive your first teaching.');
});

// --- Response normalization ---

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

function normalizeTeaching(rawText) {
  const raw = parseJsonObject(rawText);
  const teaching = cleanText(raw.teaching, 1200);
  if (!teaching) throw new Error('El guru no entregó una enseñanza válida');
  return {
    mode: 'teaching',
    tradition: cleanText(raw.tradition, 60) || 'Sabiduría contemplativa',
    title: cleanText(raw.title, 160) || 'Enseñanza del día',
    teaching,
    reflection: cleanText(raw.reflection, 600),
    source: cleanText(raw.source, 160)
  };
}

function normalizeAdvice(rawText) {
  const raw = parseJsonObject(rawText);
  const acknowledgement = cleanText(raw.acknowledgement, 800);
  const wisdom = cleanText(raw.wisdom, 1200);
  const advice = Array.isArray(raw.advice)
    ? raw.advice.map((item) => cleanText(item, 600)).filter(Boolean).slice(0, 3)
    : (cleanText(raw.advice, 600) ? [cleanText(raw.advice, 600)] : []);
  if (!wisdom && !advice.length) throw new Error('El guru no entregó un consejo válido');
  return {
    mode: 'advice',
    acknowledgement,
    wisdom,
    advice,
    closing: cleanText(raw.closing, 400)
  };
}

function cleanText(value, maximumLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}

// --- HTTP helpers ---

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        const error = new Error('Request body is too large');
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        error.message = 'Request body must be valid JSON';
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function assertLocalOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (error) {
    const invalid = new Error('Invalid request origin');
    invalid.statusCode = 403;
    throw invalid;
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    const denied = new Error('Only local browser requests are allowed');
    denied.statusCode = 403;
    throw denied;
  }
}

function serveStatic(requestPath, response) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(webRoot, relativePath);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${path.sep}`)) {
    return sendJson(response, 403, { error: 'Forbidden' });
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return sendJson(response, 404, { error: 'Not found' });
  }
  if (!stat.isFile()) return sendJson(response, 404, { error: 'Not found' });

  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  };
  response.writeHead(200, { 'content-type': types[extension] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, statusCode, body) {
  if (response.writableEnded) return;
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function setSecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:");
  response.setHeader('cache-control', 'no-store');
}

function shutdown() {
  acp.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
