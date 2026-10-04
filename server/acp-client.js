'use strict';

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const fs = require('fs');
const os = require('os');
const path = require('path');

class AcpClient {
  constructor(options) {
    this.cwd = options.cwd;
    this.agent = options.agent || 'daily-guru';
    this.command = options.command || resolveKiroCommand();
    this.child = null;
    this.lineReader = null;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.currentPrompt = null;
    this.starting = null;
    this.initialized = false;
  }

  get status() {
    if (this.initialized && this.child) return 'ready';
    if (this.starting) return 'starting';
    return 'stopped';
  }

  async start() {
    if (this.initialized && this.child) return;
    if (this.starting) return this.starting;

    this.starting = this.startProcess();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async startProcess() {
    this.child = spawn(this.command, ['acp', '--agent', this.agent], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.child.once('error', (error) => this.handleProcessFailure(error));
    this.child.once('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.handleProcessFailure(new Error(`Kiro ACP exited with ${detail}`));
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) process.stderr.write(`[kiro-acp] ${message}\n`);
    });

    this.lineReader = createInterface({ input: this.child.stdout });
    this.lineReader.on('line', (line) => this.handleLine(line));

    const result = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: 'daily-guru',
        version: '0.1.0'
      }
    });

    if (!result || result.protocolVersion !== 1) {
      throw new Error(`Unsupported ACP protocol version: ${result && result.protocolVersion}`);
    }

    this.initialized = true;
  }

  async newSession() {
    await this.start();
    const result = await this.request('session/new', {
      cwd: this.cwd,
      mcpServers: [],
      _meta: {
        kiro: {
          policyPreset: ['read-workspace']
        }
      }
    });

    if (!result || typeof result.sessionId !== 'string') {
      throw new Error('Kiro ACP did not return a session ID');
    }

    this.sessionId = result.sessionId;
    return this.sessionId;
  }

  async prompt(text) {
    if (!this.sessionId) await this.newSession();
    if (this.currentPrompt) throw new Error('A guru response is already in progress');

    const accumulator = { text: '' };
    this.currentPrompt = accumulator;

    try {
      const result = await this.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text }]
      }, 180000);

      return {
        text: accumulator.text.trim(),
        stopReason: result && result.stopReason ? result.stopReason : 'unknown'
      };
    } finally {
      this.currentPrompt = null;
    }
  }

  cancel() {
    if (!this.child || !this.sessionId || !this.currentPrompt) return false;
    this.send({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: this.sessionId }
    });
    return true;
  }

  request(method, params, timeoutMs) {
    const id = this.nextId++;
    const timeout = timeoutMs || 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timed out: ${method}`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  send(message) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new Error('Kiro ACP is not running');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleLine(line) {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stderr.write(`[kiro-acp] Ignored invalid JSON line: ${line.slice(0, 200)}\n`);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `ACP error in ${pending.method}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === 'session/update') {
      this.handleSessionUpdate(message.params);
      return;
    }

    if (message.method === 'session/request_permission' && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.rejectPermission(message);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Unsupported client method: ${message.method}` }
      });
    }
  }

  handleSessionUpdate(params) {
    if (!this.currentPrompt || !params || !params.update) return;
    const update = params.update;
    if (update.sessionUpdate !== 'agent_message_chunk') return;

    const content = update.content;
    if (content && content.type === 'text' && typeof content.text === 'string') {
      this.currentPrompt.text += content.text;
    }
  }

  rejectPermission(message) {
    const options = message.params && Array.isArray(message.params.options)
      ? message.params.options
      : [];
    const rejectOption = options.find((option) => option.kind === 'reject_once' || option.kind === 'reject_always');
    const outcome = rejectOption
      ? { outcome: 'selected', optionId: rejectOption.optionId }
      : { outcome: 'cancelled' };

    this.send({ jsonrpc: '2.0', id: message.id, result: { outcome } });
  }

  handleProcessFailure(error) {
    if (!this.child && !this.initialized) return;
    this.initialized = false;
    this.sessionId = null;
    this.child = null;
    if (this.lineReader) this.lineReader.close();
    this.lineReader = null;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.currentPrompt = null;
  }

  shutdown() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.initialized = false;
    this.sessionId = null;
    child.kill('SIGTERM');
  }
}

function resolveKiroCommand() {
  if (process.env.KIRO_CLI_PATH) return process.env.KIRO_CLI_PATH;
  const localPath = path.join(os.homedir(), '.local', 'bin', 'kiro-cli');
  return fs.existsSync(localPath) ? localPath : 'kiro-cli';
}

module.exports = { AcpClient };
