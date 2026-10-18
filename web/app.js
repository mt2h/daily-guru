'use strict';

const app = document.querySelector('#app');
const connectionStatus = document.querySelector('#connection-status');
const messageBox = document.querySelector('#message');
const liveRegion = document.querySelector('#live-region');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const model = {
  teaching: null,
  advice: null,
  recognition: null,
  listening: false,
  toastTimer: null,
  voiceURI: localStorage.getItem('dg-voice') || '',
  // Browsers block speech synthesis until the user interacts with the page.
  // We track that gesture and remember any reading that was blocked so we can
  // play it the moment the user clicks or presses a key.
  userInteracted: false,
  pendingSpeech: null
};

// Unlock audio/voice on the first user gesture, then flush any pending reading.
function registerUserGesture() {
  if (model.userInteracted) return;
  model.userInteracted = true;
  if (model.pendingSpeech) {
    const text = model.pendingSpeech;
    model.pendingSpeech = null;
    hideSpeechHint();
    speakText(text);
  }
}
['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
  window.addEventListener(eventName, registerUserGesture, { once: false });
});

initialize();

async function initialize() {
  setupVoicePicker();
  renderLoading('El guru está preparando tu enseñanza del día…');
  try {
    const health = await api('/api/health');
    updateConnection(health.acp);
    const result = await api('/api/teaching', { method: 'POST', body: {} });
    model.teaching = result.teaching;
    updateConnection('ready');
    renderMain();
    // Read the teaching aloud as soon as it appears.
    speakText(teachingToSpeech(model.teaching), { silent: true });
  } catch (error) {
    renderError(error.message);
    updateConnection('stopped');
  }
}

function renderLoading(text) {
  app.innerHTML = `
    <section class="loading-card" aria-label="Cargando">
      <span class="spinner"></span>
      <p>${escapeHtml(text)}</p>
    </section>`;
}

function renderError(message) {
  app.innerHTML = `
    <section class="panel completion">
      <div>
        <div class="completion-mark">!</div>
        <p class="eyebrow">Algo interrumpió la calma</p>
        <h2>No pudimos preparar tu enseñanza</h2>
        <p class="lead">${escapeHtml(message)}</p>
        <button class="btn btn-primary" id="retry-load">Intentar de nuevo</button>
      </div>
    </section>`;
  document.querySelector('#retry-load').addEventListener('click', initialize);
  focusApp();
}

const TRADITION_THEMES = [
  [/budd|budis/i, 'buddhism'],
  [/hindu/i, 'hinduism'],
  [/tao|lao|dao/i, 'taoism']
];

function traditionTheme(tradition) {
  const match = TRADITION_THEMES.find(([pattern]) => pattern.test(String(tradition || '')));
  return match ? match[1] : 'buddhism';
}

