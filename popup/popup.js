// GuideMe Popup Script
class GuideMePopup {
  constructor() {
    this.currentSteps = [];
    this.currentStepIndex = 0;
    this.settings = {
      apiProvider: 'gemini',  // Default to free Gemini
      apiKey: '',
      highlightColor: '#4F46E5'
    };

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.bindElements();
    this.bindEvents();
    this.updateSiteName();
  }

  bindElements() {
    // Views
    this.mainView = document.getElementById('mainView');
    this.settingsView = document.getElementById('settingsView');
    this.guideView = document.getElementById('guideView');

    // Main view elements
    this.siteName = document.getElementById('siteName');
    this.taskInput = document.getElementById('taskInput');
    this.guideBtn = document.getElementById('guideBtn');
    this.statusMessage = document.getElementById('statusMessage');
    this.quickBtns = document.querySelectorAll('.quick-btn');

    // Settings elements
    this.settingsBtn = document.getElementById('settingsBtn');
    this.backBtn = document.getElementById('backBtn');
    this.apiProvider = document.getElementById('apiProvider');
    this.apiKey = document.getElementById('apiKey');
    this.highlightColor = document.getElementById('highlightColor');
    this.saveSettingsBtn = document.getElementById('saveSettingsBtn');
    this.providerHint = document.getElementById('providerHint');

    // Guide view elements
    this.stopGuideBtn = document.getElementById('stopGuideBtn');
    this.currentStep = document.getElementById('currentStep');
    this.prevStepBtn = document.getElementById('prevStepBtn');
    this.nextStepBtn = document.getElementById('nextStepBtn');
    this.progressBar = document.getElementById('progressBar');
  }

