import * as vscode from 'vscode';
import { MockServerState } from './state';

export function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'workbench.view.extension.microMock';
  item.show();
  return item;
}

export function updateStatusBar(item: vscode.StatusBarItem, state: MockServerState): void {
  if (state.running) {
    item.text = `$(radio-tower) Micro Mock :${state.publicPort} (lat ${state.latencyMs}ms)`;
    item.tooltip = `Mocking ${state.specPath}\nClick to open Micro Mock`;
  } else {
    item.text = '$(circle-slash) Micro Mock: stopped';
    item.tooltip = 'Click to open Micro Mock';
  }
}
