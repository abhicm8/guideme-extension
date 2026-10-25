import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const panelMock = `
  window.__panelMessages = [];
  window.__closedPanels = [];
  window.__generation = 0;
  window.__panelActivity = { phase: 'idle' };
  window.__guideData = { isGuideActive: false, steps: [], completedSteps: [], activity: { phase: 'idle' } };
  window.__savedGuides = [];
  window.chrome = {
    tabs: {
      async query() { return [{ id: 1, windowId: 1, url: 'https://example.com/dashboard' }]; },
      onActivated: { addListener() {} }, onUpdated: { addListener() {} },
      async sendMessage(id, message) {
        __panelMessages.push(message);
        if (message.type === 'GET_CURRENT_GUIDE_DATA') return structuredClone(__guideData);
        if (message.type === 'ADVANCE_GUIDE') {
          const step = __guideData.steps[__guideData.currentStepIndex];
          __guideData.completedSteps.push({ ...step, verification: 'manual' });
          __guideData.isGuideActive = false;
          __guideData.activity = { phase: 'complete' };
          __guideData.lastGuideSummary = { task: __guideData.task, completedSteps: __guideData.completedSteps, finishedAt: Date.now() };
        }
        if (message.type === 'STOP_GUIDE') { __guideData.isGuideActive = false; __guideData.steps = []; __guideData.activity = { phase: 'idle' }; }
        return { success: true };
      }
    },
    windows: { async getCurrent() { return { id: 1 }; } },
    sidePanel: { async close(options) { __closedPanels.push(options); } },
    runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        __panelMessages.push(message);
        if (message.type === 'GET_PANEL_ACTIVITY') return structuredClone(__panelActivity);
        if (message.type === 'GET_MACROS') return structuredClone(__savedGuides);
        if (message.type === 'CANCEL_GUIDE_TASK') { __generation++; __panelActivity = { phase: 'idle' }; return { success: true }; }
        if (message.type === 'START_GUIDE_TASK') {
          const generation = ++__generation;
          __panelActivity = { owner: 'background', phase: 'planning', task: message.payload.task, updatedAt: Date.now() };
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (generation !== __generation) return { cancelled: true };
          __guideData = {
            task: message.payload.task, isGuideActive: true, isFinalStepBatch: false,
            currentStepIndex: 0, completedSteps: [], url: 'https://example.com/dashboard',
            activity: { phase: 'ready' }, pageStats: { elements: 24 },
            steps: [{ action: 'click', description: 'Open Campaign options in the page header.', targetDescriptor: { role: 'button', region: 'Campaigns' }, expectedResult: { type: 'attribute', attribute: 'aria-expanded', value: 'true' } }]
          };
          __panelActivity = { owner: 'content', phase: 'ready' };
          return { steps: __guideData.steps };
        }
        return { success: true };
      }
    },
    storage: { local: {
      async get() { return { apiKey: 'test-only', autoSaveGuides: false, ...JSON.parse(localStorage.getItem('__panelStorage') || '{}') }; },
      async set(values) { localStorage.setItem('__panelStorage', JSON.stringify({ ...JSON.parse(localStorage.getItem('__panelStorage') || '{}'), ...values })); },
      async remove(keys) { const values = JSON.parse(localStorage.getItem('__panelStorage') || '{}'); for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; localStorage.setItem('__panelStorage', JSON.stringify(values)); }
    } }
  };
`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 900 });
  await page.addInitScript({ content: panelMock });
  await page.goto('/extension/popup/popup.html');
  await expect(page.locator('#siteName')).toHaveText('example.com');
});

test('workspace fills the side panel and all navigation views remain accessible', async ({ page }) => {
  await expect(page.locator('h1').first()).toContainText('Find your');
  const bounds = await page.locator('.container').boundingBox();
  expect(bounds.width).toBe(380);
  expect(bounds.height).toBe(900);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#noSavedGuides')).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('API Key')).toBeVisible();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('#taskInput')).toBeVisible();
});

