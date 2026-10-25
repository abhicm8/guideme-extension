import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const scripts = ['content/page-intelligence.js', 'content/step-verifier.js', 'content/content.js']
  .map(path => readFileSync(path, 'utf8')).join('\n');
const popupScript = readFileSync('popup/popup.js', 'utf8') + '\nwindow.TestPopup = GuideMePopup;';
const chromeMock = `
  globalThis.chrome = {
    __messages: [],
    __storageListeners: [],
    runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        chrome.__messages.push(message);
        if (message.type === 'CONTINUE_GUIDE') {
          await new Promise(resolve => setTimeout(resolve, globalThis.__plannerDelay || 0));
          if (globalThis.__plannerFactory) return globalThis.__plannerFactory(message);
          return globalThis.__plannerResponse || { steps: [], completed: false, note: 'No reliable next step.' };
        }
        return { success: true };
      }
    },
    storage: { onChanged: { addListener(listener) { chrome.__storageListeners.push(listener); } }, local: {
      async get() { return { autoSaveGuides: false, ...JSON.parse(localStorage.getItem('__mockStorage') || '{}') }; },
      async set(values) {
        const data = JSON.parse(localStorage.getItem('__mockStorage') || '{}');
        localStorage.setItem('__mockStorage', JSON.stringify({ ...data, ...values }));
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
        chrome.__storageListeners.forEach(listener => listener(changes, 'local'));
      },
      async remove(keys) {
        const data = JSON.parse(localStorage.getItem('__mockStorage') || '{}');
        for (const key of keys) delete data[key];
        localStorage.setItem('__mockStorage', JSON.stringify(data));
      }
    } }
  };
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: `${chromeMock}\nwindow.addEventListener('DOMContentLoaded', () => { ${scripts}\n });` });
  await page.goto('/');
  await page.waitForFunction(() => !!window.guideMeInstance);
});

async function startGuide(page, id, expectedResult, { saved = true, legacy = false, final = true, panel = false } = {}) {
  await page.evaluate(({ id, expectedResult, saved, legacy, final, panel }) => {
    const guide = window.guideMeInstance;
    const snapshot = guide.extractDOM();
    const element = document.getElementById(id);
    const descriptor = guide.pageIntelligence.describe(element);
    const next = guide.pageIntelligence.describe(document.getElementById('next'));
    const step = legacy
      ? { element: 'gm-5', action: 'click', description: `Click ${descriptor.name}`, robustSelectors: { id, textContent: descriptor.name, tagName: descriptor.tagName }, expectedResult }
      : { element: descriptor.id, action: 'click', description: `Click ${descriptor.name}`, targetDescriptor: descriptor, snapshotId: snapshot.snapshotId, expectedResult };
    guide.handleMessage({ type: 'START_GUIDE', payload: {
      presentationMode: panel ? 'sidepanel' : undefined, task: 'GuideMe regression workflow', isSavedGuide: saved, isFinalStepBatch: final,
      steps: [step, { element: next.id, action: 'click', description: 'Click Next control', targetDescriptor: next, expectedResult: { type: 'manual' } }]
    } }, {}, () => {});
  }, { id, expectedResult, saved, legacy, final, panel });
  await page.waitForFunction(id => window.guideMeInstance.currentHighlightedElement?.id === id, id);
}

test('IDs survive insertion and rescans, replaced nodes get new IDs without mutating the page', async ({ page }) => {
  const result = await page.evaluate(() => {
    const guide = window.guideMeInstance;
    const original = guide.extractDOM();
    const before = original.elements.find(element => element.name === 'Save campaign').id;
    const button = document.createElement('button'); button.textContent = 'Inserted first';
    document.querySelector('main').prepend(button);
    const second = guide.extractDOM();
    const after = second.elements.find(element => element.name === 'Save campaign').id;
    document.getElementById('noop').outerHTML = '<button id="noop">Save campaign</button>';
    const replaced = guide.extractDOM().elements.find(element => element.name === 'Save campaign').id;
    return { before, after, replaced, snapshotsDiffer: original.snapshotId !== second.snapshotId, mutations: document.querySelectorAll('[data-guideme-id]').length };
  });
  expect(result.before).toBe(result.after);
  expect(result.replaced).not.toBe(result.before);
  expect(result.snapshotsDiffer).toBe(true);
  expect(result.mutations).toBe(0);
});

test('extracts labels, disabled state and open shadow controls without sending field values', async ({ page }) => {
  const snapshot = await page.evaluate(() => window.guideMeInstance.extractDOM());
  expect(snapshot.elements.some(element => element.name === 'Campaign name')).toBe(true);
  expect(snapshot.elements.some(element => element.name === 'Shadow control')).toBe(true);
  expect(snapshot.elements.find(element => element.name === 'Unavailable action').enabled).toBe(false);
  expect(snapshot.elements.some(element => element.name === 'Hidden action')).toBe(false);
  expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_TEXT|PRIVATE_PASSWORD|PRIVATE_TOKEN|PRIVATE_NOTES|PRIVATE_DESCRIPTION/);
});

test('ambiguous repeated controls pause; row context resolves replacement elements', async ({ page }) => {
  const result = await page.evaluate(() => {
    const engine = window.guideMeInstance.pageIntelligence;
    const ambiguous = engine.resolve({ robustSelectors: { textContent: 'Edit', tagName: 'button' } }).status;
    const descriptor = engine.describe(document.getElementById('edit-two'));
    document.getElementById('edit-two').outerHTML = '<button id="replacement">Edit</button>';
    const replacement = engine.resolve({ element: descriptor.id, targetDescriptor: descriptor });
    return { ambiguous, replacement: replacement.element?.id };
  });
  expect(result).toEqual({ ambiguous: 'ambiguous', replacement: 'replacement' });
});

test('rejects a recycled DOM node whose row now represents a different record', async ({ page }) => {
  const status = await page.evaluate(() => {
    const engine = window.guideMeInstance.pageIntelligence;
    const descriptor = engine.describe(document.getElementById('edit-two'));
    document.getElementById('edit-two').closest('tr').firstElementChild.textContent = 'Another customer';
    return engine.resolve({ element: descriptor.id, targetDescriptor: descriptor }).status;
  });
  expect(status).toBe('missing');
});

test('malformed legacy selectors cannot throw or select an arbitrary control', async ({ page }) => {
  const result = await page.evaluate(() => window.guideMeInstance.pageIntelligence.resolve({
    element: '[invalid="', robustSelectors: { cssSelector: '[broken="', textContent: 'No such control' }
  }).status);
  expect(result).toBe('missing');
});

test('reveals a target in a nested scroller and refuses an obstructed target', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = window.guideMeInstance.pageIntelligence;
    const element = document.getElementById('deep');
    const revealed = await engine.reveal(element);
    const scrolled = document.getElementById('nested').scrollTop;
    const blocker = document.createElement('div'); blocker.id = 'blocker'; document.body.append(blocker);
    return { revealed, scrolled, blocked: await engine.reveal(element) };
  });
  expect(result.revealed).toBe(true);
  expect(result.scrolled).toBeGreaterThan(0);
  expect(result.blocked).toBe(false);
});

test('legacy saved guide verifies an attribute transition and advances exactly once', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'attribute', attribute: 'aria-expanded', value: 'true' }, { legacy: true });
  await page.locator('#toggle').click();
  await expect.poll(() => page.evaluate(() => window.guideMeInstance.currentStepIndex)).toBe(1);
  const state = await page.evaluate(() => ({ count: window.guideMeInstance.completedSteps.length, original: window.guideMeInstance.originalStepIndex, verification: window.guideMeInstance.completedSteps[0].verification }));
  expect(state).toEqual({ count: 1, original: 1, verification: 'verified' });
});

test('a click and unrelated mutations do not verify success; Next confirms manually', async ({ page }) => {
  await startGuide(page, 'noop', { type: 'attribute', attribute: 'data-state', value: 'saved' });
  await page.locator('#noop').click();
  await page.evaluate(() => { document.body.append(document.createElement('p')); });
  await expect(page.locator('.guideme-hint')).toContainText('Result not confirmed', { timeout: 7000 });
  expect(await page.evaluate(() => window.guideMeInstance.currentStepIndex)).toBe(0);
  expect(await page.evaluate(() => window.guideMeInstance.completedSteps.length)).toBe(0);
  await page.locator('.guideme-next-btn').click();
  await expect.poll(() => page.evaluate(() => window.guideMeInstance.currentStepIndex)).toBe(1);
  expect(await page.evaluate(() => window.guideMeInstance.completedSteps[0].verification)).toBe('manual');
});

test('an already satisfied condition does not prove the click succeeded', async ({ page }) => {
  const verified = await page.evaluate(async () => {
    const guide = window.guideMeInstance;
    const element = document.getElementById('toggle');
    element.setAttribute('aria-expanded', 'true');
    const step = { expectedResult: { type: 'attribute', attribute: 'aria-expanded', value: 'true' } };
    const before = guide.stepVerifier.capture(step, element);
    return (await guide.stepVerifier.wait(step, before, { timeout: 100 })).status;
  });
  expect(verified).toBe('unconfirmed');
});

test('verifies the appearance of a named dialog instead of arbitrary page changes', async ({ page }) => {
  await startGuide(page, 'open-dialog', { type: 'visible', targetDescriptor: { role: 'dialog', name: 'Create campaign' } });
  await page.locator('#open-dialog').click();
  await expect.poll(() => page.evaluate(() => window.guideMeInstance.currentStepIndex)).toBe(1);
  expect(await page.evaluate(() => window.guideMeInstance.completedSteps[0].verification)).toBe('verified');
});

test('SPA navigation and verification advance once without a competing continuation', async ({ page }) => {
  await startGuide(page, 'spa', { type: 'url-changed' });
  await page.locator('#spa').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect.poll(() => page.evaluate(() => window.guideMeInstance.currentStepIndex)).toBe(1);
  expect(await page.evaluate(() => window.guideMeInstance.completedSteps.length)).toBe(1);
  expect(await page.evaluate(() => chrome.__messages.filter(message => message.type === 'CONTINUE_GUIDE').length)).toBe(0);
});

test('full-page navigation resumes a final saved batch without skipping the following step', async ({ page }) => {
  await startGuide(page, 'navigate', { type: 'url-changed' });
  await page.locator('#navigate').click();
  await expect(page).toHaveURL(/\/next-page$/);
  await page.waitForFunction(() => window.guideMeInstance?.currentHighlightedElement?.id === 'next');
  const result = await page.evaluate(() => ({
    step: window.guideMeInstance.currentStepIndex,
    count: window.guideMeInstance.completedSteps.length,
    original: window.guideMeInstance.originalStepIndex,
    saved: window.guideMeInstance.isSavedGuideReplay
  }));
  expect(result).toEqual({ step: 1, count: 1, original: 1, saved: true });
});

test('refreshing saved playback re-observes locally without an AI request', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' }, { legacy: true });
  await page.locator('.guideme-refresh-btn').click();
  await page.waitForFunction(() => window.guideMeInstance.currentHighlightedElement?.id === 'toggle');
  expect(await page.evaluate(() => chrome.__messages.filter(message => ['GENERATE_GUIDE', 'CONTINUE_GUIDE', 'START_GUIDE_TASK'].includes(message.type)).length)).toBe(0);
});

test('stop cancels verification and ignores a late AI response', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'attribute', attribute: 'aria-expanded', value: 'true' });
  await page.locator('#toggle').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#guideme-control-panel')).toHaveCount(0);
  await page.evaluate(() => {
    const guide = window.guideMeInstance;
    const descriptor = guide.pageIntelligence.describe(document.getElementById('next'));
    guide.originalTask = 'Late planner regression';
    window.__plannerDelay = 400;
    window.__plannerResponse = { steps: [{ element: descriptor.id, targetDescriptor: descriptor, action: 'click', description: 'Next' }] };
    guide.requestGuideContinuation();
    guide.stopGuide();
  });
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => window.guideMeInstance.isGuideActive)).toBe(false);
  await expect(page.locator('#guideme-control-panel')).toHaveCount(0);
  await expect(page.locator('#guideme-loading')).toHaveCount(0);
});

test('an empty uncertain plan ends highlighting with a handoff instead of announcing success', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' }, { saved: false, final: false });
  await page.evaluate(() => window.guideMeInstance.requestGuideContinuation());
  await expect.poll(() => page.evaluate(() => guideMeInstance.lastGuideSummary?.status)).toBe('handoff');
  expect(await page.evaluate(() => window.guideMeInstance.isGuideActive)).toBe(false);
  await expect(page.locator('#guideme-error-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.guideMeInstance.completedSteps.length)).toBe(0);
});

test('popup Next confirms through the content controller and reflects the saved-guide index', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' });
  await page.addScriptTag({ content: popupScript });
  const result = await page.evaluate(async () => {
    chrome.tabs = {
      async query() { return [{ id: 1, url: location.href }]; },
      async sendMessage(id, message) {
        return new Promise(resolve => window.guideMeInstance.handleMessage(message, {}, resolve));
      }
    };
    const popup = Object.create(window.TestPopup.prototype);
    Object.assign(popup, {
      currentSteps: window.guideMeInstance.currentSteps, currentStepIndex: 0,
      currentStep: document.createElement('div'), stepEditControls: document.createElement('div'),
      prevStepBtn: document.createElement('button'), nextStepBtn: document.createElement('button'), progressBar: document.createElement('div'),
      showView() {}, showStatus() {}, hideStatus() {}
    });
    await popup.navigateStep(1);
    return {
      popupIndex: popup.currentStepIndex, controllerIndex: window.guideMeInstance.currentStepIndex,
      verification: window.guideMeInstance.completedSteps[0].verification, active: window.guideMeInstance.isGuideActive
    };
  });
  expect(result).toEqual({ popupIndex: 1, controllerIndex: 1, verification: 'manual', active: true });
});

test('popup Next on a one-step live batch requests the next observation instead of stopping', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' }, { saved: false, final: false });
  await page.addScriptTag({ content: popupScript });
  await page.evaluate(async () => {
    const guide = window.guideMeInstance;
    guide.currentSteps = guide.currentSteps.slice(0, 1);
    const descriptor = guide.pageIntelligence.describe(document.getElementById('next'));
    window.__plannerResponse = { steps: [{ element: descriptor.id, action: 'click', description: 'Next control', targetDescriptor: descriptor, expectedResult: { type: 'manual' } }], completed: true };
    chrome.tabs = {
      async query() { return [{ id: 1, url: location.href }]; },
      async sendMessage(id, message) { return new Promise(resolve => guide.handleMessage(message, {}, resolve)); }
    };
    const popup = Object.create(window.TestPopup.prototype);
    Object.assign(popup, {
      currentSteps: guide.currentSteps, currentStepIndex: 0,
      nextStepBtn: document.createElement('button'), showStatus() {}, hideStatus() {}, showView() {}
    });
    await popup.navigateStep(1);
  });
  await page.waitForFunction(() => window.guideMeInstance.currentHighlightedElement?.id === 'next');
  expect(await page.evaluate(() => window.guideMeInstance.isGuideActive)).toBe(true);
  expect(await page.evaluate(() => chrome.__messages.filter(message => message.type === 'CONTINUE_GUIDE').length)).toBe(1);
});

test('model uncertainty messages render as text rather than executable HTML', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.guideMeInstance.showContinuationError('<img src=x onerror="window.injected=true">');
    return document.getElementById('guideme-error-panel').querySelectorAll('img').length;
  });
  expect(result).toBe(0);
  await expect(page.locator('.guideme-error-message')).toContainText('<img');
});

test('resaving a multi-page guide preserves selectors captured on an earlier page', async ({ page }) => {
  const selectors = await page.evaluate(() => {
    const guide = window.guideMeInstance;
    const original = { dataTestId: 'previous-page-control', textContent: 'Previous control', tagName: 'button' };
    return guide.enhanceStepsForSaving([{ element: 'gm-previous-1', description: 'Previous control', robustSelectors: original }])[0].robustSelectors;
  });
  expect(selectors.dataTestId).toBe('previous-page-control');
});

test('starting another guide cancels an outstanding planner request and highlights the new target', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' }, { saved: false });
  await page.evaluate(() => {
    window.__plannerDelay = 300;
    window.guideMeInstance.requestGuideContinuation();
  });
  await startGuide(page, 'noop', { type: 'manual' });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.guideMeInstance.currentHighlightedElement?.id)).toBe('noop');
  expect(await page.evaluate(() => window.guideMeInstance.isWaitingForAI)).toBe(false);
});

test('a confirmed live step is excluded from the checkpoint while the next plan is pending', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' }, { saved: false, final: false });
  const result = await page.evaluate(() => {
    const guide = window.guideMeInstance;
    guide.currentSteps = guide.currentSteps.slice(0, 1);
    window.__plannerDelay = 500;
    guide.handleMessage({ type: 'ADVANCE_GUIDE' }, {}, () => {});
    const checkpoint = JSON.parse(localStorage.getItem('guideme_backup'));
    return { remaining: checkpoint.remainingSteps.length, completed: checkpoint.completedSteps.length, pending: checkpoint.pendingAction };
  });
  expect(result).toEqual({ remaining: 0, completed: 1, pending: null });
});

test('legacy native checkbox clicks verify despite browser pre-activation timing', async ({ page }) => {
  await startGuide(page, 'checkbox', undefined, { legacy: true });
  await page.locator('#checkbox').click();
  await expect.poll(() => page.evaluate(() => window.guideMeInstance.currentStepIndex)).toBe(1);
  expect(await page.evaluate(() => window.guideMeInstance.completedSteps[0].verification)).toBe('verified');
});

test('hiding the workspace leaves a working compact companion and reopening hides it', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' });
  await page.evaluate(() => window.guideMeInstance.handleMessage({ type: 'SET_PANEL_VISIBILITY', visible: false }, {}, () => {}));
  await expect(page.locator('#guideme-control-panel')).toBeHidden();
  await expect(page.locator('#guideme-companion-dock')).toBeVisible();
  expect(await page.evaluate(() => window.guideMeInstance.isGuideActive)).toBe(true);
  await page.locator('.gm-dock-open').click();
  expect(await page.evaluate(() => chrome.__messages.some(message => message.type === 'OPEN_GUIDE_PANEL'))).toBe(true);
  await page.evaluate(() => window.guideMeInstance.handleMessage({ type: 'SET_PANEL_VISIBILITY', visible: true }, {}, () => {}));
  await expect(page.locator('#guideme-companion-dock')).toHaveCount(0);
  expect(await page.evaluate(() => window.guideMeInstance.isGuideActive)).toBe(true);
});

test('side-panel checkpoints belong to their tab and returning to a tab keeps the guide active', async ({ page }) => {
  await startGuide(page, 'toggle', { type: 'manual' });
  const result = await page.evaluate(async () => {
    const guide = window.guideMeInstance;
    guide.ownerTabId = 44;
    guide.handleMessage({ type: 'SET_PANEL_VISIBILITY', visible: false }, {}, () => {});
    await guide.saveGuideState();
    const storage = await chrome.storage.local.get();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    guide.tabHiddenTime = Date.now() - 10000;
    document.dispatchEvent(new Event('visibilitychange'));
    return { owner: storage.activeGuide_44.ownerTabId, active: guide.isGuideActive, hiddenTimeCleared: guide.tabHiddenTime === null };
  });
  expect(result).toEqual({ owner: 44, active: true, hiddenTimeCleared: true });
});

test('the compact companion follows saved appearance changes without recoloring the host page', async ({ page }) => {
  await page.addStyleTag({ path: 'content/overlay.css' });
  await startGuide(page, 'toggle', { type: 'manual' });
  await page.evaluate(() => window.guideMeInstance.handleMessage({ type: 'SET_PANEL_VISIBILITY', visible: false }, {}, () => {}));
  await expect(page.locator('#guideme-companion-dock')).toHaveAttribute('data-guideme-theme', 'light');
  const before = await page.evaluate(() => ({ background: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color }));
  await page.evaluate(() => chrome.storage.local.set({ appearanceTheme: 'dark' }));
  await expect(page.locator('#guideme-companion-dock')).toHaveAttribute('data-guideme-theme', 'dark');
  const result = await page.evaluate(() => ({ host: { background: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color }, theme: document.documentElement.dataset.theme, dock: getComputedStyle(document.getElementById('guideme-companion-dock')).color }));
  expect(result.host).toEqual(before);
  expect(result.theme).toBeUndefined();
  expect(result.dock).toBe('rgb(230, 239, 231)');
  await page.evaluate(() => chrome.storage.local.set({ appearanceTheme: 'light' }));
  await expect(page.locator('#guideme-companion-dock')).toHaveAttribute('data-guideme-theme', 'light');
});

test('manual Compose guidance recognises the new focused form and advances through email fields exactly once', async ({ page }) => {
  await startGuide(page, 'compose-mail', { type: 'manual' }, { saved: false, final: false, panel: true });
  await page.evaluate(() => {
    const guide = guideMeInstance;
    guide.panelVisibleUntil = Date.now() + 60000;
    guide.updateCompanionUI();
    guide.currentSteps = guide.currentSteps.slice(0, 1);
    globalThis.__plannerFactory = () => {
      if (__mailSends) return { status: 'complete', summary: 'The page reports that the message was sent.', steps: [], completed: true, evidenceIds: [guide.pageIntelligence.id(document.getElementById('mail-status'))] };
      const last = guide.completedSteps.at(-1);
      const id = last.element === guide.pageIntelligence.id(document.getElementById('compose-mail')) ? 'mail-to'
        : last.targetDescriptor?.name === 'To' ? 'mail-subject'
        : last.targetDescriptor?.name === 'Subject' ? 'mail-body' : 'mail-send';
      const target = guide.pageIntelligence.describe(document.getElementById(id));
      return { completed: id === 'mail-send', steps: [{ element: target.id, action: id === 'mail-send' ? 'click' : 'type', description: `Enter ${target.name}`, hint: 'Use the details you want in your email.', targetDescriptor: target, expectedResult: { type: id === 'mail-send' ? 'hidden' : 'field-edited' } }] };
    };
  });
  await page.locator('#compose-mail').click();
  await expect.poll(() => page.evaluate(() => guideMeInstance.currentHighlightedElement?.id)).toBe('mail-to');
  expect(await page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(1);
  expect(await page.evaluate(() => guideMeInstance.completedSteps[0].verification)).toBe('verified');
  expect(await page.evaluate(() => __composeOpens)).toBe(1);
  // A focus/click is not an edit, and an invalid address cannot advance.
  await page.locator('#mail-to').click();
  expect(await page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(1);
  await page.locator('#mail-to').fill('invalid-address');
  await page.locator('#mail-to').press('Tab');
  expect(await page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(1);
  await page.locator('#mail-to').fill('PRIVATE_RECIPIENT@example.com');
  await page.locator('#mail-to').press('Tab');
  await expect.poll(() => page.evaluate(() => guideMeInstance.currentHighlightedElement?.id)).toBe('mail-subject');
  await page.locator('#mail-subject').fill('PRIVATE_SUBJECT');
  expect(await page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(2);
  await page.locator('#mail-subject').press('Tab');
  await expect.poll(() => page.evaluate(() => guideMeInstance.currentHighlightedElement?.id)).toBe('mail-body');
  await page.locator('#mail-body').fill('PRIVATE_MESSAGE_BODY');
  await page.locator('#mail-body').press('Enter');
  expect(await page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(3);
  await page.locator('#mail-body').press('Tab');
  await expect.poll(() => page.evaluate(() => guideMeInstance.currentHighlightedElement?.id)).toBe('mail-send');
  const exposed = await page.evaluate(() => JSON.stringify({ messages: chrome.__messages, snapshot: guideMeInstance.extractDOM(), checkpoint: JSON.parse(localStorage.getItem('guideme_backup')) }));
  expect(exposed).not.toMatch(/PRIVATE_RECIPIENT|PRIVATE_SUBJECT|PRIVATE_MESSAGE_BODY/);
  expect(await page.evaluate(() => __mailSends)).toBe(0);
  await page.locator('#mail-send').click();
  await expect.poll(() => page.evaluate(() => guideMeInstance.isGuideActive)).toBe(false);
  expect(await page.evaluate(() => __mailSends)).toBe(1);
  expect(await page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(5);
});

test('a manual click without a new focused form does not advance because of unrelated UI changes', async ({ page }) => {
  await startGuide(page, 'noop', { type: 'manual' });
  await page.locator('#noop').click();
  await page.evaluate(() => {
    const banner = document.createElement('aside'); banner.textContent = 'Unrelated notification'; document.body.append(banner);
    const form = document.createElement('form'); form.innerHTML = '<input aria-label="Unrelated field">'; document.body.append(form);
  });
  await expect(page.locator('.guideme-hint')).toContainText('Result not confirmed');
  expect(await page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(0);
});

test('an already open compose form is not evidence that a later Compose click succeeded', async ({ page }) => {
  await page.locator('#compose-mail').click();
  const status = await page.evaluate(async () => {
    const guide = guideMeInstance;
    const step = { action: 'click', expectedResult: { type: 'manual' } };
    const before = guide.stepVerifier.capture(step, document.getElementById('compose-mail'));
    return (await guide.stepVerifier.wait(step, before, { timeout: 120 })).status;
  });
  expect(status).toBe('unconfirmed');
});

test('a click with a mismatched named-result check is recorded once and ends in an instructional handoff', async ({ page }) => {
  await startGuide(page, 'compose-mail', { type: 'visible', targetDescriptor: { role: 'dialog', name: 'New Message Window' } }, { saved: false, final: false, panel: true });
  await page.evaluate(() => {
    guideMeInstance.currentSteps = guideMeInstance.currentSteps.slice(0, 1);
    guideMeInstance.panelVisibleUntil = Date.now() + 60000;
    guideMeInstance.updateCompanionUI();
    __plannerResponse = { status: 'handoff', steps: [], summary: 'The message form is open. Fill in the recipient, subject and message, review the draft, and choose Send.', remainingActions: [{ text: 'Fill in To, Subject and Message Body.' }, { text: 'Review the draft and choose Send when ready.' }], completed: false };
  });
  await page.locator('#compose-mail').click();
  const interaction = await page.evaluate(() => guideMeInstance.lastInteraction);
  expect(interaction.targetName).toBe('Compose'); expect(interaction.action).toBe('click');
  await expect.poll(() => page.evaluate(() => guideMeInstance.lastGuideSummary?.status)).toBe('handoff');
  const state = await page.evaluate(() => ({ summary: guideMeInstance.lastGuideSummary, active: guideMeInstance.isGuideActive, calls: chrome.__messages.filter(message => message.type === 'CONTINUE_GUIDE').length, opens: __composeOpens, sends: __mailSends }));
  expect(state.active).toBe(false); expect(state.calls).toBe(1); expect(state.opens).toBe(1); expect(state.sends).toBe(0);
  expect(state.summary.summary).toContain('message form is open');
  expect(state.summary.completedSteps).toHaveLength(1);
  expect(state.summary.completedSteps[0].verification).toBe('observed');
  await expect(page.locator('.guideme-highlight-box')).toHaveCount(0);
  await expect(page.locator('#guideme-error-panel')).toHaveCount(0);
});

test('a physical click without verifiable outcome advances live guidance without claiming success', async ({ page }) => {
  await startGuide(page, 'noop', { type: 'attribute', attribute: 'data-state', value: 'saved' }, { saved: false, final: false, panel: true });
  await page.evaluate(() => {
    guideMeInstance.currentSteps = guideMeInstance.currentSteps.slice(0, 1);
    __plannerResponse = { status: 'blocked', steps: [], summary: 'Your click was recorded, but the page has not reported a saved result. Check for a validation message before continuing.', remainingActions: [{ text: 'Check the form for missing required details.' }], completed: false };
  });
  await page.locator('#noop').click();
  await expect.poll(() => page.evaluate(() => guideMeInstance.lastGuideSummary?.status)).toBe('blocked');
  expect(await page.evaluate(() => guideMeInstance.completedSteps[0].verification)).toBe('observed');
  expect(await page.evaluate(() => guideMeInstance.isGuideActive)).toBe(false);
  expect(await page.evaluate(() => guideMeInstance.lastGuideSummary.summary)).toContain('has not reported a saved result');
});

test('a handoff persists for its tab across page reload and Resume explicitly requests more steps', async ({ page }) => {
  await page.evaluate(async () => {
    guideMeInstance.ownerTabId = 81;
    guideMeInstance.panelOwned = true;
    guideMeInstance.originalTask = 'How do I configure this?';
    await guideMeInstance.finishGuidance({ status: 'handoff', summary: 'The settings form is ready. Review the options and apply your changes.', remainingActions: [{ text: 'Review the available options.' }] });
  });
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.type === 'GET_GUIDEME_TAB_ID' ? Promise.resolve({ tabId: 81 }) : send(message);
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => guideMeInstance.lastGuideSummary?.summary)).toContain('settings form is ready');
  expect(await page.evaluate(() => guideMeInstance.isGuideActive)).toBe(false);
  await page.evaluate(() => guideMeInstance.handleMessage({ type: 'REFRESH_GUIDE', preferSteps: true }, {}, () => {}));
  await expect.poll(() => page.evaluate(() => chrome.__messages.filter(message => message.type === 'CONTINUE_GUIDE').length)).toBe(1);
  expect(await page.evaluate(() => chrome.__messages.find(message => message.type === 'CONTINUE_GUIDE').payload.guidancePreference)).toBe('step-by-step');
});

test('autosave keeps completed AI steps when guidance ends with a handoff', async ({ page }) => {
  await page.evaluate(async () => {
    await chrome.storage.local.set({ autoSaveGuides: true });
    __plannerResponse = { status: 'handoff', steps: [], summary: 'The options are open. Review them before saving.' };
  });
  await startGuide(page, 'toggle', { type: 'attribute', attribute: 'aria-expanded', value: 'true' }, { saved: false, panel: true });
  await page.locator('#toggle').click();
  await expect.poll(() => page.evaluate(() => guideMeInstance.completedSteps.length)).toBe(1);
  await page.evaluate(() => guideMeInstance.nextStep('manual'));
  await expect.poll(() => page.evaluate(() => chrome.__messages.filter(message => message.type === 'SAVE_MACRO').length)).toBe(1);
  const saved = await page.evaluate(() => chrome.__messages.find(message => message.type === 'SAVE_MACRO').payload);
  expect(saved.steps).toHaveLength(2);
  expect(saved.steps[0].robustSelectors.id).toBe('toggle');
  expect(saved.steps.map(step => step.verification)).toEqual(['verified', 'manual']);
  expect(saved.outcome.status).toBe('handoff');
  expect(await page.evaluate(() => guideMeInstance.lastGuideSummary.save.state)).toBe('saved');
});

async function finishSession(page, { status = 'handoff', enabled = true, replay = false, steps = 1 } = {}) {
  return page.evaluate(async ({ status, enabled, replay, steps }) => {
    await chrome.storage.local.set({ autoSaveGuides: enabled });
    const guide = guideMeInstance;
    guide.ownerTabId = 81;
    guide.panelOwned = true;
    guide.originalTask = 'Configure this page';
    guide.guideSessionId = 'regression-session';
    guide.guideStartUrl = `${location.origin}/original-start`;
    guide.isSavedGuideReplay = replay;
    const descriptor = guide.pageIntelligence.describe(document.getElementById('toggle'));
    guide.completedSteps = Array.from({ length: steps }, () => ({
      element: descriptor.id, action: 'click', description: 'Open the options', targetDescriptor: descriptor,
      robustSelectors: { id: 'toggle' }, verification: 'verified', pageUrl: guide.guideStartUrl
    }));
    guide.allStepsForSaving = replay ? [] : structuredClone(guide.completedSteps);
    await guide.finishGuidance({ status, summary: 'Review the options.', remainingActions: [{ text: 'Review and save when ready.' }] });
    return guide.lastGuideSummary;
  }, { status, enabled, replay, steps });
}

for (const status of ['complete', 'blocked']) {
  test(`autosave preserves performed actions and the ${status} outcome`, async ({ page }) => {
    const summary = await finishSession(page, { status });
    expect(summary.save.state).toBe('saved');
    const payload = await page.evaluate(() => chrome.__messages.find(message => message.type === 'SAVE_MACRO').payload);
    expect(payload.outcome.status).toBe(status);
    expect(payload.startUrl).toContain('/original-start');
    expect(payload.sourceSessionId).toBe('regression-session');
    expect(payload.steps).toHaveLength(1);
  });
}

test('autosave respects the setting while allowing an explicit manual save', async ({ page }) => {
  const summary = await finishSession(page, { enabled: false });
  expect(summary.save.state).toBe('disabled');
  expect(await page.evaluate(() => chrome.__messages.some(message => message.type === 'SAVE_MACRO'))).toBe(false);
  await page.evaluate(() => new Promise(resolve => guideMeInstance.handleMessage({ type: 'SAVE_GUIDE_SESSION' }, {}, resolve)));
  expect(await page.evaluate(() => guideMeInstance.lastGuideSummary.save.state)).toBe('saved');
});

test('empty guides and saved replays never autosave another Library entry', async ({ page }) => {
  expect((await finishSession(page, { replay: true })).save.state).toBe('replay');
  expect((await finishSession(page, { steps: 0 })).save.state).toBe('empty');
  expect(await page.evaluate(() => chrome.__messages.some(message => message.type === 'SAVE_MACRO'))).toBe(false);
});

test('a rejected background save remains retryable after reload with its original replay targets', async ({ page }) => {
  await page.evaluate(() => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => {
      if (message.type === 'SAVE_MACRO') { chrome.__messages.push(message); return Promise.resolve({ error: 'Storage quota exceeded' }); }
      return send(message);
    };
  });
  const summary = await finishSession(page);
  expect(summary.save.state).toBe('error');
  expect(summary.save.message).toContain('Retry');
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.type === 'GET_GUIDEME_TAB_ID' ? Promise.resolve({ tabId: 81 }) : send(message);
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => guideMeInstance.lastGuideSummary?.save.state)).toBe('saved');
  const saved = await page.evaluate(() => chrome.__messages.find(message => message.type === 'SAVE_MACRO').payload);
  expect(saved.sourceSessionId).toBe('regression-session');
  expect(saved.steps[0].robustSelectors.id).toBe('toggle');
  expect(saved.startUrl).toContain('/original-start');
  expect(await page.evaluate(() => guideMeInstance.isGuideActive)).toBe(false);
});

test('a save with no acknowledgement is shown as failed and can be retried once', async ({ page }) => {
  await page.evaluate(() => {
    const send = chrome.runtime.sendMessage;
    window.__saveFails = true;
    chrome.runtime.sendMessage = message => {
      if (message.type === 'SAVE_MACRO' && __saveFails) { chrome.__messages.push(message); return Promise.resolve(undefined); }
      return send(message);
    };
  });
  expect((await finishSession(page)).save.state).toBe('error');
  await page.evaluate(async () => {
    __saveFails = false;
    await Promise.all([guideMeInstance.autoSaveGuideIfEnabled(), guideMeInstance.autoSaveGuideIfEnabled()]);
  });
  expect(await page.evaluate(() => guideMeInstance.lastGuideSummary.save.state)).toBe('saved');
  const ids = await page.evaluate(() => chrome.__messages.filter(message => message.type === 'SAVE_MACRO').map(message => message.payload.sourceSessionId));
  expect(ids).toEqual(['regression-session', 'regression-session']);
});

test('resuming after a summary reload preserves the full journey for the next save', async ({ page }) => {
  await finishSession(page);
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.type === 'GET_GUIDEME_TAB_ID' ? Promise.resolve({ tabId: 81 }) : send(message);
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => guideMeInstance.allStepsForSaving.length)).toBe(1);
  await page.evaluate(async () => {
    const guide = guideMeInstance;
    const descriptor = guide.pageIntelligence.describe(document.getElementById('next'));
    guide.currentSteps = [{ element: descriptor.id, targetDescriptor: descriptor, action: 'click', description: 'Next control' }];
    guide.currentHighlightedElement = document.getElementById('next');
    guide.trackStepCompletion('manual');
    await guide.finishGuidance({ status: 'complete', summary: 'The page reports the changes were saved.' });
  });
  const saved = await page.evaluate(() => chrome.__messages.find(message => message.type === 'SAVE_MACRO').payload);
  expect(saved.steps).toHaveLength(2);
  expect(saved.steps.map(step => step.robustSelectors.id)).toEqual(['toggle', 'next']);
  expect(saved.sourceSessionId).toBe('regression-session');
  expect(saved.startUrl).toContain('/original-start');
});

test('an in-flight save does not resurrect a dismissed summary', async ({ page }) => {
  await page.evaluate(() => {
    const send = chrome.runtime.sendMessage;
    window.__saving = false;
    chrome.runtime.sendMessage = async message => {
      if (message.type === 'SAVE_MACRO') {
        __saving = true;
        await new Promise(resolve => { window.__finishSave = resolve; });
      }
      return send(message);
    };
  });
  const saving = finishSession(page);
  await expect.poll(() => page.evaluate(() => __saving)).toBe(true);
  await page.evaluate(() => {
    guideMeInstance.handleMessage({ type: 'DISMISS_GUIDE_OUTCOME' }, {}, () => {});
    __finishSave();
  });
  await saving;
  const result = await page.evaluate(async () => ({ report: guideMeInstance.lastGuideSummary, stored: (await chrome.storage.local.get(['guideme_summary_81'])).guideme_summary_81 }));
  expect(result.report).toBeNull();
  expect(result.stored).toBeUndefined();
});

test('a handoff survives SPA navigation without automatically replanning or highlighting stale targets', async ({ page }) => {
  await finishSession(page, { steps: 0 });
  await page.locator('#spa').click();
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => guideMeInstance.lastGuideSummary.summary)).toBe('Review the options.');
  expect(await page.evaluate(() => guideMeInstance.isGuideActive)).toBe(false);
  expect(await page.evaluate(() => chrome.__messages.some(message => message.type === 'CONTINUE_GUIDE'))).toBe(false);
  expect(await page.evaluate(() => chrome.__messages.some(message => message.type === 'SESSION_EVENT' && message.event.type === 'page'))).toBe(true);
});

async function identifyRecordingTab(page, tabId = 81) {
  await page.evaluate(tabId => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.type === 'GET_GUIDEME_TAB_ID' ? Promise.resolve({ tabId }) : send(message);
  }, tabId);
}

test('session recording captures future actions, omits entered values, pauses, resumes, and stops', async ({ page }) => {
  await identifyRecordingTab(page);
  await page.locator('#toggle').click();
  await page.evaluate(() => guideMeInstance.startRecording({ sessionId: 'manual-session' }));
  expect(await page.evaluate(() => guideMeInstance.recordedSteps.length)).toBe(0);
  await page.locator('#labelled').click();
  await page.locator('#labelled').fill('DO_NOT_SAVE_THIS_VALUE');
  await page.locator('#labelled').press('Tab');
  await page.evaluate(() => guideMeInstance.pauseRecording());
  const count = await page.evaluate(() => guideMeInstance.recordedSteps.length);
  await page.locator('#toggle').click();
  expect(await page.evaluate(() => guideMeInstance.recordedSteps.length)).toBe(count);
  expect(await page.evaluate(() => JSON.stringify(chrome.__messages))).not.toContain('DO_NOT_SAVE_THIS_VALUE');
  await page.evaluate(() => guideMeInstance.resumeRecording());
  await page.locator('#next').click();
  const result = await page.evaluate(() => guideMeInstance.stopRecording());
  expect(result.steps.length).toBe(count + 1);
  expect(result.sessionId).toBe('manual-session');
  expect(JSON.stringify(result)).not.toContain('DO_NOT_SAVE_THIS_VALUE');
  await page.locator('#toggle').click();
  await page.waitForTimeout(600);
  expect(await page.evaluate(async () => (await chrome.storage.local.get(['activeRecording'])).activeRecording)).toBeUndefined();
});

test('recording stays in its owner tab across navigation and paused reloads', async ({ page }) => {
  await identifyRecordingTab(page);
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.type === 'GET_GUIDEME_TAB_ID' ? Promise.resolve({ tabId: 81 }) : send(message);
  });
  await page.evaluate(() => guideMeInstance.startRecording({ sessionId: 'scoped-session' }));
  await page.locator('#navigate').click();
  await expect.poll(() => page.evaluate(() => guideMeInstance.isRecording)).toBe(true);
  expect(await page.evaluate(() => guideMeInstance.recordedSteps[0].causesNavigation)).toBe(true);
  await page.evaluate(() => guideMeInstance.pauseRecording());
  await page.reload();
  await expect.poll(() => page.evaluate(() => guideMeInstance.isRecording)).toBe(true);
  expect(await page.evaluate(() => guideMeInstance.recordingPaused)).toBe(true);
  const count = await page.evaluate(() => guideMeInstance.recordedSteps.length);
  await page.locator('#toggle').click();
  expect(await page.evaluate(() => guideMeInstance.recordedSteps.length)).toBe(count);
  await identifyRecordingTab(page, 99);
  await page.evaluate(async () => {
    guideMeInstance.isRecording = false;
    guideMeInstance.removeRecordingListeners();
    await guideMeInstance.checkForActiveRecording();
  });
  expect(await page.evaluate(() => guideMeInstance.isRecording)).toBe(false);
});

test('session recording keeps choice controls as clicks and rich-text edits omit entered text', async ({ page }) => {
  await identifyRecordingTab(page);
  await page.evaluate(() => guideMeInstance.startRecording({ sessionId: 'choices-and-text' }));
  await page.locator('#checkbox').click();
  await page.locator('[contenteditable="true"][aria-label="Notes"]').fill('PRIVATE_RICH_TEXT');
  await page.locator('[contenteditable="true"][aria-label="Notes"]').press('Tab');
  const result = await page.evaluate(() => guideMeInstance.stopRecording());
  expect(result.steps.find(step => step.robustSelectors.id === 'checkbox').action).toBe('click');
  expect(result.steps.some(step => step.action === 'type' && step.robustSelectors.ariaLabel === 'Notes')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_RICH_TEXT');
});
