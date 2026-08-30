import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TEST_FILE), '../..');

test('維持変更・未知qdr・修飾クリック・再注入の契約を保つ', { timeout: 30_000 }, async (t) => {
  const browser = await puppeteer.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${pathToFileURL(TEST_FILE).href}?q=test&tbs=qdr:y`);
  await page.setContent('<main id="center_col"></main>');
  await page.evaluate(() => {
    window.__settingsMessages = [];
    const storageListeners = new Set();
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          lastError: undefined,
          sendMessage: (msg, callback) => {
            window.__settingsMessages.push(msg);
            callback({ done: true });
          },
        },
        storage: {
          sync: {
            get: (defaults, callback) => callback({ ...defaults, qdr: 'y', keepSetting: false }),
            set: async () => {},
          },
          onChanged: {
            addListener: (listener) => storageListeners.add(listener),
            removeListener: (listener) => storageListeners.delete(listener),
          },
        },
      },
    });
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return attachShadow.call(this, { ...init, mode: 'open' });
    };
  });

  await page.addScriptTag({ path: path.join(REPO_ROOT, 'src/shared/presets.js') });
  await page.addScriptTag({ path: path.join(REPO_ROOT, 'src/content/content.js') });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#searchclock-root').length), 1);

  await page.evaluate(() => {
    const root = document.getElementById('searchclock-root');
    const keepInput = root.shadowRoot.getElementById('sc-keep-input');
    keepInput.checked = true;
    keepInput.dispatchEvent(new Event('change'));
    document.getElementById('center_col').replaceWith(Object.assign(document.createElement('main'), {
      id: 'center_col',
    }));
  });

  await page.waitForFunction(() => document.querySelectorAll('#searchclock-root').length === 1
    && document.querySelector('#center_col > #searchclock-root'));
  assert.equal(await page.evaluate(
    () => document.querySelectorAll('#center_col > #searchclock-root').length,
  ), 1);
  assert.deepEqual(await page.evaluate(() => window.__settingsMessages), [{
    type: 'updateKeepSetting',
    keepSetting: true,
    qdr: 'y',
  }]);

  const unknownQdrState = await page.evaluate(() => {
    const root = document.getElementById('searchclock-root');
    const shadow = root.shadowRoot;
    const refs = {
      status: shadow.getElementById('sc-status'),
      tbs: shadow.getElementById('sc-tbs'),
      issueNo: shadow.getElementById('sc-issue-no'),
      panel: shadow.getElementById('sc-panel'),
      keepInput: shadow.getElementById('sc-keep-input'),
      keepWrap: shadow.getElementById('sc-keep'),
      modeChip: shadow.getElementById('sc-mode-chip'),
      radios: shadow.querySelectorAll('input[name="qdr"]'),
    };
    const qdr = urlQdr(new URL('https://www.google.com/search?q=test&tbs=qdr:h'));
    updateUI(refs, qdr, false);
    return {
      qdr,
      status: refs.status.textContent,
      tbs: refs.tbs.textContent,
      active: refs.panel.classList.contains('is-active'),
      keepDisabled: refs.keepInput.disabled,
    };
  });
  assert.deepEqual(unknownQdrState, {
    qdr: 'h',
    status: '1時間以内',
    tbs: 'qdr:h',
    active: true,
    keepDisabled: true,
  });

  const modifiedClick = await page.evaluate(() => {
    window.__settingsMessages = [];
    const link = document.createElement('a');
    link.href = 'file:///search?q=test&tbs=qdr:d';
    link.textContent = '期間変更';
    document.body.appendChild(link);
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    link.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, messages: window.__settingsMessages };
  });
  assert.equal(modifiedClick.defaultPrevented, false);
  assert.deepEqual(modifiedClick.messages, [{ type: 'updateQdr', qdr: '', keepSetting: false }]);

  const retryResult = await page.evaluate(async () => {
    window.__settingsMessages = [];
    let shouldFail = true;
    chrome.runtime.sendMessage = (msg, callback) => {
      window.__settingsMessages.push(msg);
      if (shouldFail) {
        shouldFail = false;
        callback({ done: false, error: 'temporary failure' });
        return;
      }
      callback({ done: true });
    };
    await sendSettingsMessage({ type: 'updateQdr', qdr: 'd' });
    return window.__settingsMessages;
  });
  assert.equal(retryResult.length, 2);
  assert.deepEqual(retryResult[0], retryResult[1]);

  const rapidChangeMessages = await page.evaluate(() => {
    window.__settingsMessages = [];
    chrome.runtime.sendMessage = (msg, callback) => {
      window.__settingsMessages.push(msg);
      if (msg.type === 'updateKeepSetting') callback({ done: true });
    };
    const shadow = document.getElementById('searchclock-root').shadowRoot;
    const keepInput = shadow.getElementById('sc-keep-input');
    keepInput.disabled = false;
    keepInput.checked = true;
    keepInput.dispatchEvent(new Event('change'));
    const radio = [...shadow.querySelectorAll('input[name="qdr"]')]
      .find((input) => input.value === 'd');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    return window.__settingsMessages;
  });
  assert.deepEqual(rapidChangeMessages, [
    { type: 'updateKeepSetting', keepSetting: true, qdr: 'y' },
    { type: 'updateQdr', qdr: 'd' },
  ]);
});
