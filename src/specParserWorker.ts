import { parentPort, workerData } from 'worker_threads';
import { getHttpOperationsFromSpec } from '@stoplight/prism-http';

async function main(): Promise<void> {
  try {
    const operations = await getHttpOperationsFromSpec(workerData.specPath);
    parentPort!.postMessage({ ok: true, operations });
  } catch (err) {
    parentPort!.postMessage({ ok: false, error: (err as Error).message });
  }
}

void main();
