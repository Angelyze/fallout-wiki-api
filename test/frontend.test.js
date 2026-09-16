import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../BLOGGER_FRONTEND.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

function element() {
  return {
    style: {}, events: {}, children: [], value: '', scrollHeight: 100,
    addEventListener(name, listener) { this.events[name] = listener; },
    setAttribute() {}, removeAttribute() {},
    appendChild(child) { this.children.push(child); }
  };
}
function fixture() {
  function chat(id) {
    const messages = element();
    const input = element();
    const send = element();
    const close = element();
    const loading = element();
    const root = Object.assign(element(), { id, querySelector(selector) {
      return { '[id="user-input"]': input, '[id="loading"]': loading,
        '[onclick*="sendMessage"]': send, '[id="close-chat"]': close }[selector];
    } });
    messages.closest = () => root;
    return { messages, input, send, close, loading, root };
  }
  const page = chat('');
  const widget = chat('chat-widget');
  const icon = element();
  const calls = [];
  const context = vm.createContext({
    window: { innerHeight: 800 }, AbortController, setTimeout, clearTimeout,
    document: { readyState: 'complete',
      querySelectorAll: () => [page.messages, widget.messages],
      createElement: element, getElementById: () => icon },
    fetch: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return Response.json({ reply: '<img src=x onerror=alert(1)> **Vault 13** &lt;script&gt;' });
    }
  });
  vm.runInContext(source, context);
  return { page, widget, icon, calls, context };
}
const click = button => button.events.click({ preventDefault() {} });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('both chats stay independent and neither user nor AI HTML is executable markup', async () => {
  const { page, widget, icon, calls } = fixture();
  click(icon);
  const greetingCount = page.messages.children.length;
  widget.input.value = '<img src=x onerror=alert(1)>';
  click(widget.send);
  await flush();
  assert.deepEqual(calls, [{ message: '<img src=x onerror=alert(1)>' }]);
  assert.equal(page.messages.children.length, greetingCount);
  const user = widget.messages.children[1];
  assert.equal(user.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(user.innerHTML, undefined);
  const reply = widget.messages.children[2].innerHTML;
  assert.doesNotMatch(reply, /<img|<script/);
  assert.match(reply, /&lt;img/);
  assert.match(reply, /<strong>Vault 13<\/strong>/);
  assert.match(reply, /&amp;lt;script&amp;gt;/);
  assert.equal(widget.loading.style.display, 'none');
  assert.equal(widget.send.disabled, false);
});

test('duplicate script copies do not register twice and widget opens/closes', () => {
  const { page, widget, icon, context } = fixture();
  const listener = page.send.events.click;
  vm.runInContext(source, context);
  assert.equal(page.send.events.click, listener);
  assert.equal(page.messages.children.length, 1);
  click(icon);
  assert.equal(widget.root.style.display, 'block');
  assert.equal(icon.style.display, 'none');
  click(widget.close);
  assert.equal(widget.root.style.display, 'none');
  assert.equal(icon.style.display, 'block');
});

test('sending twice while a request is pending makes only one request', async () => {
  const { page, calls } = fixture();
  page.input.value = 'Fallout?';
  click(page.send);
  page.input.value = 'Another question';
  click(page.send);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(page.input.value, 'Another question');
});
