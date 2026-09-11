import * as http from 'http';
import httpProxy from 'http-proxy';
import { state } from './state';
import { addRequestLogEntry } from './requestLog';

export interface ChaosProxyInstance {
  stop(): void;
  setInternalPort(port: number): void;
}

interface ResponseWithBody extends http.ServerResponse {
  microMockBody?: string;
}

export function startChaosProxy(publicPort: number, internalPort: number): ChaosProxyInstance {
  let currentInternalPort = internalPort;
  const proxy = httpProxy.createProxyServer();
  proxy.on('error', (_err, _req, res) => {
    const serverRes = res as http.ServerResponse;
    if (!serverRes.headersSent) {
      serverRes.writeHead(502, { 'Content-Type': 'application/json' });
    }
    serverRes.end(JSON.stringify({ error: 'Micro Mock: unable to reach mock engine' }));
  });

  proxy.on('proxyRes', (proxyRes, _req, res) => {
    const chunks: Buffer[] = [];
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on('end', () => {
      (res as ResponseWithBody).microMockBody = Buffer.concat(chunks).toString('utf8');
    });
  });

  const server = http.createServer((req, res) => {
    const start = Date.now();
    res.on('finish', () => {
      addRequestLogEntry({
        method: req.method ?? '',
        path: req.url ?? '',
        status: res.statusCode,
        ms: Date.now() - start,
        timestamp: Date.now(),
        body: (res as ResponseWithBody).microMockBody ?? '',
      });
    });

    void handleRequest(req, res);
  });

  async function handleRequest(req: http.IncomingMessage, res: ResponseWithBody): Promise<void> {
    const roll = Math.random() * 100;
    let cumulative = 0;
    for (const entry of state.errorCodes) {
      cumulative += entry.percent;
      if (roll < cumulative) {
        const payload = JSON.stringify({ error: 'Micro Mock: simulated chaos error', code: entry.code });
        res.microMockBody = payload;
        res.writeHead(entry.code, { 'Content-Type': 'application/json' });
        res.end(payload);
        return;
      }
    }

    if (state.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.latencyMs));
    }

    proxy.web(req, res, { target: `http://127.0.0.1:${currentInternalPort}` });
  }

  server.listen(publicPort, '127.0.0.1');

  return {
    stop: () => {
      proxy.close();
      server.close();
    },
    setInternalPort: (port: number) => {
      currentInternalPort = port;
    },
  };
}
