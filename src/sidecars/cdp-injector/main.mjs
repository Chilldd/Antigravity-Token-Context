import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyBoardAction } from '../../shared/board-store.mjs';
import {
  ensureCatalog,
  getGeminiQuotaSummary,
  getLatestMetrics,
  getWorkspaceBoardData,
} from '../../shared/ls-client.mjs';
import { startCdpInjector } from '../../statusline/injector.mjs';

const PID_FILE = join(tmpdir(), 'agy-cdp-injector.pid');

function takeOverSingleInstance() {
  try {
    const raw = readFileSync(PID_FILE, 'utf8').trim();
    const oldPid = Number.parseInt(raw, 10);
    if (Number.isInteger(oldPid) && oldPid > 0 && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0);
        process.kill(oldPid);
      } catch {
        // old process already exited or inaccessible
      }
    }
  } catch {
    // pid file does not exist yet
  }
  try {
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch {
    // ignore pid write failure
  }
}

function releasePidFile() {
  try {
    if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      rmSync(PID_FILE, { force: true });
    }
  } catch {
    // ignore cleanup failure
  }
}

takeOverSingleInstance();
ensureCatalog();

const stopInjector = startCdpInjector({
  getMetrics: (cid) => getLatestMetrics(cid, { includeSubagents: false, fallbackToLatest: false }),
  getQuota: getGeminiQuotaSummary,
  getBoard: () => getWorkspaceBoardData(120),
  onSetBoardStatus: (payload) => applyBoardAction(payload),
});

function shutdown() {
  try { stopInjector(); } catch {}
  releasePidFile();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', releasePidFile);
