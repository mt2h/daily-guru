# Daily Guru

A calm, local app that opens with a short daily teaching from Buddhist/Hindu/Taoist wisdom, listens to how your day went (by voice), and gives you gentle guru advice. It uses Kiro CLI via ACP.

## Run

```bash
cd /home/cristhian/repos/daily-guru
kiro-cli whoami
npm start
```

Then visit `http://127.0.0.1:4273`. When the app opens, Kiro starts automatically and the guru prepares your teaching of the day.

If `kiro-cli whoami` reports that there is no active session:

```bash
kiro-cli login
```

No `npm install` is required: the project uses only modules bundled with Node.js and browser APIs.

## Flow

1. You open the app. A home screen shows two cards, "Daily teaching" and "Active break". Nothing is requested from Kiro yet.
2. You choose one. Only then does the local server start `kiro-cli acp --agent daily-guru` (if needed) and request that content.
3. The teaching or the active break appears. Reading aloud only happens when you press "Listen".
4. Below it you can tell the guru about your day, by voice or text.
5. The guru returns gentle, practical advice connected to the wisdom.
6. "Back" returns to the home screen; content already generated is kept and not requested again.

By default the app listens exclusively on `127.0.0.1` and never sends Kiro credentials to the browser.

## Active break

An on-demand exercise of 2 to 5 minutes (movement and breath, done on the spot, no equipment) with 3 to 6 steps and a safety note. Each press of "Otra pausa" requests a new one. The tradition rotates on every request (Kriya Yoga, Buddhism, Taoism, Zen), starting from a tradition derived from the date. The browser sends the titles of the last five breaks so the guru does not repeat them. The rotation lives in server memory and restarts when the server restarts. Nothing is cached. The card has a "Listen" button.

Kriya Yoga exercises are limited to beginner-safe techniques (natural breath awareness, soft breathing, mantra, meditation, self-inquiry). Advanced techniques that are normally received through initiation from a teacher are never proposed.

## Architecture

```text
.kiro/
├── agents/daily-guru.md
└── skills/daily-guidance/SKILL.md
server/
├── acp-client.js
├── index.js
├── practice.js
├── practice.test.js
└── text.js
web/
├── app.js
├── index.html
└── styles.css
```

- `web/`: single screen with the teaching, voice input, and the guru's advice.
- `server/`: local HTTP server, ACP client, and response validation.
- `.kiro/`: the guru's behavior and its structured JSON contract.

## Voice

Reading the teaching and advice aloud uses the browser's own `SpeechSynthesis`
(no OS/system TTS). Pick any installed voice from the "Voz" dropdown in the
header; your choice is remembered. For the best Spanish voices on Linux, use
**Chrome or Brave**, which bundle their own "Google español" voices. Firefox on
Linux relies on the system `speech-dispatcher` and may expose no voices.

Telling the guru about your day uses `SpeechRecognition`/`webkitSpeechRecognition`
with `es-ES` (available in Chrome/Brave). If voice input is not available, type
your day into the field instead.

## Configuration

Optional variables:

```bash
HOST=127.0.0.1 PORT=4273 KIRO_CLI_PATH=/path/to/kiro-cli npm start
```

Keep `HOST=127.0.0.1` unless you add authentication and network protection.

## Verification

```bash
npm run check
curl http://127.0.0.1:4273/api/health
```

The endpoint should respond with `"status":"ok"`. The ACP status appears as `stopped` until the app opens and changes to `ready` once connected to Kiro.

## Note

This app shares general spiritual reflections for calm and perspective. It does not provide medical, legal, or financial advice.
