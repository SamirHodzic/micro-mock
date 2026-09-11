import * as vscode from 'vscode';
import { state, EndpointEntry } from './state';
import { sendRequest, ParsedRequest } from './sendRequest';
import { getRequestLog, requestLogEvents, RequestLogEntry } from './requestLog';

interface WebviewMessage {
  type: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  text?: string;
}

export class RequestPanel {
  private static current: RequestPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private pendingPrefill: EndpointEntry | undefined;
  private pendingHighlight: number | undefined;

  static createOrShow(prefill?: EndpointEntry, highlightEntry?: RequestLogEntry): void {
    if (RequestPanel.current) {
      RequestPanel.current.panel.reveal(vscode.ViewColumn.Active);
      if (prefill) {
        RequestPanel.current.postPrefill(prefill);
      }
      if (highlightEntry) {
        RequestPanel.current.postHistory(highlightEntry.timestamp);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel('microMockRequestPanel', 'Micro Mock', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    RequestPanel.current = new RequestPanel(panel, prefill, highlightEntry);
  }

  private constructor(panel: vscode.WebviewPanel, prefill?: EndpointEntry, highlightEntry?: RequestLogEntry) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.pendingPrefill = prefill;
    this.pendingHighlight = highlightEntry?.timestamp;

    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message), undefined, this.disposables);

    const onLogChange = () => this.postHistory();
    requestLogEvents.on('change', onLogChange);
    this.disposables.push({ dispose: () => requestLogEvents.off('change', onLogChange) });

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private handleMessage(message: WebviewMessage): void {
    if (message.type === 'ready') {
      this.postHistory(this.pendingHighlight);
      this.pendingHighlight = undefined;
      if (this.pendingPrefill) {
        this.postPrefill(this.pendingPrefill);
        this.pendingPrefill = undefined;
      }
      return;
    }

    if (message.type === 'send') {
      void this.send(message);
      return;
    }

    if (message.type === 'copyCurl' && message.text) {
      vscode.env.clipboard.writeText(message.text);
      vscode.window.setStatusBarMessage('Micro Mock: copied as cURL', 2000);
    }
  }

  private async send(message: WebviewMessage): Promise<void> {
    const body = (message.body ?? '').trim();
    const parsed: ParsedRequest = {
      method: message.method ?? 'GET',
      url: message.url ?? '',
      headers: message.headers ?? {},
      body: body.length > 0 ? body : undefined,
    };

    try {
      await sendRequest(parsed);
    } catch (err) {
      this.panel.webview.postMessage({ type: 'error', message: (err as Error).message });
    } finally {
      this.panel.webview.postMessage({ type: 'sendComplete' });
    }
  }

  private postPrefill(entry: EndpointEntry): void {
    const method = entry.method.toUpperCase();
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);

    const query = new URLSearchParams(entry.query).toString();
    const url = `http://localhost:${state.publicPort}${entry.resolvedPath}${query ? `?${query}` : ''}`;

    const headers = { ...entry.headers };
    if (hasBody && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    this.panel.webview.postMessage({
      type: 'prefill',
      method,
      url,
      headers,
      body: hasBody ? (entry.bodyExample ?? '{}') : '',
    });
  }

  private postHistory(highlightTimestamp?: number): void {
    this.panel.webview.postMessage({ type: 'history', entries: getRequestLog(), highlightTimestamp });
  }

  private dispose(): void {
    RequestPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 12px;
  }
  label { display: block; font-size: 12px; opacity: 0.8; margin: 10px 0 4px; }
  select, input, textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 6px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
  }
  select { width: auto; min-width: 100px; }
  .method-row { display: flex; gap: 8px; align-items: flex-end; }
  .method-row label { margin: 0; }
  .method-row .url-field { flex: 1; }
  textarea { resize: vertical; }
  button {
    margin-top: 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.6; cursor: default; }
  .spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    vertical-align: middle;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .link-btn {
    margin: 0;
    background: transparent;
    color: var(--vscode-textLink-foreground);
    padding: 0;
    font-size: 12px;
  }
  .link-btn:hover { background: transparent; text-decoration: underline; }
  #error { color: var(--vscode-errorForeground); margin-top: 8px; min-height: 1em; }
  .header-row { display: flex; gap: 4px; margin-bottom: 4px; }
  .header-row input { width: auto; }
  .header-key { flex: 0 0 35%; }
  .header-value { flex: 1; }
  .remove-header {
    margin: 0;
    flex: 0 0 auto;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: none;
    padding: 0 8px;
    font-size: 14px;
    cursor: pointer;
  }
  .remove-header:hover { color: var(--vscode-errorForeground); background: transparent; }
  #addHeader { margin-top: 2px; }
  .body-header { display: flex; justify-content: space-between; align-items: baseline; margin: 10px 0 4px; }
  .body-header label { margin: 0; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); min-height: 1.2em; margin-top: 3px; }
  .hint.invalid { color: var(--vscode-errorForeground); }
  textarea.invalid { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
  h2 { font-size: 13px; font-weight: 600; opacity: 0.8; margin: 24px 0 8px; }
  .entry {
    border: 1px solid var(--vscode-widget-border, transparent);
    background: var(--vscode-editorWidget-background);
    margin-bottom: 4px;
  }
  .summary { padding: 6px 8px; cursor: pointer; font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
  .summary:hover { background: var(--vscode-list-hoverBackground); }
  .body { margin: 0; padding: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-all; border-top: 1px solid var(--vscode-widget-border, transparent); }
  .empty { opacity: 0.6; font-size: 12px; }
</style>
</head>
<body>
  <div class="method-row">
    <div>
      <label for="method">Method</label>
      <select id="method">
        <option>GET</option>
        <option>POST</option>
        <option>PUT</option>
        <option>PATCH</option>
        <option>DELETE</option>
        <option>HEAD</option>
        <option>OPTIONS</option>
      </select>
    </div>
    <div class="url-field">
      <label for="url">URL</label>
      <input id="url" type="text" value="http://localhost:4010/">
    </div>
  </div>

  <label>Headers</label>
  <div id="headersList"></div>
  <button id="addHeader" class="link-btn" type="button">+ Add Header</button>

  <div class="body-header">
    <label for="body">Body</label>
    <button id="formatBody" class="link-btn" type="button">Format JSON</button>
  </div>
  <textarea id="body" rows="8"></textarea>
  <div id="bodyHint" class="hint"></div>

  <button id="send">Send Request</button>
  <button id="copyCurl" class="link-btn" type="button" style="margin-left: 10px;">Copy as cURL</button>
  <div id="error"></div>

  <h2>Recent Requests</h2>
  <div id="history"><div class="empty">No requests yet.</div></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const methodEl = document.getElementById('method');
  const urlEl = document.getElementById('url');
  const headersListEl = document.getElementById('headersList');
  const bodyEl = document.getElementById('body');
  const bodyHintEl = document.getElementById('bodyHint');
  const errorEl = document.getElementById('error');
  const historyEl = document.getElementById('history');

  function addHeaderRow(key, value) {
    const row = document.createElement('div');
    row.className = 'header-row';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'Key';
    keyInput.className = 'header-key';
    keyInput.value = key || '';

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = 'Value';
    valueInput.className = 'header-value';
    valueInput.value = value || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-header';
    removeBtn.textContent = '\\u00d7';
    removeBtn.title = 'Remove header';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);
    headersListEl.appendChild(row);
  }

  function setHeaderRows(headers) {
    headersListEl.innerHTML = '';
    const entries = Object.entries(headers || {});
    for (const [key, value] of entries) {
      addHeaderRow(key, value);
    }
    addHeaderRow('', '');
  }

  function getHeadersFromRows() {
    const headers = {};
    headersListEl.querySelectorAll('.header-row').forEach((row) => {
      const key = row.querySelector('.header-key').value.trim();
      const value = row.querySelector('.header-value').value;
      if (key) headers[key] = value;
    });
    return headers;
  }

  document.getElementById('addHeader').addEventListener('click', () => addHeaderRow('', ''));
  setHeaderRows({});

  function validateBody() {
    const text = bodyEl.value.trim();
    if (!text) {
      bodyEl.classList.remove('invalid');
      bodyHintEl.textContent = '';
      bodyHintEl.classList.remove('invalid');
      return;
    }
    try {
      JSON.parse(text);
      bodyEl.classList.remove('invalid');
      bodyHintEl.textContent = '';
      bodyHintEl.classList.remove('invalid');
    } catch (err) {
      bodyEl.classList.add('invalid');
      bodyHintEl.textContent = 'Not valid JSON \\u2014 will still be sent as raw text: ' + err.message;
      bodyHintEl.classList.add('invalid');
    }
  }

  bodyEl.addEventListener('input', validateBody);

  document.getElementById('formatBody').addEventListener('click', () => {
    try {
      bodyEl.value = JSON.stringify(JSON.parse(bodyEl.value), null, 2);
    } catch (err) {
      // leave content as-is; validateBody below still reports the problem
    }
    validateBody();
  });

  function shellEscape(value) {
    return "'" + String(value).replace(/'/g, "'\\\\''") + "'";
  }

  function buildCurl(method, url, headers, body) {
    const parts = ['curl -X ' + method + ' ' + shellEscape(url)];
    for (const [key, value] of Object.entries(headers)) {
      parts.push('-H ' + shellEscape(key + ': ' + value));
    }
    if (body && body.trim().length > 0) {
      parts.push('-d ' + shellEscape(body));
    }
    return parts.join(' \\\\\\n  ');
  }

  document.getElementById('copyCurl').addEventListener('click', () => {
    const curl = buildCurl(methodEl.value, urlEl.value, getHeadersFromRows(), bodyEl.value);
    vscode.postMessage({ type: 'copyCurl', text: curl });
  });

  const sendBtn = document.getElementById('send');
  const sendBtnLabel = sendBtn.textContent;

  function setSending(sending) {
    sendBtn.disabled = sending;
    sendBtn.innerHTML = sending ? '<span class="spinner"></span>Sending\\u2026' : sendBtnLabel;
  }

  sendBtn.addEventListener('click', () => {
    errorEl.textContent = '';
    setSending(true);
    vscode.postMessage({
      type: 'send',
      method: methodEl.value,
      url: urlEl.value,
      headers: getHeadersFromRows(),
      body: bodyEl.value,
    });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'prefill') {
      methodEl.value = msg.method;
      urlEl.value = msg.url;
      setHeaderRows(msg.headers);
      bodyEl.value = msg.body;
      validateBody();
    } else if (msg.type === 'history') {
      renderHistory(msg.entries, msg.highlightTimestamp);
    } else if (msg.type === 'error') {
      errorEl.textContent = msg.message;
    } else if (msg.type === 'sendComplete') {
      setSending(false);
    }
  });

  function renderHistory(entries, highlightTimestamp) {
    historyEl.innerHTML = '';
    if (!entries || entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No requests yet.';
      historyEl.appendChild(empty);
      return;
    }
    let highlightedRow = null;
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'entry';

      const summary = document.createElement('div');
      summary.className = 'summary';
      const time = new Date(entry.timestamp).toLocaleTimeString();
      summary.textContent = time + '  ' + entry.method + ' ' + entry.path + ' \\u2192 ' + entry.status + ' (' + entry.ms + 'ms)';

      const body = document.createElement('pre');
      body.className = 'body';
      const isHighlighted = highlightTimestamp && entry.timestamp === highlightTimestamp;
      body.style.display = isHighlighted ? 'block' : 'none';
      body.textContent = formatBody(entry.body);

      summary.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });

      row.appendChild(summary);
      row.appendChild(body);
      historyEl.appendChild(row);
      if (isHighlighted) highlightedRow = row;
    }
    if (highlightedRow) {
      highlightedRow.scrollIntoView({ block: 'center' });
    }
  }

  function formatBody(text) {
    if (!text) return '(empty body)';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
