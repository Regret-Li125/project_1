const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

class LocalShareServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.isRunning = false;
    this.exportPath = null;
  }

  getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async start(exportPath) {
    if (this.isRunning) {
      return { success: false, error: 'Server is already running' };
    }

    this.exportPath = path.resolve(exportPath);

    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '/', 'http://localhost');
          const requestedPath = requestUrl.pathname === '/'
            ? 'index.html'
            : decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, '');
          const filePath = path.resolve(this.exportPath, requestedPath);

          // Security: prevent directory traversal
          const relativePath = path.relative(this.exportPath, filePath);
          if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }

          const content = await fs.readFile(filePath);
          const ext = path.extname(filePath).toLowerCase();
          
          const contentTypes = {
            '.html': 'text/html',
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
            'Cache-Control': 'no-cache',
          });
          res.end(content);
        } catch (error) {
          if (error.code === 'ENOENT') {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(500);
            res.end('Internal Server Error');
          }
        }
      });

      this.server.listen(0, '0.0.0.0', () => {
        this.port = this.server.address().port;
        this.isRunning = true;
        
        const ipAddress = this.getLocalIpAddress();
        resolve({
          success: true,
          port: this.port,
          ipAddress,
          url: `http://${ipAddress}:${this.port}`,
          localUrl: `http://localhost:${this.port}`,
        });
      });

      this.server.on('error', (error) => {
        resolve({ success: false, error: String(error) });
      });
    });
  }

  async stop() {
    if (!this.isRunning || !this.server) {
      return { success: true };
    }

    return new Promise((resolve) => {
      const forceCloseTimeout = setTimeout(() => {
        this.server = null;
        this.port = null;
        this.isRunning = false;
        this.exportPath = null;
        resolve({ success: true });
      }, 5000);

      this.server.close(() => {
        clearTimeout(forceCloseTimeout);
        this.server = null;
        this.port = null;
        this.isRunning = false;
        this.exportPath = null;
        resolve({ success: true });
      });
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      url: this.isRunning ? `http://${this.getLocalIpAddress()}:${this.port}` : null,
      localUrl: this.isRunning ? `http://localhost:${this.port}` : null,
    };
  }
}

module.exports = {
  localShareServer: new LocalShareServer(),
};
