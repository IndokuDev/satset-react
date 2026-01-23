import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';

export function startHMR(
  server: http.Server, 
  root: string,
  onFileChange?: (filePath: string) => Promise<void>
) {
  const clients = new Set<WebSocket>();

  console.log('🔥 HMR server starting...');

  // WebSocket server for HMR
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  // Upgrade HTTP to WebSocket
  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/__hmr_ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Watch src directory for changes
  const srcPath = path.join(root, 'src');
  
  if (fs.existsSync(srcPath)) {
    const watcher = chokidar.watch(srcPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('change', async (filePath) => {
      const relativePath = path.relative(root, filePath);
      console.log(`🔄 File changed: ${relativePath}`);

      // Trigger rebuild
      if (onFileChange) {
        await onFileChange(filePath);
      }

      // Notify all clients
      notifyClients({
        type: 'update',
        file: relativePath,
        timestamp: Date.now(),
      });
    });

    watcher.on('add', async (filePath) => {
      const relativePath = path.relative(root, filePath);
      console.log(`➕ File added: ${relativePath}`);

      if (onFileChange) {
        await onFileChange(filePath);
      }

      notifyClients({
        type: 'add',
        file: relativePath,
        timestamp: Date.now(),
      });
    });

    watcher.on('unlink', (filePath) => {
      const relativePath = path.relative(root, filePath);
      console.log(`➖ File removed: ${relativePath}`);

      notifyClients({
        type: 'remove',
        file: relativePath,
        timestamp: Date.now(),
      });
    });

    console.log('👀 Watching for file changes...');
  }

  // Handle legacy SSE endpoint (fallback)
  const originalEmit = server.emit.bind(server);
  server.emit = function (event: string, ...args: any[]) {
    // args may be [req, res] for 'request' or [req, socket, head] for 'upgrade'
    const req = args[0];
    const res = args[1];
    if (event === 'request' && req && req.url === '/__hmr') {
      handleLegacyHMR(req as http.IncomingMessage, res as http.ServerResponse);
      return true;
    }
    return originalEmit(event, ...args);
  } as any;

  function handleLegacyHMR(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/javascript',
      'Cache-Control': 'no-cache',
    });

    // Inject WebSocket client
    const hmrClient = `
(function() {
  const ws = new WebSocket('ws://' + location.host + '/__hmr_ws');
  
  ws.onopen = () => {
    console.log('🔥 HMR Connected');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'update') {
      console.log('🔄 Reloading:', data.file);
      
      // Check if CSS file
      if (data.file.endsWith('.css')) {
        reloadCSS();
      } else {
        // Full page reload for JS/JSX/TSX changes
        location.reload();
      }
    }
    
    if (data.type === 'add' || data.type === 'remove') {
      console.log('🔄 File structure changed, reloading...');
      location.reload();
    }
  };

  ws.onerror = (error) => {
    console.error('❌ HMR Error:', error);
  };

  ws.onclose = () => {
    console.log('🔌 HMR Disconnected, retrying...');
    setTimeout(() => location.reload(), 1000);
  };

  function reloadCSS() {
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        link.setAttribute('href', href.split('?')[0] + '?t=' + Date.now());
      }
    });
  }
})();
    `;

    res.end(hmrClient);
  }

  function notifyClients(data: any) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (e) {
          clients.delete(client);
        }
      }
    });
  }

  return {
    clients,
    notify: notifyClients,
    close: () => {
      wss.close();
    },
  };
}