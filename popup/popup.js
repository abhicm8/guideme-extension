// GuideMe Popup Script
class GuideMePopup {
  constructor() {
    this.currentSteps = [];
    this.currentStepIndex = 0;
    this.currentTask = '';
    this.currentUrl = '';
    this.settings = {
      apiProvider: 'gemini',  // Default to free Gemini
      apiKey: '',
      highlightColor: '#4F46E5'
    };

    // Voice recognition
    this.isListening = false;

    // Guide management state
    this.allGuides = [];
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.guideToDelete = null;
    this.guideToRename = null;

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.bindElements();
    this.bindEvents();
    this.updateSiteName();
    this.setupVoiceRecognition();
    
    // Restore guide state from content script if a guide is running
    await this.restoreGuideStateFromContentScript();
  }
  
  async restoreGuideStateFromContentScript() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        return;
      }
      
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_GUIDE_DATA' });
      
      if (response && response.steps && response.steps.length > 0) {
        console.log('Restoring guide state from content script');
        console.log('- savedGuideId:', response.savedGuideId);
        console.log('- steps (current page):', response.steps.length);
        console.log('- allOriginalSteps:', response.allOriginalSteps?.length);
        console.log('- currentStepIndex:', response.currentStepIndex);
        console.log('- originalStepIndex:', response.originalStepIndex);
        
        // For saved guides, use allOriginalSteps (full guide) to ensure we can edit properly
        // Calculate the actual index into the full guide
        if (response.isSavedGuideReplay && response.allOriginalSteps) {
          this.currentSteps = response.allOriginalSteps;
          // The actual step in the full guide = originalStepIndex + currentStepIndex
          this.currentStepIndex = (response.originalStepIndex || 0) + (response.currentStepIndex || 0);
          console.log('- Calculated full guide index:', this.currentStepIndex);
        } else {
          this.currentSteps = response.steps;
          this.currentStepIndex = response.currentStepIndex || 0;
        }
        
        this.currentTask = response.task || '';
        this.currentUrl = response.url || '';
        this.currentPlayingGuideId = response.savedGuideId || null;
        
        // Show guide view if a guide is active
        this.showView('guide');
        this.renderCurrentStep();
      }
    } catch (e) {
      // No guide running or content script not injected, that's fine
      console.log('No active guide to restore:', e.message);
    }
  }

  bindElements() {
    // Views
    this.mainView = document.getElementById('mainView');
    this.settingsView = document.getElementById('settingsView');
    this.guideView = document.getElementById('guideView');
    this.savedGuidesView = document.getElementById('savedGuidesView');

    // Main view elements
    this.siteName = document.getElementById('siteName');
    this.taskInput = document.getElementById('taskInput');
    this.guideBtn = document.getElementById('guideBtn');
    this.statusMessage = document.getElementById('statusMessage');
    this.quickBtns = document.querySelectorAll('.quick-btn');
    this.autoSaveToggle = document.getElementById('autoSaveToggle');

    // Voice elements
    this.voiceBtn = document.getElementById('voiceBtn');
    this.voiceStatus = document.getElementById('voiceStatus');

    // Saved Guides elements
    this.savedGuidesBtn = document.getElementById('savedGuidesBtn');
    this.backFromSavedBtn = document.getElementById('backFromSavedBtn');
    this.savedGuidesList = document.getElementById('savedGuidesList');
    this.noSavedGuides = document.getElementById('noSavedGuides');
    this.importGuideBtn = document.getElementById('importGuideBtn');
    this.importFileInput = document.getElementById('importFileInput');

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
    this.saveCurrentGuideBtn = document.getElementById('saveCurrentGuideBtn');
    this.currentStep = document.getElementById('currentStep');
    this.prevStepBtn = document.getElementById('prevStepBtn');
    this.nextStepBtn = document.getElementById('nextStepBtn');
    this.progressBar = document.getElementById('progressBar');

    // Modal elements
    this.saveMacroModal = document.getElementById('saveMacroModal');
    this.macroNameInput = document.getElementById('macroNameInput');
    this.macroCategorySelect = document.getElementById('macroCategorySelect');
    this.cancelMacroBtn = document.getElementById('cancelMacroBtn');
    this.confirmSaveMacroBtn = document.getElementById('confirmSaveMacroBtn');

    // Search & Filter elements
    this.guideSearchInput = document.getElementById('guideSearchInput');
    this.categoryPills = document.getElementById('categoryPills');

    // Rename modal elements
    this.renameGuideModal = document.getElementById('renameGuideModal');
    this.renameGuideInput = document.getElementById('renameGuideInput');
    this.renameCategorySelect = document.getElementById('renameCategorySelect');
    this.cancelRenameBtn = document.getElementById('cancelRenameBtn');
    this.confirmRenameBtn = document.getElementById('confirmRenameBtn');

    // Delete confirmation modal elements
    this.deleteConfirmModal = document.getElementById('deleteConfirmModal');
    this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    
    // Step edit elements
    this.stepEditControls = document.getElementById('stepEditControls');
    this.editStepBtn = document.getElementById('editStepBtn');
    this.deleteStepBtn = document.getElementById('deleteStepBtn');
    this.editStepModal = document.getElementById('editStepModal');
    this.editStepInput = document.getElementById('editStepInput');
    this.cancelEditStepBtn = document.getElementById('cancelEditStepBtn');
    this.confirmEditStepBtn = document.getElementById('confirmEditStepBtn');
    this.deleteStepModal = document.getElementById('deleteStepModal');
    this.deleteStepPreview = document.getElementById('deleteStepPreview');
    this.cancelDeleteStepBtn = document.getElementById('cancelDeleteStepBtn');
    this.confirmDeleteStepBtn = document.getElementById('confirmDeleteStepBtn');
    
    // Recording elements
    this.recordBtn = document.getElementById('recordBtn');
    this.recordingPanel = document.getElementById('recordingPanel');
    this.recordingStepCount = document.getElementById('recordingStepCount');
    this.recordingStartUrl = document.getElementById('recordingStartUrl');
    this.stopRecordingBtn = document.getElementById('stopRecordingBtn');
    this.cancelRecordingBtn = document.getElementById('cancelRecordingBtn');
  }

  bindEvents() {
    // Navigation
    this.settingsBtn.addEventListener('click', () => this.showView('settings'));
    this.savedGuidesBtn.addEventListener('click', () => this.showView('savedGuides'));
    this.backBtn.addEventListener('click', () => this.showView('main'));
    this.backFromSavedBtn.addEventListener('click', () => this.showView('main'));
    this.stopGuideBtn.addEventListener('click', () => this.stopGuide());

    // Main actions
    this.guideBtn.addEventListener('click', () => this.startGuide());
    this.taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.startGuide();
      }
    });

    // Voice input
    this.voiceBtn.addEventListener('click', () => this.toggleVoice());

    // Auto-save toggle
    this.autoSaveToggle.addEventListener('change', () => this.saveAutoSaveSetting());

    // Save Guide
    this.saveCurrentGuideBtn.addEventListener('click', () => this.showSaveMacroModal());
    this.cancelMacroBtn.addEventListener('click', () => this.hideSaveMacroModal());
    this.confirmSaveMacroBtn.addEventListener('click', () => this.saveMacro());

    // Import/Export guides
    this.importGuideBtn.addEventListener('click', () => this.importFileInput.click());
    this.importFileInput.addEventListener('change', (e) => this.handleImportFile(e));

    // Search and filter
    this.guideSearchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.filterAndRenderGuides();
    });

    // Category pills
    this.categoryPills.querySelectorAll('.category-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        // Update active state
        this.categoryPills.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentFilter = pill.dataset.category;
        this.filterAndRenderGuides();
      });
    });

    // Rename modal
    this.cancelRenameBtn.addEventListener('click', () => this.hideRenameModal());
    this.confirmRenameBtn.addEventListener('click', () => this.confirmRename());

    // Delete confirmation modal
    this.cancelDeleteBtn.addEventListener('click', () => this.hideDeleteModal());
    this.confirmDeleteBtn.addEventListener('click', () => this.confirmDelete());

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
    
    // Step editing
    this.editStepBtn.addEventListener('click', () => this.showEditStepModal());
    this.deleteStepBtn.addEventListener('click', () => this.showDeleteStepModal());
    this.cancelEditStepBtn.addEventListener('click', () => this.hideEditStepModal());
    this.confirmEditStepBtn.addEventListener('click', () => this.confirmEditStep());
    this.cancelDeleteStepBtn.addEventListener('click', () => this.hideDeleteStepModal());
    this.confirmDeleteStepBtn.addEventListener('click', () => this.confirmDeleteStep());
    
    // Recording events
    this.recordBtn.addEventListener('click', () => this.startRecording());
    this.stopRecordingBtn.addEventListener('click', () => this.stopRecording());
    this.cancelRecordingBtn.addEventListener('click', () => this.cancelRecording());
    
    // Check if there's an active recording on popup open
    this.checkActiveRecording();
    
    // Listen for recording updates from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'RECORDING_STOPPED') {
        this.handleRecordingComplete(message.payload);
        sendResponse({ received: true });
      }
    });
  }

  // ============ VOICE RECOGNITION (runs directly in popup - visible UI context) ============
  setupVoiceRecognition() {
    // SpeechRecognition MUST run in popup (visible UI) - offscreen documents don't support it
    this.recognition = null;
    console.log('Voice recognition setup - will run directly in popup');
  }

  async toggleVoice() {
    // If already listening, stop
    if (this.isListening) {
      this.stopVoice();
      return;
    }

    // Start voice recognition
    this.startVoiceRecognition();
  }

  async startVoiceRecognition() {
    console.log('Starting voice recognition...');
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('SpeechRecognition API not available');
      // Check if Opera
      const isOpera = navigator.userAgent.includes('OPR') || navigator.userAgent.includes('Opera');
      if (isOpera) {
        this.showStatus('Voice not supported in Opera. Please use Chrome or Edge.', 'error');
      } else {
        this.showStatus('Voice not supported in this browser. Try Chrome or Edge.', 'error');
      }
      return;
    }

    // Show listening UI
    this.voiceBtn.classList.add('listening');
    this.voiceStatus.classList.remove('hidden');
    this.taskInput.value = '';
    this.taskInput.placeholder = 'Requesting mic access...';

    // STEP 1: Request microphone permission explicitly
    try {
      console.log('Requesting microphone permission...');
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ Microphone permission GRANTED');
    } catch (micError) {
      console.error('❌ Microphone permission denied:', micError.name, micError.message);
      this.stopVoiceUI();
      
      if (micError.name === 'NotAllowedError') {
        this.showStatus('🎤 Mic blocked. Click 🔒 in address bar → Allow microphone.', 'error');
      } else if (micError.name === 'NotFoundError') {
        this.showStatus('No microphone found. Please connect one.', 'error');
      } else {
        this.showStatus('Mic error: ' + micError.message, 'error');
      }
      return;
    }

    // STEP 2: Now start speech recognition
    this.taskInput.placeholder = 'Listening... speak now!';
    this.isListening = true;

    try {
      // Small delay to ensure mic is ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'en-US';
      this.recognition.continuous = true;  // Keep listening
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        console.log('✅ Voice recognition STARTED - speak now!');
      };

      this.recognition.onaudiostart = () => {
        console.log('✅ Audio capturing started');
      };

      this.recognition.onspeechstart = () => {
        console.log('✅ Speech detected');
      };

      this.recognition.onresult = (event) => {
        let transcript = '';
        let isFinal = false;

        // Get the latest result
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            isFinal = true;
          }
        }

        console.log(`Transcript: "${transcript}", Final: ${isFinal}`);
        this.taskInput.value = transcript;

        if (isFinal && transcript.trim()) {
          console.log('Final transcript received:', transcript);
          // Just stop listening - don't auto-start guide
          // User can review and click "Guide Me" button manually
          this.stopVoice();
          this.showStatus('Got it! Click "Guide Me" to start.', 'success');
        }
      };

      this.recognition.onerror = (event) => {
        console.error('❌ Voice recognition error:', event.error);
        
        // Don't show error for 'aborted' (user stopped) or 'no-speech' (normal timeout)
        if (event.error === 'aborted') {
          console.log('Recognition aborted (this is normal when stopping)');
          return;
        }
        
        this.stopVoice();
        
        if (event.error === 'not-allowed') {
          this.showStatus('Mic blocked. Click the lock icon in address bar to allow.', 'error');
        } else if (event.error === 'no-speech') {
          this.showStatus('No speech heard. Click mic and try again.', 'error');
        } else if (event.error === 'network') {
          this.showStatus('Network error. Check your internet connection.', 'error');
        } else if (event.error === 'audio-capture') {
          this.showStatus('Mic not working. Check your microphone.', 'error');
        } else {
          this.showStatus('Voice error: ' + event.error, 'error');
        }
      };

      this.recognition.onend = () => {
        console.log('Voice recognition ended');
        // Only restart if still supposed to be listening and no final result yet
        if (this.isListening && !this.taskInput.value.trim()) {
          console.log('Restarting recognition (no result yet)...');
          try {
            this.recognition.start();
          } catch (e) {
            console.log('Could not restart:', e);
            this.stopVoice();
          }
        } else {
          this.stopVoiceUI();
        }
      };

      console.log('Calling recognition.start()...');
      this.recognition.start();
      console.log('✅ recognition.start() called successfully');
      
    } catch (error) {
      console.error('❌ Failed to start voice recognition:', error);
      this.stopVoice();
      this.showStatus('Failed to start voice: ' + error.message, 'error');
    }
  }

  stopVoice() {
    console.log('Stopping voice...');
    this.isListening = false;
    
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
      this.recognition = null;
    }
    
    // Stop audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    
    this.stopVoiceUI();
  }

  stopVoiceUI() {
    this.voiceBtn.classList.remove('listening');
    this.voiceStatus.classList.add('hidden');
    this.taskInput.placeholder = 'e.g., How do I create a new project?\ne.g., Where can I change my password?\ne.g., Help me export this as PDF';
  }

  // ============ SAVED GUIDES (MACROS) ============
  async loadSavedGuides() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_MACROS' });
      this.allGuides = response || [];
      this.filterAndRenderGuides();
    } catch (error) {
      console.error('Failed to load saved guides:', error);
    }
  }

  filterAndRenderGuides() {
    let filtered = this.allGuides;

    // Filter by category
    if (this.currentFilter && this.currentFilter !== 'all') {
      filtered = filtered.filter(guide => 
        (guide.category || 'other').toLowerCase() === this.currentFilter
      );
    }

    // Filter by search query
    if (this.searchQuery) {
      filtered = filtered.filter(guide =>
        guide.name.toLowerCase().includes(this.searchQuery) ||
        (guide.startUrlPattern || '').toLowerCase().includes(this.searchQuery)
      );
    }

    this.renderSavedGuides(filtered);
  }

  renderSavedGuides(guides) {
    if (guides.length === 0) {
      this.savedGuidesList.classList.add('hidden');
      this.noSavedGuides.classList.remove('hidden');
      
      // Update message based on filter/search
      if (this.searchQuery || this.currentFilter !== 'all') {
        this.noSavedGuides.innerHTML = `
          <div class="no-guides-icon">
            <span class="icon icon-xl">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
          </div>
          <p>No guides found</p>
          <p class="no-guides-hint">Try adjusting your search or filter</p>
        `;
      } else {
        this.noSavedGuides.innerHTML = `
          <div class="no-guides-icon">
            <span class="icon icon-xl">
              <svg viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="m9 10 2 2 4-4"/></svg>
            </span>
          </div>
          <p>No saved guides yet</p>
          <p class="no-guides-hint">Complete a guide to save it here</p>
          <p class="no-guides-hint">Or import a .guideme file!</p>
        `;
      }
      return;
    }

    this.savedGuidesList.classList.remove('hidden');
    this.noSavedGuides.classList.add('hidden');

    // Icons for categories
    const categoryIcons = {
      navigation: '<svg viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
      settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
      account: '<svg viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      other: '<svg viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>'
    };

    this.savedGuidesList.innerHTML = guides.map(guide => {
      const category = guide.category || 'other';
      const categoryIcon = categoryIcons[category] || categoryIcons.other;
      const importedBadge = guide.imported ? '<span class="guide-badge imported">imported</span>' : '';
      const recordedBadge = guide.isRecorded ? '<span class="guide-badge recorded">recorded</span>' : '';
      
      return `
        <div class="saved-guide-item" data-guide-id="${guide.id}">
          <div class="saved-guide-icon">
            <span class="icon">${categoryIcon}</span>
          </div>
          <div class="saved-guide-info">
            <div class="saved-guide-name">${this.escapeHtml(guide.name)}</div>
            <div class="saved-guide-meta">
              <span>${this.escapeHtml(guide.startUrlPattern || '')}</span>
              <span>•</span>
              <span>${guide.steps?.length || 0} steps</span>
              ${importedBadge}
              ${recordedBadge}
            </div>
          </div>
          <div class="saved-guide-actions">
            <button class="guide-action-btn edit" data-guide-id="${guide.id}" title="Rename">
              <span class="icon icon-sm">
                <svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </span>
            </button>
            <button class="guide-action-btn export" data-guide-id="${guide.id}" title="Export">
              <span class="icon icon-sm">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              </span>
            </button>
            <button class="guide-action-btn delete" data-guide-id="${guide.id}" title="Delete">
              <span class="icon icon-sm">
                <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Bind click events for play (on guide-info only)
    this.savedGuidesList.querySelectorAll('.saved-guide-item').forEach(item => {
      // Click on guide info to play
      const guideInfo = item.querySelector('.saved-guide-info');
      if (guideInfo) {
        guideInfo.addEventListener('click', () => {
          this.playSavedGuide(item.dataset.guideId);
        });
      }
      const guideIcon = item.querySelector('.saved-guide-icon');
      if (guideIcon) {
        guideIcon.addEventListener('click', () => {
          this.playSavedGuide(item.dataset.guideId);
        });
      }
    });

    // Bind edit buttons
    this.savedGuidesList.querySelectorAll('.guide-action-btn.edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showRenameModal(btn.dataset.guideId);
      });
    });

    // Bind export buttons
    this.savedGuidesList.querySelectorAll('.guide-action-btn.export').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.exportGuide(btn.dataset.guideId);
      });
    });

    // Bind delete buttons
    this.savedGuidesList.querySelectorAll('.guide-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDeleteModal(btn.dataset.guideId);
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showSaveMacroModal() {
    this.macroNameInput.value = this.currentTask;
    if (this.macroCategorySelect) {
      this.macroCategorySelect.value = 'navigation'; // Default
    }
    this.saveMacroModal.classList.remove('hidden');
    this.macroNameInput.focus();
  }

  hideSaveMacroModal() {
    this.saveMacroModal.classList.add('hidden');
  }

  async saveMacro() {
    const name = this.macroNameInput.value.trim();
    if (!name) {
      this.macroNameInput.style.borderColor = '#dc2626';
      return;
    }

    const category = this.macroCategorySelect ? this.macroCategorySelect.value : 'other';
    
    // Check if we're saving a recorded guide
    let stepsToSave = this.currentSteps;
    let taskName = this.currentTask;
    let startUrl = this.currentUrl;
    let isRecorded = false;
    
    if (this.recordedGuide && this.recordedGuide.steps.length > 0) {
      stepsToSave = this.recordedGuide.steps;
      taskName = name;
      startUrl = this.recordedGuide.startUrl;
      isRecorded = true;
    }

    try {
      await chrome.runtime.sendMessage({
        type: 'SAVE_MACRO',
        payload: {
          name: name,
          task: taskName,
          steps: stepsToSave,
          startUrl: startUrl,
          category: category,
          isRecorded: isRecorded
        }
      });

      this.hideSaveMacroModal();
      this.showStatus('Guide saved! Find it in Saved Guides.', 'success');
      
      // Clear recorded guide and storage
      this.recordedGuide = null;
      await chrome.storage.local.remove(['completedRecording']);
    } catch (error) {
      console.error('Failed to save guide:', error);
      this.showStatus('Failed to save guide', 'error');
    }
  }

  // ============ RENAME GUIDE ============
  showRenameModal(guideId) {
    const guide = this.allGuides.find(g => g.id === guideId);
    if (!guide) return;

    this.guideToRename = guideId;
    this.renameGuideInput.value = guide.name;
    this.renameCategorySelect.value = guide.category || 'other';
    this.renameGuideModal.classList.remove('hidden');
    this.renameGuideInput.focus();
    this.renameGuideInput.select();
  }

  hideRenameModal() {
    this.renameGuideModal.classList.add('hidden');
    this.guideToRename = null;
  }

  async confirmRename() {
    if (!this.guideToRename) return;

    const newName = this.renameGuideInput.value.trim();
    if (!newName) {
      this.renameGuideInput.style.borderColor = '#dc2626';
      return;
    }

    const newCategory = this.renameCategorySelect.value;

    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_MACRO',
        payload: {
          macroId: this.guideToRename,
          updates: {
            name: newName,
            category: newCategory
          }
        }
      });

      this.hideRenameModal();
      this.showStatus('Guide updated!', 'success');
      this.loadSavedGuides();
    } catch (error) {
      console.error('Failed to rename guide:', error);
      this.showStatus('Failed to rename guide', 'error');
    }
  }

  // ============ DELETE GUIDE WITH CONFIRMATION ============
  showDeleteModal(guideId) {
    this.guideToDelete = guideId;
    this.deleteConfirmModal.classList.remove('hidden');
  }

  hideDeleteModal() {
    this.deleteConfirmModal.classList.add('hidden');
    this.guideToDelete = null;
  }

  async confirmDelete() {
    if (!this.guideToDelete) return;

    try {
      await chrome.runtime.sendMessage({
        type: 'DELETE_MACRO',
        payload: { macroId: this.guideToDelete }
      });
      this.hideDeleteModal();
      this.showStatus('Guide deleted', 'success');
      this.loadSavedGuides();
    } catch (error) {
      console.error('Failed to delete guide:', error);
      this.showStatus('Failed to delete guide', 'error');
    }
  }

  async deleteSavedGuide(guideId) {
    // Use confirmation modal instead of direct delete
    this.showDeleteModal(guideId);
  }

  // ============ EXPORT/IMPORT (.guideme format) ============
  
  async exportGuide(guideId) {
    try {
      this.showStatus('Exporting guide...', 'info');
      
      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_GUIDE',
        payload: { guideId }
      });
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      // Create download
      const jsonString = JSON.stringify(response.data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // Trigger download
      const a = document.createElement('a');
      a.href = url;
      a.download = response.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.showStatus('Guide exported! Share the .guideme file with others.', 'success');
      
      // Log summary for debugging
      console.log('Exported guide summary:', response.summary);
      
    } catch (error) {
      console.error('Failed to export guide:', error);
      this.showStatus(`Export failed: ${error.message}`, 'error');
    }
  }
  
  async handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Reset input so same file can be selected again
    event.target.value = '';
    
    // Validate file type
    if (!file.name.endsWith('.guideme') && !file.name.endsWith('.json')) {
      this.showStatus('Please select a .guideme or .json file', 'error');
      return;
    }
    
    try {
      this.showStatus('Importing guide...', 'info');
      
      // Read file content
      const jsonContent = await this.readFileAsText(file);
      
      // Send to background for validation and import
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_GUIDE',
        payload: { jsonContent }
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Import failed');
      }
      
      // Show success with any warnings
      let message = `Imported "${response.metadata?.name || 'Guide'}" successfully!`;
      if (response.warnings && response.warnings.length > 0) {
        message += ` (${response.warnings.join(', ')})`;
        console.warn('Import warnings:', response.warnings);
      }
      
      this.showStatus(message, 'success');
      
      // Refresh the guides list
      this.loadSavedGuides();
      
    } catch (error) {
      console.error('Failed to import guide:', error);
      this.showStatus(`Import failed: ${error.message}`, 'error');
    }
  }
  
  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  async playSavedGuide(guideId) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_MACROS' });
      const guide = (response || []).find(g => g.id === guideId);
      
      if (!guide) {
        this.showStatus('Guide not found', 'error');
        return;
      }

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Check if we're on a valid webpage
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        this.showStatus('Please navigate to a website first', 'error');
        return;
      }
      
      this.currentTask = guide.task;
      this.currentSteps = guide.steps;
      this.currentStepIndex = 0;
      this.currentUrl = tab.url;
      this.currentPlayingGuideId = guide.id; // Store for editing

      // First, ensure content script is loaded by injecting it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js']
        });
      } catch (e) {
        // Script might already be loaded, which is fine
        console.log('Content script injection result:', e.message);
      }
      
      // Small delay to ensure script is ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send steps to content script (no AI needed!)
      await chrome.tabs.sendMessage(tab.id, {
        type: 'START_GUIDE',
        payload: {
          steps: this.currentSteps,
          highlightColor: this.settings.highlightColor,
          task: guide.task,
          isMacro: true,
          isRecorded: guide.isRecorded || false,
          guideId: guide.id // Pass guide ID for edit persistence
        }
      });

      this.showView('guide');
      this.renderCurrentStep();
      this.showStatus('Playing guide: ' + guide.name, 'success');

    } catch (error) {
      console.error('Failed to play guide:', error);
      this.showStatus('Failed to play guide: ' + error.message, 'error');
    }
  }

  updateProviderHint() {
    const hints = {
      gemini: 'Get free API key at aistudio.google.com',
      openai: 'Get key at platform.openai.com (paid)',
      anthropic: 'Get key at console.anthropic.com (paid)'
    };
    this.providerHint.textContent = hints[this.apiProvider.value] || '';
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['apiProvider', 'apiKey', 'highlightColor', 'autoSaveGuides']);
      if (result.apiProvider) this.settings.apiProvider = result.apiProvider;
      if (result.apiKey) this.settings.apiKey = result.apiKey;
      if (result.highlightColor) this.settings.highlightColor = result.highlightColor;
      
      // Auto-save defaults to true
      this.settings.autoSaveGuides = result.autoSaveGuides !== false;

      // Update form
      if (this.apiProvider) {
        this.apiProvider.value = this.settings.apiProvider;
        this.apiKey.value = this.settings.apiKey;
        this.highlightColor.value = this.settings.highlightColor;
      }
      
      // Update auto-save toggle
      if (this.autoSaveToggle) {
        this.autoSaveToggle.checked = this.settings.autoSaveGuides;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async saveAutoSaveSetting() {
    this.settings.autoSaveGuides = this.autoSaveToggle.checked;
    try {
      await chrome.storage.local.set({ autoSaveGuides: this.settings.autoSaveGuides });
      console.log('Auto-save setting:', this.settings.autoSaveGuides);
    } catch (error) {
      console.error('Failed to save auto-save setting:', error);
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
    this.savedGuidesView.classList.add('hidden');

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
      case 'savedGuides':
        this.savedGuidesView.classList.remove('hidden');
        this.loadSavedGuides();
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
    this.guideBtn.innerHTML = '<span class="icon btn-icon"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> Analyzing...';
    this.showStatus('Reading page and generating guide...', 'loading');

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Store for macro saving
      this.currentTask = task;
      this.currentUrl = tab.url;
      
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

      // Check if AI returned empty steps (shouldn't happen after backend fix, but be safe)
      if (!this.currentSteps || this.currentSteps.length === 0) {
        // Check if AI marked task as already complete
        if (response.completed) {
          this.showStatus('The AI thinks this task is already complete on this page. Try asking differently.', 'error');
        } else {
          this.showStatus('Could not generate guide. Try being more specific about what you want to do.', 'error');
        }
        return;
      }

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
      this.guideBtn.innerHTML = '<span class="icon btn-icon"><svg viewBox="0 0 24 24"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg></span> Guide Me';
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
    const actionText = step.action ? `<p class="step-hint">Action: ${step.action}</p>` : '';
    const hintText = step.hint ? `<p class="step-hint">${step.hint}</p>` : '';

    this.currentStep.innerHTML = `
      <span class="step-number">Step ${stepNum} of ${totalSteps}</span>
      <p class="step-instruction">${stepText}</p>
      ${actionText}
      ${hintText}
    `;

    // Show step edit controls for saved guides
    if (this.stepEditControls) {
      this.stepEditControls.classList.remove('hidden');
    }

    // Update navigation buttons
    this.prevStepBtn.disabled = this.currentStepIndex === 0;
    this.nextStepBtn.innerHTML = this.currentStepIndex === totalSteps - 1 
      ? 'Done <span class="icon icon-sm"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' 
      : 'Next <span class="icon icon-sm"><svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span>';

    // Update progress bar
    const progress = ((stepNum) / totalSteps) * 100;
    this.progressBar.style.width = `${progress}%`;

    // Highlight current element
    this.highlightCurrentStep();
  }
  
  // ============ STEP EDITING ============
  
  showEditStepModal() {
    const step = this.currentSteps[this.currentStepIndex];
    if (!step) return;
    
    this.editStepInput.value = step.description || step.instruction || '';
    this.editStepModal.classList.remove('hidden');
    this.editStepInput.focus();
    this.editStepInput.select();
  }
  
  hideEditStepModal() {
    this.editStepModal.classList.add('hidden');
  }
  
  async confirmEditStep() {
    const newDescription = this.editStepInput.value.trim();
    if (!newDescription) {
      this.editStepInput.style.borderColor = '#dc2626';
      return;
    }
    
    console.log('confirmEditStep - currentStepIndex:', this.currentStepIndex);
    console.log('confirmEditStep - currentPlayingGuideId:', this.currentPlayingGuideId);
    
    // Update step description locally
    this.currentSteps[this.currentStepIndex].description = newDescription;
    this.currentSteps[this.currentStepIndex].instruction = newDescription;
    
    // Get guide ID - first check local, then try content script
    let guideId = this.currentPlayingGuideId;
    if (!guideId) {
      console.log('No local guideId, trying content script...');
      guideId = await this.getGuideIdFromContentScript();
    }
    
    console.log('Final guideId:', guideId);
    
    // Update saved guide if we have a guide ID
    if (guideId) {
      const success = await this.updateSavedGuideStep(guideId, this.currentStepIndex, { 
        description: newDescription,
        instruction: newDescription
      });
      
      if (success) {
        // Also update content script's steps
        await this.syncStepsToContentScript();
        this.showStatus('Step updated!', 'success');
      } else {
        this.showStatus('Failed to save changes', 'error');
      }
    } else {
      console.log('No guide ID found - changes will be local only');
      this.showStatus('Step updated (local only)', 'warning');
    }
    
    this.hideEditStepModal();
    this.renderCurrentStep();
  }
  
  async getGuideIdFromContentScript() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_GUIDE_DATA' });
      console.log('getGuideIdFromContentScript response:', response);
      if (response?.savedGuideId) {
        // Cache it for future use
        this.currentPlayingGuideId = response.savedGuideId;
        return response.savedGuideId;
      }
    } catch (e) {
      console.log('Could not get guide ID from content script:', e);
    }
    return null;
  }
  
  async syncStepsToContentScript() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_STEPS',
        payload: {
          steps: this.currentSteps,
          currentStepIndex: this.currentStepIndex,
          wasEdited: true // Mark that edits were made from popup
        }
      });
      console.log('Steps synced to content script (with edit flag)');
    } catch (e) {
      console.log('Could not sync steps to content script:', e);
    }
  }
  
  showDeleteStepModal() {
    const step = this.currentSteps[this.currentStepIndex];
    if (!step) return;
    
    // Don't allow deleting if only 1 step
    if (this.currentSteps.length <= 1) {
      this.showStatus('Cannot delete the only step', 'error');
      return;
    }
    
    this.deleteStepPreview.textContent = step.description || step.instruction || 'This step';
    this.deleteStepModal.classList.remove('hidden');
  }
  
  hideDeleteStepModal() {
    this.deleteStepModal.classList.add('hidden');
  }
  
  async confirmDeleteStep() {
    console.log('confirmDeleteStep - before delete, steps:', this.currentSteps.length);
    console.log('confirmDeleteStep - currentStepIndex:', this.currentStepIndex);
    
    // Remove the step
    this.currentSteps.splice(this.currentStepIndex, 1);
    
    // Adjust index if needed
    if (this.currentStepIndex >= this.currentSteps.length) {
      this.currentStepIndex = this.currentSteps.length - 1;
    }
    
    console.log('confirmDeleteStep - after delete, steps:', this.currentSteps.length);
    
    // Get guide ID - first check local, then try content script
    let guideId = this.currentPlayingGuideId;
    if (!guideId) {
      guideId = await this.getGuideIdFromContentScript();
    }
    
    // Update saved guide if we have a guide ID
    if (guideId) {
      console.log('Updating saved guide steps after delete:', guideId);
      const success = await this.updateSavedGuideSteps(guideId, [...this.currentSteps]);
      
      if (success) {
        // Also update content script's steps
        await this.syncStepsToContentScript();
        this.showStatus('Step deleted!', 'success');
      } else {
        this.showStatus('Failed to save changes', 'error');
      }
    } else {
      console.log('No guide ID found - delete will be local only');
      this.showStatus('Step deleted (local only)', 'warning');
    }
    
    this.hideDeleteStepModal();
    this.renderCurrentStep();
    this.highlightCurrentStep();
  }
  
  async updateSavedGuideStep(guideId, stepIndex, updates) {
    try {
      console.log('updateSavedGuideStep:', guideId, 'step:', stepIndex, 'updates:', updates);
      
      const response = await chrome.runtime.sendMessage({ type: 'GET_MACROS' });
      const guides = response || [];
      
      console.log('Found', guides.length, 'guides');
      
      const guideIndex = guides.findIndex(g => g.id === guideId);
      console.log('Guide index:', guideIndex);
      
      if (guideIndex >= 0) {
        const guide = guides[guideIndex];
        console.log('Guide has', guide.steps?.length, 'steps');
        
        if (guide.steps && guide.steps[stepIndex]) {
          // Update the step
          guide.steps[stepIndex].description = updates.description;
          guide.steps[stepIndex].instruction = updates.instruction;
          guide.updatedAt = Date.now();
          
          // Save back to storage
          await chrome.storage.local.set({ guideme_macros: guides });
          
          // Verify the save
          const verify = await chrome.storage.local.get(['guideme_macros']);
          const savedDesc = verify.guideme_macros?.[guideIndex]?.steps?.[stepIndex]?.description;
          console.log('Verified saved description:', savedDesc?.substring(0, 30));
          
          console.log('✓ Guide step updated successfully');
          return true;
        } else {
          console.warn('Step not found at index:', stepIndex);
          return false;
        }
      } else {
        console.warn('Guide not found:', guideId);
        return false;
      }
    } catch (e) {
      console.error('Failed to update saved guide step:', e);
      return false;
    }
  }
  
  async updateSavedGuideSteps(guideId, steps) {
    try {
      console.log('updateSavedGuideSteps:', guideId, 'new step count:', steps.length);
      
      const response = await chrome.runtime.sendMessage({ type: 'GET_MACROS' });
      const guides = response || [];
      const guideIndex = guides.findIndex(g => g.id === guideId);
      
      console.log('Guide index:', guideIndex);
      
      if (guideIndex >= 0) {
        // Make a deep copy of steps
        guides[guideIndex].steps = steps.map(s => ({...s}));
        guides[guideIndex].updatedAt = Date.now();
        
        await chrome.storage.local.set({ guideme_macros: guides });
        
        // Verify the save
        const verify = await chrome.storage.local.get(['guideme_macros']);
        const savedCount = verify.guideme_macros?.[guideIndex]?.steps?.length;
        console.log('Verified saved step count:', savedCount);
        
        console.log('✓ Guide steps updated successfully');
        return true;
      } else {
        console.warn('Guide not found:', guideId);
        return false;
      }
    } catch (e) {
      console.error('Failed to update saved guide steps:', e);
      return false;
    }
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
      this.showStatus('Guide completed!', 'success');
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
    this.currentTask = '';
    this.currentUrl = '';
    this.showView('main');
    this.hideStatus();
  }
  
  // ============ GUIDE RECORDING MODE ============
  
  async checkActiveRecording() {
    try {
      // First check for completed recording that needs saving
      const completed = await chrome.storage.local.get(['completedRecording']);
      if (completed.completedRecording && completed.completedRecording.steps?.length > 0) {
        // Check if it's recent (within last 30 minutes)
        const age = Date.now() - (completed.completedRecording.completedAt || 0);
        if (age < 30 * 60 * 1000) {
          console.log('Found completed recording with', completed.completedRecording.steps.length, 'steps');
          this.handleRecordingComplete(completed.completedRecording);
          return;
        } else {
          // Old recording, clear it
          await chrome.storage.local.remove(['completedRecording']);
        }
      }
      
      // Check for active recording in progress
      const result = await chrome.storage.local.get(['activeRecording']);
      if (result.activeRecording && result.activeRecording.isRecording) {
        // Show recording panel
        this.showRecordingPanel(result.activeRecording);
      }
    } catch (e) {
      console.log('No active recording');
    }
  }
  
  async startRecording() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        this.showStatus('Please navigate to a website first', 'error');
        return;
      }
      
      // Check if we can inject content script
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        this.showStatus('Cannot record on browser internal pages', 'error');
        return;
      }
      
      // Send start recording message to content script
      await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
      
      // Show recording panel
      this.showRecordingPanel({
        startUrl: tab.url,
        steps: [],
        startTime: Date.now()
      });
      
      this.showStatus('Recording started! Perform your task...', 'success');
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.showStatus('Failed to start recording. Try refreshing the page.', 'error');
    }
  }
  
  showRecordingPanel(recordingData) {
    // Hide main input section
    const inputSection = document.querySelector('.input-section');
    if (inputSection) inputSection.classList.add('hidden');
    
    // Show recording panel
    this.recordingPanel.classList.remove('hidden');
    
    // Update recording info
    const url = recordingData.startUrl || '';
    const hostname = url ? new URL(url).hostname : 'unknown';
    this.recordingStartUrl.textContent = `Started on: ${hostname}`;
    this.recordingStepCount.textContent = `${recordingData.steps?.length || 0} steps`;
    
    // Start polling for step count updates
    this.startRecordingPoll();
  }
  
  hideRecordingPanel() {
    // Show main input section
    const inputSection = document.querySelector('.input-section');
    if (inputSection) inputSection.classList.remove('hidden');
    
    // Hide recording panel
    this.recordingPanel.classList.add('hidden');
    
    // Stop polling
    this.stopRecordingPoll();
  }
  
  startRecordingPoll() {
    this.recordingPollInterval = setInterval(async () => {
      try {
        const result = await chrome.storage.local.get(['activeRecording']);
        if (result.activeRecording) {
          this.recordingStepCount.textContent = `${result.activeRecording.steps?.length || 0} steps`;
        }
      } catch (e) {}
    }, 1000);
  }
  
  stopRecordingPoll() {
    if (this.recordingPollInterval) {
      clearInterval(this.recordingPollInterval);
      this.recordingPollInterval = null;
    }
  }
  
  async stopRecording() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
      
      if (response && response.data) {
        this.handleRecordingComplete(response.data);
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      
      // Try to get data from storage directly
      const result = await chrome.storage.local.get(['activeRecording']);
      if (result.activeRecording && result.activeRecording.steps?.length > 0) {
        this.handleRecordingComplete({
          steps: result.activeRecording.steps,
          startUrl: result.activeRecording.startUrl
        });
      } else {
        this.showStatus('Failed to stop recording', 'error');
      }
    }
    
    // Clear storage
    await chrome.storage.local.remove(['activeRecording']);
    this.hideRecordingPanel();
  }
  
  async cancelRecording() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
    } catch (e) {}
    
    // Clear storage
    await chrome.storage.local.remove(['activeRecording']);
    this.hideRecordingPanel();
    this.showStatus('Recording cancelled', 'info');
  }
  
  async handleRecordingComplete(data) {
    if (!data || !data.steps || data.steps.length === 0) {
      this.showStatus('No steps were recorded', 'error');
      await chrome.storage.local.remove(['completedRecording']);
      return;
    }
    
    console.log('Recording complete:', data.steps.length, 'steps');
    
    // Hide recording panel if visible
    this.hideRecordingPanel();
    
    // Convert recorded steps to guide format
    const guideSteps = data.steps.map((step, index) => ({
      id: `gm-recorded-${index + 1}`,
      instruction: step.description,
      description: step.description,
      action: step.action,
      element: step.element,
      value: step.value,
      robustSelectors: step.robustSelectors,
      pageUrl: step.pageUrl,
      pageTitle: step.pageTitle
    }));
    
    // Store the recorded guide temporarily
    this.recordedGuide = {
      steps: guideSteps,
      startUrl: data.startUrl,
      endUrl: data.endUrl,
      duration: data.duration
    };
    
    // Generate smart suggested name based on page and actions
    const hostname = data.startUrl ? new URL(data.startUrl).hostname.replace('www.', '') : 'unknown';
    const firstAction = data.steps[0]?.description || '';
    const lastAction = data.steps[data.steps.length - 1]?.description || '';
    
    // Try to create a meaningful name
    let suggestedName = '';
    if (lastAction.toLowerCase().includes('create')) {
      suggestedName = `Create something on ${hostname}`;
    } else if (lastAction.toLowerCase().includes('submit')) {
      suggestedName = `Submit form on ${hostname}`;
    } else {
      suggestedName = `Guide on ${hostname} (${data.steps.length} steps)`;
    }
    
    this.macroNameInput.value = suggestedName;
    this.macroNameInput.placeholder = 'e.g., Create a new repository, Submit contact form...';
    this.macroCategorySelect.value = 'other';
    
    // Show modal with updated content for recorded guide
    this.saveMacroModal.classList.remove('hidden');
    
    // Update modal title and add step preview
    const modalTitle = this.saveMacroModal.querySelector('h3');
    if (modalTitle) {
      modalTitle.innerHTML = `
        <span class="icon" style="color: #ef4444;">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>
        </span> 
        Save Recorded Guide
      `;
    }
    
    // Add step preview if not already present
    let previewEl = this.saveMacroModal.querySelector('.recorded-steps-preview');
    if (!previewEl) {
      previewEl = document.createElement('div');
      previewEl.className = 'recorded-steps-preview';
      const inputGroup = this.saveMacroModal.querySelector('.input-group');
      if (inputGroup) {
        inputGroup.parentNode.insertBefore(previewEl, inputGroup);
      }
    }
    
    // Show first few steps as preview
    const previewSteps = data.steps.slice(0, 4);
    previewEl.innerHTML = `
      <div class="preview-header">
        <span class="preview-badge">${data.steps.length} steps recorded</span>
      </div>
      <div class="preview-steps">
        ${previewSteps.map((s, i) => `
          <div class="preview-step">
            <span class="step-num">${i + 1}</span>
            <span class="step-desc">${this.escapeHtml(s.description?.substring(0, 50) || 'Action')}</span>
          </div>
        `).join('')}
        ${data.steps.length > 4 ? `<div class="preview-more">...and ${data.steps.length - 4} more steps</div>` : ''}
      </div>
    `;
    
    // Focus on name input
    setTimeout(() => this.macroNameInput.focus(), 100);
  }
  
  // Override saveMacro to handle recorded guides
  async saveMacroWithRecording() {
    const name = this.macroNameInput.value.trim();
    const category = this.macroCategorySelect.value;
    
    if (!name) {
      this.showStatus('Please enter a name for your guide', 'error');
      return;
    }
    
    // Check if we're saving a recorded guide
    let stepsToSave = this.currentSteps;
    let taskName = this.currentTask;
    let startUrl = this.currentUrl;
    
    if (this.recordedGuide && this.recordedGuide.steps.length > 0) {
      stepsToSave = this.recordedGuide.steps;
      taskName = name;
      startUrl = this.recordedGuide.startUrl;
    }
    
    const guide = {
      id: Date.now().toString(),
      name: name,
      task: taskName,
      category: category,
      steps: stepsToSave,
      url: startUrl,
      createdAt: new Date().toISOString(),
      isRecorded: !!this.recordedGuide
    };
    
    try {
      // Get existing guides
      const result = await chrome.storage.local.get(['savedGuides']);
      const guides = result.savedGuides || [];
      guides.push(guide);
      
      // Save updated guides
      await chrome.storage.local.set({ savedGuides: guides });
      
      this.showStatus('Guide saved successfully!', 'success');
      this.hideSaveMacroModal();
      
      // Clear recorded guide
      this.recordedGuide = null;
      
    } catch (error) {
      console.error('Failed to save guide:', error);
      this.showStatus('Failed to save guide', 'error');
    }
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new GuideMePopup();
});
