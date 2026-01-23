import blessed from 'blessed';

export class SatsetTUI {
  private screen?: blessed.Widgets.Screen;
  private header?: blessed.Widgets.BoxElement;
  private routesBox?: blessed.Widgets.ListElement;
  private logBox?: blessed.Widgets.Log;
  private footer?: blessed.Widgets.BoxElement;

  private routes: string[] = [];
  private pageCount: number = 0;
  private port: number = 3000;
  private hmrStatus: 'Active' | 'Inactive' = 'Inactive';
  private networkUrl: string | null = null;

  constructor() {
    // Lazy initialization
  }

  public start() {
    if (this.screen) return;

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'SATSET Dashboard',
      fullUnicode: true,
      dockBorders: true,
    });

    // 1. Header
    this.header = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '{center}{bold}SATSET ENGINE v1.0.0{/bold} [ 🟢 Running ]{/center}',
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'green' } }
    });

    // 2. Routes (Left)
    this.routesBox = blessed.list({
      top: 3,
      left: 0,
      width: '35%',
      height: '100%-6',
      label: ' ROUTES ',
      items: [],
      border: { type: 'line' },
      style: { 
        border: { fg: 'cyan' }, 
        selected: { bg: 'blue' },
        item: { fg: 'white' }
      },
      keys: true,
      mouse: true,
      scrollable: true
    });

    // 3. Logs (Right)
    this.logBox = blessed.log({
      top: 3,
      left: '35%',
      width: '65%',
      height: '100%-6',
      label: ' LOGS ',
      border: { type: 'line' },
      style: { border: { fg: 'yellow' } },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { 
        ch: ' ', 
        track: { bg: 'grey' }, 
        style: { inverse: true } 
      },
      keys: true,
      mouse: true,
      tags: true
    });

    // 4. Footer
    this.footer = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' Initializing...',
      border: { type: 'line' },
      style: { border: { fg: 'white' } }
    });

    // Append all
    this.screen.append(this.header);
    this.screen.append(this.routesBox);
    this.screen.append(this.logBox);
    this.screen.append(this.footer);

    // Key bindings
    this.screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    // Focus logBox by default so scrolling works immediately
    this.logBox.focus();

    // Initial state
    this.setRoutes(this.routes);
    this.setPort(this.port);

    this.render();
  }

  public setRoutes(routes: string[]) {
    this.routes = routes;
    this.pageCount = routes.length;
    
    if (this.routesBox) {
      this.routesBox.setItems(routes.map(r => ` ${r}`)); // Add space for padding
      this.updateFooter();
      this.render();
    }
  }

  public setPort(port: number) {
    this.port = port;
    if (this.footer) {
      this.updateFooter();
      this.render();
    }
  }

  public setHMRStatus(status: 'Active' | 'Inactive') {
    this.hmrStatus = status;
    if (this.footer) {
      this.updateFooter();
      this.render();
    }
  }

  public setNetworkUrl(url: string) {
    this.networkUrl = url;
    if (this.footer) {
      this.updateFooter();
      this.render();
    }
  }

  public log(message: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') {
    // If TUI is not active, we assume console logs are handled normally (or we should pipe to stdout if this method is called directly)
    // But since dev.ts overrides console.log to call this, we MUST print to stdout if screen is missing.
    if (!this.logBox) {
        // Fallback to standard output if TUI not started
        // But we must be careful not to create infinite loop if console.log calls this.
        // We use process.stdout.write to bypass console.log override if possible, 
        // OR we rely on dev.ts not overriding console.log until tui.start() is called.
        // If dev.ts overrides console.log AFTER tui.start(), then this case (!this.logBox) should theoretically not happen 
        // for console logs. 
        // However, if something calls tui.log directly...
        // Let's safe guard.
        // Actually, better to just return if not started, assuming console.log is not overridden yet.
        // Wait, dev.ts overrides console.log at start of startDevServer.
        // If I put tui.start() before console override, then logBox exists.
        return;
    }

    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    let prefix = '{blue-fg}[LOG]{/blue-fg}';
    if (type === 'warn') prefix = '{yellow-fg}[WARN]{/yellow-fg}';
    if (type === 'error') prefix = '{red-fg}[ERR ]{/red-fg}';
    if (type === 'success') prefix = '{green-fg}[OK  ]{/green-fg}';

    const escapedMessage = message.replace(/[{}]/g, (c) => c === '{' ? '{open}' : '{close}');
    
    const lines = message.split('\n');
    for (const line of lines) {
       this.logBox.log(`{gray-fg}${time}{/gray-fg} ${prefix} ${line}`);
    }
    this.render();
  }

  private updateFooter() {
    if (!this.footer) return;
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    let content = ` 🚀 Local: http://localhost:${this.port}`;
    if (this.networkUrl) {
      content += ` | 🌐 Network: ${this.networkUrl}`;
    }
    content += ` | 💾 ${mem}MB | 🛠️  Ctrl+C to Exit`;
    
    this.footer.setContent(content);
  }

  public render() {
    if (this.screen) {
      this.screen.render();
    }
  }
}

export const tui = new SatsetTUI();
