/**
 * Minimal static file server for the built client.
 *
 * The client and the WebSocket endpoint are served from the same origin and the
 * same process. That is deliberate: it removes CORS entirely, keeps deployment
 * to a single Fly app, and means the socket URL can always be derived from
 * `location`.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

export class StaticServer {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resolve a URL path to a file inside the root, or null if it escapes.
   *
   * `normalize` collapses `..` segments before the prefix check, so
   * `/../../etc/passwd` cannot walk out of the build directory.
   */
  private resolvePath(urlPath: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;

    const candidate = resolve(join(this.root, normalize(decoded)));
    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) return null;
    return candidate;
  }

  private async sendFile(
    res: ServerResponse,
    filePath: string,
    { immutable }: { immutable: boolean },
  ): Promise<boolean> {
    let size: number;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return false;
      size = info.size;
    } catch {
      return false;
    }

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      // Vite emits content-hashed asset filenames, so those are safe to cache
      // forever. index.html must never be cached or clients pin to an old build.
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    return await new Promise<boolean>((done) => {
      const stream = createReadStream(filePath);
      stream.on('error', () => {
        res.destroy();
        done(true);
      });
      stream.on('end', () => done(true));
      stream.pipe(res);
    });
  }

  /**
   * Serve `req`. Returns false if the caller should handle the route itself
   * (only happens for genuinely broken installs with no index.html).
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
    const filePath = this.resolvePath(urlPath);

    if (filePath && urlPath !== '/' && !urlPath.endsWith('/')) {
      const immutable = urlPath.startsWith('/assets/');
      if (await this.sendFile(res, filePath, { immutable })) return true;
    }

    // Single-page app fallback: /r/ABCDE is a client route, not a file.
    return await this.sendFile(res, join(this.root, 'index.html'), { immutable: false });
  }
}
