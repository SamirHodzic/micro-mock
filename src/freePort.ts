import * as net from 'net';

function listenOnce(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
      server.close(() => resolve(resolvedPort));
    });
  });
}

export async function findFreePort(preferred?: number): Promise<number> {
  if (preferred) {
    try {
      return await listenOnce(preferred);
    } catch {
      // preferred port unavailable, fall through to OS-assigned port
    }
  }
  return listenOnce(0);
}
