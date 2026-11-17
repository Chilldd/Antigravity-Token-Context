import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConversationId, filterAntigravityPages } from '../src/statusline/client.mjs';

test('extractConversationId extracts UUID from Antigravity page URL', () => {
  const url = 'https://127.0.0.1:59643/c/162ee284-dce9-4118-b331-8f60b46a6ef5?project=abc';
  assert.equal(extractConversationId(url), '162ee284-dce9-4118-b331-8f60b46a6ef5');
  assert.equal(extractConversationId('https://127.0.0.1:59643/'), '');
});

test('filterAntigravityPages keeps only Antigravity main renderer pages', () => {
  const targets = [
    { type: 'page', title: 'data:text/html,splash', url: 'data:text/html,foo', webSocketDebuggerUrl: 'ws://1' },
    { type: 'iframe', title: 'plugin://x', url: 'plugin://x', webSocketDebuggerUrl: 'ws://2' },
    { type: 'page', title: 'New Tab - Google Chrome', url: 'https://google.com', webSocketDebuggerUrl: 'ws://3' },
    { type: 'page', title: 'Chat - Antigravity', url: 'https://127.0.0.1:59643/c/123', webSocketDebuggerUrl: 'ws://4' },
  ];
  const filtered = filterAntigravityPages(targets);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].webSocketDebuggerUrl, 'ws://4');
});
