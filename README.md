# Daily Guru

A calm, local app that opens with a short daily teaching from Buddhist/Hindu wisdom, listens to how your day went (by voice), and gives you gentle guru advice. It uses Kiro CLI via ACP.

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

1. You open the app. It requests a daily teaching from the local server.
2. The server starts `kiro-cli acp --agent daily-guru` when needed.
3. The guru returns a short teaching (read aloud automatically).
4. You tell the guru about your day, by voice or text.
5. The guru returns gentle, practical advice connected to the wisdom.

By default the app listens exclusively on `127.0.0.1` and never sends Kiro credentials to the browser.

## Architecture

```text
.kiro/
├── agents/daily-guru.md
└── skills/daily-guidance/SKILL.md
server/
├── acp-client.js
└── index.js
web/
├── app.js
├── index.html
└── styles.css
```

- `web/`: single screen with the teaching, voice input, and the guru's advice.
- `server/`: local HTTP server, ACP client, and response validation.
- `.kiro/`: the guru's behavior and its structured JSON contract.

## Voice

Reading the teaching and advice aloud uses `SpeechSynthesis` (Spanish voice when available). Telling the guru about your day uses `SpeechRecognition`/`webkitSpeechRecognition` with `es-ES`. If voice input is not available, type your day into the field instead.

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
