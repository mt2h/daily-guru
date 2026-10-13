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
  voiceURI: localStorage.getItem('dg-voice') || ''
};

// Meditative Tibetan singing bowls generated with the Web Audio API (no external
// files, so it works under the strict Content-Security-Policy).
const ambientSound = {
  context: null,
  master: null,
  timer: null,
  playing: false
};

initialize();

async function initialize() {
  setupSoundToggle();
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

function renderMain() {
  const teaching = model.teaching;
  app.innerHTML = `
    <section class="guru-layout">
      <article class="panel teaching-card">
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

// --- Meditative ambient sound (Web Audio API) ---

function setupSoundToggle() {
  const button = document.querySelector('#sound-toggle');
  if (!button) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    button.disabled = true;
    button.title = 'Sonido no disponible en este navegador';
    return;
  }
  button.addEventListener('click', toggleAmbientSound);
}

function toggleAmbientSound() {
  if (ambientSound.playing) stopAmbientSound();
  else startAmbientSound();
}

function startAmbientSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  if (!ambientSound.context) {
    const context = new AudioCtx();
    const master = context.createGain();
    master.gain.value = 0;

    // Gentle reverb-like warmth: a short feedback-free lowpass to soften the tails.
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    tone.connect(context.destination);
    master.connect(tone);

    ambientSound.context = context;
    ambientSound.master = master;
    ambientSound.timer = null;
  }

  const { context, master } = ambientSound;
  if (context.state === 'suspended') context.resume();
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0.9, now + 1.5);

  ambientSound.playing = true;
  scheduleSingingBowls();
  updateSoundButton();
}

// Pentatonic set of calm, warm bowl pitches (A-based, soothing intervals).
const BOWL_FREQUENCIES = [196.0, 220.0, 261.63, 293.66, 329.63];

// Strikes a single Tibetan singing bowl: a few inharmonic partials with a soft
// attack and a long, slowly fading tail — the hallmark of a real metal bowl.
function strikeSingingBowl(frequency) {
  const { context, master } = ambientSound;
  if (!context || !master) return;
  const now = context.currentTime;

  const bowlGain = context.createGain();
  bowlGain.gain.setValueAtTime(0, now);
  bowlGain.connect(master);

  // Inharmonic partials give the shimmering metallic bell character.
  const partials = [
    { ratio: 1.0, gain: 0.5 },
    { ratio: 2.76, gain: 0.22 },
    { ratio: 5.4, gain: 0.12 },
    { ratio: 8.9, gain: 0.06 }
  ];

  const duration = 7.5;
  partials.forEach((partial, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency * partial.ratio;

    const partialGain = context.createGain();
    partialGain.gain.value = partial.gain;

    // Subtle vibrato on the fundamental for a living, breathing shimmer.
    if (index === 0) {
      const vibrato = context.createOscillator();
      vibrato.frequency.value = 4.5;
      const vibratoGain = context.createGain();
      vibratoGain.gain.value = 1.3;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(oscillator.frequency);
      vibrato.start(now);
      vibrato.stop(now + duration);
    }

    oscillator.connect(partialGain);
    partialGain.connect(bowlGain);
    oscillator.start(now);
    oscillator.stop(now + duration);
  });

  // Soft mallet attack, then a long exponential decay (the singing tail).
  const peak = 0.9;
  bowlGain.gain.linearRampToValueAtTime(peak, now + 0.08);
  bowlGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
}

// Schedules bowls to ring at relaxed, slightly varied intervals.
function scheduleSingingBowls() {
  if (!ambientSound.playing) return;
  const index = Math.floor(Math.random() * BOWL_FREQUENCIES.length);
  strikeSingingBowl(BOWL_FREQUENCIES[index]);

  const nextDelay = 5000 + Math.random() * 4000; // 5–9 seconds between strikes
  ambientSound.timer = setTimeout(scheduleSingingBowls, nextDelay);
}

function stopAmbientSound() {
  if (!ambientSound.context) return;
  const { context, master } = ambientSound;
  if (ambientSound.timer) {
    clearTimeout(ambientSound.timer);
    ambientSound.timer = null;
  }
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + 2);

  ambientSound.playing = false;
  updateSoundButton();
}

function updateSoundButton() {
  const button = document.querySelector('#sound-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed', String(ambientSound.playing));
  button.setAttribute('aria-label', ambientSound.playing ? 'Silenciar cuencos tibetanos' : 'Activar cuencos tibetanos');
  const label = button.querySelector('.sound-label');
  if (label) label.textContent = ambientSound.playing ? 'Cuencos' : 'Cuencos';
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

// Reads any text aloud using a calm Spanish voice when available.
function speakText(text, options) {
  const silent = Boolean(options && options.silent);
  if (!window.speechSynthesis) {
    if (!silent) showError('La lectura en voz alta no está disponible en este navegador.');
    return;
  }
  if (!text) return;

  let spoken = false;
  const speak = () => {
    if (spoken) return;
    spoken = true;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    // Unhurried, serene delivery. Keep pitch near natural — pushing it low is
    // what makes the synthesizer sound metallic/robotic. The chosen voice
    // (ideally "Grandpa" or a cloud voice) already carries the elder character.
    utterance.rate = 0.88;
    utterance.pitch = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const voice = pickCalmSpanishVoice(voices);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  if (!window.speechSynthesis.getVoices().length) {
    window.speechSynthesis.addEventListener('voiceschanged', speak, { once: true });
    setTimeout(speak, 250);
    return;
  }
  speak();
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

  const spanish = voices.filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith('es'));
  const list = spanish.length ? spanish : voices;

  // Rank nicer voices toward the top of the list.
  const rank = (voice) => {
    const name = voice.name || '';
    let value = 0;
    if (voice.localService === false) value += 100;
    if (/grandpa/i.test(name)) value += 60;
    if (/google/i.test(name)) value += 55;
    if (/rocko|reed|eddy|flo|sandy|shelley/i.test(name)) value += 30;
    if (/m[oó]nica|paulina/i.test(name)) value += 20;
    if (/espeak|compact|eloquence|pico/i.test(name)) value -= 50;
    return value;
  };
  const ordered = list.slice().sort((a, b) => rank(b) - rank(a));

  const current = model.voiceURI;
  select.innerHTML = '<option value="">Voz automática</option>';
  ordered.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    const quality = voice.localService === false ? ' ✦' : '';
    option.textContent = `${voice.name} (${voice.lang})${quality}`;
    if (voice.voiceURI === current) option.selected = true;
    select.appendChild(option);
  });
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

  // Ordered wish-list of voices that actually sound good, best first.
  // "Grandpa" is a warm elderly male voice — perfect for a wise guru — and
  // Google/online voices are the most natural when available (e.g. Chrome).
  const preferredByName = [
    /grandpa/i,
    /google.*espa|espa.*google/i,
    /microsoft.*(álvaro|alvaro|dario|dar[ií]o|jorge|elvira|dalia|online|natural)/i,
    /(álvaro|alvaro|jorge|diego|carlos|enrique|gonzalo|pablo)/i, // natural-ish male voices
    /rocko|reed|eddy/i,                                           // newer Siri "novelty" voices
    /m[oó]nica|paulina/i                                          // decent default local voices
  ];

  // Low-quality engines that sound robotic — avoid these.
  const roboticPattern = /espeak|festival|pico|flite|mbrola|robo|compact|eloquence/i;

  const score = (voice) => {
    const name = voice.name || '';
    let value = 0;

    // Rank by position in the wish-list (earlier = much better).
    for (let i = 0; i < preferredByName.length; i += 1) {
      if (preferredByName[i].test(name)) {
        value += (preferredByName.length - i) * 20;
        break;
      }
    }

    // Cloud/neural voices are consistently the most human-sounding.
    if (voice.localService === false) value += 25;
    if (roboticPattern.test(name)) value -= 60;

    return value;
  };

  return pool.slice().sort((a, b) => score(b) - score(a))[0];
}

// --- UI helpers ---

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
