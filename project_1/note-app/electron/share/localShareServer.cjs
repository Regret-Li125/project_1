const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PLAIN_ERROR_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

class LocalShareServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.isRunning = false;
    this.isStarting = false;
    this.exportPath = null;
    this.token = null;
  }

  _isPrivateLanIp(address) {
    if (address.startsWith('192.168.') || address.startsWith('10.')) {
      return true;
    }
    const match = address.match(/^172\.(\d+)\./);
    return Boolean(match) && Number(match[1]) >= 16 && Number(match[1]) <= 31;
  }

  _getLanIpAddresses() {
    const preferred = [];
    const others = [];
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (this._isPrivateLanIp(iface.address)) {
            preferred.push(iface.address);
          } else {
            others.push(iface.address);
          }
        }
      }
    }
    return [...preferred, ...others];
  }

  getLocalIpAddress() {
    const ips = this._getLanIpAddresses();
    return ips.length > 0 ? ips[0] : '127.0.0.1';
  }

  _getCookieToken(cookieHeader) {
    if (!cookieHeader) {
      return null;
    }
    for (const part of String(cookieHeader).split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === 'token') {
        return rest.join('=').trim();
      }
    }
    return null;
  }

  _isOutsideExportRoot(relativePath) {
    return (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    );
  }

  _writePlainError(res, statusCode, message) {
    if (!res.headersSent) {
      res.writeHead(statusCode, PLAIN_ERROR_HEADERS);
    }
    res.end(message);
  }

  async start(exportPath) {
    if (this.isStarting || this.isRunning) {
      return { success: false, error: 'Server is already starting or running' };
    }

    this.isStarting = true;

    try {
      this.exportPath = await fs.realpath(path.resolve(exportPath));
    } catch (error) {
      this.isStarting = false;
      return { success: false, error: String(error) };
    }

    this.token = crypto.randomBytes(24).toString('hex');

    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '/', 'http://localhost');

          // Token auth: accept ?token= query or token cookie.
          // A valid query token also sets a cookie so relative in-page links keep working.
          const queryToken = requestUrl.searchParams.get('token');
          if (queryToken === this.token) {
            res.setHeader('Set-Cookie', `token=${this.token}; Path=/; HttpOnly; SameSite=Lax`);
          } else if (this._getCookieToken(req.headers.cookie) !== this.token) {
            this._writePlainError(res, 403, 'Forbidden');
            return;
          }

          let requestedPath = 'index.html';
          if (requestUrl.pathname !== '/') {
            let decodedPath;
            try {
              decodedPath = decodeURIComponent(requestUrl.pathname);
            } catch {
              this._writePlainError(res, 400, 'Bad Request');
              return;
            }
            requestedPath = decodedPath.replace(/^[/\\]+/, '');
          }

          const filePath = path.resolve(this.exportPath, requestedPath);

          // Security: prevent directory traversal
          const relativePath = path.relative(this.exportPath, filePath);
          if (this._isOutsideExportRoot(relativePath)) {
            this._writePlainError(res, 403, 'Forbidden');
            return;
          }

          // Security: resolve symlinks and re-check the real path stays inside the export root
          const realFilePath = await fs.realpath(filePath);
          const realRelativePath = path.relative(this.exportPath, realFilePath);
          if (this._isOutsideExportRoot(realRelativePath)) {
            this._writePlainError(res, 403, 'Forbidden');
            return;
          }

          const stat = await fs.stat(realFilePath);
          if (stat.isDirectory()) {
            this._writePlainError(res, 403, 'Forbidden');
            return;
          }

          const ext = path.extname(realFilePath).toLowerCase();

          const contentTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.md': 'text/markdown',
            '.txt': 'text/plain',
          };

          res.writeHead(200, {
            'Content-Type': contentTypes[ext] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
          });

          const stream = fsSync.createReadStream(realFilePath);
          stream.on('error', (error) => {
            console.error('[LocalShareServer] stream error:', error);
            this._writePlainError(res, 500, 'Internal Server Error');
          });
          stream.pipe(res);
        } catch (error) {
          if (error.code === 'ENOENT') {
            this._writePlainError(res, 404, 'Not Found');
          } else if (error.code === 'EISDIR') {
            this._writePlainError(res, 403, 'Forbidden');
          } else {
            this._writePlainError(res, 500, 'Internal Server Error');
          }
        }
      });

      this.server.listen(0, '0.0.0.0', () => {
        this.port = this.server.address().port;
        this.isRunning = true;
        this.isStarting = false;

        const ips = this._getLanIpAddresses();
        const ipAddress = ips.length > 0 ? ips[0] : '127.0.0.1';
        resolve({
          success: true,
          port: this.port,
          ipAddress,
          ips,
          url: `http://${ipAddress}:${this.port}/?token=${this.token}`,
          localUrl: `http://localhost:${this.port}/?token=${this.token}`,
        });
      });

      this.server.on('error', (error) => {
        if (this.isStarting && !this.isRunning) {
          this.isStarting = false;
          this.server = null;
          resolve({ success: false, error: String(error) });
        } else {
          // Runtime errors after a successful listen must not be swallowed silently.
          console.error('[LocalShareServer] runtime error:', error);
        }
      });
    });
  }

  async stop() {
    if ((!this.isRunning && !this.isStarting) || !this.server) {
      return { success: true };
    }

    return new Promise((resolve) => {
      const clearState = () => {
        this.server = null;
        this.port = null;
        this.isRunning = false;
        this.isStarting = false;
        this.exportPath = null;
        this.token = null;
        resolve({ success: true });
      };

      const forceCloseTimeout = setTimeout(() => {
        this.server.closeAllConnections?.();
        this.server.closeIdleConnections?.();
        clearState();
      }, 5000);

      // Close idle keep-alive connections right away so close() can finish promptly;
      // the force timeout above destroys any remaining connections as a fallback.
      this.server.closeIdleConnections?.();
      this.server.close(() => {
        clearTimeout(forceCloseTimeout);
        clearState();
      });
    });
  }

  getStatus() {
    const ips = this._getLanIpAddresses();
    const ipAddress = ips.length > 0 ? ips[0] : '127.0.0.1';
    return {
      isRunning: this.isRunning,
      port: this.port,
      ips,
      url: this.isRunning ? `http://${ipAddress}:${this.port}/?token=${this.token}` : null,
      localUrl: this.isRunning ? `http://localhost:${this.port}/?token=${this.token}` : null,
    };
  }
}

module.exports = {
  localShareServer: new LocalShareServer(),
};
