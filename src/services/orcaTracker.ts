/**
 * Orca Browser Diagnostic & Error Tracking Engine
 * Intercepts console, network, unhandled exceptions, and AI workflow events.
 * Exposes window.__ORCA_TRACKER__ for headless Orca browser querying (`orca eval`).
 */

export interface OrcaLogEntry {
  id: string;
  timestamp: number;
  isoTime: string;
  level: 'info' | 'warn' | 'error' | 'network' | 'action';
  category: 'system' | 'console' | 'network' | 'generation' | 'voice' | 'sam' | 'user';
  message: string;
  details?: any;
  stack?: string;
}

type Subscriber = (logs: OrcaLogEntry[]) => void;

class OrcaTrackerService {
  private logs: OrcaLogEntry[] = [];
  private maxLogs = 250;
  private subscribers: Set<Subscriber> = new Set();
  private initialized = false;

  constructor() {
    this.init();
  }

  public init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    // Attach to window for Orca CLI (`orca eval --expression "window.__ORCA_TRACKER__.dump()"`)
    (window as any).__ORCA_TRACKER__ = this;

    // Hook console errors and warnings
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.error = (...args: any[]) => {
      originalConsoleError.apply(console, args);
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      this.record('error', 'console', msg, { args });
    };

    console.warn = (...args: any[]) => {
      originalConsoleWarn.apply(console, args);
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      this.record('warn', 'console', msg, { args });
    };

    // Hook window error & unhandledrejection
    window.addEventListener('error', (event) => {
      this.record('error', 'system', event.message || 'Uncaught error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      }, event.error?.stack);
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      this.record('error', 'system', `Unhandled Promise Rejection: ${msg}`, { reason }, stack);
    });

    // Hook window.fetch for network monitoring
    const originalFetch = window.fetch;
    window.fetch = async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || 'GET';
      const start = performance.now();

      // Only track internal APIs or specific requests
      const isInternal = url.startsWith('/api') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');

      try {
        const response = await originalFetch.apply(window, args);
        const duration = Math.round(performance.now() - start);

        if (!response.ok && isInternal) {
          // Clone response to inspect error body without consuming original
          let errorPayload: any = null;
          try {
            const clone = response.clone();
            const text = await clone.text();
            try { errorPayload = JSON.parse(text); } catch { errorPayload = text; }
          } catch {}

          this.record('error', 'network', `Fetch failed ${method} ${url} -> ${response.status} (${duration}ms)`, {
            status: response.status,
            statusText: response.statusText,
            url,
            method,
            durationMs: duration,
            responseBody: errorPayload,
          });
        } else if (isInternal) {
          this.record('network', 'network', `${method} ${url} -> ${response.status} (${duration}ms)`, {
            status: response.status,
            url,
            method,
            durationMs: duration,
          });
        }

        return response;
      } catch (err: any) {
        const duration = Math.round(performance.now() - start);
        this.record('error', 'network', `Network exception ${method} ${url} (${duration}ms): ${err.message}`, {
          url,
          method,
          durationMs: duration,
        }, err.stack);
        throw err;
      }
    };

    this.record('info', 'system', 'Orca diagnostic tracker initialized and ready.');
  }

  public record(
    level: OrcaLogEntry['level'],
    category: OrcaLogEntry['category'],
    message: string,
    details?: any,
    stack?: string
  ) {
    const entry: OrcaLogEntry = {
      id: `orca-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      level,
      category,
      message,
      details,
      stack,
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.notify();
  }

  public trackAction(category: OrcaLogEntry['category'], message: string, details?: any) {
    this.record('action', category, message, details);
  }

  public trackError(category: OrcaLogEntry['category'], message: string, error?: any) {
    const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : message;
    const stack = error instanceof Error ? error.stack : undefined;
    this.record('error', category, `${message}: ${msg}`, error, stack);
  }

  public getLogs(): OrcaLogEntry[] {
    return [...this.logs];
  }

  public getErrors(): OrcaLogEntry[] {
    return this.logs.filter(l => l.level === 'error');
  }

  public getSummary() {
    const errors = this.getErrors();
    const network = this.logs.filter(l => l.level === 'network');
    return {
      totalLogs: this.logs.length,
      errorCount: errors.length,
      networkCalls: network.length,
      lastError: errors[0] || null,
      lastLog: this.logs[0] || null,
    };
  }

  public clear() {
    this.logs = [];
    this.record('info', 'system', 'Orca tracker logs cleared.');
    this.notify();
  }

  public dump(): string {
    return JSON.stringify({
      summary: this.getSummary(),
      recentErrors: this.getErrors().slice(0, 10),
      recentLogs: this.logs.slice(0, 30),
    }, null, 2);
  }

  public subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify() {
    for (const sub of this.subscribers) {
      try { sub(this.getLogs()); } catch {}
    }
  }
}

export const orcaTracker = new OrcaTrackerService();
