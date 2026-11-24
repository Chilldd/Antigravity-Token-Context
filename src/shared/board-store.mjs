import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const VALID_BOARD_COLUMNS = new Set(['starred', 'waiting', 'running', 'idle', 'error']);
const MANUAL_COLUMNS = new Set(['waiting', 'running', 'idle', 'error']);

export function getDefaultBoardConfigPath() {
  return join(homedir(), '.gemini', 'antigravity', 'agy-workspace-board.json');
}

function normalizeCardEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let column = typeof raw.column === 'string' ? raw.column.trim() : '';
  let starred = Boolean(raw.starred);
  if (column === 'starred') {
    starred = true;
    column = '';
  }
  if (!MANUAL_COLUMNS.has(column)) {
    column = '';
  }
  const archived = Boolean(raw.archived);
  const archivedAt = archived && typeof raw.archivedAt === 'string' ? raw.archivedAt : '';
  const seenAt = typeof raw.seenAt === 'string' ? raw.seenAt : '';
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : '';

  if (!starred && !archived && !seenAt && !column) {
    return null;
  }

  const entry = {};
  if (starred) entry.starred = true;
  if (archived) {
    entry.archived = true;
    if (archivedAt) entry.archivedAt = archivedAt;
  }
  if (seenAt) entry.seenAt = seenAt;
  if (column) entry.column = column;
  if (updatedAt) entry.updatedAt = updatedAt;
  return entry;
}

export function getBoardStore(configPath = getDefaultBoardConfigPath()) {
  try {
    if (!existsSync(configPath)) return { initializedAt: '', cards: {} };
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { initializedAt: '', cards: {} };
    const initializedAt = typeof parsed.initializedAt === 'string' ? parsed.initializedAt : '';
    const rawCards = parsed.cards && typeof parsed.cards === 'object' ? parsed.cards : {};
    const cards = {};
    for (const [id, rawEntry] of Object.entries(rawCards)) {
      const key = String(id || '').trim();
      if (!key) continue;
      const normalized = normalizeCardEntry(rawEntry);
      if (normalized) cards[key] = normalized;
    }
    return { initializedAt, cards };
  } catch {
    return { initializedAt: '', cards: {} };
  }
}

function writeBoardStore(store, configPath) {
  const cleanedCards = {};
  for (const [id, rawEntry] of Object.entries(store.cards || {})) {
    const key = String(id || '').trim();
    if (!key) continue;
    const normalized = normalizeCardEntry(rawEntry);
    if (normalized) cleanedCards[key] = normalized;
  }
  const payload = {
    version: 2,
    initializedAt: store.initializedAt || new Date().toISOString(),
    cards: cleanedCards,
  };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf8');
  return { initializedAt: payload.initializedAt, cards: cleanedCards };
}

export function ensureBoardInitialized(configPath = getDefaultBoardConfigPath()) {
  const store = getBoardStore(configPath);
  if (store.initializedAt) return store;
  const initializedAt = new Date().toISOString();
  return writeBoardStore({ initializedAt, cards: store.cards }, configPath);
}

export function getBoardStateMap(configPath = getDefaultBoardConfigPath()) {
  return getBoardStore(configPath).cards;
}

function pickLaterIso(a, b) {
  const msA = a ? Date.parse(a) : 0;
  const msB = b ? Date.parse(b) : 0;
  if (Number.isFinite(msA) && Number.isFinite(msB)) {
    return msA >= msB ? a : b;
  }
  return b || a || '';
}

export function applyBoardAction(payload, configPath = getDefaultBoardConfigPath()) {
  if (!payload || typeof payload !== 'object') return getBoardStateMap(configPath);
  const store = ensureBoardInitialized(configPath);
  const cards = { ...store.cards };
  const now = new Date().toISOString();
  const action = String(payload.action || '').trim();

  if (action === 'archive_batch') {
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    for (const rawId of ids) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      const prev = cards[id] || {};
      cards[id] = {
        ...prev,
        archived: true,
        archivedAt: now,
        seenAt: pickLaterIso(prev.seenAt, now),
        updatedAt: now,
      };
    }
    return writeBoardStore({ initializedAt: store.initializedAt, cards }, configPath).cards;
  }

  const id = String(payload.id || '').trim();
  if (!id) return cards;
  const prev = cards[id] || {};

  if (action === 'star') {
    const nextStarred = Boolean(payload.value);
    const next = { ...prev, updatedAt: now };
    if (nextStarred) next.starred = true;
    else delete next.starred;
    cards[id] = next;
  } else if (action === 'archive') {
    const nextArchived = Boolean(payload.value);
    const next = { ...prev, updatedAt: now };
    if (nextArchived) {
      next.archived = true;
      next.archivedAt = now;
      next.seenAt = pickLaterIso(prev.seenAt, now);
    } else {
      delete next.archived;
      delete next.archivedAt;
    }
    cards[id] = next;
  } else if (action === 'seen') {
    const targetAt = typeof payload.at === 'string' && payload.at ? payload.at : now;
    cards[id] = {
      ...prev,
      seenAt: pickLaterIso(prev.seenAt, targetAt),
      updatedAt: now,
    };
  } else {
    // 'move' or legacy { id, column }
    const col = String(payload.column || '').trim();
    const next = { ...prev, updatedAt: now };
    if (col === 'starred') {
      next.starred = true;
      delete next.column;
    } else if (!col || col === 'auto') {
      delete next.column;
    } else if (MANUAL_COLUMNS.has(col)) {
      next.column = col;
    }
    cards[id] = next;
  }

  return writeBoardStore({ initializedAt: store.initializedAt, cards }, configPath).cards;
}

export function setBoardCardColumn(conversationId, column, configPath = getDefaultBoardConfigPath()) {
  const id = String(conversationId || '').trim();
  if (!id) return getBoardStateMap(configPath);
  return applyBoardAction({ action: 'move', id, column }, configPath);
}
