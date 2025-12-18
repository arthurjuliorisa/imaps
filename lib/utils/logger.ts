/**
 * Simple Logger for iMAPS API
 * No external dependencies, works in both dev and production
 * Compatible with Next.js build process
 */

import { NextRequest } from 'next/server';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: any;
}

interface LogEntry {
  level: number;
  time: number;
  msg: string;
  [key: string]: any;
}

class SimpleLogger {
  private context: LogContext = {};
  private logLevel: LogLevel;

  // Log level mapping
  private levelMap: Record<LogLevel, number> = {
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
  };

  constructor(baseContext: LogContext = {}) {
    this.context = baseContext;
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  /**
   * Create child logger with additional context
   */
  child(additionalContext: LogContext): SimpleLogger {
    const childLogger = new SimpleLogger({ ...this.context, ...additionalContext });
    childLogger.logLevel = this.logLevel;
    return childLogger;
  }

  /**
   * Check if level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return this.levelMap[level] >= this.levelMap[this.logLevel];
  }

  /**
   * Format and output log entry
   */
  private log(level: LogLevel, messageOrData: string | LogContext, data?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry: LogEntry = {
      level: this.levelMap[level],
      time: Date.now(),
      ...this.context,
      msg: '',
    };

    // Handle different argument patterns
    if (typeof messageOrData === 'string') {
      logEntry.msg = messageOrData;
      if (data) {
        Object.assign(logEntry, data);
      }
    } else {
      Object.assign(logEntry, messageOrData);
      if (messageOrData.msg) {
        logEntry.msg = messageOrData.msg;
      }
    }

    // Format output based on environment
    const output = this.formatOutput(level, logEntry);
    
    // Output to appropriate console method
    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }

  /**
   * Format log output
   */
  private formatOutput(level: LogLevel, entry: LogEntry): string {
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isDev) {
      // Human-readable format for development
      const timestamp = new Date(entry.time).toISOString();
      const levelStr = level.toUpperCase().padEnd(5);
      const { level: _, time, msg, ...rest } = entry;
      const contextStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
      return `[${timestamp}] ${levelStr}: ${msg}${contextStr}`;
    } else {
      // JSON format for production (easier to parse)
      return JSON.stringify(entry);
    }
  }

  /**
   * Debug level log
   */
  debug(messageOrData: string | LogContext, data?: LogContext): void {
    this.log('debug', messageOrData, data);
  }

  /**
   * Info level log
   */
  info(messageOrData: string | LogContext, data?: LogContext): void {
    this.log('info', messageOrData, data);
  }

  /**
   * Warn level log
   */
  warn(messageOrData: string | LogContext, data?: LogContext): void {
    this.log('warn', messageOrData, data);
  }

  /**
   * Error level log
   */
  error(messageOrData: string | LogContext, data?: LogContext): void {
    this.log('error', messageOrData, data);
  }
}

// Export singleton instance
export const logger = new SimpleLogger({
  env: process.env.NODE_ENV || 'development',
  pid: process.pid,
  hostname: typeof window === 'undefined' ? require('os').hostname() : 'browser',
});

// ============================================================================
// HELPER FUNCTIONS FOR API ROUTES
// ============================================================================

/**
 * Create request logger with unique request ID
 */
export function createRequestLogger(request: NextRequest): {
  requestId: string;
  logger: SimpleLogger;
} {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const requestLogger = logger.child({ requestId });
  return { requestId, logger: requestLogger };
}

/**
 * Log incoming request
 */
export async function logRequest(
  request: NextRequest,
  requestLogger: SimpleLogger
): Promise<void> {
  const method = request.method;
  const path = new URL(request.url).pathname;
  
  // Get body size if available
  let bodySize = 0;
  try {
    const clonedRequest = request.clone();
    const body = await clonedRequest.text();
    bodySize = body.length;
  } catch (error) {
    // Ignore if body can't be read
  }

  requestLogger.info({
    method,
    path,
    bodySize,
    msg: 'Incoming API request',
  });
}

/**
 * Log API response
 */
export function logResponse(
  requestLogger: SimpleLogger,
  statusCode: number,
  startTime: number
): void {
  const duration = Date.now() - startTime;
  
  requestLogger.info({
    statusCode,
    duration: `${duration}ms`,
    msg: 'API response sent',
  });
}