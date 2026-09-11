import * as vscode from 'vscode';
import { state, ErrorCodeEntry, EndpointEntry } from './state';
import { findFreePort } from './freePort';
import { startPrism, PrismInstance } from './mockServer';
import { startChaosProxy, ChaosProxyInstance } from './chaosProxy';
import { createStatusBarItem, updateStatusBar } from './statusBar';
import { MicroMockTreeItem, MicroMockTreeProvider } from './treeView';
import { clearRequestLog, RequestLogEntry } from './requestLog';
import { RequestPanel } from './requestPanel';

let prismInstance: PrismInstance | undefined;
let chaosInstance: ChaosProxyInstance | undefined;
let statusBarItem: vscode.StatusBarItem;
let treeProvider: MicroMockTreeProvider;
let specWatcher: vscode.FileSystemWatcher | undefined;
let reloadTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('microMock');
  state.errorCodes = config.get<ErrorCodeEntry[]>('errorCodes', []);
  state.latencyMs = config.get<number>('latencyMs', 0);

  statusBarItem = createStatusBarItem();
  updateStatusBar(statusBarItem, state);

  treeProvider = new MicroMockTreeProvider();

  context.subscriptions.push(
    statusBarItem,
    vscode.window.registerTreeDataProvider('microMockView', treeProvider),
    vscode.commands.registerCommand('microMock.startMockServer', (uri?: vscode.Uri) => startMockServer(uri)),
    vscode.commands.registerCommand('microMock.stopMockServer', () => stopMockServer()),
    vscode.commands.registerCommand('microMock.addErrorCode', () => addErrorCode()),
    vscode.commands.registerCommand('microMock.editErrorCode', (item: MicroMockTreeItem) => editErrorCode(item)),
    vscode.commands.registerCommand('microMock.removeErrorCode', (item: MicroMockTreeItem) => removeErrorCode(item)),
    vscode.commands.registerCommand('microMock.setLatency', () => setLatency()),
    vscode.commands.registerCommand('microMock.clearRequestLog', () => clearRequestLog()),
    vscode.commands.registerCommand('microMock.newRequest', (entry: EndpointEntry) => RequestPanel.createOrShow(entry)),
    vscode.commands.registerCommand('microMock.openRequestPanel', (entry?: RequestLogEntry) =>
      RequestPanel.createOrShow(undefined, entry)
    )
  );
}

export async function deactivate(): Promise<void> {
  clearTimeout(reloadTimer);
  specWatcher?.dispose();
  chaosInstance?.stop();
  await prismInstance?.stop();
}

function refreshUI(): void {
  updateStatusBar(statusBarItem, state);
  treeProvider.refresh();
}

async function startMockServer(uri: vscode.Uri | undefined): Promise<void> {
  if (state.running) {
    vscode.window.showInformationMessage('Micro Mock: a mock server is already running. Stop it first.');
    return;
  }

  const specUri = uri ?? (await pickSpecFile());
  if (!specUri) {
    return;
  }

  const preferredPort = vscode.workspace.getConfiguration('microMock').get<number>('port', 4010);

  let url: string | undefined;
  try {
    prismInstance = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Micro Mock: parsing spec… (large specs can take a while)',
        cancellable: true,
      },
      (_progress, token) =>
        startPrism(specUri.fsPath, (cancel) => {
          token.onCancellationRequested(cancel);
        })
    );
    const publicPort = await findFreePort(preferredPort);
    chaosInstance = startChaosProxy(publicPort, prismInstance.port);

    state.running = true;
    state.specPath = specUri.fsPath;
    state.internalPort = prismInstance.port;
    state.publicPort = publicPort;
    state.operations = prismInstance.operations;
    refreshUI();
    void vscode.commands.executeCommand('workbench.view.extension.microMock');

    url = `http://localhost:${publicPort}`;

    specWatcher = vscode.workspace.createFileSystemWatcher(specUri.fsPath);
    specWatcher.onDidChange(() => scheduleReload());
  } catch (err) {
    prismInstance?.stop().catch(() => undefined);
    chaosInstance?.stop();
    prismInstance = undefined;
    chaosInstance = undefined;
    state.running = false;
    refreshUI();

    const message = (err as Error).message;
    if (message === 'Cancelled.') {
      vscode.window.showInformationMessage('Micro Mock: cancelled.');
    } else {
      vscode.window.showErrorMessage(`Micro Mock: failed to start — ${message}`);
    }
  }

  if (url) {
    vscode.window.showInformationMessage(`Micro Mock: running at ${url}`, 'Copy URL').then((selection) => {
      if (selection === 'Copy URL') {
        vscode.env.clipboard.writeText(url);
      }
    });
  }
}

