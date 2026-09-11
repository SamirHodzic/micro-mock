import * as path from 'path';
import { Worker } from 'worker_threads';
import { generateHttpParam } from '@stoplight/prism-http';
import { createServer } from '@stoplight/prism-http-server';
import { createLogger } from '@stoplight/prism-core';
import { IHttpOperation, IHttpParam, IHttpContent, HttpSecurityScheme } from '@stoplight/types';
import { findFreePort } from './freePort';

function parseSpecInWorker(specPath: string, registerCancel?: (cancel: () => void) => void): Promise<IHttpOperation[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'specParserWorker.js'), {
      workerData: { specPath },
    });

    let settled = false;

    if (registerCancel) {
      registerCancel(() => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        reject(new Error('Cancelled.'));
      });
    }

    worker.once('message', (msg: { ok: boolean; operations?: IHttpOperation[]; error?: string }) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      if (msg.ok && msg.operations) {
        resolve(msg.operations);
      } else {
        reject(new Error(msg.error ?? 'Failed to parse the spec.'));
      }
    });

    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

export interface EndpointInfo {
  method: string;
  path: string;
  resolvedPath: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  bodyExample?: string;
}

export interface PrismInstance {
  port: number;
  operations: EndpointInfo[];
  stop(): Promise<void>;
}

export async function startPrism(
  specPath: string,
  registerCancel?: (cancel: () => void) => void
): Promise<PrismInstance> {
  const operations = await parseSpecInWorker(specPath, registerCancel);
  if (operations.length === 0) {
    throw new Error('No operations found in this OpenAPI spec.');
  }

  const logger = createLogger('micro-mock', { level: 'silent' });
  const server = createServer(operations, {
    cors: true,
    config: {
      isProxy: false,
      checkSecurity: true,
      validateRequest: true,
      validateResponse: true,
      errors: false,
      upstreamProxy: undefined,
      mock: { dynamic: true },
    },
    components: { logger },
  });

  const port = await findFreePort();
  await server.listen(port, '127.0.0.1');

  return {
    port,
    operations: operations.map(buildEndpointInfo),
    stop: () => server.close(),
  };
}

function unwrapOption<T>(option: { _tag: string; value?: T }): T | undefined {
  return option._tag === 'Some' ? option.value : undefined;
}

function paramValueToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function generateParamValue(param: IHttpParam): string {
  return paramValueToString(unwrapOption(generateHttpParam(param)));
}

function buildEndpointInfo(op: IHttpOperation): EndpointInfo {
  const pathParams = op.request?.path ?? [];
  const queryParams = op.request?.query ?? [];
  const headerParams = op.request?.headers ?? [];

  let resolvedPath = op.path;
  for (const param of pathParams) {
    const value = generateParamValue(param) || 'example';
    resolvedPath = resolvedPath.replace(`{${param.name}}`, encodeURIComponent(value));
  }

  const query: Record<string, string> = {};
  for (const param of queryParams) {
    if (param.required) {
      query[param.name] = generateParamValue(param);
    }
  }

  const headers: Record<string, string> = {};
  for (const param of headerParams) {
    if (param.required) {
      headers[param.name] = generateParamValue(param);
    }
  }

  applySecurityDefaults(op.security?.[0], headers, query);

  let bodyExample: string | undefined;
  const jsonContent = op.request?.body?.contents?.find((c) => c.mediaType.includes('json'));
  if (jsonContent) {
    const generated = unwrapOption(generateHttpParam(jsonContent as IHttpContent));
    if (generated !== undefined) {
      bodyExample = JSON.stringify(generated, null, 2);
    }
  }

  return {
    method: op.method.toUpperCase(),
    path: op.path,
    resolvedPath,
    query,
    headers,
    bodyExample,
  };
}

function applySecurityDefaults(
  schemes: HttpSecurityScheme[] | undefined,
  headers: Record<string, string>,
  query: Record<string, string>
): void {
  for (const scheme of schemes ?? []) {
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      headers['Authorization'] = 'Bearer example-token';
    } else if (scheme.type === 'http') {
      headers['Authorization'] = `Basic ${Buffer.from('user:password').toString('base64')}`;
    } else if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      headers['Authorization'] = 'Bearer example-token';
    } else if (scheme.type === 'apiKey') {
      if (scheme.in === 'header') {
        headers[scheme.name] = 'example-api-key';
      } else if (scheme.in === 'query') {
        query[scheme.name] = 'example-api-key';
      }
    }
  }
}