test('processing transitions into guidance and hiding never sends Stop', async ({ page }) => {
  await page.getByLabel('What would you like to do?').fill('Find campaign settings');
  await page.getByRole('button', { name: 'Find my next step' }).click();
  await expect(page.locator('#processingCard')).toBeVisible();
  await expect(page.locator('#guideView')).toBeVisible();
  await expect(page.locator('#processingCard')).toBeHidden();
  await expect(page.locator('#currentStep')).toContainText('Campaign options');
  await page.getByRole('button', { name: 'Hide panel and keep guide active' }).click();
  const result = await page.evaluate(() => ({ closed: __closedPanels, stopped: __panelMessages.some(message => message.type === 'STOP_GUIDE' || message.type === 'CANCEL_GUIDE_TASK'), running: __guideData.isGuideActive }));
  expect(result).toEqual({ closed: [{ windowId: 1 }], stopped: false, running: true });
});

test('reopening restores the active guide, actual counts and recent activity', async ({ page }) => {
  await page.evaluate(() => {
    __guideData = {
      task: 'Create a campaign', isGuideActive: true, currentStepIndex: 0, isFinalStepBatch: false,
      activity: { phase: 'ready' }, pageStats: { elements: 31 },
      completedSteps: [
        { description: 'Opened the campaigns page', verification: 'verified' },
        { description: 'Entered the campaign name', verification: 'manual' }
      ],
      steps: [{ action: 'click', description: 'Choose the campaign audience.', targetDescriptor: { role: 'combobox', region: 'Campaign settings' }, expectedResult: { type: 'manual' } }]
    };
  });
  await expect(page.locator('#guideView')).toBeVisible();
  await expect(page.locator('#verifiedCount')).toHaveText('1');
  await expect(page.locator('#confirmedCount')).toHaveText('1');
  await expect(page.locator('#currentStep .step-number')).toHaveText('Step 3');
  await expect(page.locator('#activityList')).toContainText('Result verified on page');
  await expect(page.locator('#activityList')).toContainText('Confirmed by you');
});

test('completion remains visible after the controller finishes', async ({ page }) => {
  await page.evaluate(() => {
    __guideData = { isGuideActive: false, activity: { phase: 'complete' }, completedSteps: [], lastGuideSummary: { task: 'Find settings', completedSteps: [{ description: 'Opened settings', verification: 'verified' }], finishedAt: Date.now() } };
  });
  await expect(page.locator('#completionCard')).toBeVisible();
  await expect(page.locator('#completionDetail')).toContainText('1 guide step finished');
  await page.getByRole('button', { name: 'Start another guide' }).click();
  await expect(page.locator('#completionCard')).toBeHidden();
  await expect(page.locator('#taskInput')).toBeFocused();
});

test('narrow panels have no horizontal overflow and reduced motion disables processing animation', async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { __panelActivity = { owner: 'background', phase: 'planning', task: 'Find settings', updatedAt: Date.now() }; });
  await expect(page.locator('#processingCard')).toBeVisible();
  const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, animation: getComputedStyle(document.querySelector('.processing-symbol span')).animationName }));
  expect(result).toEqual({ overflow: false, animation: 'none' });
});

test('visual previews: idle, processing and active workspace', async ({ page }) => {
  mkdirSync('test-results/previews', { recursive: true });
  await page.screenshot({ path: 'test-results/previews/workspace-idle.png' });
  await page.getByLabel('What would you like to do?').fill('Show me how to create a campaign');
  await page.getByRole('button', { name: 'Find my next step' }).click();
  await expect(page.locator('#processingCard')).toBeVisible();
  await page.screenshot({ path: 'test-results/previews/workspace-processing.png' });
  await expect(page.locator('#guideView')).toBeVisible();
  await page.screenshot({ path: 'test-results/previews/workspace-active.png' });
});