async function stopMockServer(): Promise<void> {
  if (!state.running) {
    vscode.window.showInformationMessage('Micro Mock: no mock server is running.');
    return;
  }

  clearTimeout(reloadTimer);
  specWatcher?.dispose();
  specWatcher = undefined;

  chaosInstance?.stop();
  await prismInstance?.stop();
  chaosInstance = undefined;
  prismInstance = undefined;

  state.running = false;
  state.specPath = undefined;
  state.internalPort = undefined;
  state.publicPort = undefined;
  state.operations = [];
  refreshUI();
  vscode.window.showInformationMessage('Micro Mock: mock server stopped.');
}

function scheduleReload(): void {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void reloadMockServer(), 300);
}

async function reloadMockServer(): Promise<void> {
  if (!state.running || !state.specPath || !chaosInstance) {
    return;
  }

  try {
    const newPrism = await startPrism(state.specPath);
    await prismInstance?.stop();
    prismInstance = newPrism;
    chaosInstance.setInternalPort(newPrism.port);

    state.internalPort = newPrism.port;
    state.operations = newPrism.operations;
    refreshUI();
    vscode.window.setStatusBarMessage('Micro Mock: reloaded — spec file changed', 3000);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Micro Mock: spec has an error, keeping the previous mock running — ${(err as Error).message}`
    );
  }
}

async function persistErrorCodes(): Promise<void> {
  await vscode.workspace
    .getConfiguration('microMock')
    .update('errorCodes', state.errorCodes, vscode.ConfigurationTarget.Workspace);
}

async function addErrorCode(): Promise<void> {
  const codeInput = await vscode.window.showInputBox({
    prompt: 'HTTP status code to simulate (e.g. 500)',
    validateInput: (value) => validateRange(value, 100, 599),
  });
  if (codeInput === undefined) return;

  const code = Number(codeInput);
  const percentInput = await vscode.window.showInputBox({
    prompt: `% chance of returning ${code}`,
    value: '10',
    validateInput: (value) => validateRange(value, 0, 100),
  });
  if (percentInput === undefined) return;

  const percent = Number(percentInput);
  state.errorCodes = [...state.errorCodes.filter((entry) => entry.code !== code), { code, percent }];
  await persistErrorCodes();
  refreshUI();
}

async function editErrorCode(item: MicroMockTreeItem): Promise<void> {
  const entry = item.data as ErrorCodeEntry;
  const percentInput = await vscode.window.showInputBox({
    prompt: `% chance of returning ${entry.code}`,
    value: String(entry.percent),
    validateInput: (value) => validateRange(value, 0, 100),
  });
  if (percentInput === undefined) return;

  entry.percent = Number(percentInput);
  await persistErrorCodes();
  refreshUI();
}

async function removeErrorCode(item: MicroMockTreeItem): Promise<void> {
  const entry = item.data as ErrorCodeEntry;
  state.errorCodes = state.errorCodes.filter((e) => e !== entry);
  await persistErrorCodes();
  refreshUI();
}

async function setLatency(): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: 'Latency (ms) added to every mock response',
    value: String(state.latencyMs),
    validateInput: (value) => validateRange(value, 0, 10000),
  });
  if (input === undefined) return;

  state.latencyMs = Number(input);
  await vscode.workspace
    .getConfiguration('microMock')
    .update('latencyMs', state.latencyMs, vscode.ConfigurationTarget.Workspace);
  refreshUI();
}

function validateRange(value: string, min: number, max: number): string | undefined {
  const num = Number(value);
  if (Number.isNaN(num) || num < min || num > max) {
    return `Enter a number between ${min} and ${max}`;
  }
  return undefined;
}

async function pickSpecFile(): Promise<vscode.Uri | undefined> {
  const candidates = await vscode.workspace.findFiles(
    '**/*.{yaml,yml,json}',
    '**/{node_modules,vendor,dist,out,build,bin,obj,target,.git,.venv,venv}/**',
    500
  );

  if (candidates.length === 0) {
    vscode.window.showErrorMessage('Micro Mock: no .yaml/.yml/.json files found in this workspace.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    candidates
      .map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    { placeHolder: 'Select an OpenAPI spec file (type to filter)' }
  );
  return picked?.uri;
}