function renderMain() {
  const teaching = model.teaching;
  app.innerHTML = `
    <section class="guru-layout">
      <article class="panel teaching-card" data-tradition="${traditionTheme(teaching.tradition)}">
        <div class="teaching-head">
          <span class="meta-chip">${escapeHtml(teaching.tradition)}</span>
          <button class="btn btn-ghost listen-btn" id="hear-teaching" type="button">🔊 Escuchar</button>
        </div>
        <p class="eyebrow">Enseñanza del día</p>
        <h1 class="teaching-title">${escapeHtml(teaching.title)}</h1>
        <p class="teaching-text">${escapeHtml(teaching.teaching)}</p>
        ${teaching.reflection ? `<div class="reflection"><strong>Reflexión</strong><p>${escapeHtml(teaching.reflection)}</p></div>` : ''}
        ${teaching.source ? `<p class="source">${escapeHtml(teaching.source)}</p>` : ''}
      </article>

      <article class="panel day-card">
        <p class="eyebrow">Cuéntale a tu guru</p>
        <h2>¿Cómo estuvo tu día?</h2>
        <p class="muted">Habla con libertad. Cuando termines, el guru te dará un consejo.</p>
        <div class="answer-box">
          <label class="sr-only" for="day-input">Cómo estuvo tu día</label>
          <textarea id="day-input" maxlength="4000" placeholder="Pulsa el micrófono y cuéntame tu día…"></textarea>
          <div class="answer-toolbar">
            <button class="mic-button" id="mic-button" type="button" aria-label="Comenzar a hablar">MIC</button>
            <span class="speech-status" id="speech-status">${SpeechRecognition ? 'Pulsa MIC y habla; no te preocupes por los detalles.' : 'Dictado no disponible aquí; escribe cómo estuvo tu día.'}</span>
            <button class="btn btn-primary" id="send-day" type="button">Pedir consejo →</button>
          </div>
        </div>
      </article>

      <div id="advice-slot"></div>
    </section>`;

  const micButton = document.querySelector('#mic-button');
  if (!SpeechRecognition) micButton.disabled = true;
  micButton.addEventListener('click', toggleRecognition);
  document.querySelector('#send-day').addEventListener('click', askAdvice);
  document.querySelector('#hear-teaching').addEventListener('click', () => speakText(teachingToSpeech(model.teaching)));
  document.querySelector('#day-input').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') askAdvice();
  });

  if (model.advice) renderAdvice(model.advice);
  focusApp();
}