test('explicit appearance saves immediately, survives reopening and ignores the system scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('__panelStorage')).appearanceTheme)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('#siteName')).toHaveText('example.com');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Light', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('both palettes keep primary, secondary and button text readable', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).check();
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    const ratios = await page.evaluate(() => {
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255);
        return rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      };
      const ratio = (foreground, background) => {
        const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
        return (values[1] + .05) / (values[0] + .05);
      };
      const body = getComputedStyle(document.body);
      const button = getComputedStyle(document.getElementById('guideBtn'));
      return [ratio(body.color, body.backgroundColor), ratio(getComputedStyle(document.querySelector('.welcome p')).color, body.backgroundColor), ratio(button.color, button.backgroundColor)];
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test('dark theme covers the library and dialogs and has no horizontal overflow', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#noSavedGuides')).toBeVisible();
  await page.evaluate(() => document.getElementById('saveMacroModal').classList.remove('hidden'));
  const result = await page.evaluate(() => ({
    scheme: getComputedStyle(document.documentElement).colorScheme,
    overflow: document.documentElement.scrollWidth > innerWidth,
    dialog: getComputedStyle(document.querySelector('.modal-content')).backgroundColor
  }));
  expect(result.scheme).toBe('dark');
  expect(result.overflow).toBe(false);
  expect(result.dialog).toBe('rgb(31, 48, 38)');
});

test('appearance rolls back with a clear message if the preference cannot be saved', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(() => {
    const save = chrome.storage.local.set;
    chrome.storage.local.set = async values => {
      if ('appearanceTheme' in values) throw new Error('Storage unavailable');
      return save(values);
    };
  });
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
  await expect(page.locator('#statusMessage')).toContainText('Could not save your appearance');
});

test('visual previews: dark workspace and appearance settings', async ({ page }) => {
  mkdirSync('test-results/previews', { recursive: true });
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.waitForTimeout(200); // Let palette/hover transitions settle for the preview.
  await page.screenshot({ path: 'test-results/previews/appearance-dark.png' });
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/previews/workspace-dark.png' });
  await page.getByLabel('What would you like to do?').fill('Show me how to create a campaign');
  await page.getByRole('button', { name: 'Find my next step' }).click();
  await expect(page.locator('#guideView')).toBeVisible();
  await page.screenshot({ path: 'test-results/previews/workspace-active-dark.png' });
});

// Deliberately fake, nonfunctional key material for form tests; no real credentials.
const formCredential = { type: 'service_account', project_id: 'test-project', client_email: 'demo@test-project.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----\n' };

test('Vertex JSON settings persist without revealing the saved private key or requiring an API key', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.getByLabel('API Key', { exact: true }).fill('');
  await page.getByLabel('AI Provider').selectOption('vertex');
  await expect(page.getByLabel('API Key', { exact: true })).toBeHidden();
  await page.getByLabel('Service-account JSON', { exact: true }).fill(JSON.stringify(formCredential));
  await page.getByLabel('Gemini model', { exact: true }).selectOption('gemini-3.8-flash');
  await page.getByLabel('Thinking', { exact: true }).selectOption('HIGH');
  await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(page.locator('#statusMessage')).toContainText('Settings saved');
  await expect(page.getByLabel('Service-account JSON', { exact: true })).toHaveValue('');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('__panelStorage')));
  expect(stored.vertexProject).toBe('test-project');
  expect(stored.vertexLocation).toBe('global');
  expect(stored.apiKey).toBe('');
  expect(stored.appearanceTheme).toBe('dark');
  await page.reload();
  await expect(page.locator('#siteName')).toHaveText('example.com');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('AI Provider')).toHaveValue('vertex');
  await expect(page.getByLabel('Service-account JSON', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Service-account JSON', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Thinking', { exact: true })).toHaveValue('HIGH');
  await expect(page.locator('#vertexCredentialSummary')).toContainText(formCredential.client_email);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByLabel('What would you like to do?').fill('Open settings');
  await page.getByRole('button', { name: 'Find my next step' }).click();
  await expect(page.locator('#guideView')).toBeVisible();
  const sent = await page.evaluate(() => JSON.stringify(__panelMessages));
  expect(sent).not.toContain('PRIVATE KEY');
  expect(sent).not.toContain('vertexCredentials');
});

