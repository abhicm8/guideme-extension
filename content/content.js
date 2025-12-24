// GuideMe Content Script
// Runs on every page to read DOM and inject overlay highlights

class GuideMeContent {
  constructor() {
    this.currentSteps = [];
    this.currentStepIndex = 0;
    this.completedSteps = []; // Track completed steps across pages
    this.totalStepsCompleted = 0; // Total steps done in this session
    this.isMultiPageTask = false; // Flag for multi-page tasks
    this.isSavedGuideReplay = false; // Flag for replaying saved guides (no AI)
    this.allStepsForSaving = []; // Store ALL steps for auto-save
    this.visitedUrls = []; // Track visited URLs to detect back navigation
    this.highlightColor = '#4F46E5';
    this.overlayElements = [];
    this.controlPanel = null;
    this.currentHighlightedElement = null;
    this.scrollHandler = null;
    this.resizeHandler = null;
    this.clickHandler = null;
    this.mutationObserver = null;
    this.pendingRetry = null;
    this.isGuideActive = false;
    this.originalTask = '';
    
    // SPA Navigation Detection
    this.lastUrl = window.location.href;
    this.urlCheckInterval = null;
    this.popstateHandler = null;
    this.originalPushState = null;
    this.originalReplaceState = null;

    // Voice overlay tracking (recognition runs in offscreen document)
    this.voiceOverlayVisible = false;
    
    this.init();
  }

  init() {
    // Listen for messages from popup/background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    // Setup SPA navigation detection (for YouTube, Gmail, etc.)
    this.setupSPADetection();
    
    // Setup visibility change detection (for new tab scenarios)
    this.setupVisibilityDetection();

    // Check for saved guide state on page load (for cross-page navigation)
    this.checkForSavedGuide();
  }
  
