#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Daemon } from './daemon.js';
import { daemonLogPath, daemonPidPath, loadDaemonConfig } from './config.js';
import { createLogger } from './logger.js';

type Subcommand = 'start' | 'stop' | 'status' | 'health' | 'help';

function parseSubcommand(argv: string[]): Subcommand {
  const sub = argv[2];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') return 'help';
  if (sub === 'start' || sub === 'stop' || sub === 'status' || sub === 'health') {
    return sub;
  }
  return 'help';
}

function printHelp(): void {
  const lines = [
    'cepage-daemon — native execution daemon for Cepage',
    '',
    'Usage:',
    '  cepage-daemon start     Start the daemon (foreground)',
    '  cepage-daemon stop      Stop the running daemon',
    '  cepage-daemon status    Show daemon status from the health endpoint',
    '  cepage-daemon health    Alias for status',
    '',
    'Environment:',
    '  CEPAGE_API_URL              Cepage API base URL (default http://localhost:31947)',
    '  CEPAGE_HOME                 Daemon state directory (default ~/.cepage)',
    '  CEPAGE_WORKSPACE_ROOT       Agent workspace root (default ~/cepage_workspaces)',
    '  CEPAGE_DAEMON_HEALTH_PORT   Local health server port (default 31982)',
    '  CEPAGE_DAEMON_POLL_MS       Poll interval (default 500)',
    '  CEPAGE_DAEMON_HEARTBEAT_MS  Heartbeat interval (default 5000)',
    '  CEPAGE_DAEMON_LOG_LEVEL     debug|info|warn|error (default info)',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function writePidFile(pidPath: string): void {
  const dir = path.dirname(pidPath);
  if (!existsSync(dir)) {
    return;
  }
  writeFileSync(pidPath, `${process.pid}\n`);
}

function removePidFile(pidPath: string): void {
  try {
    rmSync(pidPath);
  } catch {
    // best-effort
  }
}

async function runStart(): Promise<number> {
  const config = loadDaemonConfig();
  const logger = createLogger({ level: config.logLevel, filePath: daemonLogPath() });
  const daemon = new Daemon(config, { logger });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('daemon shutting down', { signal });
    try {
      await daemon.stop();
    } catch (error) {
      logger.error('daemon stop failed', {
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      removePidFile(daemonPidPath());
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await daemon.start();
    writePidFile(daemonPidPath());
    logger.info('daemon ready', { runtimeId: config.runtimeId, apiBaseUrl: config.apiBaseUrl });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('daemon failed to start', { detail });
    process.exit(1);
  }
  return 0;
}

async function runStop(): Promise<number> {
  const pidPath = daemonPidPath();
  if (!existsSync(pidPath)) {
    process.stdout.write('daemon is not running (no pid file)\n');
    return 0;
  }
  const pid = Number(readFileSync(pidPath, 'utf8').trim());
  if (!Number.isFinite(pid) || pid <= 0) {
    process.stderr.write(`invalid pid file at ${pidPath}\n`);
    return 1;
  }
  try {
    process.kill(pid, 'SIGTERM');
    process.stdout.write(`sent SIGTERM to daemon pid ${pid}\n`);
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`failed to signal daemon pid ${pid}: ${detail}\n`);
    return 1;
  }
}

async function runStatus(): Promise<number> {
  const config = loadDaemonConfig();
  const url = `http://127.0.0.1:${config.healthPort}/healthz`;
  try {
    const response = await fetch(url);
    const body = await response.text();
    if (response.status >= 400) {
      process.stderr.write(`daemon status ${response.status}: ${body}\n`);
      return 1;
    }
    process.stdout.write(`${body}\n`);
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`daemon status unreachable at ${url}: ${detail}\n`);
    return 2;
  }
}

async function main(): Promise<number> {
  const sub = parseSubcommand(process.argv);
  switch (sub) {
    case 'start':
      return runStart();
    case 'stop':
      return runStop();
    case 'status':
    case 'health':
      return runStatus();
    case 'help':
    default:
      printHelp();
      return 0;
  }
}

main().then(
  (code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  },
  (error) => {
    process.stderr.write(`daemon cli failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
