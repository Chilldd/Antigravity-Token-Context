import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyBoardAction, getBoardStateMap } from '../src/shared/board-store.mjs';

test('board-store supports star, archive, seen, rename, and batch archive/unarchive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-board-store-'));
  const configPath = join(dir, 'board.json');

  try {
    let cards = applyBoardAction({ action: 'star', id: 'c1', value: true }, configPath);
    assert.equal(cards.c1.starred, true);

    cards = applyBoardAction({ action: 'rename', id: 'c1', title: '自定义会话名称' }, configPath);
    assert.equal(cards.c1.customTitle, '自定义会话名称');

    cards = applyBoardAction({ action: 'seen', id: 'c2', at: '2026-11-24T01:00:00.000Z' }, configPath);
    assert.equal(cards.c2.seenAt, '2026-11-24T01:00:00.000Z');

    cards = applyBoardAction({ action: 'archive', id: 'c2', value: true }, configPath);
    assert.equal(cards.c2.archived, true);
    assert.ok(cards.c2.archivedAt);

    cards = applyBoardAction({ action: 'archive', id: 'c2', value: false }, configPath);
    assert.equal(cards.c2.archived, undefined);
    assert.equal(cards.c2.archivedAt, undefined);
    assert.ok(cards.c2.seenAt);

    cards = applyBoardAction({ action: 'archive_batch', ids: ['c1', 'c2', 'c3'] }, configPath);
    assert.equal(cards.c1.archived, true);
    assert.equal(cards.c2.archived, true);
    assert.equal(cards.c3.archived, true);
    assert.equal(cards.c1.starred, true);

    cards = applyBoardAction({ action: 'unarchive_batch', ids: ['c1', 'c2', 'c3'] }, configPath);
    assert.equal(cards.c1.archived, undefined);
    assert.equal(cards.c1.archivedAt, undefined);
    assert.equal(cards.c1.starred, true);
    assert.equal(cards.c2.archived, undefined);
    assert.equal(cards.c3.archived, undefined);

    const persisted = getBoardStateMap(configPath);
    assert.equal(persisted.c1.customTitle, '自定义会话名称');
    assert.equal(persisted.c1.archived, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