  setupVisibilityDetection() {
    // Detect when user switches to another tab
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isGuideActive) {
        console.log('GuideMe: Tab hidden - pausing guide state');
        // When tab becomes hidden, if guide is active, mark for potential cleanup
        // This handles the case where user clicks a link that opens new tab
        this.tabHiddenTime = Date.now();
      } else if (!document.hidden && this.tabHiddenTime) {
        // Tab became visible again
        const hiddenDuration = Date.now() - this.tabHiddenTime;
        console.log('GuideMe: Tab visible again, was hidden for', hiddenDuration, 'ms');
        
        // If tab was hidden for a while (user was in another tab), 
        // and we have a guide active, check if we should stop
        if (hiddenDuration > 5000 && this.isGuideActive) {
          // User spent significant time in another tab - likely following guide there
          // Stop the guide in this tab to prevent confusion
          console.log('GuideMe: Guide likely continued in another tab, stopping here');
          this.stopGuide();
        }
        this.tabHiddenTime = null;
      }
    });
  }

  setupSPADetection() {
    // Method 1: Listen for popstate (browser back/forward)
    this.popstateHandler = () => {
      this.handleSPANavigation('popstate');
    };
    window.addEventListener('popstate', this.popstateHandler);

    // Method 2: Intercept pushState and replaceState (SPA navigation)
    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);

    const self = this;
    history.pushState = function(...args) {
      self.originalPushState(...args);
      self.handleSPANavigation('pushState');
    };
    history.replaceState = function(...args) {
      self.originalReplaceState(...args);
      self.handleSPANavigation('replaceState');
    };

    // Method 3: Fallback URL polling for edge cases (every 500ms)
    this.urlCheckInterval = setInterval(() => {
      if (window.location.href !== this.lastUrl) {
        this.handleSPANavigation('polling');
      }
    }, 500);

    console.log('GuideMe: SPA navigation detection enabled');
  }

  handleSPANavigation(source) {
    const newUrl = window.location.href;
    if (newUrl === this.lastUrl) return; // No actual change
    
    console.log(`GuideMe: SPA navigation detected via ${source}:`, newUrl);
    this.lastUrl = newUrl;

    // Only continue if we have an active guide
    if (!this.isGuideActive && !this.originalTask) {
      // No active guide - don't auto-resume on navigation
      // User must explicitly start a new guide
      console.log('GuideMe: No active guide, ignoring navigation');
      return;
    }

    // For SAVED GUIDE REPLAYS - use remaining steps, NO AI call
    if (this.isSavedGuideReplay) {
      console.log('GuideMe: Saved guide - using remaining steps, no AI call');
      // Re-scan DOM for fresh element IDs
      setTimeout(() => {
        this.extractDOM();
        if (this.currentSteps.length > this.currentStepIndex + 1) {
          // Move to next step
          this.currentStepIndex++;
          this.highlightStep(this.currentStepIndex);
          this.updateControlPanel();
        } else {
          // No more steps
          this.showFinalCompletion();
        }
      }, 800);
      return;
    }

    // LIVE GUIDE - save state for potential navigation
    if (this.originalTask) {
      this.saveStateForNavigation();
      
      // Wait for new content to load, then continue
      setTimeout(async () => {
        await this.waitForPageReady();
        console.log('GuideMe: Requesting AI continuation after SPA navigation...');
        this.requestGuideContinuation();
      }, 800);
    }
  }

  async checkForSavedGuide() {
    // Don't re-activate if guide is already running
    if (this.isGuideActive) {
      console.log('GuideMe: Guide already active, skipping check');
      return;
    }
    
    try {
      // Check chrome.storage first
      let guideState = null;
      const result = await chrome.storage.local.get(['activeGuide']);
      
      if (result.activeGuide && result.activeGuide.task) {
        guideState = result.activeGuide;
      }
      
      // Also check localStorage backup (more reliable for navigation)
      try {
        const backup = localStorage.getItem('guideme_backup');
        if (backup) {
          const backupState = JSON.parse(backup);
          // Use backup if it's newer or if we don't have chrome.storage data
          if (!guideState || (backupState.savedAt > (guideState.savedAt || 0))) {
            guideState = backupState;
          }
          // Clear the backup after reading
          localStorage.removeItem('guideme_backup');
        }
      } catch (e) {}
      
      // Check if guide was marked as completed - DO NOT RESUME
      if (!guideState || guideState.completed || !guideState.task) {
        console.log('GuideMe: No active guide to resume or guide completed');
        this.clearGuideState();
        return;
      }
      
      // Check if state is expired (older than 2 minutes)
      const stateAge = Date.now() - (guideState.savedAt || 0);
      const MAX_AGE = 2 * 60 * 1000; // 2 minutes
      
      if (stateAge > MAX_AGE) {
        console.log('GuideMe: Saved state expired, clearing...');
        this.clearGuideState();
        return;
      }
      
      // Check if this is a FORWARD navigation (not back button)
      // Back navigation = URL we've seen before without explicit action
      // We should NOT auto-resume on back button - it causes the loop
      const isBackNavigation = this.wasUrlVisited(window.location.href);
      if (isBackNavigation && !guideState.remainingSteps?.length) {
        console.log('GuideMe: Back navigation detected, not auto-resuming');
        this.clearGuideState();
        return;
      }
      
      console.log('GuideMe: Found saved guide task:', guideState.task);
      console.log('GuideMe: Remaining steps:', guideState.remainingSteps?.length || 0);
      
      this.originalTask = guideState.task;
      this.highlightColor = guideState.highlightColor || '#4F46E5';
      this.completedSteps = guideState.completedSteps || [];
      this.isSavedGuideReplay = guideState.isSavedGuideReplay || false;
      this.allStepsForSaving = guideState.allStepsForSaving || [];
      this.visitedUrls = guideState.visitedUrls || [];
      
      // Mark current URL as visited
      this.markUrlVisited(window.location.href);
      
      // Wait for page to be fully interactive
      await this.waitForPageReady();
      
      // Check if we have remaining steps
      if (guideState.remainingSteps && guideState.remainingSteps.length > 0) {
        console.log('GuideMe: Continuing with', guideState.remainingSteps.length, 'remaining steps');
        this.extractDOM();
        this.currentSteps = guideState.remainingSteps;
        this.currentStepIndex = 0;
        this.isMultiPageTask = true;
        this.startGuide();
        this.saveGuideState();
      } else if (!this.isSavedGuideReplay) {
        // Live guide needs AI - but only if forward navigation
        console.log('GuideMe: Requesting AI for new page...');
        this.requestGuideContinuation();
      } else {
        // Saved guide with no remaining steps = complete
        console.log('GuideMe: Saved guide completed');
        this.showTaskCompleted();
      }
    } catch (error) {
      console.log('GuideMe: Error checking saved guide:', error);
    }
  }
  
  // Track visited URLs to detect back navigation
  wasUrlVisited(url) {
    return (this.visitedUrls || []).includes(url);
  }
  
  markUrlVisited(url) {
    if (!this.visitedUrls) this.visitedUrls = [];
    if (!this.visitedUrls.includes(url)) {
      this.visitedUrls.push(url);
    }
  }

  trackStepCompletion() {
    // Track the current step as completed
    const completedStep = this.currentSteps[this.currentStepIndex];
    if (completedStep) {
      this.completedSteps.push({
        description: completedStep.description || '',
        action: completedStep.action || 'click',
        page: window.location.href,
        completedAt: Date.now()
      });
      console.log('GuideMe: Tracked completed step:', completedStep.description);
    }
  }

  saveStateForNavigation() {
    // Calculate remaining steps (steps after current one)
    const remainingSteps = this.currentSteps.slice(this.currentStepIndex + 1);
    
    // Mark current URL as visited
    this.markUrlVisited(window.location.href);
    
    // Save state immediately for potential navigation
    const guideState = {
      task: this.originalTask,
      completedSteps: this.completedSteps,
      highlightColor: this.highlightColor,
      pageUrl: '', // Clear so new page triggers continuation
      savedAt: Date.now(),
      // Save remaining steps and replay flag to avoid AI calls on saved guides
      remainingSteps: remainingSteps,
      isSavedGuideReplay: this.isSavedGuideReplay,
      allStepsForSaving: this.allStepsForSaving || [],
      visitedUrls: this.visitedUrls || []
    };
    
    // Save to both storages for reliability
    chrome.storage.local.set({ activeGuide: guideState });
    try {
      localStorage.setItem('guideme_backup', JSON.stringify(guideState));
    } catch (e) {}
    
    console.log('GuideMe: State saved for navigation, remaining steps:', remainingSteps.length);
  }

  async requestGuideContinuation() {
    // Show loading state
    this.showContinuationLoading();
    
    try {
      // Get current page DOM
      const dom = this.extractDOM();
      
      // Ask background to continue the guide
      const response = await chrome.runtime.sendMessage({
        type: 'CONTINUE_GUIDE',
        payload: {
          task: this.originalTask,
          completedSteps: this.completedSteps,
          dom: dom,
          url: window.location.href,
          title: document.title
        }
      });
      
      if (response.error) {
        console.error('GuideMe: Continuation failed:', response.error);
        this.showContinuationError(response.error);
        return;
      }
      
      if (response.steps && response.steps.length > 0) {
        this.hideContinuationLoading();
        this.currentSteps = response.steps;
        this.currentStepIndex = 0;
        this.startGuide();
        this.saveGuideState();
      } else if (response.completed) {
        this.showTaskCompleted();
      } else {
        // No steps and not completed - might be an issue
        this.hideContinuationLoading();
        console.log('GuideMe: No more steps for this page');
      }
    } catch (error) {
      console.error('GuideMe: Failed to continue guide:', error);
      this.showContinuationError(error.message);
    }
  }

  showContinuationLoading() {
    // Create a simple loading panel
    const panel = document.createElement('div');
    panel.id = 'guideme-loading';
    panel.innerHTML = `
      <div style="position:fixed;bottom:20px;right:20px;background:#4F46E5;color:white;padding:16px 24px;border-radius:12px;font-family:system-ui;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:20px;height:20px;border:3px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:guideme-spin 1s linear infinite;"></div>
          <span>Analyzing new page...</span>
        </div>
      </div>
      <style>
        @keyframes guideme-spin { to { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(panel);
  }

  hideContinuationLoading() {
    const panel = document.getElementById('guideme-loading');
    if (panel) panel.remove();
  }

  showContinuationError(message) {
    this.hideContinuationLoading();
    console.error('GuideMe: Could not continue guide:', message);
    
    // DON'T clear state - show retry UI instead
    // Create error panel with retry button
    const panel = document.createElement('div');
    panel.id = 'guideme-error-panel';
    const isRateLimit = message.toLowerCase().includes('rate') || message.toLowerCase().includes('limit') || message.toLowerCase().includes('quota');
    
    panel.innerHTML = `
      <div style="position:fixed;bottom:20px;right:20px;background:#1f2937;color:white;padding:20px 24px;border-radius:16px;font-family:system-ui;z-index:2147483647;box-shadow:0 10px 40px rgba(0,0,0,0.4);max-width:320px;">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;">
          <span style="font-size:24px;">${isRateLimit ? '⏳' : '⚠️'}</span>
          <div>
            <div style="font-weight:600;margin-bottom:4px;">${isRateLimit ? 'API Rate Limited' : 'Connection Issue'}</div>
            <div style="font-size:13px;opacity:0.8;">${isRateLimit ? 'Too many requests. Wait 10-15 seconds.' : message}</div>
          </div>
        </div>
        <div style="display:flex;gap:12px;">
          <button id="guideme-retry-btn" style="flex:1;padding:10px 16px;background:#4F46E5;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;transition:background 0.2s;">
            🔄 Retry Now
          </button>
          <button id="guideme-cancel-btn" style="padding:10px 16px;background:#374151;color:white;border:none;border-radius:8px;cursor:pointer;transition:background 0.2s;">
            ✕ Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    
    // Bind events
    document.getElementById('guideme-retry-btn').addEventListener('click', () => {
      panel.remove();
      this.requestGuideContinuation();
    });
    document.getElementById('guideme-cancel-btn').addEventListener('click', () => {
      panel.remove();
      this.clearGuideState();
    });
  }

  showTaskCompleted() {
    this.hideContinuationLoading();
    
    // IMMEDIATELY clear all state to prevent re-activation
    this.isGuideActive = false;
    this.clearGuideState();
    try {
      localStorage.removeItem('guideme_backup');
    } catch (e) {}
    console.log('GuideMe: Task completed - all state cleared');
    
    const panel = document.createElement('div');
    panel.innerHTML = `
      <div style="position:fixed;bottom:20px;right:20px;background:#10B981;color:white;padding:20px 28px;border-radius:12px;font-family:system-ui;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-size:18px;font-weight:600;">🎉 Task Complete!</div>
        <div style="margin-top:8px;opacity:0.9;">Your guide has finished.</div>
      </div>
    `;
    document.body.appendChild(panel);
    setTimeout(() => panel.remove(), 4000);
  }

  // ============ SAVE GUIDE FROM FLOATING PANEL ============
  showSaveGuideModal() {
    // Remove existing modal if any
    const existingModal = document.getElementById('guideme-save-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'guideme-save-modal';
    modal.innerHTML = `
      <div class="guideme-save-modal-backdrop"></div>
      <div class="guideme-save-modal-content">
        <h3>💾 Save This Guide</h3>
        <p>Save to replay anytime without using AI.</p>
        <input type="text" class="guideme-save-name-input" placeholder="e.g., GitHub - Create Repo" value="${this.originalTask || 'My Guide'}">
        <div class="guideme-save-modal-actions">
          <button class="guideme-save-cancel-btn">Cancel</button>
          <button class="guideme-save-confirm-btn">Save Guide</button>
        </div>
      </div>
      <style>
        #guideme-save-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: system-ui, -apple-system, sans-serif;
        }
        .guideme-save-modal-backdrop {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
        }
        .guideme-save-modal-content {
          position: relative;
          background: white;
          border-radius: 16px;
          padding: 24px;
          width: 340px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: guideme-modal-appear 0.2s ease;
        }
        @keyframes guideme-modal-appear {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .guideme-save-modal-content h3 {
          margin: 0 0 8px 0;
          font-size: 18px;
          color: #1f2937;
        }
        .guideme-save-modal-content p {
          margin: 0 0 16px 0;
          font-size: 13px;
          color: #6b7280;
        }
        .guideme-save-name-input {
          width: 100%;
          padding: 12px;
          font-size: 14px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          margin-bottom: 16px;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.2s;
        }
        .guideme-save-name-input:focus {
          border-color: #4F46E5;
        }
        .guideme-save-modal-actions {
          display: flex;
          gap: 12px;
        }
        .guideme-save-cancel-btn, .guideme-save-confirm-btn {
          flex: 1;
          padding: 10px 16px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .guideme-save-cancel-btn {
          background: #f3f4f6;
          color: #4b5563;
        }
        .guideme-save-cancel-btn:hover {
          background: #e5e7eb;
        }
        .guideme-save-confirm-btn {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: white;
        }
        .guideme-save-confirm-btn:hover {
          background: linear-gradient(135deg, #d97706, #b45309);
        }
      </style>
    `;

    document.body.appendChild(modal);

    // Focus the input
    const input = modal.querySelector('.guideme-save-name-input');
    input.focus();
    input.select();

    // Bind events
    modal.querySelector('.guideme-save-modal-backdrop').addEventListener('click', () => modal.remove());
    modal.querySelector('.guideme-save-cancel-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.guideme-save-confirm-btn').addEventListener('click', () => this.saveGuideFromModal(modal));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveGuideFromModal(modal);
      if (e.key === 'Escape') modal.remove();
    });
  }

  async saveGuideFromModal(modal) {
    const input = modal.querySelector('.guideme-save-name-input');
    const name = input.value.trim();

    if (!name) {
      input.style.borderColor = '#dc2626';
      return;
    }

    try {
      // Send save request to background
      await chrome.runtime.sendMessage({
        type: 'SAVE_MACRO',
        payload: {
          name: name,
          task: this.originalTask,
          steps: this.currentSteps,
          startUrl: window.location.href
        }
      });

      // Remove modal and show success
      modal.remove();
      this.showSaveSuccess(name);
    } catch (error) {
      console.error('GuideMe: Failed to save guide:', error);
      input.style.borderColor = '#dc2626';
    }
  }

  showSaveSuccess(name) {
    const toast = document.createElement('div');
    toast.innerHTML = `
      <div style="position:fixed;bottom:100px;right:20px;background:#10B981;color:white;padding:16px 24px;border-radius:12px;font-family:system-ui;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:guideme-toast-in 0.3s ease;">
        <div style="font-weight:600;">✅ Guide Saved!</div>
        <div style="font-size:13px;opacity:0.9;margin-top:4px;">"${name}" - Find it in 📚 Saved Guides</div>
      </div>
      <style>
        @keyframes guideme-toast-in {
          from { opacity:0; transform:translateY(20px); }
          to { opacity:1; transform:translateY(0); }
        }
      </style>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  waitForPageReady() {
    return new Promise((resolve) => {
      // If document is already complete, wait a bit more for JS frameworks
      if (document.readyState === 'complete') {
        setTimeout(resolve, 800);
        return;
      }
      
      // Wait for load event
      window.addEventListener('load', () => {
        setTimeout(resolve, 500);
      }, { once: true });
      
      // Fallback timeout
      setTimeout(resolve, 2000);
    });
  }

  async saveGuideState() {
    try {
      // Calculate remaining steps for cross-page continuation
      const remainingSteps = this.currentSteps.slice(this.currentStepIndex + 1);
      
      await chrome.storage.local.set({
        activeGuide: {
          task: this.originalTask,
          steps: this.currentSteps,
          currentStepIndex: this.currentStepIndex,
          highlightColor: this.highlightColor,
          completedSteps: this.completedSteps || [],
          pageUrl: window.location.href,
          savedAt: Date.now(),
          // Include remaining steps and flags for cross-page continuation
          remainingSteps: remainingSteps,
          isSavedGuideReplay: this.isSavedGuideReplay || false,
          allStepsForSaving: this.allStepsForSaving || [],
          visitedUrls: this.visitedUrls || []
        }
      });
      console.log('GuideMe: Guide state saved, remaining steps:', remainingSteps.length);
    } catch (error) {
      console.error('GuideMe: Failed to save guide state', error);
    }
  }

  async clearGuideState() {
    try {
      // Set completed flag BEFORE removing, in case of race conditions
      await chrome.storage.local.set({ 
        activeGuide: { completed: true, clearedAt: Date.now() } 
      });
      // Then remove completely
      await chrome.storage.local.remove(['activeGuide']);
      // Also clear localStorage backup
      try {
        localStorage.removeItem('guideme_backup');
      } catch (e) {}
      console.log('GuideMe: Guide state cleared completely');
    } catch (error) {
      console.error('GuideMe: Failed to clear guide state', error);
    }
  }

  handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'GET_DOM':
        sendResponse(this.extractDOM());
        break;
      
      case 'START_GUIDE':
        this.currentSteps = message.payload.steps;
        this.highlightColor = message.payload.highlightColor || '#4F46E5';
        this.currentStepIndex = 0;
        this.originalTask = message.payload.task || '';
        this.isSavedGuideReplay = message.payload.isMacro || message.payload.isSavedGuide || false;
        
        // Store all steps for auto-save (deep copy at start)
        // This captures the INITIAL steps before any mutations
        this.allStepsForSaving = JSON.parse(JSON.stringify(this.currentSteps));
        console.log('GuideMe: Starting guide with', this.currentSteps.length, 'steps');
        console.log('GuideMe: Is saved guide replay:', this.isSavedGuideReplay);
        console.log('GuideMe: Steps descriptions:', this.currentSteps.map(s => s.description?.substring(0, 30)));
        
        // For saved guide replays, we need to re-scan DOM first!
        if (this.isSavedGuideReplay) {
          console.log('GuideMe: Replaying saved guide - re-scanning DOM first');
          this.extractDOM(); // This assigns fresh gm-X IDs
        }
        
        this.startGuide();
        this.saveGuideState(); // Save state for cross-page navigation
        sendResponse({ success: true });
        break;
      
      case 'HIGHLIGHT_STEP':
        this.currentStepIndex = message.payload.stepIndex;
        this.highlightColor = message.payload.highlightColor || this.highlightColor;
        this.highlightStep(this.currentStepIndex);
        this.updateControlPanel();
        this.saveGuideState(); // Save updated step
        sendResponse({ success: true });
        break;
      
      case 'STOP_GUIDE':
        this.stopGuide();
        sendResponse({ success: true });
        break;

      case 'START_VOICE_RECOGNITION':
        // Voice recognition now handled by offscreen document
        // Just show the voice overlay for visual feedback
        this.showVoiceOverlay();
        sendResponse({ success: true });
        break;

      case 'STOP_VOICE_RECOGNITION':
        // Hide the voice overlay
        this.hideVoiceOverlay();
        sendResponse({ success: true });
        break;
      
      case 'VOICE_RESULT':
        // Update voice overlay with transcript from offscreen document
        if (message.transcript) {
          this.updateVoiceOverlay(message.transcript, message.isFinal);
        }
        if (message.isFinal) {
          setTimeout(() => this.hideVoiceOverlay(), 500);
        }
        sendResponse({ success: true });
        break;
        
      case 'VOICE_ERROR':
        // Voice error from offscreen document
        this.hideVoiceOverlay();
        sendResponse({ success: true });
        break;
        
      case 'VOICE_ENDED':
        // Voice recognition ended
        this.hideVoiceOverlay();
        sendResponse({ success: true });
        break;
      
      case 'GET_CURRENT_GUIDE_DATA':
        // Return current guide data for saving
        sendResponse({
          task: this.originalTask,
          steps: this.currentSteps,
          currentStepIndex: this.currentStepIndex,
          url: window.location.href
        });
        break;
      
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  // ============ VOICE OVERLAY UI (voice recognition runs in offscreen document) ============
  // Voice recognition has been moved to offscreen document for proper microphone access
  // These methods just handle the visual overlay in the content page
  
  showVoiceOverlay() {
    // Remove existing overlay
    this.hideVoiceOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'guideme-voice-overlay';
    overlay.innerHTML = `
      <div class="guideme-voice-modal">
        <div class="guideme-voice-animation">
          <div class="guideme-voice-circle"></div>
          <div class="guideme-voice-circle"></div>
          <div class="guideme-voice-circle"></div>
          <div class="guideme-voice-mic">🎤</div>
        </div>
        <div class="guideme-voice-text">Listening...</div>
        <div class="guideme-voice-transcript"></div>
        <button class="guideme-voice-cancel">Cancel</button>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.id = 'guideme-voice-styles';
    style.textContent = `
      #guideme-voice-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        animation: guideme-fade-in 0.2s ease;
      }

      @keyframes guideme-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .guideme-voice-modal {
        background: white;
        border-radius: 20px;
        padding: 40px;
        text-align: center;
        min-width: 300px;
        max-width: 400px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }

      .guideme-voice-animation {
        position: relative;
        width: 120px;
        height: 120px;
        margin: 0 auto 24px;
      }

      .guideme-voice-mic {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 40px;
        z-index: 10;
      }

      .guideme-voice-circle {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 3px solid #4F46E5;
        animation: guideme-pulse-ring 1.5s ease-out infinite;
      }

      .guideme-voice-circle:nth-child(1) {
        width: 60px;
        height: 60px;
        animation-delay: 0s;
      }

      .guideme-voice-circle:nth-child(2) {
        width: 80px;
        height: 80px;
        animation-delay: 0.3s;
      }

      .guideme-voice-circle:nth-child(3) {
        width: 100px;
        height: 100px;
        animation-delay: 0.6s;
      }

      @keyframes guideme-pulse-ring {
        0% {
          transform: translate(-50%, -50%) scale(0.8);
          opacity: 1;
          border-width: 3px;
        }
        100% {
          transform: translate(-50%, -50%) scale(1.4);
          opacity: 0;
          border-width: 1px;
        }
      }

      /* Sound wave animation when speaking */
      .guideme-voice-modal.speaking .guideme-voice-circle {
        animation: guideme-sound-wave 0.5s ease-in-out infinite alternate;
      }

      .guideme-voice-modal.speaking .guideme-voice-circle:nth-child(1) {
        animation-delay: 0s;
      }
      .guideme-voice-modal.speaking .guideme-voice-circle:nth-child(2) {
        animation-delay: 0.1s;
      }
      .guideme-voice-modal.speaking .guideme-voice-circle:nth-child(3) {
        animation-delay: 0.2s;
      }

      @keyframes guideme-sound-wave {
        0% {
          transform: translate(-50%, -50%) scale(0.9);
          border-color: #4F46E5;
        }
        100% {
          transform: translate(-50%, -50%) scale(1.1);
          border-color: #7C3AED;
        }
      }

      .guideme-voice-text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 20px;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 12px;
      }

      .guideme-voice-transcript {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 16px;
        color: #4F46E5;
        min-height: 24px;
        margin-bottom: 20px;
        padding: 0 20px;
        word-wrap: break-word;
      }

      .guideme-voice-cancel {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 10px 24px;
        background: #f3f4f6;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        color: #6b7280;
        cursor: pointer;
        transition: background 0.2s;
      }

      .guideme-voice-cancel:hover {
        background: #e5e7eb;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // Bind cancel button
    overlay.querySelector('.guideme-voice-cancel').addEventListener('click', () => {
      this.stopVoiceRecognition();
      chrome.runtime.sendMessage({ type: 'VOICE_ERROR', error: 'cancelled' });
    });
  }

  updateVoiceOverlay(transcript, isFinal) {
    const overlay = document.getElementById('guideme-voice-overlay');
    if (!overlay) return;

    const modal = overlay.querySelector('.guideme-voice-modal');
    const textEl = overlay.querySelector('.guideme-voice-text');
    const transcriptEl = overlay.querySelector('.guideme-voice-transcript');

    // Add speaking animation when there's activity
    if (transcript) {
      modal.classList.add('speaking');
      transcriptEl.textContent = `"${transcript}"`;
    }

    if (isFinal) {
      modal.classList.remove('speaking');
      textEl.textContent = '✓ Got it!';
      textEl.style.color = '#10b981';
    }
  }

  hideVoiceOverlay() {
    const overlay = document.getElementById('guideme-voice-overlay');
    const style = document.getElementById('guideme-voice-styles');
    if (overlay) overlay.remove();
    if (style) style.remove();
  }

  startGuide() {
    this.isGuideActive = true;
    // Reset counters for fresh guide (but not if continuing)
    if (this.totalStepsCompleted === 0) {
      this.isMultiPageTask = false;
    }
    this.createControlPanel();
    this.highlightStep(this.currentStepIndex);
    this.setupEventListeners();
  }

  stopGuide() {
    this.isGuideActive = false;
    // Cancel any pending retries
    if (this.pendingRetry) {
      clearTimeout(this.pendingRetry);
      this.pendingRetry = null;
    }
    this.clearHighlights();
    this.removeControlPanel();
    this.removeEventListeners();
    this.currentSteps = [];
    this.currentStepIndex = 0;
    this.completedSteps = [];
    this.totalStepsCompleted = 0; // Reset counter
    this.isMultiPageTask = false; // Reset flag
    this.isSavedGuideReplay = false; // Reset replay flag
    this.allStepsForSaving = []; // Clear saved steps
    this.visitedUrls = []; // Clear visited URLs
    this.originalTask = '';
    
    // Clear ALL saved state to prevent unwanted resumption
    this.clearGuideState();
    try {
      localStorage.removeItem('guideme_backup');
    } catch (e) {}
    
    // Note: We keep SPA detection active as it's needed for new guides
    console.log('GuideMe: Guide stopped and all state cleared');
  }

  cleanupSPADetection() {
    // Restore original history methods
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
    
    // Remove popstate listener
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = null;
    }
    
    // Clear URL polling interval
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
  }

  setupEventListeners() {
    // CRITICAL: Save state before page unloads (navigation)
    this.beforeUnloadHandler = () => {
      if (this.isGuideActive && this.originalTask) {
        // Synchronously save to storage before page unloads
        const guideState = {
          task: this.originalTask,
          completedSteps: this.completedSteps || [],
          highlightColor: this.highlightColor,
          pageUrl: '', // Clear URL so new page triggers continuation
          savedAt: Date.now()
        };
        // Use synchronous localStorage as backup (chrome.storage is async)
        try {
          localStorage.setItem('guideme_backup', JSON.stringify(guideState));
        } catch (e) {}
        console.log('GuideMe: Saved state before navigation');
      }
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);

    // Update highlight position on scroll
    this.scrollHandler = () => {
      if (this.currentHighlightedElement && this.isGuideActive) {
        this.updateHighlightPosition();
      }
    };
    window.addEventListener('scroll', this.scrollHandler, true);

    // Update on resize
    this.resizeHandler = () => {
      if (this.currentHighlightedElement && this.isGuideActive) {
        this.updateHighlightPosition();
      }
    };
    window.addEventListener('resize', this.resizeHandler);

    // Detect clicks on highlighted element to auto-advance
    this.clickHandler = (e) => {
      if (!this.isGuideActive) return;
      
      // CRITICAL: Only advance if we have a highlighted element AND user clicked on it
      if (!this.currentHighlightedElement) {
        console.log('GuideMe: Click detected but no highlighted element - ignoring');
        return;
      }
      
      // Check if clicked element is or contains the highlighted element
      const clickedOnHighlighted = 
        this.currentHighlightedElement.contains(e.target) || 
        e.target === this.currentHighlightedElement ||
        this.currentHighlightedElement.contains(e.target.parentElement);
      
      if (!clickedOnHighlighted) {
        console.log('GuideMe: Click was not on highlighted element - ignoring');
        return;
      }
      
      console.log('GuideMe: User clicked highlighted element, advancing...');
      
      // IMMEDIATELY save state before navigation might occur
      this.trackStepCompletion();
      this.saveStateForNavigation();
        
      // Auto-advance to next step after a short delay (if no navigation)
      setTimeout(() => {
        if (this.isGuideActive) {
          this.nextStep();
        }
      }, 600);
    };
    document.addEventListener('click', this.clickHandler, true);

    // Watch for DOM changes (for dynamically loaded content)
    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.isGuideActive) return;
      
      // Check if highlighted element was removed from DOM
      if (this.currentHighlightedElement && !document.body.contains(this.currentHighlightedElement)) {
        console.log('GuideMe: Highlighted element removed from DOM, clearing highlight');
        this.clearHighlights();
        this.currentHighlightedElement = null;
        // Try to re-find and highlight
        setTimeout(() => {
          if (this.isGuideActive && this.currentSteps.length > 0) {
            this.highlightStep(this.currentStepIndex);
          }
        }, 300);
        return;
      }
      
      // If we don't have a highlighted element yet, try to find it
      if (!this.currentHighlightedElement && this.currentSteps.length > 0) {
        const step = this.currentSteps[this.currentStepIndex];
        if (step) {
          const selector = step.element || step.selector;
          const description = step.description || step.instruction || '';
          const element = this.findElement(selector, description);
          if (element) {
            console.log('GuideMe: Found element after DOM update');
            this.currentHighlightedElement = element;
            this.createHighlight(element);
          }
        }
      }
    });
    
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  removeEventListeners() {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler, true);
      this.scrollHandler = null;
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }

  createControlPanel() {
    this.removeControlPanel();

    const panel = document.createElement('div');
    panel.id = 'guideme-control-panel';
    panel.innerHTML = `
      <div class="guideme-panel-header">
        <span class="guideme-logo">🎯 GuideMe</span>
        <div class="guideme-header-actions">
          <button class="guideme-save-btn" title="Save this guide for later">💾</button>
          <button class="guideme-close-btn" title="Close guide">✕</button>
        </div>
      </div>
      <div class="guideme-panel-content">
        <div class="guideme-step-info">
          <span class="guideme-step-number">Step 1 of ${this.currentSteps.length}</span>
          <button class="guideme-refresh-btn" title="Can't find element? Click to re-scan page">🔄</button>
        </div>
        <p class="guideme-instruction"></p>
        <p class="guideme-hint"></p>
        <p class="guideme-not-found" style="display:none;color:#f59e0b;font-size:12px;">Element not found. Open any dropdowns, then click 🔄 to re-scan.</p>
      </div>
      <div class="guideme-panel-controls">
        <button class="guideme-prev-btn" disabled>← Prev</button>
        <button class="guideme-next-btn">Next →</button>
      </div>
      <div class="guideme-progress-bar">
        <div class="guideme-progress-fill"></div>
      </div>
      <button class="guideme-exit-btn">🚪 Exit Tutorial</button>
    `;

    document.body.appendChild(panel);
    this.controlPanel = panel;

    // Bind control panel events
    panel.querySelector('.guideme-close-btn').addEventListener('click', () => this.stopGuide());
    panel.querySelector('.guideme-prev-btn').addEventListener('click', () => this.prevStep());
    panel.querySelector('.guideme-next-btn').addEventListener('click', () => this.nextStep());
    panel.querySelector('.guideme-refresh-btn').addEventListener('click', () => this.refreshAndReHighlight());
    panel.querySelector('.guideme-save-btn').addEventListener('click', () => this.showSaveGuideModal());
    panel.querySelector('.guideme-exit-btn').addEventListener('click', () => {
      if (confirm('Exit tutorial? Your progress will be lost.')) {
        this.stopGuide();
      }
    });

    // Make panel draggable
    this.makeDraggable(panel);

    this.updateControlPanel();
  }

  async refreshAndReHighlight() {
    console.log('GuideMe: Manual refresh requested - re-extracting DOM');
    
    // Show loading state
    const refreshBtn = this.controlPanel?.querySelector('.guideme-refresh-btn');
    if (refreshBtn) {
      refreshBtn.textContent = '⏳';
      refreshBtn.disabled = true;
    }
    
    // Clear old element IDs and re-extract
    document.querySelectorAll('[data-guideme-id]').forEach(el => {
      el.removeAttribute('data-guideme-id');
    });
    
    // Re-extract DOM with fresh IDs
    const dom = this.extractDOM();
    console.log('GuideMe: Re-extracted', dom.elements.length, 'elements');
    
    // Ask AI for steps on this refreshed DOM
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CONTINUE_GUIDE',
        payload: {
          task: this.originalTask,
          completedSteps: this.completedSteps,
          dom: dom,
          url: window.location.href,
          title: document.title
        }
      });
      
      if (response.steps && response.steps.length > 0) {
        this.currentSteps = response.steps;
        this.currentStepIndex = 0;
        this.highlightStep(0);
        this.updateControlPanel();
        
        // Hide not found message
        const notFoundEl = this.controlPanel?.querySelector('.guideme-not-found');
        if (notFoundEl) notFoundEl.style.display = 'none';
      }
    } catch (error) {
      console.error('GuideMe: Refresh failed:', error);
    }
    
    // Reset button
    if (refreshBtn) {
      refreshBtn.textContent = '🔄';
      refreshBtn.disabled = false;
    }
  }

  makeDraggable(panel) {
    const header = panel.querySelector('.guideme-panel-header');
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('guideme-close-btn')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${initialX + dx}px`;
      panel.style.top = `${initialY + dy}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      header.style.cursor = 'grab';
    });
  }

  updateControlPanel() {
    if (!this.controlPanel || !this.currentSteps.length) return;

    const step = this.currentSteps[this.currentStepIndex];
    const pageStepNum = this.currentStepIndex + 1;
    const pageTotal = this.currentSteps.length;
    const overallStep = this.totalStepsCompleted + pageStepNum;
    
    console.log('GuideMe: updateControlPanel - step', pageStepNum, 'of', pageTotal);
    console.log('GuideMe: Step description:', step.description?.substring(0, 50));

    // Show overall journey step number (not "X of Y" since we don't know total)
    const stepNumberEl = this.controlPanel.querySelector('.guideme-step-number');
    if (this.isMultiPageTask || this.totalStepsCompleted > 0) {
      stepNumberEl.textContent = `Step ${overallStep} • Multi-page`;
    } else {
      stepNumberEl.textContent = `Step ${pageStepNum} of ${pageTotal}`;
    }
    
    this.controlPanel.querySelector('.guideme-instruction').textContent = 
      step.description || step.instruction || 'Follow this step';
    
    const hintEl = this.controlPanel.querySelector('.guideme-hint');
    if (step.hint || step.action) {
      hintEl.textContent = `💡 Action: ${step.action || step.hint}`;
      hintEl.style.display = 'block';
    } else {
      hintEl.style.display = 'none';
    }

    // Update buttons - always show "Next" since we might have more pages
    const prevBtn = this.controlPanel.querySelector('.guideme-prev-btn');
    const nextBtn = this.controlPanel.querySelector('.guideme-next-btn');
    
    prevBtn.disabled = this.currentStepIndex === 0 && this.totalStepsCompleted === 0;
    // Always show "Next →" - we'll check for completion after clicking
    nextBtn.textContent = 'Next →';

    // Update progress bar (pulse if multi-page to show ongoing)
    const progressBar = this.controlPanel.querySelector('.guideme-progress-fill');
    const progress = (pageStepNum / pageTotal) * 100;
    progressBar.style.width = `${progress}%`;
    if (this.isMultiPageTask) {
      progressBar.style.animation = 'guideme-pulse 2s ease-in-out infinite';
    } else {
      progressBar.style.animation = 'none';
    }
  }

  removeControlPanel() {
    if (this.controlPanel) {
      this.controlPanel.remove();
      this.controlPanel = null;
    }
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.pendingRetry = null; // Cancel any pending retries
      this.highlightStep(this.currentStepIndex);
      this.updateControlPanel();
      this.saveGuideState(); // Save progress
    }
  }

  nextStep() {
    // For live guides (not replay), track the completed step
    // Note: trackStepCompletion() is called by click handler, so don't duplicate here
    const completedStep = this.currentSteps[this.currentStepIndex];
    
    // Only increment counter (tracking already done by click handler for live clicks)
    if (completedStep) {
      this.totalStepsCompleted++;
      
      // Add to allStepsForSaving if not already there
      if (!this.isSavedGuideReplay && this.allStepsForSaving) {
        const alreadyExists = this.allStepsForSaving.some(
          s => s.description === completedStep.description
        );
        if (!alreadyExists) {
          this.allStepsForSaving.push({
            description: completedStep.description,
            action: completedStep.action || 'click',
            element: completedStep.element || 'body'
          });
        }
      }
    }
    
    if (this.currentStepIndex < this.currentSteps.length - 1) {
      this.currentStepIndex++;
      this.pendingRetry = null; // Cancel any pending retries
      // Add delay for page content to update after click
      setTimeout(() => {
        this.highlightStep(this.currentStepIndex);
        this.updateControlPanel();
        this.saveGuideState(); // Save progress
      }, 300);
    } else {
      // All steps on THIS PAGE complete
      // For saved guide replays, just show completion (no AI continuation)
      if (this.isSavedGuideReplay) {
        console.log('GuideMe: Saved guide replay complete');
        this.showFinalCompletion();
      } else {
        // Live guide - request continuation from AI
        console.log('GuideMe: All steps on this page done, requesting continuation...');
        this.saveGuideState();
        this.requestContinuation();
      }
    }
  }

  async requestContinuation() {
    // Mark this as a multi-page task since we're continuing
    this.isMultiPageTask = true;
    
    // Ensure control panel exists
    if (!this.controlPanel || !document.body.contains(this.controlPanel)) {
      console.log('GuideMe: Recreating control panel...');
      this.createControlPanel();
    }
    
    // Show loading state
    if (this.controlPanel) {
      this.controlPanel.querySelector('.guideme-instruction').textContent = '⏳ Finding next steps...';
      this.controlPanel.querySelector('.guideme-hint').textContent = '🔄 This is a multi-page task';
      this.controlPanel.querySelector('.guideme-hint').style.display = 'block';
      this.controlPanel.querySelector('.guideme-step-number').textContent = `Step ${this.totalStepsCompleted + 1} • Loading...`;
    }

    try {
      // Wait for any DOM updates after the click (menus opening, page loading)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Re-extract DOM with fresh element IDs
      const dom = this.extractDOM();
      
      const response = await chrome.runtime.sendMessage({
        type: 'CONTINUE_GUIDE',
        payload: {
          task: this.originalTask,
          completedSteps: this.completedSteps,
          dom: dom,
          url: window.location.href,
          title: document.title
        }
      });

      console.log('GuideMe: Continuation response:', response);

      if (response.error) {
        console.error('GuideMe: Continuation error:', response.error);
        this.showCompletionMessage();
        setTimeout(() => this.stopGuide(), 2000);
        return;
      }

      // Check if AI says we're truly done
      if (response.completed === true) {
        console.log('GuideMe: Task marked as completed by AI');
        this.showFinalCompletion();
        return;
      }

      // More steps available!
      if (response.steps && response.steps.length > 0) {
        console.log('GuideMe: Got', response.steps.length, 'more steps');
        this.currentSteps = response.steps;
        this.currentStepIndex = 0;
        
        // Add new steps to allStepsForSaving for auto-save
        if (this.allStepsForSaving) {
          response.steps.forEach(step => {
            // Avoid duplicates by checking descriptions
            const exists = this.allStepsForSaving.some(
              s => s.description === step.description
            );
            if (!exists) {
              this.allStepsForSaving.push({
                description: step.description,
                action: step.action || 'click',
                element: step.element || 'body'
              });
            }
          });
          console.log('GuideMe: Total steps for saving:', this.allStepsForSaving.length);
        }
        
        // Ensure panel exists before updating
        if (!this.controlPanel || !document.body.contains(this.controlPanel)) {
          this.createControlPanel();
        }
        
        // Update UI
        this.highlightStep(0);
        this.updateControlPanel();
        this.saveGuideState();
        
        // Show progress if available
        if (response.progress && this.controlPanel) {
          const hint = this.controlPanel.querySelector('.guideme-hint');
          hint.textContent = `📍 ${response.progress}`;
          hint.style.display = 'block';
        }
      } else {
        // No more steps and not marked complete - task might be done
        console.log('GuideMe: No more steps available, assuming complete');
        this.showFinalCompletion();
      }
    } catch (error) {
      console.error('GuideMe: Continuation failed:', error);
      // Show error with retry option instead of just stopping
      this.showRetryOption(error.message || 'Connection failed');
    }
  }

  showRetryOption(errorMessage) {
    if (this.controlPanel) {
      this.controlPanel.querySelector('.guideme-step-number').textContent = '⚠️ Paused';
      this.controlPanel.querySelector('.guideme-instruction').textContent = 
        errorMessage.includes('rate') ? 'API rate limited - wait a moment' : 'Failed to get next steps';
      this.controlPanel.querySelector('.guideme-hint').textContent = 'Click 🔄 to retry';
      this.controlPanel.querySelector('.guideme-hint').style.display = 'block';
      
      // Make the refresh button pulse to draw attention
      const refreshBtn = this.controlPanel.querySelector('.guideme-refresh-btn');
      if (refreshBtn) {
        refreshBtn.style.animation = 'guideme-pulse 1s ease-in-out infinite';
        refreshBtn.title = 'Click to retry';
      }
    }
  }

  async showFinalCompletion() {
    // IMMEDIATELY clear all saved state to prevent re-activation on back navigation
    this.isGuideActive = false;
    await this.clearGuideState();
    try {
      localStorage.removeItem('guideme_backup');
    } catch (e) {}
    console.log('GuideMe: Guide completed - all state cleared immediately');
    
    // Auto-save the guide if enabled
    await this.autoSaveGuideIfEnabled();
    
    // Show success with stats
    const totalSteps = this.totalStepsCompleted + this.currentStepIndex + 1;
    if (this.controlPanel) {
      this.controlPanel.querySelector('.guideme-step-number').textContent = '✅ Complete!';
      this.controlPanel.querySelector('.guideme-instruction').textContent = '🎉 You made it!';
      this.controlPanel.querySelector('.guideme-hint').textContent = `Completed ${totalSteps} steps • Auto-saved ✓`;
      this.controlPanel.querySelector('.guideme-hint').style.display = 'block';
      this.controlPanel.querySelector('.guideme-progress-fill').style.width = '100%';
      this.controlPanel.querySelector('.guideme-progress-fill').style.animation = 'none';
      this.controlPanel.querySelector('.guideme-progress-fill').style.background = '#10B981';
    }
    this.clearHighlights();
    setTimeout(() => this.stopGuide(), 3000);
  }

  async autoSaveGuideIfEnabled() {
    try {
      // Check if auto-save is enabled
      const result = await chrome.storage.local.get(['autoSaveGuides']);
      const autoSaveEnabled = result.autoSaveGuides !== false; // Default true
      
      if (!autoSaveEnabled) {
        console.log('GuideMe: Auto-save disabled, skipping...');
        return;
      }
      
      // Don't auto-save if this was already a saved guide replay
      if (this.isSavedGuideReplay) {
        console.log('GuideMe: Skipping auto-save for replayed guide');
        return;
      }
      
      // Use allStepsForSaving which has the complete journey
      const stepsToSave = this.allStepsForSaving || [];
      
      if (stepsToSave.length === 0) {
        console.log('GuideMe: No steps to save');
        return;
      }
      
      // Generate a name from the task
      const guideName = this.originalTask.substring(0, 50) + (this.originalTask.length > 50 ? '...' : '');
      
      // Save via background script
      await chrome.runtime.sendMessage({
        type: 'SAVE_MACRO',
        payload: {
          name: guideName,
          task: this.originalTask,
          steps: stepsToSave,
          startUrl: window.location.href
        }
      });
      
      console.log('GuideMe: Guide auto-saved with', stepsToSave.length, 'steps');
    } catch (error) {
      console.error('GuideMe: Auto-save failed:', error);
    }
  }

  showCompletionMessage() {
    if (this.controlPanel) {
      this.controlPanel.querySelector('.guideme-instruction').textContent = '🎉 Guide completed!';
      this.controlPanel.querySelector('.guideme-hint').textContent = 'Great job!';
      this.controlPanel.querySelector('.guideme-hint').style.display = 'block';
    }
  }

  highlightStep(stepIndex, retryCount = 0) {
    // Always clear highlights first
    this.clearHighlights();
    this.currentHighlightedElement = null;

    if (!this.currentSteps || stepIndex >= this.currentSteps.length) return;
    
    // Check if this is stale (step changed while retrying)
    if (stepIndex !== this.currentStepIndex) {
      console.log('GuideMe: Skipping stale highlight attempt for step', stepIndex);
      return;
    }

    const step = this.currentSteps[stepIndex];
    const selector = step.element || step.selector;
    const description = step.description || step.instruction || '';
    
    console.log(`GuideMe: Highlighting step ${stepIndex + 1}: ${description.substring(0, 50)}...`);
    
    // Use both selector AND description for better element finding
    const element = this.findElement(selector, description);

    if (!element) {
      // Retry up to 3 times with increasing delays (for page load timing)
      if (retryCount < 3) {
        const delay = (retryCount + 1) * 500; // 500ms, 1000ms, 1500ms
        console.log(`GuideMe: Element not found, retrying in ${delay}ms (attempt ${retryCount + 1}/3)`);
        this.pendingRetry = setTimeout(() => {
          if (stepIndex === this.currentStepIndex) { // Only retry if still on same step
            this.highlightStep(stepIndex, retryCount + 1);
          }
        }, delay);
        return;
      }
      console.warn('GuideMe: Could not find element after retries:', step);
      this.showNotFoundMessage(description);
      return;
    }

    this.currentHighlightedElement = element;
    console.log('GuideMe: Found element:', this.getElementText(element).substring(0, 30));

    // Check if element is in viewport, if not scroll to it
    if (!this.isElementInViewport(element)) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Wait for scroll to complete before highlighting
      setTimeout(() => {
        if (stepIndex === this.currentStepIndex) { // Verify still on same step
          this.createHighlight(element);
        }
      }, 500);
    } else {
      this.createHighlight(element);
    }
  }

  isElementInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  updateHighlightPosition() {
    if (!this.currentHighlightedElement) return;

    const element = this.currentHighlightedElement;
    const rect = element.getBoundingClientRect();

    // Update highlight box position
    const highlight = document.querySelector('.guideme-highlight-box');
    if (highlight) {
      highlight.style.top = `${rect.top - 4}px`;
      highlight.style.left = `${rect.left - 4}px`;
      highlight.style.width = `${rect.width + 8}px`;
      highlight.style.height = `${rect.height + 8}px`;
    }

    // Update ring position
    const ring = document.querySelector('.guideme-ring');
    if (ring) {
      ring.style.top = `${rect.top + rect.height / 2}px`;
      ring.style.left = `${rect.left + rect.width / 2}px`;
    }

    // Update arrow position
    const arrow = document.querySelector('.guideme-arrow');
    if (arrow) {
      arrow.style.top = `${rect.top - 50}px`;
      arrow.style.left = `${rect.left + rect.width / 2 - 20}px`;
    }
  }

  showNotFoundMessage(instruction) {
    // Show a message in the control panel that element wasn't found
    if (this.controlPanel) {
      const hintEl = this.controlPanel.querySelector('.guideme-hint');
      hintEl.textContent = '⚠️ Element not found';
      hintEl.style.display = 'block';
      hintEl.style.color = '#dc2626';
      
      // Show the not found help message
      const notFoundEl = this.controlPanel.querySelector('.guideme-not-found');
      if (notFoundEl) {
        notFoundEl.style.display = 'block';
      }
    }
  }

  createHighlight(element) {
    const rect = element.getBoundingClientRect();
    
    // Create highlight box (no background blocking clicks)
    const highlight = document.createElement('div');
    highlight.className = 'guideme-highlight-box';
    highlight.style.cssText = `
      position: fixed;
      top: ${rect.top - 4}px;
      left: ${rect.left - 4}px;
      width: ${rect.width + 8}px;
      height: ${rect.height + 8}px;
      border: 3px solid ${this.highlightColor};
      border-radius: 8px;
      background: transparent;
      pointer-events: none;
      z-index: 2147483640;
      box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.4);
      animation: guideme-pulse 1.5s ease-in-out infinite;
    `;
    
    document.body.appendChild(highlight);
    this.overlayElements.push(highlight);

    // Create pulsing ring
    const ring = document.createElement('div');
    ring.className = 'guideme-ring';
    ring.style.cssText = `
      position: fixed;
      top: ${rect.top + rect.height / 2}px;
      left: ${rect.left + rect.width / 2}px;
      width: 20px;
      height: 20px;
      border: 3px solid ${this.highlightColor};
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483641;
      animation: guideme-ripple 1.5s ease-out infinite;
      transform: translate(-50%, -50%);
    `;
    
    document.body.appendChild(ring);
    this.overlayElements.push(ring);

    // Create pointing arrow
    const arrow = document.createElement('div');
    arrow.className = 'guideme-arrow';
    arrow.innerHTML = '👇';
    arrow.style.cssText = `
      position: fixed;
      top: ${rect.top - 50}px;
      left: ${rect.left + rect.width / 2 - 20}px;
      font-size: 32px;
      pointer-events: none;
      z-index: 2147483642;
      animation: guideme-bounce 1s ease-in-out infinite;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    `;
    
    document.body.appendChild(arrow);
    this.overlayElements.push(arrow);
  }

  clearHighlights() {
    this.overlayElements.forEach(el => {
      try { el.remove(); } catch (e) {}
    });
    this.overlayElements = [];
    this.currentHighlightedElement = null;
  }

  // ==================== DOM EXTRACTION METHODS ====================
  // NEW: ID-based element tracking - no more guessing!

  extractDOM() {
    // Clear old IDs first
    document.querySelectorAll('[data-guideme-id]').forEach(el => {
      el.removeAttribute('data-guideme-id');
    });
    
    const data = {
      url: window.location.href,
      title: document.title,
      elements: []
    };

    let elementIndex = 0;
    const seen = new Set();
    
    // Helper to add element with ID
    const addElement = (el, location) => {
      if (seen.has(el) || !this.isVisible(el)) return;
      seen.add(el);
      
      const text = this.getElementText(el);
      const ariaLabel = el.getAttribute('aria-label');
      if (!text && !ariaLabel && el.tagName !== 'INPUT') return;
      
      // Assign unique ID
      const guideId = `gm-${elementIndex++}`;
      el.setAttribute('data-guideme-id', guideId);
      
      // Determine element type
      let elType = 'link';
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') elType = 'button';
      else if (el.tagName === 'INPUT') elType = el.type || 'input';
      else if (el.tagName === 'SELECT') elType = 'dropdown';
      else if (el.getAttribute('role') === 'menuitem') elType = 'menu-item';
      else if (el.getAttribute('role') === 'tab') elType = 'tab';
      
      data.elements.push({
        id: guideId,
        text: (text || ariaLabel || '').substring(0, 60).trim(),
        type: elType,
        location: location || 'page'
      });
    };

    // 1. Header elements
    document.querySelectorAll('header, #masthead, [role="banner"]').forEach(header => {
      header.querySelectorAll('button, a, [role="button"], [role="menuitem"]').forEach(el => {
        addElement(el, 'header');
      });
    });

    // 2. Sidebar/Navigation elements
    document.querySelectorAll('aside, [role="complementary"], nav, .sidebar, .side-nav, .menu, [aria-label*="menu"], [aria-label*="Menu"], [aria-label*="navigation"], [role="navigation"]').forEach(sidebar => {
      sidebar.querySelectorAll('a, button, [role="menuitem"], [role="tab"], li a, li button').forEach(el => {
        addElement(el, 'sidebar');
      });
    });

    // 3. Main content elements (highest priority for actions)
    document.querySelectorAll('main, [role="main"], .main-content, #content, article').forEach(main => {
      // Headings for context
      main.querySelectorAll('h1, h2, h3').forEach(h => {
        if (seen.has(h)) return;
        seen.add(h);
        const text = h.textContent.trim().substring(0, 80);
        if (text) {
          data.elements.push({
            id: `heading-${elementIndex++}`,
            text: text,
            type: 'heading',
            location: 'main'
          });
        }
      });
      
      // Interactive elements
      main.querySelectorAll('a, button, [role="button"], input, select').forEach(el => {
        addElement(el, 'main');
      });
    });

    // 4. Any remaining interactive elements not yet captured
    const interactiveSelectors = 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"]';
    document.querySelectorAll(interactiveSelectors).forEach(el => {
      addElement(el, 'page');
    });

    // 5. Page headings for context
    document.querySelectorAll('h1, h2').forEach(h => {
      if (seen.has(h)) return;
      seen.add(h);
      const text = h.textContent.trim().substring(0, 80);
      if (text) {
        data.elements.push({
          id: `heading-${elementIndex++}`,
          text: text,
          type: 'heading',
          location: 'page'
        });
      }
    });

    console.log('GuideMe: Extracted', data.elements.length, 'elements with IDs');
    
    // Limit to prevent token overflow
    data.elements = data.elements.slice(0, 100);
    return data;
  }

  getElementText(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const title = el.title;
    if (title) return title;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.placeholder) return el.placeholder;
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent.trim();
    }

    let text = '';
    el.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent.trim() + ' ';
      }
    });
    text = text.trim();

    if (!text) text = el.textContent.trim();
    return text;
  }

  getRelevantClasses(el) {
    const classes = Array.from(el.classList)
      .filter(c => !c.match(/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/))
      .filter(c => !c.match(/^_[a-zA-Z0-9]+$/))
      .slice(0, 5);
    return classes.length > 0 ? classes.join(' ') : null;
  }

  generateSelector(el) {
    if (el.id && !el.id.match(/^[0-9]/)) return `#${el.id}`;

    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
    if (testId) return `[data-testid="${testId}"]`;

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
      return `${el.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
    }

    const text = this.getElementText(el);
    if (text && text.length < 50 && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
      return `${el.tagName.toLowerCase()}:contains("${text.substring(0, 30)}")`;
    }

    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    if (el.placeholder) return `${el.tagName.toLowerCase()}[placeholder="${el.placeholder}"]`;

    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const index = siblings.indexOf(el) + 1;
      const parentSelector = this.getParentSelector(parent);
      return `${parentSelector} > ${el.tagName.toLowerCase()}:nth-of-type(${index})`;
    }

    return el.tagName.toLowerCase();
  }

  getParentSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.tagName === 'BODY') return 'body';
    const classes = this.getRelevantClasses(el);
    if (classes) return `.${classes.split(' ')[0]}`;
    return el.tagName.toLowerCase();
  }

  isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 && rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  }

  findElement(selector, text) {
    console.log('GuideMe: ========== FINDING ELEMENT ==========');
    console.log('GuideMe: Element ID/selector:', selector);
    console.log('GuideMe: Description:', text?.substring(0, 60));
    
    // STRATEGY 1: Find by GuideMe ID (most reliable for live guides)
    // The selector should be the element ID like "gm-15"
    if (selector && selector.startsWith('gm-')) {
      const el = document.querySelector(`[data-guideme-id="${selector}"]`);
      if (el && this.isVisible(el)) {
        console.log('GuideMe: ✓ Found by ID:', selector);
        return el;
      }
      console.log('GuideMe: ID not found or not visible:', selector);
    }
    
    // For saved guide replays, IDs won't match - use text matching primarily
    // STRATEGY 2: If selector looks like exact text, find by exact text match
    if (selector && selector.length > 2 && !selector.startsWith('.') && !selector.startsWith('#') && !selector.startsWith('gm-')) {
      const exactMatch = this.findByExactText(selector);
      if (exactMatch) {
        console.log('GuideMe: ✓ Found by exact text:', selector);
        return exactMatch;
      }
    }
    
    // STRATEGY 3: Try CSS selector if it looks like one
    if (selector && (selector.startsWith('.') || selector.startsWith('#') || selector.startsWith('['))) {
      try {
        const el = document.querySelector(selector);
        if (el && this.isVisible(el)) {
          console.log('GuideMe: ✓ Found by CSS selector');
          return el;
        }
      } catch (e) {}
    }
    
    // STRATEGY 4: Extract keywords from description and find best match
    // This is the fallback for saved guides where IDs changed
    const description = text || '';
    const keywords = this.extractKeywords(selector + ' ' + description);
    console.log('GuideMe: Keywords:', keywords);
    
    if (keywords.length > 0) {
      const match = this.findByKeywords(keywords);
      if (match) {
        console.log('GuideMe: ✓ Found by keywords:', this.getElementText(match).substring(0, 40));
        return match;
      }
    }
    
    console.log('GuideMe: ✗ Could not find element');
    return null;
  }

  extractKeywords(text) {
    if (!text) return [];
    const stopWords = ['the', 'a', 'an', 'to', 'on', 'in', 'for', 'or', 'and', 'click', 'button', 'link', 'tab', 'option', 'select', 'your', 'this', 'that', 'then', 'will', 'can', 'should'];
    return text.toLowerCase()
      .replace(/['"()]/g, '')
      .split(/[\s,.-]+/)
      .filter(w => w.length > 2 && !stopWords.includes(w))
      .slice(0, 8);
  }

  findByKeywords(keywords) {
    // Search elements with data-guideme-id (elements we know about)
    const elements = document.querySelectorAll('[data-guideme-id]');
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const el of elements) {
      if (!this.isVisible(el)) continue;
      
      const elText = this.getElementText(el).toLowerCase();
      const elWords = elText.split(/\s+/);
      
      let score = 0;
      let matchedKeywords = [];
      
      for (const kw of keywords) {
        // Exact word match
        if (elWords.includes(kw)) {
          score += 25;
          matchedKeywords.push(kw);
        }
        // Word contains keyword
        else if (elWords.some(w => w.includes(kw) && kw.length > 3)) {
          score += 15;
          matchedKeywords.push(kw + '*');
        }
        // Keyword contains word (e.g., "budgets" matches "budget")
        else if (elWords.some(w => kw.includes(w) && w.length > 3)) {
          score += 10;
          matchedKeywords.push('*' + kw);
        }
      }
      
      // Bonus for matching more keywords
      if (matchedKeywords.length > 1) {
        score += matchedKeywords.length * 10;
      }
      
      // Penalty for very long text (probably a container, not a button)
      if (elText.length > 50) {
        score -= 10;
      }
      
      if (score > bestScore && score >= 20) {
        bestScore = score;
        bestMatch = el;
      }
    }
    
    return bestMatch;
  }

  extractSearchTerms(selector, text) {
    const terms = new Set();
    const combined = `${selector || ''} ${text || ''}`;
    
    // Extract quoted strings
    const quoted = combined.match(/['"]([^'"]+)['"]/g);
    if (quoted) {
      quoted.forEach(q => terms.add(q.replace(/['"]/g, '').trim()));
    }
    
    // Extract key phrases after common words
    const patterns = [
      /click\s+(?:the\s+)?['"]?([^'"]+?)['"]?\s*(?:button|link|tab|option|menu)?/gi,
      /find\s+(?:the\s+)?['"]?([^'"]+?)['"]?/gi,
      /look\s+for\s+['"]?([^'"]+?)['"]?/gi,
      /(?:button|link|tab)\s+(?:called|named|labeled)\s+['"]?([^'"]+?)['"]?/gi,
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(combined)) !== null) {
        if (match[1] && match[1].length > 2) {
          terms.add(match[1].trim());
        }
      }
    });
    
    // Add the whole selector if it looks like a description
    if (selector && !selector.startsWith('[') && !selector.startsWith('#') && !selector.startsWith('.')) {
      const cleaned = selector
        .replace(/^(click|tap|select|find|look for|locate|on the|in the)\s+/gi, '')
        .replace(/\s+(button|link|tab|option|in the sidebar|in the menu|in navigation)$/gi, '')
        .replace(/['"`]/g, '')
        .trim();
      if (cleaned.length > 2) terms.add(cleaned);
    }
    
    // Extract important context nouns from the full text
    const contextNouns = combined.match(/\b(budget|budgets|alert|alerts|billing|profile|account|repository|repositories|project|projects|package|packages|action|actions|codespace|codespaces|license|licensing|payment|usage|overview|settings|notifications)\b/gi);
    if (contextNouns) {
      contextNouns.forEach(noun => terms.add(noun.toLowerCase()));
    }
    
    // Add synonym variations
    const synonyms = {
      'create': ['new', 'add', 'create'],
      'new': ['create', 'add', 'new'],
      'add': ['create', 'new', 'add'],
      'delete': ['remove', 'delete'],
      'remove': ['delete', 'remove'],
      'edit': ['modify', 'change', 'update', 'edit'],
      'settings': ['preferences', 'options', 'settings'],
      'budget': ['budgets', 'budget'],
      'budgets': ['budget', 'budgets'],
      'alert': ['alerts', 'alert', 'notification', 'notifications'],
      'alerts': ['alert', 'alerts', 'notification', 'notifications']
    };
    
    const termsArray = Array.from(terms);
    termsArray.forEach(term => {
      const words = term.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (synonyms[word]) {
          // Add variations with synonyms
          synonyms[word].forEach(syn => {
            const variant = term.toLowerCase().replace(word, syn);
            terms.add(variant);
          });
        }
      });
    });
    
    const result = Array.from(terms).filter(t => t.length > 1);
    console.log('GuideMe: Extracted search terms:', result);
    return result;
  }

  tryDirectSelector(selector) {
    try {
      // Clean up selector - remove :contains() which isn't real CSS
      let cleanSelector = selector;
      if (selector.includes(':contains(')) {
        const match = selector.match(/^([^:]+):contains\("([^"]+)"\)$/);
        if (match) {
          const [, tag, searchText] = match;
          const elements = document.querySelectorAll(tag);
          for (const el of elements) {
            if (el.textContent.trim().toLowerCase().includes(searchText.toLowerCase()) && this.isVisible(el)) {
              console.log('GuideMe: Found via :contains()');
              return el;
            }
          }
        }
        return null;
      }
      
      // Try direct selector
      if (!cleanSelector.includes(' with ')) {
        const el = document.querySelector(cleanSelector);
        if (el && this.isVisible(el)) {
          console.log('GuideMe: Found via direct selector');
          return el;
        }
      }
    } catch (e) {
      // Invalid selector, continue to other methods
    }
    return null;
  }

  findByExactText(searchText) {
    if (!searchText || searchText.length < 2) return null;
    const lower = searchText.toLowerCase().trim();
    
    // Search all interactive elements first (higher priority)
    const interactiveElements = document.querySelectorAll('a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], li a, li button');
    
    // Pass 1: Exact text match on interactive elements
    for (const el of interactiveElements) {
      if (!this.isVisible(el)) continue;
      
      const elText = this.getElementText(el).toLowerCase().trim();
      
      // Exact match (case insensitive)
      if (elText === lower) {
        console.log('GuideMe: EXACT match found! Looking for:', lower, '-> Found:', elText);
        return el;
      }
    }
    
    // Pass 2: Check aria-labels on interactive elements
    for (const el of interactiveElements) {
      if (!this.isVisible(el)) continue;
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.toLowerCase().trim() === lower) {
        console.log('GuideMe: EXACT aria-label match:', lower);
        return el;
      }
    }
    
    // Pass 3: Check non-interactive elements (spans, divs) that might be clickable
    const otherElements = document.querySelectorAll('span, div, label, li');
    for (const el of otherElements) {
      if (!this.isVisible(el)) continue;
      
      const elText = this.getElementText(el).toLowerCase().trim();
      if (elText === lower) {
        // Check if this element or a close parent is clickable
        const clickable = el.closest('a, button, [role="button"], [role="menuitem"], [onclick]');
        if (clickable) {
          console.log('GuideMe: Found text in clickable parent:', lower);
          return clickable;
        }
        // Return the element anyway if exact match
        console.log('GuideMe: Found exact text (not explicitly clickable):', lower);
        return el;
      }
    }
    
    // No exact match found - log some candidates for debugging
    console.log('GuideMe: No exact match for:', lower);
    
    return null;
  }

  findByPartialText(searchText) {
    if (!searchText || searchText.length < 2) return null;
    const lower = searchText.toLowerCase().trim();
    
    // Search all interactive elements first
    const interactiveElements = document.querySelectorAll('a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], input[type="submit"], input[type="button"]');
    
    for (const el of interactiveElements) {
      if (!this.isVisible(el)) continue;
      
      const elText = this.getElementText(el).toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      
      // Check if search term is contained
      if (elText.includes(lower) || ariaLabel.includes(lower)) {
        console.log('GuideMe: Found partial text match:', searchText);
        return el;
      }
    }
    
    // Then try other elements (li, span, div that might be clickable)
    const otherElements = document.querySelectorAll('li, span, div, label');
    for (const el of otherElements) {
      if (!this.isVisible(el)) continue;
      
      // Only consider if it has a click handler or is inside a clickable
      const hasClickHandler = el.onclick || el.getAttribute('onclick') || el.closest('a, button, [role="button"]');
      if (!hasClickHandler) continue;
      
      const elText = this.getElementText(el).toLowerCase();
      if (elText.includes(lower)) {
        console.log('GuideMe: Found partial text in clickable container:', searchText);
        return el;
      }
    }
    
    return null;
  }

  findBestMatch(searchTerms) {
    if (!searchTerms || searchTerms.length === 0) return null;
    
    // Get all clickable elements
    const allElements = document.querySelectorAll('a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], input[type="submit"], input[type="button"]');
    
    let bestElement = null;
    let bestScore = 0;
    
    // Extract important context words from search terms (nouns, specific terms)
    const contextWords = new Set();
    const actionWords = ['create', 'new', 'add', 'delete', 'remove', 'edit', 'save', 'submit', 'update', 'click', 'open', 'view'];
    
    searchTerms.forEach(term => {
      term.toLowerCase().split(/\s+/).forEach(word => {
        if (word.length > 3 && !actionWords.includes(word)) {
          contextWords.add(word);
        }
      });
    });
    
    console.log('GuideMe: Context words:', Array.from(contextWords));
    
    // Check if search terms suggest an action button
    const isActionSearch = searchTerms.some(term => 
      actionWords.some(action => term.toLowerCase().includes(action))
    );
    
    for (const el of allElements) {
      if (!this.isVisible(el)) continue;
      
      const elText = this.getElementText(el).toLowerCase().trim();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const combinedText = `${elText} ${ariaLabel}`;
      
      // Skip very short or empty text
      if (elText.length < 2 && ariaLabel.length < 2) continue;
      
      let score = 0;
      let hasContextMatch = false;
      
      // First, check if element contains important context words
      for (const contextWord of contextWords) {
        if (combinedText.includes(contextWord)) {
          score += 50; // High bonus for context match
          hasContextMatch = true;
        }
      }
      
      for (const term of searchTerms) {
        const lower = term.toLowerCase();
        
        // Exact match = highest score
        if (elText === lower || ariaLabel === lower) {
          score += 100;
        }
        // Starts with = high score
        else if (elText.startsWith(lower) || ariaLabel.startsWith(lower)) {
          score += 60;
        }
        // Element text starts with a word from search term
        else if (lower.split(/\s+/).some(word => elText.startsWith(word) && word.length > 3)) {
          score += 30;
        }
        // Contains full term
        else if (combinedText.includes(lower)) {
          score += 25;
        }
        // Word overlap (but require context word to be present)
        else {
          const termWords = lower.split(/\s+/).filter(w => w.length > 2);
          const textWords = combinedText.split(/\s+/);
          const overlap = termWords.filter(tw => 
            textWords.some(ew => ew === tw || (ew.includes(tw) && tw.length > 3))
          );
          // Only count action word matches if context word is also present
          const actionOnlyMatch = overlap.every(w => actionWords.includes(w));
          if (!actionOnlyMatch || hasContextMatch) {
            score += overlap.length * 10;
          }
        }
      }
      
      // Location-based scoring
      const inHeader = el.closest('header, [role="banner"], #masthead, .Header');
      const inSidebar = el.closest('aside, nav, .sidebar, .menu, [role="navigation"], [role="complementary"]');
      const inMainContent = el.closest('main, [role="main"], .main-content, #content, article, .container');
      const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
      
      if (isActionSearch && hasContextMatch) {
        // For action buttons with context, strongly prefer main content
        if (inMainContent && isButton) {
          score += 30;
        }
        if (inHeader) {
          score -= 30; // Penalize header buttons when we have context
        }
      } else if (isActionSearch) {
        // Action without context - slightly prefer main content
        if (inMainContent && isButton) {
          score += 10;
        }
        if (inSidebar) {
          score -= 10;
        }
      }
      
      // Penalize very generic/short button text
      if (elText.length < 15 && !hasContextMatch) {
        const genericStarts = ['create', 'new', 'add', 'edit', 'delete', 'more', 'menu', 'open'];
        if (genericStarts.some(g => elText.startsWith(g)) && !contextWords.size === 0) {
          score -= 25; // Penalize generic buttons without context match
        }
      }
      
      // Penalize very generic navigation items
      const genericTerms = ['settings', 'home', 'back', 'menu', 'more', 'options'];
      if (genericTerms.includes(elText) && !searchTerms.some(t => t.toLowerCase() === elText)) {
        score -= 20;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestElement = el;
        console.log(`GuideMe: Candidate "${elText}" score: ${score} (context: ${hasContextMatch})`);
      }
    }
    
    if (bestElement && bestScore >= 20) {
      console.log('GuideMe: Best match:', this.getElementText(bestElement), 'score:', bestScore);
      return bestElement;
    }
    
    return null;
  }
}