test('model selection exposes only compatible thinking settings and persists the chosen model', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  const model = page.getByLabel('Gemini model', { exact: true });
  const thinking = page.getByLabel('Thinking', { exact: true });
  await model.selectOption('gemini-3.6-flash');
  await thinking.selectOption('MINIMAL');
  await model.selectOption('gemini-3.8-flash');
  await expect(thinking).toHaveValue('auto');
  await expect(thinking.locator('option[value="MINIMAL"]')).toHaveCount(0);
  await model.selectOption('gemini-2.5-flash');
  await expect(thinking.locator('option[value="HIGH"]')).toHaveCount(0);
  await thinking.selectOption('off');
  await model.selectOption('custom');
  await page.getByLabel('Custom model ID', { exact: true }).fill('gemini-future-example');
  await expect(thinking).toBeDisabled();
  await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(page.locator('#statusMessage')).toContainText('Settings saved');
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(model).toHaveValue('custom');
  await expect(page.getByLabel('Custom model ID', { exact: true })).toHaveValue('gemini-future-example');
});

test('malformed Vertex JSON does not save, upload supports service accounts, and removal survives reload', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('AI Provider').selectOption('vertex');
  await page.getByLabel('Service-account JSON', { exact: true }).fill('{invalid');
  await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(page.locator('#statusMessage')).toContainText('valid service-account JSON');
  await expect(page.locator('#settingsView')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__panelStorage') || '{}').vertexCredentials)).toBeUndefined();
  await page.getByLabel('Import JSON file').setInputFiles({ name: 'test-only.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(formCredential)) });
  await expect(page.getByLabel('Google Cloud project ID')).toHaveValue('test-project');
  await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(page.locator('#statusMessage')).toContainText('Settings saved');
  await page.getByRole('button', { name: 'Remove saved key' }).click();
  await expect(page.locator('#vertexCredentialSummary')).toContainText('No service-account');
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#vertexCredentialSummary')).toContainText('No service-account');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByLabel('What would you like to do?').fill('Open settings');
  await page.getByRole('button', { name: 'Find my next step' }).click();
  await expect(page.locator('#settingsView')).toBeVisible();
});

test('Vertex settings fit both palettes at narrow panel widths', async ({ page }) => {
  mkdirSync('test-results/previews', { recursive: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('AI Provider').selectOption('vertex');
  for (const theme of ['light', 'dark']) {
    await page.getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).check();
    await page.getByLabel('Service-account JSON', { exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `test-results/previews/vertex-${theme}.png` });
    await page.getByLabel('Gemini model', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/previews/vertex-model-${theme}.png` });
  }
});

test('labelled Stop cancels pending planning and a late response cannot reopen the guide', async ({ page }) => {
  await page.getByLabel('What would you like to do?').fill('Send an email');
  await page.getByRole('button', { name: 'Find my next step' }).click();
  await expect(page.locator('#processingCard')).toBeVisible();
  await page.getByRole('button', { name: 'Stop guide', exact: true }).click();
  await expect(page.locator('#processingCard')).toBeHidden();
  await expect(page.locator('#statusMessage')).toContainText('Guide stopped');
  await page.waitForTimeout(1200); // Wait past the deliberately delayed planner result.
  await expect(page.locator('#guideView')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Find my next step' })).toBeEnabled();
  const messages = await page.evaluate(() => __panelMessages.map(message => message.type));
  expect(messages).toContain('CANCEL_GUIDE_TASK'); expect(messages).toContain('STOP_GUIDE');
});

test('active mail field guidance shows entry help, a form checklist and a fixed Stop button in both themes', async ({ page }) => {
  mkdirSync('test-results/previews', { recursive: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    __guideData = { task: 'Send an email', isGuideActive: true, currentStepIndex: 0, activity: { phase: 'ready' }, completedSteps: [{ description: 'Open Compose', verification: 'verified' }], steps: [{ action: 'type', description: 'Enter the recipient’s email address in To.', hint: 'To is the address of the person who should receive this message.', targetDescriptor: { role: 'textbox', name: 'To', region: 'New Message' }, expectedResult: { type: 'field-edited' } }], formContext: { name: 'New Message', fields: [{ name: 'To', required: true, filled: false }, { name: 'Subject', filled: false }, { name: 'Message Body', filled: false }] } };
  });
  await expect(page.locator('#guideView')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Field help' })).toContainText('To is the address');
  await expect(page.getByRole('region', { name: 'Fields on this form' })).toContainText('Subject');
  await expect(page.locator('#verificationDetail')).toContainText('edit this field');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => GuideMeTheme.set(theme), theme);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(page.getByRole('button', { name: 'Stop guide', exact: true })).toBeInViewport();
    await page.screenshot({ path: `test-results/previews/mail-guidance-${theme}.png` });
  }
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop guide', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop guide', exact: true }).click();
  await expect(page.locator('#mainView')).toBeVisible();
});

test('handoff summary replaces the old step, renders plain text, survives reopening, and offers optional further guidance', async ({ page }) => {
  mkdirSync('test-results/previews', { recursive: true });
  await page.setViewportSize({ width: 340, height: 900 });
  const report = { status: 'handoff', task: 'How do I send a message?', summary: 'The message form is open. Fill in the recipient, subject and message, review the draft, and choose Send.', remainingActions: [{ text: 'Enter the recipient in To.' }, { text: 'Add a subject and write your message.' }, { text: 'Review the draft, then choose Send when ready.' }], completedSteps: [{ description: 'Clicked Compose', verification: 'observed' }], finishedAt: 123456 };
  await page.evaluate(report => { __guideData = { isGuideActive: false, steps: [], activity: { phase: 'handoff' }, lastGuideSummary: report, completedSteps: report.completedSteps }; }, report);
  await expect(page.locator('#completionCard')).toBeVisible();
  await expect(page.locator('#completionDetail')).toContainText('message form is open');
  await expect(page.locator('#mainView')).toBeHidden();
  expect((await page.locator('#completionCard').boundingBox()).y).toBeLessThan(200);
  await expect(page.locator('#summaryActions li')).toHaveCount(3);
  await expect(page.locator('#guideView')).toBeHidden();
  await expect(page.locator('#processingCard')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Stop guide', exact: true })).toBeHidden();
  await page.locator('#summaryHistoryLabel').click();
  await expect(page.locator('#summaryHistoryList')).toContainText('Click recorded; result unverified');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => GuideMeTheme.set(theme), theme);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/previews/handoff-${theme}.png` });
  }
  await page.getByRole('button', { name: 'Guide me step by step' }).click();
  expect(await page.evaluate(() => __panelMessages.some(message => message.type === 'REFRESH_GUIDE' && message.preferSteps))).toBe(true);
  // Reopening receives the same persisted report from the content controller.
  await page.reload();
  await page.evaluate(report => { __guideData = { isGuideActive: false, steps: [], activity: { phase: 'handoff' }, lastGuideSummary: report, completedSteps: report.completedSteps }; }, report);
  await expect(page.locator('#completionCard')).toBeVisible();
  await page.evaluate(() => { __guideData.lastGuideSummary.summary = '<img src=x onerror="window.__unsafe=true">'; });
  await expect(page.locator('#completionDetail')).toHaveText('<img src=x onerror="window.__unsafe=true">');
  await expect(page.locator('#completionDetail img')).toHaveCount(0);
});

test('click receipt is shown while checking a result without telling the user to click again', async ({ page }) => {
  await page.evaluate(() => {
    __guideData = { task: 'Open a form', isGuideActive: true, currentStepIndex: 0, completedSteps: [], activity: { phase: 'verifying' }, steps: [{ element: 'button-1', action: 'click', description: 'Click Open', targetDescriptor: { role: 'button', name: 'Open' } }], lastInteraction: { action: 'click', targetName: 'Open', elementId: 'button-1', result: 'checking' } };
  });
  await expect(page.locator('#actionReceipt')).toContainText('Click on “Open” registered');
  await expect(page.locator('#currentStep')).toBeHidden();
});

test('summary exposes save errors and Retry saving updates the status without resuming actions', async ({ page }) => {
  await page.evaluate(() => {
    const report = {
      status: 'handoff', task: 'Configure options', summary: 'Review the open options.', remainingActions: [], finishedAt: Date.now(),
      completedSteps: [{ description: 'Opened options', verification: 'verified' }],
      save: { state: 'error', message: 'Could not save your guided steps. Retry saving.' }
    };
    __guideData = { isGuideActive: false, steps: [], activity: { phase: 'handoff' }, lastGuideSummary: report };
    const send = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = async (tabId, message) => {
      const result = await send(tabId, message);
      if (message.type === 'SAVE_GUIDE_SESSION') report.save = { state: 'saved', message: 'Recorded steps saved to Library. The overall task is not confirmed complete.' };
      return result;
    };
  });
  await expect(page.locator('#summarySaveStatus')).toContainText('Could not save');
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.locator('#summarySaveStatus')).toContainText('saved to Library');
  await expect(page.locator('#saveSessionBtn')).toBeHidden();
  expect(await page.evaluate(() => __panelMessages.filter(message => message.type === 'SAVE_GUIDE_SESSION').length)).toBe(1);
  expect(await page.evaluate(() => __panelMessages.some(message => message.type === 'REFRESH_GUIDE' || message.type === 'ADVANCE_GUIDE'))).toBe(false);
});

test('Library labels saved guided sessions with an unconfirmed outcome as partial', async ({ page }) => {
  await page.evaluate(() => {
    __savedGuides = [{ id: 'guided-session', name: 'Configure options', startUrlPattern: 'example.com', steps: [{ description: 'Open options' }], outcome: { status: 'handoff' } }];
  });
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#savedGuidesList')).toContainText('Configure options');
  await expect(page.locator('#savedGuidesList .guide-badge')).toHaveText('partial');
  await expect(page.locator('#savedGuidesList')).toContainText('1 steps');
});

async function installHistoryFixture(page) {
  const setup = () => {
    const initial = {
      id: 'history-session', task: 'Create a private repository', status: 'handoff', startUrl: 'https://example.com/start',
      createdAt: 1000, updatedAt: 2000,
      events: [
        { id: 'request', type: 'request', text: 'Create a private repository', url: 'https://example.com/start', at: 1000 },
        { id: 'advice', type: 'advice', text: 'Open Create new, choose New repository, enter a name, then choose Private.', status: 'handoff', remainingActions: [{ text: 'Enter a repository name.' }, { text: 'Choose Private.' }], url: 'https://example.com/start', at: 2000 }
      ]
    };
    const state = JSON.parse(localStorage.getItem('__historyFixture') || 'null') || { sessions: [initial], current: initial.id, url: 'https://example.com/start' };
    window.__historyFixture = state;
    const persist = () => localStorage.setItem('__historyFixture', JSON.stringify(state));
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async message => {
      const result = await send(message);
      if (message.type === 'GET_SESSION_CONTEXT') return { session: state.sessions.find(item => item.id === state.current) || null };
      if (message.type === 'GET_SESSION_HISTORY') return { sessions: state.sessions.map(item => ({ ...item, actionCount: item.events.filter(event => event.type === 'action').length })) };
      if (message.type === 'GET_HISTORY_SESSION') return { session: state.sessions.find(item => item.id === message.sessionId) || null };
      if (message.type === 'ATTACH_HISTORY_SESSION') { state.current = message.sessionId; persist(); }
      if (message.type === 'DELETE_HISTORY_SESSION') { state.sessions = state.sessions.filter(item => item.id !== message.sessionId); persist(); }
      if (message.type === 'CLEAR_SESSION_HISTORY') { state.sessions = []; persist(); }
      return result;
    };
    chrome.tabs.query = async () => [{ id: 1, windowId: 1, url: state.url }];
    const tabSend = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = async (tabId, message) => {
      const result = await tabSend(tabId, message);
      if (message.type === 'START_RECORDING') await chrome.storage.local.set({ activeRecording: { isRecording: true, ownerTabId: tabId, sessionId: message.payload.sessionId, steps: [] } });
      if (message.type === 'PAUSE_RECORDING' || message.type === 'RESUME_RECORDING') {
        const { activeRecording } = await chrome.storage.local.get(['activeRecording']);
        activeRecording.paused = message.type === 'PAUSE_RECORDING'; await chrome.storage.local.set({ activeRecording });
      }
      if (message.type === 'STOP_RECORDING') await chrome.storage.local.remove(['activeRecording']);
      return result;
    };
  };
  await page.evaluate(setup);
  await page.addInitScript(setup);
}

test('saved instructions survive a page change and panel reload without starting another guide', async ({ page }) => {
  await installHistoryFixture(page);
  await expect(page.locator('#sessionContextCard')).toBeVisible();
  await expect(page.locator('#sessionInstructionsCopy')).toContainText('choose Private');
  await page.evaluate(() => {
    __historyFixture.url = 'https://example.com/new';
    localStorage.setItem('__historyFixture', JSON.stringify(__historyFixture));
  });
  await page.reload();
  await expect(page.locator('#sessionInstructionsCopy')).toContainText('Advice from an earlier page');
  await expect(page.locator('#sessionInstructionsCopy')).toContainText('Enter a repository name.');
  expect(await page.evaluate(() => __panelMessages.some(message => message.type === 'CONTINUE_SESSION_HERE'))).toBe(false);
  await page.getByRole('button', { name: 'Continue guidance here', exact: true }).click();
  expect(await page.evaluate(() => __panelMessages.find(message => message.type === 'CONTINUE_SESSION_HERE').payload.sessionId)).toBe('history-session');
});

test('Library history retains advice-only sessions and renders the full timeline as text', async ({ page }) => {
  await installHistoryFixture(page);
  await page.evaluate(() => {
    __historyFixture.sessions[0].events[1].text = '<img src=x onerror="window.historyInjected=true">' + 'Detailed advice. '.repeat(130);
  });
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Session history', exact: true }).click();
  await page.locator('#historyList .history-session').click();
  await expect(page.locator('#historyTimeline')).toContainText('Suggested guidance');
  await expect(page.locator('#historyTimeline')).toContainText('Choose Private.');
  expect((await page.locator('#historyTimeline').textContent()).length).toBeGreaterThan(2000);
  expect(await page.evaluate(() => window.historyInjected)).toBeUndefined();
  await expect(page.locator('#saveHistoryWalkthroughBtn')).toBeHidden();
  await page.getByRole('button', { name: 'Delete session', exact: true }).click();
  await expect(page.locator('#historyEmpty')).toBeVisible();
});

test('session recording has explicit start, pause, resume and stop controls', async ({ page }) => {
  await installHistoryFixture(page);
  await page.getByRole('button', { name: 'Record my actions', exact: true }).click();
  await expect(page.locator('#sessionRecordingStatus')).toContainText('Recording');
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
  await expect(page.locator('#sessionRecordingStatus')).toContainText('Paused');
  await page.getByRole('button', { name: 'Resume recording', exact: true }).click();
  await expect(page.locator('#sessionRecordingStatus')).toContainText('Recording');
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.locator('#sessionRecordingControls')).toBeHidden();
  await expect(page.locator('#sessionInstructionsCopy')).toContainText('choose Private');
});

test('history and recording controls fit both palettes at a narrow panel width', async ({ page }) => {
  await installHistoryFixture(page);
  await page.setViewportSize({ width: 340, height: 900 });
  mkdirSync('test-results/previews', { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => GuideMeTheme.set(theme), theme);
    await expect(page.locator('#sessionContextCard')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/previews/session-${theme}.png` });
    await page.getByRole('button', { name: 'View session history', exact: true }).click();
    await expect(page.locator('#historyTimeline')).toContainText('Choose Private');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/previews/history-${theme}.png` });
    await page.getByRole('button', { name: 'Back to workspace', exact: true }).filter({ visible: true }).click();
  }
});
