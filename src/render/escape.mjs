// 소스에 문자를 직접 쓰면 편집 도구가 줄바꿈으로 바꿀 수 있어 코드로 만든다.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

// <script type="application/json"> 안에 넣을 JSON. '</script>'로 스크립트가 끝나지 않도록 '<'를 이스케이프한다.
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029');
}

// 코드 포인트 단위로 자른다. 한글·이모지가 반으로 잘리지 않게 한다.
export function truncate(value, max) {
  const chars = [...String(value ?? '')];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}