// Initialize content script
const guideme = new GuideMeContent();

// Inject styles
const style = document.createElement('style');
style.textContent = `
  @keyframes guideme-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  
  @keyframes guideme-ripple {
    0% { width: 20px; height: 20px; opacity: 1; }
    100% { width: 80px; height: 80px; opacity: 0; }
  }

  @keyframes guideme-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  #guideme-control-panel {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 320px;
    background: white;
    border-radius: 16px;
    box-shadow: 0 10px 50px rgba(0,0,0,0.25);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }

  .guideme-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
    color: white;
    cursor: grab;
  }

  .guideme-header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .guideme-logo {
    font-weight: 700;
    font-size: 14px;
  }

  .guideme-save-btn {
    background: rgba(255,255,255,0.2);
    border: none;
    color: white;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .guideme-save-btn:hover {
    background: rgba(245, 158, 11, 0.9);
    transform: scale(1.1);
  }

  .guideme-close-btn {
    background: rgba(255,255,255,0.2);
    border: none;
    color: white;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .guideme-close-btn:hover {
    background: rgba(255,255,255,0.3);
  }

  .guideme-panel-content {
    padding: 16px;
  }

  .guideme-step-info {
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .guideme-step-number {
    display: inline-block;
    background: #EEF2FF;
    color: #4F46E5;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }

  .guideme-persist-badge {
    font-size: 14px;
    opacity: 0.7;
    cursor: help;
  }

  .guideme-instruction {
    margin: 12px 0 8px;
    font-size: 15px;
    line-height: 1.5;
    color: #1f2937;
  }

  .guideme-hint {
    margin: 0;
    font-size: 13px;
    color: #6b7280;
  }

  .guideme-panel-controls {
    display: flex;
    gap: 8px;
    padding: 0 16px 16px;
  }

  .guideme-prev-btn, .guideme-next-btn {
    flex: 1;
    padding: 10px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #f9fafb;
    color: #374151;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .guideme-prev-btn:hover:not(:disabled), .guideme-next-btn:hover:not(:disabled) {
    background: #e5e7eb;
  }

  .guideme-prev-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .guideme-next-btn {
    background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
    color: white;
    border: none;
  }

  .guideme-next-btn:hover {
    opacity: 0.9;
  }

  .guideme-progress-bar {
    height: 4px;
    background: #e5e7eb;
  }

  .guideme-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4F46E5, #7C3AED);
    transition: width 0.3s ease;
  }

  .guideme-exit-btn {
    width: calc(100% - 32px);
    margin: 0 16px 16px;
    padding: 10px 16px;
    background: transparent;
    border: 1px solid #dc2626;
    border-radius: 8px;
    color: #dc2626;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .guideme-exit-btn:hover {
    background: #dc2626;
    color: white;
  }

  @keyframes guideme-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
`;
document.head.appendChild(style);
