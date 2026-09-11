export interface ErrorCodeEntry {
  code: number;
  percent: number;
}

export interface EndpointEntry {
  method: string;
  path: string;
  resolvedPath: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  bodyExample?: string;
}

export interface MockServerState {
  running: boolean;
  specPath?: string;
  internalPort?: number;
  publicPort?: number;
  errorCodes: ErrorCodeEntry[];
  latencyMs: number;
  operations: EndpointEntry[];
}

export const state: MockServerState = {
  running: false,
  errorCodes: [],
  latencyMs: 0,
  operations: [],
};