  bindEvents() {
    // Navigation
    this.settingsBtn.addEventListener('click', () => this.showView('settings'));
    this.backBtn.addEventListener('click', () => this.showView('main'));
    this.stopGuideBtn.addEventListener('click', () => this.stopGuide());

    // Main actions
    this.guideBtn.addEventListener('click', () => this.startGuide());
    this.taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.startGuide();
      }
    });

    // Quick buttons
    this.quickBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.taskInput.value = btn.dataset.task;
        this.startGuide();
      });
    });

    // Settings
    this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    this.apiProvider.addEventListener('change', () => this.updateProviderHint());

    // Guide navigation
    this.prevStepBtn.addEventListener('click', () => this.navigateStep(-1));
    this.nextStepBtn.addEventListener('click', () => this.navigateStep(1));
  }

  updateProviderHint() {
    const hints = {
      gemini: '🆓 Get free key at aistudio.google.com',
      openai: '💳 Get key at platform.openai.com (paid)',
      anthropic: '💳 Get key at console.anthropic.com (paid)'
    };
    this.providerHint.textContent = hints[this.apiProvider.value] || '';
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['apiProvider', 'apiKey', 'highlightColor']);
      if (result.apiProvider) this.settings.apiProvider = result.apiProvider;
      if (result.apiKey) this.settings.apiKey = result.apiKey;
      if (result.highlightColor) this.settings.highlightColor = result.highlightColor;

      // Update form
      if (this.apiProvider) {
        this.apiProvider.value = this.settings.apiProvider;
        this.apiKey.value = this.settings.apiKey;
        this.highlightColor.value = this.settings.highlightColor;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async saveSettings() {
    this.settings.apiProvider = this.apiProvider.value;
    this.settings.apiKey = this.apiKey.value;
    this.settings.highlightColor = this.highlightColor.value;

    try {
      await chrome.storage.local.set(this.settings);
      this.showStatus('Settings saved successfully!', 'success');
      setTimeout(() => this.showView('main'), 1000);
    } catch (error) {
      this.showStatus('Failed to save settings', 'error');
    }
  }

  async updateSiteName() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        this.siteName.textContent = url.hostname;
      } else {
        this.siteName.textContent = 'Unknown site';
      }
    } catch (error) {
      this.siteName.textContent = 'Unable to detect';
    }
  }

  showView(view) {
    this.mainView.classList.add('hidden');
    this.settingsView.classList.add('hidden');
    this.guideView.classList.add('hidden');

    switch (view) {
      case 'main':
        this.mainView.classList.remove('hidden');
        break;
      case 'settings':
        this.settingsView.classList.remove('hidden');
        // Populate current settings
        this.apiProvider.value = this.settings.apiProvider;
        this.apiKey.value = this.settings.apiKey;
        this.highlightColor.value = this.settings.highlightColor;
        this.updateProviderHint();
        break;
      case 'guide':
        this.guideView.classList.remove('hidden');
        break;
    }
  }

  showStatus(message, type = 'loading') {
    this.statusMessage.textContent = message;
    this.statusMessage.className = `status-message ${type}`;
    this.statusMessage.classList.remove('hidden');
  }

  hideStatus() {
    this.statusMessage.classList.add('hidden');
  }

  async startGuide() {
    const task = this.taskInput.value.trim();
    if (!task) {
      this.showStatus('Please describe what you want to do', 'error');
      return;
    }

    if (!this.settings.apiKey) {
      this.showStatus('Please add your API key in settings', 'error');
      return;
    }

    this.guideBtn.disabled = true;
    this.guideBtn.innerHTML = '<span class="btn-icon">⏳</span> Analyzing...';
    this.showStatus('Reading page and generating guide...', 'loading');

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Request DOM from content script
      const domData = await this.getDOMFromPage(tab.id);
      
      // Send to AI via background script
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_GUIDE',
        payload: {
          task: task,
          url: tab.url,
          title: tab.title,
          dom: domData,
          apiProvider: this.settings.apiProvider,
          apiKey: this.settings.apiKey
        }
      });

      if (response.error) {
        throw new Error(response.error);
      }

      this.currentSteps = response.steps;
      this.currentStepIndex = 0;

      // Send steps to content script for highlighting (include task for cross-page tracking)
      await chrome.tabs.sendMessage(tab.id, {
        type: 'START_GUIDE',
        payload: {
          steps: this.currentSteps,
          highlightColor: this.settings.highlightColor,
          task: task
        }
      });

      this.hideStatus();
      this.showView('guide');
      this.renderCurrentStep();

    } catch (error) {
      console.error('Guide generation failed:', error);
      this.showStatus(`Error: ${error.message}`, 'error');
    } finally {
      this.guideBtn.disabled = false;
      this.guideBtn.innerHTML = '<span class="btn-icon">✨</span> Guide Me';
    }
  }

  async getDOMFromPage(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_DOM' });
      return response;
    } catch (error) {
      // Content script might not be loaded, inject it first
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['content/overlay.css']
      });
      
      // Retry
      return await chrome.tabs.sendMessage(tabId, { type: 'GET_DOM' });
    }
  }

  renderCurrentStep() {
    if (this.currentSteps.length === 0) return;

    const step = this.currentSteps[this.currentStepIndex];
    const stepNum = this.currentStepIndex + 1;
    const totalSteps = this.currentSteps.length;

    // Use description or instruction (handle both field names)
    const stepText = step.description || step.instruction || 'Follow this step';
    const actionText = step.action ? `<p class="step-hint" style="font-size: 12px; color: #6b7280; margin-top: 8px;">💡 Action: ${step.action}</p>` : '';
    const hintText = step.hint ? `<p class="step-hint" style="font-size: 12px; color: #6b7280; margin-top: 4px;">💡 ${step.hint}</p>` : '';

    this.currentStep.innerHTML = `
      <span class="step-number">Step ${stepNum} of ${totalSteps}</span>
      <p class="step-instruction">${stepText}</p>
      ${actionText}
      ${hintText}
    `;

    // Update navigation buttons
    this.prevStepBtn.disabled = this.currentStepIndex === 0;
    this.nextStepBtn.textContent = this.currentStepIndex === totalSteps - 1 ? 'Done ✓' : 'Next →';

    // Update progress bar
    const progress = ((stepNum) / totalSteps) * 100;
    this.progressBar.style.width = `${progress}%`;

    // Highlight current element
    this.highlightCurrentStep();
  }

  async highlightCurrentStep() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, {
        type: 'HIGHLIGHT_STEP',
        payload: {
          stepIndex: this.currentStepIndex,
          highlightColor: this.settings.highlightColor
        }
      });
    } catch (error) {
      console.error('Failed to highlight step:', error);
    }
  }

  async navigateStep(direction) {
    const newIndex = this.currentStepIndex + direction;
    
    if (newIndex < 0) return;
    
    if (newIndex >= this.currentSteps.length) {
      // Guide complete
      await this.stopGuide();
      this.showStatus('🎉 Guide completed!', 'success');
      this.showView('main');
      return;
    }

    this.currentStepIndex = newIndex;
    this.renderCurrentStep();
  }

  async stopGuide() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: 'STOP_GUIDE' });
    } catch (error) {
      console.error('Failed to stop guide:', error);
    }

    this.currentSteps = [];
    this.currentStepIndex = 0;
    this.showView('main');
    this.hideStatus();
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new GuideMePopup();
});
