import * as vscode from 'vscode';
import { state, ErrorCodeEntry, EndpointEntry } from './state';
import { getRequestLog, requestLogEvents, RequestLogEntry } from './requestLog';

type NodeKind =
  | 'toggleServer'
  | 'errorCodesRoot'
  | 'errorCodeItem'
  | 'addErrorCode'
  | 'latencyRoot'
  | 'endpointsRoot'
  | 'endpointItem'
  | 'endpointsEmpty'
  | 'requestLogRoot'
  | 'requestLogItem'
  | 'requestLogEmpty';

export class MicroMockTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: NodeKind,
    public readonly data?: ErrorCodeEntry | RequestLogEntry | EndpointEntry
  ) {
    super(label, collapsibleState);
  }
}

export class MicroMockTreeProvider implements vscode.TreeDataProvider<MicroMockTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    requestLogEvents.on('change', () => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MicroMockTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MicroMockTreeItem): MicroMockTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    switch (element.kind) {
      case 'errorCodesRoot':
        return this.getErrorCodeItems();
      case 'endpointsRoot':
        return this.getEndpointItems();
      case 'requestLogRoot':
        return this.getRequestLogItems();
      default:
        return [];
    }
  }

  private getRootItems(): MicroMockTreeItem[] {
    const toggleItem = new MicroMockTreeItem(
      state.running ? '■ Stop Mock Server' : '▶ Start Mock Server',
      vscode.TreeItemCollapsibleState.None,
      'toggleServer'
    );
    toggleItem.command = {
      command: state.running ? 'microMock.stopMockServer' : 'microMock.startMockServer',
      title: 'Toggle Mock Server',
    };
    toggleItem.iconPath = new vscode.ThemeIcon(state.running ? 'debug-stop' : 'play');

    const errorCodesRoot = new MicroMockTreeItem(
      'Error Codes',
      vscode.TreeItemCollapsibleState.Expanded,
      'errorCodesRoot'
    );
    errorCodesRoot.iconPath = new vscode.ThemeIcon('warning');

    const latencyRoot = new MicroMockTreeItem(
      `Latency: ${state.latencyMs}ms`,
      vscode.TreeItemCollapsibleState.None,
      'latencyRoot'
    );
    latencyRoot.command = { command: 'microMock.setLatency', title: 'Set Latency' };
    latencyRoot.iconPath = new vscode.ThemeIcon('clock');

    const endpointsRoot = new MicroMockTreeItem(
      'Endpoints',
      vscode.TreeItemCollapsibleState.Expanded,
      'endpointsRoot'
    );
    endpointsRoot.iconPath = new vscode.ThemeIcon('plug');

    const requestLogRoot = new MicroMockTreeItem(
      'Recent Requests',
      vscode.TreeItemCollapsibleState.Expanded,
      'requestLogRoot'
    );
    requestLogRoot.iconPath = new vscode.ThemeIcon('history');
    requestLogRoot.command = { command: 'microMock.openRequestPanel', title: 'Open Micro Mock Panel' };

    return [toggleItem, errorCodesRoot, latencyRoot, endpointsRoot, requestLogRoot];
  }

  private getErrorCodeItems(): MicroMockTreeItem[] {
    const items = state.errorCodes.map((entry) => {
      const item = new MicroMockTreeItem(
        `${entry.code} — ${entry.percent}%`,
        vscode.TreeItemCollapsibleState.None,
        'errorCodeItem',
        entry
      );
      item.contextValue = 'errorCode';
      item.command = { command: 'microMock.editErrorCode', title: 'Edit Error Code', arguments: [item] };
      return item;
    });

    const addItem = new MicroMockTreeItem('+ Add error code', vscode.TreeItemCollapsibleState.None, 'addErrorCode');
    addItem.command = { command: 'microMock.addErrorCode', title: 'Add Error Code' };

    return [...items, addItem];
  }

  private getEndpointItems(): MicroMockTreeItem[] {
    if (state.operations.length === 0) {
      return [
        new MicroMockTreeItem(
          'Start the mock server to see endpoints',
          vscode.TreeItemCollapsibleState.None,
          'endpointsEmpty'
        ),
      ];
    }

    return state.operations.map((entry) => {
      const item = new MicroMockTreeItem(
        `${entry.method} ${entry.path}`,
        vscode.TreeItemCollapsibleState.None,
        'endpointItem',
        entry
      );
      item.command = { command: 'microMock.newRequest', title: 'New Request', arguments: [entry] };
      return item;
    });
  }

  private getRequestLogItems(): MicroMockTreeItem[] {
    const log = getRequestLog();
    if (log.length === 0) {
      const empty = new MicroMockTreeItem('No requests yet', vscode.TreeItemCollapsibleState.None, 'requestLogEmpty');
      empty.command = { command: 'microMock.openRequestPanel', title: 'Open Micro Mock Panel' };
      return [empty];
    }

    return log.map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const item = new MicroMockTreeItem(
        `${time}  ${entry.method} ${entry.path} → ${entry.status} (${entry.ms}ms)`,
        vscode.TreeItemCollapsibleState.None,
        'requestLogItem',
        entry
      );
      item.command = { command: 'microMock.openRequestPanel', title: 'Open Micro Mock Panel', arguments: [entry] };
      return item;
    });
  }
}
