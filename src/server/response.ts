import http from 'http';
import { Stream } from 'stream';
import { SatsetResponse, SatsetResponseInit } from '../core/response';

export { SatsetResponse, type SatsetResponseInit };

let currentRequestCookies: Record<string, string> | null = null;

export function setCurrentRequestCookies(cookies: Record<string, string> | null) {
  currentRequestCookies = cookies;
}

export async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  // Return cached body if available
  if ((req as any)._bodyBuffer) {
    return (req as any)._bodyBuffer;
  }

  // If stream already ended and no cache, return empty buffer
  if (req.readableEnded) {
    return Buffer.alloc(0);
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    const onData = (c: Buffer) => chunks.push(c);
    const onEnd = () => {
      cleanup();
      const fullBody = Buffer.concat(chunks);
      (req as any)._bodyBuffer = fullBody;
      resolve(fullBody);
    };
    const onError = (err: any) => {
      cleanup();
      console.error('[Satset] Error reading request body:', err);
      reject(err);
    };

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    
    // Ensure flowing mode
    req.resume();
  });
}

export async function buildSatsetRequest(req: http.IncomingMessage, baseUrl = 'http://localhost') {
  const url = (req.url && req.url.startsWith('http')) ? req.url : baseUrl + (req.url || '/');
  const headers: Record<string, string> = {};
  for (const k of Object.keys(req.headers)) {
    const val = req.headers[k];
    if (Array.isArray(val)) headers[k] = val.join(', ');
    else if (val !== undefined) headers[k] = String(val);
  }

  let bodyBuffer: Buffer | null = null;
  if (req.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    try {
      bodyBuffer = await readRequestBody(req);
    } catch (e) {
      bodyBuffer = null;
    }
  }

  const text = bodyBuffer ? bodyBuffer.toString('utf-8') : '';

  return {
    url,
    method: req.method || 'GET',
    headers,
    async json() {
      if (!text) return {};
      try {
        const result = JSON.parse(text);
        return (result === undefined || result === null) ? {} : result;
      } catch (e) {
        return {};
      }
    },
    async text() {
      return text;
    },
    nodeRequest: req,
  } as const;
}

export function cookies() {
  const store = currentRequestCookies || {};
  return {
    get(name: string) {
      const value = store[name];
      if (value === undefined) return undefined;
      return { name, value };
    },
    getAll() {
      return Object.entries(store).map(([name, value]) => ({ name, value }));
    },
    has(name: string) {
      return Object.prototype.hasOwnProperty.call(store, name);
    },
    set(name: string, value: string, opts: { path?: string; maxAge?: number } = {}) {
      try {
        const res = (global as any).__SATSET_ACTION_RES__ as http.ServerResponse | undefined;
        if (!res) return;
        const parts = [`${name}=${encodeURIComponent(value)}`];
        if (opts.path) parts.push(`Path=${opts.path}`);
        else parts.push('Path=/');
        if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${opts.maxAge}`);
        const cookieStr = parts.join('; ');
        const prev = res.getHeader('Set-Cookie');
        if (prev) {
          if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, cookieStr]);
          else res.setHeader('Set-Cookie', [String(prev), cookieStr]);
        } else {
          res.setHeader('Set-Cookie', cookieStr);
        }
      } catch (e) {
      }
    },
  };
}

export async function sendSatsetResponse(nodeRes: http.ServerResponse, satRes: SatsetResponse) {
  const headers = satRes.headers || {};
  const status = satRes.status || 200;

  if (headers.Location) {
    nodeRes.writeHead(status, headers);
    nodeRes.end();
    return;
  }

  const body = satRes.body;

  if (body === null || body === undefined) {
    nodeRes.writeHead(status, headers);
    nodeRes.end();
    return;
  }

  // String
  if (typeof body === 'string') {
    if (!headers['Content-Type']) headers['Content-Type'] = 'text/plain; charset=utf-8';
    nodeRes.writeHead(status, headers);
    nodeRes.end(body);
    return;
  }

  // Buffer
  if (Buffer.isBuffer(body)) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream';
    nodeRes.writeHead(status, headers);
    nodeRes.end(body);
    return;
  }

  // ArrayBuffer / Uint8Array
  if (body instanceof Uint8Array || body instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && body instanceof SharedArrayBuffer)) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream';
    nodeRes.writeHead(status, headers);
    
    // Explicitly handle different buffer types to satisfy TS
    if (body instanceof Uint8Array) {
      nodeRes.end(body);
    } else {
      // ArrayBuffer or SharedArrayBuffer
      nodeRes.end(Buffer.from(body as any));
    }
    return;
  }

  // Blob
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const buffer = Buffer.from(await body.arrayBuffer());
    if (!headers['Content-Type']) headers['Content-Type'] = body.type || 'application/octet-stream';
    nodeRes.writeHead(status, headers);
    nodeRes.end(buffer);
    return;
  }

  // Node Stream
  if (body instanceof Stream || (typeof body.pipe === 'function' && body.on)) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream';
    nodeRes.writeHead(status, headers);
    body.pipe(nodeRes);
    return;
  }

  // Web ReadableStream
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream';
    nodeRes.writeHead(status, headers);
    
    // Use Readable.fromWeb if available (Node 18+)
    if (typeof (Stream as any).Readable?.fromWeb === 'function') {
      const nodeStream = (Stream as any).Readable.fromWeb(body);
      nodeStream.pipe(nodeRes);
    } else {
      // Manual conversion for older Node
      const reader = body.getReader();
      const stream = new Stream.Readable({
        async read() {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null);
            } else {
              this.push(Buffer.from(value));
            }
          } catch (e) {
            this.destroy(e as Error);
          }
        }
      });
      stream.pipe(nodeRes);
    }
    return;
  }

  // Fallback to JSON
  const bodyStr = typeof body === 'object' ? JSON.stringify(body) : String(body);
  if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  nodeRes.writeHead(status, headers);
  nodeRes.end(bodyStr);
}
