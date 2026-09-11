import * as http from 'http';
import * as https from 'https';

export interface ParsedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SendResult {
  status: number;
  statusText: string;
  ms: number;
  body: string;
}

export function sendRequest(req: ParsedRequest): Promise<SendResult> {
  const start = Date.now();
  const url = new URL(req.url);
  const client = url.protocol === 'https:' ? https : http;

  const headers = { ...req.headers };
  if (req.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) {
    headers['Content-Length'] = String(Buffer.byteLength(req.body));
  }

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            ms: Date.now() - start,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    request.on('error', reject);

    if (req.body !== undefined) {
      request.write(req.body);
    }
    request.end();
  });
}
