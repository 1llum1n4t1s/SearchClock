const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PRESETS_SOURCE = fs.readFileSync(path.join(__dirname, '../shared/presets.js'), 'utf8');
const BACKGROUND_SOURCE = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness({ failDynamicUpdates = 0, setDelay = () => 0 } = {}) {
  const storage = { qdr: '', keepSetting: true };
  const dynamicCalls = [];
  const listeners = {};
  let remainingDynamicFailures = failDynamicUpdates;

  const chrome = {
    runtime: {
      id: 'searchclock-test',
      onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
      onStartup: { addListener: (fn) => { listeners.startup = fn; } },
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
    },
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...storage }),
        set: async (updates) => {
          await delay(setDelay(updates));
          const changes = {};
          for (const [key, value] of Object.entries(updates)) {
            if (storage[key] !== value) {
              changes[key] = { oldValue: storage[key], newValue: value };
              storage[key] = value;
            }
          }
          if (Object.keys(changes).length > 0) {
            queueMicrotask(() => listeners.storageChanged?.(changes, 'sync'));
          }
        },
      },
      onChanged: { addListener: (fn) => { listeners.storageChanged = fn; } },
    },
    declarativeNetRequest: {
      updateDynamicRules: async (options) => {
        dynamicCalls.push(options);
        if (remainingDynamicFailures > 0) {
          remainingDynamicFailures--;
          throw new Error('DNR failed');
        }
      },
    },
    action: {
      onClicked: { addListener: (fn) => { listeners.action = fn; } },
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
      setTitle: async () => {},
    },
    tabs: { create: async () => {} },
  };

  const context = vm.createContext({
    chrome,
    clearTimeout,
    console: { warn: () => {} },
    importScripts: () => {},
    queueMicrotask,
    setTimeout,
  });
  vm.runInContext(PRESETS_SOURCE, context, { filename: 'presets.js' });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });

  const send = (msg) => new Promise((resolve) => {
    const handled = listeners.message(msg, { id: chrome.runtime.id }, resolve);
    assert.equal(handled, true);
  });

  return { storage, dynamicCalls, send };
}

function lastAppliedQdr(dynamicCalls) {
  const call = dynamicCalls.at(-1);
  const addRule = call?.addRules?.find((rule) => rule.id === 1);
  const value = addRule?.action?.redirect?.transform?.queryTransform?.addOrReplaceParams?.[0]?.value;
  return value?.replace('qdr:', '') ?? '';
}

test('連続 updateQdr はストレージと DNR の両方で最後の選択が勝つ', async () => {
  const harness = createHarness({
    setDelay: (updates) => updates.qdr === 'd' ? 30 : 0,
  });

  const first = harness.send({ type: 'updateQdr', qdr: 'd' });
  const second = harness.send({ type: 'updateQdr', qdr: 'y' });
  const responses = await Promise.all([first, second]);
  await delay(50);

  assert.deepEqual(responses.map((response) => response.done), [true, true]);
  assert.equal(harness.storage.qdr, 'y');
  assert.equal(lastAppliedQdr(harness.dynamicCalls), 'y');
});

test('維持モード変更も同じキューで qdr と keepSetting を保存する', async () => {
  const harness = createHarness();
  const response = await harness.send({
    type: 'updateKeepSetting',
    qdr: 'm3',
    keepSetting: true,
  });
  await delay(10);

  assert.equal(response.done, true);
  assert.deepEqual(harness.storage, { qdr: 'm3', keepSetting: true });
  assert.equal(lastAppliedQdr(harness.dynamicCalls), 'm3');
});

test('DNR 更新失敗は done:false を返し、保存済み設定から再試行できる', async () => {
  const harness = createHarness({ failDynamicUpdates: 1 });
  const response = await harness.send({ type: 'updateQdr', qdr: 'y3' });
  await delay(20);

  assert.equal(response.done, false);
  assert.equal(response.error, 'settings update failed');
  assert.equal(harness.storage.qdr, 'y3');
  assert.equal(lastAppliedQdr(harness.dynamicCalls), 'y3');
});
