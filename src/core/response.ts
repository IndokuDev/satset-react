export interface SatsetResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

export class SatsetResponse {
  public body: any;
  public status: number;
  public headers: Record<string, string>;
  public cookies: {
    set(name: string, value: string, opts?: { path?: string; httpOnly?: boolean; maxAge?: number }): void;
    delete(name: string, opts?: { path?: string }): void;
  };

  constructor(body: any = null, init: SatsetResponseInit = {}) {
    this.body = body;
    this.status = init.status ?? (body == null ? 204 : 200);
    this.headers = init.headers || {};

     const self = this;
     this.cookies = {
       set(name: string, value: string, opts: { path?: string; httpOnly?: boolean; maxAge?: number } = {}) {
         const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
         if (opts.path) parts.push(`Path=${opts.path}`);
         if (opts.httpOnly) parts.push('HttpOnly');
         if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${opts.maxAge}`);
         self.headers['Set-Cookie'] = parts.join('; ');
       },
       delete(name: string, opts: { path?: string } = {}) {
         const parts: string[] = [`${name}=`, 'Max-Age=0'];
         if (opts.path) parts.push(`Path=${opts.path}`);
         self.headers['Set-Cookie'] = parts.join('; ');
       },
     };
  }

  static json(data: any, init: SatsetResponseInit = {}) {
    const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    return new SatsetResponse(JSON.stringify(data), { status: init.status ?? 200, headers });
  }

  static redirect(url: string, status = 307) {
    return new SatsetResponse(null, { status, headers: { Location: url } });
  }

  static rewrite(url: string) {
    // Simple hint header for rewrite; server will interpret and serve the rewrite target
    return new SatsetResponse(null, { status: 200, headers: { 'X-Satset-Rewrite': url } });
  }

  static next() {
    return new SatsetResponse(null, { status: 204 });
  }

  static isSatsetResponse(obj: any): obj is SatsetResponse {
    return obj instanceof SatsetResponse;
  }
}
