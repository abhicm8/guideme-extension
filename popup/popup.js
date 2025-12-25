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

    try {
      await chrome.runtime.sendMessage({
        type: 'SAVE_MACRO',
        payload: {
          name: name,
          task: this.currentTask,
          steps: this.currentSteps,
          startUrl: this.currentUrl,
          category: category
        }
      });

      this.hideSaveMacroModal();
      this.showStatus('Guide saved! Find it in Saved Guides.', 'success');
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
          isMacro: true
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
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new GuideMePopup();
});
