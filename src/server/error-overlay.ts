export interface ErrorInfo {
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string[];
  title?: string;
}

export function generateErrorOverlayHTML(error: ErrorInfo): string {
  const { message, file, line, code = [], stack, title: pageTitle } = error;

  // Extract code snippet with error line highlighted
  const title = pageTitle || 'Runtime Error';
  const codeSnippet = code.length > 0 
    ? code.map((lineCode, idx) => {
        const lineNum = (line || 0) - Math.floor(code.length / 2) + idx;
        const isErrorLine = lineNum === line;
        return `<div class="${isErrorLine ? 'line-err' : ''}" style="opacity: ${isErrorLine ? '1' : '0.5'}">
          ${lineNum} | ${escapeHtml(lineCode)}
        </div>`;
      }).join('')
    : '<div style="opacity: 0.5">No code preview available</div>';

  return `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        :root {
            --bg-blur: rgba(0, 0, 0, 0.85);
            --card-bg: #111111;
            --accent-red: #ff3333;
            --accent-blue: #0070f3;
            --accent-red-dim: rgba(255, 51, 51, 0.1);
            --text-primary: #ffffff;
            --text-secondary: #a0a0a0;
            --code-bg: #050505;
            --font-mono: 'JetBrains Mono', 'Fira Code', 'Menlo', monospace;
        }

        body {
            margin: 0;
            padding: 0;
            background: #0a0a0a;
            font-family: 'Inter', -apple-system, sans-serif;
            color: var(--text-primary);
            height: 100vh;
            overflow: hidden;
        }

        .dev-badge {
            position: fixed;
            bottom: 24px;
            left: 24px;
            width: 52px;
            height: 52px;
            background: #222;
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            z-index: 10000;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .dev-badge:hover {
            transform: scale(1.1);
            background: #333;
            border-color: var(--accent-blue);
        }

        .dev-badge svg {
            width: 24px;
            height: 24px;
            fill: var(--text-secondary);
            transition: fill 0.3s;
        }

        .dev-badge:hover svg {
            fill: var(--text-primary);
        }

        .overlay-wrapper {
            position: fixed;
            inset: 0;
            background: var(--bg-blur);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            z-index: 9999;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }

        .overlay-wrapper.active {
            opacity: 1;
            pointer-events: auto;
        }

        .card {
            width: 100%;
            max-width: 900px;
            background: var(--card-bg);
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 60px 120px rgba(0,0,0,0.9);
            animation: slideUp 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        @keyframes slideUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }

        .card-header {
            padding: 24px 32px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .header-title {
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: var(--accent-red);
        }

        .close-btn {
            cursor: pointer;
            background: rgba(255,255,255,0.05);
            border: none;
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            font-size: 20px;
        }

        .close-btn:hover { background: #333; }

        .card-body {
            padding: 32px;
            max-height: 70vh;
            overflow-y: auto;
        }

        .error-msg { 
            font-size: 18px; 
            font-weight: 700; 
            margin-bottom: 20px;
            color: var(--accent-red);
            line-height: 1.5;
        }

        .code-block {
            background: var(--code-bg);
            border-radius: 12px;
            padding: 20px;
            font-family: var(--font-mono);
            font-size: 13px;
            border: 1px solid rgba(255,255,255,0.05);
            margin-bottom: 20px;
            overflow-x: auto;
        }

        .line-err { 
            background: var(--accent-red-dim); 
            border-left: 3px solid var(--accent-red); 
            margin: 0 -20px; 
            padding: 4px 20px;
        }

        .stack-trace {
            font-family: var(--font-mono);
            font-size: 12px;
            color: var(--text-secondary);
            background: rgba(255, 255, 255, 0.02);
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
        }

        .stack-trace-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
            opacity: 0.5;
        }

        .card-body::-webkit-scrollbar { width: 6px; }
        .card-body::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }

        .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 0;
            border-bottom: 1px solid rgba(255,255,255,0.03);
        }

        .setting-info h4 { margin: 0; font-size: 15px; }
        .setting-info p { margin: 4px 0 0; font-size: 12px; color: var(--text-secondary); }

        .switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
        }

        .switch input { opacity: 0; width: 0; height: 0; }

        .slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            background-color: #333;
            transition: .4s;
            border-radius: 34px;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }

        input:checked + .slider { background-color: var(--accent-blue); }
        input:checked + .slider:before { transform: translateX(20px); }
    </style>
</head>
<body>
    <div class="dev-badge" id="openSettings" title="Overlay Settings">
        <svg viewBox="0 0 24 24">
            <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.35 19.43,11.03L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.97 19.05,5.05L16.56,6.05C16.04,5.66 15.47,5.34 14.86,5.12L14.47,2.47C14.44,2.23 14.24,2.05 14,2.05H10C9.76,2.05 9.56,2.23 9.53,2.47L9.14,5.12C8.53,5.34 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.97 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11.03C4.53,11.35 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.95C7.96,18.34 8.53,18.66 9.14,18.88L9.53,21.53C9.56,21.77 9.76,21.95 10,21.95H14C14.24,21.95 14.44,21.77 14.47,21.53L14.86,18.88C15.47,18.66 16.04,18.34 16.56,17.95L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
        </svg>
    </div>

    <div class="overlay-wrapper active" id="overlay">
        <div class="card" id="errorView">
            <div class="card-header">
                <div class="header-title">Runtime Error</div>
                <button class="close-btn" onclick="closeOverlay()">×</button>
            </div>
            <div class="card-body">
                <div class="error-msg">${escapeHtml(message)}</div>
                
                ${file ? `<p style="color: var(--text-secondary); font-size: 13px; font-family: var(--font-mono); margin-bottom: 16px;">
                    📁 ${escapeHtml(file)}${line ? `:${line}:${error.column || 0}` : ''}
                </p>` : ''}
                
                <div class="code-block">
                    ${codeSnippet}
                </div>
                
                ${stack ? `
                <div class="stack-trace">
                    <div class="stack-trace-title">Stack Trace</div>
                    <pre style="margin: 0; white-space: pre-wrap;">${escapeHtml(stack)}</pre>
                </div>
                ` : ''}
            </div>
        </div>

        <div class="card" id="settingsView" style="display: none;">
            <div class="card-header">
                <div class="header-title" style="color: var(--accent-blue);">Overlay Settings</div>
                <button class="close-btn" onclick="showView('error')">×</button>
            </div>
            <div class="card-body">
                <div class="setting-item">
                    <div class="setting-info">
                        <h4>Enable Blur</h4>
                        <p>Apply backdrop-filter to the background.</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" checked onchange="toggleBlur(this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="setting-item">
                    <div class="setting-info">
                        <h4>Compact Mode</h4>
                        <p>Show less detailed stack traces.</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" onchange="toggleCompact(this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="setting-item">
                    <div class="setting-info">
                        <h4>Auto-dismiss</h4>
                        <p>Hide overlay after fixing the code.</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" checked>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
        </div>
    </div>

    <script>
        const overlay = document.getElementById('overlay');
        const errorView = document.getElementById('errorView');
        const settingsView = document.getElementById('settingsView');

        const closeOverlay = () => {
            overlay.classList.remove('active');
            // Send message to parent to clear error
            if (window.parent) {
                window.parent.postMessage({ type: 'satset:clear-error' }, '*');
            }
        };
        
        const showView = (view) => {
            if (view === 'settings') {
                errorView.style.display = 'none';
                settingsView.style.display = 'block';
            } else {
                errorView.style.display = 'block';
                settingsView.style.display = 'none';
            }
        };

        document.getElementById('openSettings').onclick = () => showView('settings');

        const toggleBlur = (enabled) => {
            overlay.style.backdropFilter = enabled ? 'blur(24px)' : 'none';
            overlay.style.webkitBackdropFilter = enabled ? 'blur(24px)' : 'none';
        };

        const toggleCompact = (enabled) => {
            const stackTrace = document.querySelector('.stack-trace pre');
            if (stackTrace) {
                stackTrace.style.maxHeight = enabled ? '100px' : 'none';
                stackTrace.style.overflow = enabled ? 'hidden' : 'auto';
            }
        };

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeOverlay();
        });

        overlay.onclick = (e) => {
            if (e.target === overlay) closeOverlay();
        };
    </script>
</body>
</html>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function extractCodeSnippet(filePath: string, errorLine: number, context = 5): string[] {
  const fs = require('fs');
  const path = require('path');

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const start = Math.max(0, errorLine - context);
    const end = Math.min(lines.length, errorLine + context);
    
    return lines.slice(start, end);
  } catch (e) {
    return [];
  }
}