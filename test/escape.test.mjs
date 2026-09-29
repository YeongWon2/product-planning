import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, jsonForScript } from '../src/render/escape.mjs';

test('HTML과 스크립트용 JSON을 안전하게 만든다', () => {
  assert.equal(escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.ok(!jsonForScript({ n: '</script>' }).includes('</script>'));
  assert.deepEqual(JSON.parse(jsonForScript({ n: '</script>' })), { n: '</script>' });
  const separators = String.fromCharCode(0x2028, 0x2029);
  assert.ok(!jsonForScript({ n: separators }).includes(separators));
  assert.deepEqual(JSON.parse(jsonForScript({ n: separators })), { n: separators });
});
