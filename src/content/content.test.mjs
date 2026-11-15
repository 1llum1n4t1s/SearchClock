import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { createSeededProfile, removeSeededProfile } from '../../scripts/chrome-profile-seed.mjs';

const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TEST_FILE), '../..');
const EN_MESSAGES = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '_locales/en/messages.json'), 'utf8'));

test('維持変更・未知qdr・修飾クリック・再注入の契約を保つ', { timeout: 30_000 }, async (t) => {
  // Windows アカウントのロック防止（必須）: userDataDir 未指定だと新規プロファイルごとに空パスワード確認（LogonUser 失敗）が走るため、
  // シード済みの一時プロファイルを渡し、終了時に片付ける。理由は scripts/chrome-profile-seed.mjs を参照。
  const userDataDir = createSeededProfile('searchclock-test');
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : { channel: 'chrome' }),
  });
  t.after(async () => { await browser.close(); removeSeededProfile(userDataDir); });
  const page = await browser.newPage();
  // 右側に列を置ける幅にして、検索結果列の右外へ置くサイド配置を検証する
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`${pathToFileURL(TEST_FILE).href}?q=test&tbs=qdr:y`);
  await page.setContent('<div id="rcnt"><main id="center_col" style="position:relative;width:650px;margin-left:180px"><div id="first-result">result</div></main></div>');
  await page.evaluate((enMessages) => {
    window.__settingsMessages = [];
    const storageListeners = new Set();
    const chromeApi = window.chrome ?? {};
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', { value: chromeApi });
    }
    Object.assign(chromeApi, {
      // ui-localizer.js が使う最小の i18n / storage.local / manifest（辞書は en）
      i18n: {
        getMessage: (key, subs) => {
          const entry = enMessages[key];
          if (!entry) return '';
          return entry.message.replace(/$[A-Z]+$/g, [].concat(subs ?? '')[0] ?? '');
        },
        getUILanguage: () => 'en',
      },
      runtime: {
        getManifest: () => ({ version: 'test' }),
        lastError: undefined,
        sendMessage: (msg, callback) => {
          window.__settingsMessages.push(msg);
          callback({ done: true });
        },
      },
      storage: {
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        sync: {
          get: (defaults, callback) => callback({ ...defaults, qdr: 'y', keepSetting: false }),
          set: async () => {},
        },
        onChanged: {
          addListener: (listener) => storageListeners.add(listener),
          removeListener: (listener) => storageListeners.delete(listener),
        },
      },
    });
    const attachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function attachOpenShadow(init) {
      return attachShadow.call(this, { ...init, mode: 'open' });
    };
  }, EN_MESSAGES);

  await page.addScriptTag({ path: path.join(REPO_ROOT, 'src/shared/ui-localizer.js') });
  await page.addScriptTag({ path: path.join(REPO_ROOT, 'src/shared/presets.js') });
  await page.addScriptTag({ path: path.join(REPO_ROOT, 'src/content/content.js') });
  // 注入は Localizer.ready の後に非同期で行われる
  await page.waitForSelector('#searchclock-root');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#searchclock-root').length), 1);

  // パネルは検索結果の外側（右）に置かれ、1件目の位置を動かさない
  const sideLayout = await page.evaluate(() => {
    const root = document.getElementById('searchclock-root');
    const center = document.getElementById('center_col');
    const first = document.getElementById('first-result');
    return {
      position: getComputedStyle(root).position,
      firstIsTop: center.firstElementChild === first,
      firstTop: first.getBoundingClientRect().top - center.getBoundingClientRect().top,
      rootLeftOfCenterRight: root.getBoundingClientRect().left >= center.getBoundingClientRect().right,
    };
  });
  assert.deepEqual(sideLayout, {
    position: 'absolute',
    firstIsTop: true,
    firstTop: 0,
    rootLeftOfCenterRight: true,
  });

  await page.evaluate(() => {
    const root = document.getElementById('searchclock-root');
    const keepInput = root.shadowRoot.getElementById('sc-keep-input');
    keepInput.checked = true;
    keepInput.dispatchEvent(new Event('change'));
    const next = document.createElement('main');
    next.id = 'center_col';
    next.style.cssText = 'position:relative;width:650px;margin-left:180px';
    next.appendChild(Object.assign(document.createElement('div'), { id: 'first-result', textContent: 'result' }));
    document.getElementById('center_col').replaceWith(next);
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
    history.replaceState(null, '', '?q=test&tbs=qdr:h');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    const shadow = document.getElementById('searchclock-root').shadowRoot;
    return {
      status: shadow.getElementById('sc-status').textContent,
      tbs: shadow.getElementById('sc-tbs').textContent,
      active: shadow.getElementById('sc-panel').classList.contains('is-active'),
      keepDisabled: shadow.getElementById('sc-keep-input').disabled,
    };
  });
  assert.deepEqual(unknownQdrState, {
    status: 'Within 1 hour',
    tbs: 'qdr:h',
    active: true,
    keepDisabled: true,
  });
  await page.evaluate(() => {
    history.replaceState(null, '', '?q=test&tbs=qdr:y');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
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

  await page.evaluate(() => {
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
    const keepInput = document.getElementById('searchclock-root').shadowRoot.getElementById('sc-keep-input');
    keepInput.checked = true;
    keepInput.dispatchEvent(new Event('change'));
  });
  // 修飾クリックで別タブが開くと描画が止まるため、メッセージ完了はフレームに依存せず待つ。
  await page.waitForFunction(() => window.__settingsMessages.length === 2, { polling: 50, timeout: 5000 });
  const retryResult = await page.evaluate(() => window.__settingsMessages);
  assert.equal(retryResult.length, 2);
  assert.deepEqual(retryResult[0], { type: 'updateKeepSetting', keepSetting: true, qdr: 'y' });
  assert.deepEqual(retryResult[0], retryResult[1]);
  assert.equal(await page.evaluate(() => document.getElementById('searchclock-root')
    .shadowRoot.getElementById('sc-keep-input').checked), true);

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

  // Sonoyo が実ページと同じく #center_col の右外へ列を作ったら、その列の先頭へ積み、重ならない
  await page.evaluate(() => {
    const col = document.createElement('div');
    col.id = 'sonoyo-col';
    col.style.cssText = 'position:absolute;left:calc(100% + 28px);top:0;width:380px;';
    const sonoyo = document.createElement('div');
    sonoyo.id = 'sonoyo-root';
    sonoyo.style.cssText = 'display:block;width:100%;height:300px;';
    col.appendChild(sonoyo);
    document.getElementById('center_col').appendChild(col);
  });
  await page.waitForFunction(() => document.querySelector('#sonoyo-col > #searchclock-root:first-child'), { polling: 50, timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => {
    const a = document.getElementById('searchclock-root').getBoundingClientRect();
    const b = document.getElementById('sonoyo-root').getBoundingClientRect();
    const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { count: document.querySelectorAll('#searchclock-root').length, overlap, below: b.top >= a.bottom };
  }), { count: 1, overlap: false, below: true });

  // Sonoyo の列が外れたら、検索結果列の右外へ戻る
  await page.evaluate(() => document.getElementById('sonoyo-col').remove());
  await page.waitForFunction(() => document.querySelector('#center_col > #searchclock-root'), { polling: 50, timeout: 5000 });

  // 右カラム (#rhs) が後から現れたら、そちらの先頭へ載せ替える
  await page.evaluate(() => {
    const rhs = document.createElement('div');
    rhs.id = 'rhs';
    document.getElementById('rcnt').appendChild(rhs);
  });
  await page.waitForFunction(() => document.querySelector('#rhs > #searchclock-root'), { polling: 50, timeout: 5000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#searchclock-root').length), 1);

  // 右側に余白が無い幅では画面右下へ固定表示し、検索結果列にも1件目の上にも入らない
  // 修飾クリックで開いた別タブの裏に回ったままだと resize が届かないため、先に前面へ戻す
  await page.bringToFront();
  await page.setViewport({ width: 900, height: 900 });
  await page.waitForFunction(() => document.querySelector('body > #searchclock-root'), { polling: 50, timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => ({
    count: document.querySelectorAll('#searchclock-root').length,
    position: getComputedStyle(document.getElementById('searchclock-root')).position,
    firstIsTop: document.getElementById('center_col').firstElementChild.id,
    coversFirst: (() => {
      const a = document.getElementById('searchclock-root').getBoundingClientRect();
      const b = document.getElementById('first-result').getBoundingClientRect();
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    })(),
  })), { count: 1, position: 'fixed', firstIsTop: 'first-result', coversFirst: false });
});