async function askAdvice() {
  stopRecognition();
  const textarea = document.querySelector('#day-input');
  const day = textarea.value.trim();
  if (!day) {
    showError('Cuéntame cómo estuvo tu día antes de pedir consejo.');
    textarea.focus();
    return;
  }

  setBusy(true, 'El guru está reflexionando sobre tu día…');
  try {
    const result = await api('/api/advice', { method: 'POST', body: { day } });
    model.advice = result.advice;
    renderAdvice(model.advice);
    speakText(adviceToSpeech(model.advice), { silent: true });
    announce('Tu guru te dio un consejo.');
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

function renderAdvice(advice) {
  const slot = document.querySelector('#advice-slot');
  slot.innerHTML = `
    <article class="panel advice-card">
      <div class="teaching-head">
        <span class="meta-chip">Consejo del guru</span>
        <button class="btn btn-ghost listen-btn" id="hear-advice" type="button">🔊 Escuchar</button>
      </div>
      ${advice.acknowledgement ? `<p class="advice-ack">${escapeHtml(advice.acknowledgement)}</p>` : ''}
      ${advice.wisdom ? `<p class="advice-wisdom">${escapeHtml(advice.wisdom)}</p>` : ''}
      ${advice.advice && advice.advice.length ? `<ul class="advice-list">${advice.advice.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
      ${advice.closing ? `<p class="advice-closing">${escapeHtml(advice.closing)}</p>` : ''}
    </article>`;
  document.querySelector('#hear-advice').addEventListener('click', () => speakText(adviceToSpeech(model.advice)));
  slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Speech recognition (voice input) ---

function toggleRecognition() {
  if (model.listening) stopRecognition();
  else startRecognition();
}

function startRecognition() {
  if (!SpeechRecognition) return;
  stopRecognition();

  const textarea = document.querySelector('#day-input');
  const baseText = textarea.value.trim();
  const recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.continuous = true;
  recognition.interimResults = true;
  model.recognition = recognition;

  recognition.onstart = () => {
    model.listening = true;
    updateMicState('Escuchando… habla con calma');
  };

  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let index = 0; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += `${text} `;
      else interimText += text;
    }
    textarea.value = [baseText, finalText.trim(), interimText.trim()].filter(Boolean).join(' ');
  };

  recognition.onerror = (event) => {
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      showError(`No pudimos usar el micrófono: ${event.error}`);
    }
  };

  recognition.onend = () => {
    model.listening = false;
    model.recognition = null;
    updateMicState('Pulsa MIC para seguir hablando');
  };

  try {
    recognition.start();
  } catch (error) {
    showError('El reconocimiento de voz ya estaba activo. Intenta nuevamente.');
  }
}

function stopRecognition() {
  if (model.recognition) {
    const recognition = model.recognition;
    model.recognition = null;
    model.listening = false;
    try { recognition.stop(); } catch (error) { /* Already stopped. */ }
  }
  updateMicState(SpeechRecognition ? 'Pulsa MIC y habla; no te preocupes por los detalles.' : 'Dictado no disponible.');
}

function updateMicState(statusText) {
  const button = document.querySelector('#mic-button');
  const status = document.querySelector('#speech-status');
  if (button) {
    button.classList.toggle('listening', model.listening);
    button.textContent = model.listening ? 'STOP' : 'MIC';
    button.setAttribute('aria-label', model.listening ? 'Detener' : 'Comenzar a hablar');
  }
  if (status) status.textContent = statusText;
}

// --- Speech synthesis (reading aloud) ---

function teachingToSpeech(teaching) {
  if (!teaching) return '';
  return [teaching.title, teaching.teaching, teaching.reflection].filter(Boolean).join('. ');
}

function adviceToSpeech(advice) {
  if (!advice) return '';
  return [advice.acknowledgement, advice.wisdom, ...(advice.advice || []), advice.closing]
    .filter(Boolean)
    .join('. ');
}

// Reads any text aloud using the browser's built-in speech synthesis
// (Web Speech API). On Linux, Brave/Chrome expose system voices through
// speech-dispatcher, which is configured here to use the natural-sounding
// Piper neural voice. This runs entirely in the browser — no server call.
function speakText(text, options) {
  const silent = Boolean(options && options.silent);
  if (!text) return;

  if (!window.speechSynthesis) {
    if (!silent) showError('Tu navegador no soporta lectura en voz alta.');
    return;
  }

  // Browsers refuse to speak before the first user interaction. If this is an
  // automatic reading and the user hasn't interacted yet, remember it and show
  // a gentle hint instead of failing silently.
  if (silent && !model.userInteracted) {
    model.pendingSpeech = text;
    showSpeechHint();
    return;
  }

  let spoken = false;
  const utter = (voices) => {
    if (spoken) return;
    spoken = true;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickCalmSpanishVoice(voices);
    if (voice) utterance.voice = voice;
    // Follow the chosen voice's own locale (e.g. es-MX, es-US) so Latin
    // American voices keep their accent instead of being forced to es-ES.
    utterance.lang = (voice && voice.lang) || 'es-US';
    // Natural, flowing delivery. Keep rate near normal so it never drags, and
    // pitch at 1.0 so good neural voices sound human rather than robotic.
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // Voices load asynchronously in Chromium-based browsers (Brave, Chrome). On
  // Linux especially they can arrive well after page load, so we poll a few
  // times and also listen for `voiceschanged` instead of giving up after a
  // single short timeout. We only surface the "no voices" hint once every
  // retry has come back empty.
  const maxAttempts = 20; // ~5s total at 250ms each
  let attempts = 0;
  let settled = false;

  const trySpeak = () => {
    if (settled) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', trySpeak);
      utter(voices);
      return;
    }
    attempts += 1;
    if (attempts >= maxAttempts) {
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', trySpeak);
      if (!silent) {
        showError('Tu navegador no expone voces de síntesis. En Brave/Chrome en Linux lanza el navegador con el flag --enable-speech-dispatcher (o añádelo a ~/.config/brave-flags.conf) y reinícialo.');
      }
      return;
    }
    setTimeout(trySpeak, 250);
  };

  window.speechSynthesis.addEventListener('voiceschanged', trySpeak);
  trySpeak();
}

// Builds the voice dropdown so the user can pick the voice they like best.
// Browser TTS quality varies wildly, so letting the user choose is the most
// reliable fix for a bad default voice.
function setupVoicePicker() {
  const select = document.querySelector('#voice-select');
  if (!select || !window.speechSynthesis) {
    if (select) select.style.display = 'none';
    return;
  }

  const fill = () => populateVoiceList(select);
  fill();
  window.speechSynthesis.addEventListener('voiceschanged', fill);

  select.addEventListener('change', () => {
    model.voiceURI = select.value;
    if (model.voiceURI) localStorage.setItem('dg-voice', model.voiceURI);
    else localStorage.removeItem('dg-voice');
    // Preview the chosen voice right away.
    speakText('Hola. Soy tu guru. Que tu día esté lleno de calma.');
  });
}

function populateVoiceList(select) {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;

  const latinLocale = /^es[-_](us|mx|419|ar|co|cl|pe|ve|gt|ec|bo|cr|do|hn|ni|pa|py|pr|sv|uy)/i;
  const maleNames = /(álvaro|alvaro|jorge|diego|carlos|enrique|gonzalo|pablo|dar[ií]o|yago|liam|miguel|\bmale\b|hombre)/i;
  const femaleNames = /(elvira|dalia|sabina|paloma|m[oó]nica|paulina|helena|laura|luc[ií]a|female|mujer)/i;

  // Human-friendly region label so the user can tell Latin American voices
  // apart from the European (Spain) ones.
  const regionLabel = (lang) => {
    const code = String(lang || '').toLowerCase();
    if (/^es[-_]es/.test(code)) return 'España';
    if (/^es[-_]mx/.test(code)) return 'México';
    if (/^es[-_]us/.test(code)) return 'Latino (EE. UU.)';
    if (/^es[-_]419/.test(code)) return 'Latinoamérica';
    if (/^es[-_]ar/.test(code)) return 'Argentina';
    if (/^es[-_]co/.test(code)) return 'Colombia';
    if (/^es[-_]cl/.test(code)) return 'Chile';
    if (/^es[-_]pe/.test(code)) return 'Perú';
    if (/^es[-_]ve/.test(code)) return 'Venezuela';
    if (latinLocale.test(code)) return 'Latino';
    if (/^es/.test(code)) return 'Español';
    return lang || 'Otro';
  };

  // Guess gender from the voice name so the user can pick a female voice.
  const genderTag = (name) => {
    if (femaleNames.test(name)) return ' ♀';
    if (maleNames.test(name)) return ' ♂';
    return '';
  };

  // Show every Spanish voice first (there can be many), then all remaining
  // voices so the user has the widest possible choice.
  const spanish = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('es'));
  const others = voices.filter((v) => !(v.lang && v.lang.toLowerCase().startsWith('es')));

  // Rank nicer voices toward the top: natural/online and female first.
  const rank = (voice) => {
    const name = voice.name || '';
    let value = 0;
    if (voice.localService === false) value += 100;
    if (/google/i.test(name)) value += 55;
    if (/microsoft.*(natural|online)/i.test(name)) value += 50;
    if (femaleNames.test(name)) value += 20;
    if (maleNames.test(name)) value -= 10;
    if (/espeak|compact|eloquence|pico|festival/i.test(name)) value -= 50;
    return value;
  };
  const orderedSpanish = spanish.slice().sort((a, b) => rank(b) - rank(a));
  const orderedOthers = others.slice().sort((a, b) => rank(b) - rank(a));

  const current = model.voiceURI;
  const addOption = (voice) => {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    const quality = voice.localService === false ? ' ✦' : '';
    option.textContent = `${regionLabel(voice.lang)} · ${voice.name}${genderTag(voice.name)}${quality}`;
    if (voice.voiceURI === current) option.selected = true;
    select.appendChild(option);
  };

  select.innerHTML = '<option value="">Voz automática</option>';
  orderedSpanish.forEach(addOption);
  if (orderedOthers.length) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '──────── Otros idiomas ────────';
    select.appendChild(sep);
    orderedOthers.forEach(addOption);
  }
}

function pickCalmSpanishVoice(voices) {
  // If the user explicitly chose a voice, always honor it.
  if (model.voiceURI) {
    const chosen = (voices || []).find((voice) => voice.voiceURI === model.voiceURI);
    if (chosen) return chosen;
  }
  const spanish = (voices || []).filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith('es'));
  const pool = spanish.length ? spanish : (voices || []);
  if (!pool.length) return null;

  // Names that are typically male — we want a female voice by default, so we
  // push these down.
  const maleNames = /(álvaro|alvaro|jorge|diego|carlos|enrique|gonzalo|pablo|dar[ií]o|yago|liam|miguel|male)/i;
  // Names/markers that are typically female.
  const femaleNames = /(elvira|dalia|sabina|paloma|m[oó]nica|paulina|helena|laura|lucia|luc[ií]a|female|mujer)/i;

  // Low-quality engines that sound robotic — avoid these.
  const roboticPattern = /espeak|festival|pico|flite|mbrola|robo|compact|eloquence/i;

  const score = (voice) => {
    const name = voice.name || '';
    const lang = (voice.lang || '').toLowerCase();
    let value = 0;

    // Default behaviour mirrors the original: a Spain (es-ES) voice.
    if (/^es[-_]es/.test(lang)) value += 60;

    // Prefer female voices.
    if (femaleNames.test(name)) value += 40;
    if (maleNames.test(name)) value -= 40;

    // Google/online voices are the most natural (and female by default on
    // Chrome/Brave for es-ES), so rank them high.
    if (/google/i.test(name)) value += 50;
    if (/microsoft.*(natural|online)/i.test(name)) value += 45;

    // Cloud/neural voices are consistently the most human-sounding.
    if (voice.localService === false) value += 25;
    if (roboticPattern.test(name)) value -= 60;

    return value;
  };

  return pool.slice().sort((a, b) => score(b) - score(a))[0];
}

// --- UI helpers ---

// Shows a dismissible hint telling the user to interact so the guru can speak.
function showSpeechHint() {
  if (document.querySelector('#speech-hint')) return;
  const hint = document.createElement('button');
  hint.id = 'speech-hint';
  hint.type = 'button';
  hint.className = 'speech-hint';
  hint.innerHTML = '🔊 Toca para escuchar al guru';
  hint.addEventListener('click', registerUserGesture);
  document.body.appendChild(hint);
}

function hideSpeechHint() {
  const hint = document.querySelector('#speech-hint');
  if (hint) hint.remove();
}

function setBusy(busy, label) {
  const existing = document.querySelector('#busy-overlay');
  if (!busy) {
    if (existing) existing.remove();
    return;
  }
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'busy-overlay';
  overlay.className = 'busy-overlay';
  overlay.innerHTML = `
    <div class="busy-dialog" role="status" aria-live="polite">
      <span class="spinner"></span>
      <h3>${escapeHtml(label)}</h3>
      <p>Un momento de calma mientras el guru responde.</p>
    </div>`;
  document.body.appendChild(overlay);
}

async function api(url, options) {
  const request = options || {};
  const response = await fetch(url, {
    method: request.method || 'GET',
    headers: request.body ? { 'content-type': 'application/json' } : {},
    body: request.body ? JSON.stringify(request.body) : undefined
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`El servidor respondió con HTTP ${response.status}`);
  }

  if (!response.ok) throw new Error(payload.error || `Error HTTP ${response.status}`);
  return payload;
}

function updateConnection(status) {
  const label = connectionStatus.querySelector('span:last-child');
  connectionStatus.classList.toggle('offline', status === 'stopped');
  label.textContent = status === 'ready' ? 'Kiro conectado' : 'Local';
}

function showError(message) {
  clearTimeout(model.toastTimer);
  messageBox.textContent = message;
  messageBox.hidden = false;
  model.toastTimer = setTimeout(() => { messageBox.hidden = true; }, 7000);
  announce(message);
}

function announce(message) {
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = message; }, 20);
}

function focusApp() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  app.focus({ preventScroll: true });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
