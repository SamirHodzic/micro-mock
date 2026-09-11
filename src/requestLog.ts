import { EventEmitter } from 'events';

export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  ms: number;
  timestamp: number;
  body: string;
}

const MAX_ENTRIES = 10;
const entries: RequestLogEntry[] = [];

export const requestLogEvents = new EventEmitter();

export function addRequestLogEntry(entry: RequestLogEntry): void {
  entries.unshift(entry);
  entries.length = Math.min(entries.length, MAX_ENTRIES);
  requestLogEvents.emit('change');
}

export function getRequestLog(): readonly RequestLogEntry[] {
  return entries;
}

export function clearRequestLog(): void {
  entries.length = 0;
  requestLogEvents.emit('change');
}
