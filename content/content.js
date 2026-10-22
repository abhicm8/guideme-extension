// GuideMe Content Script
// Runs on every page to read DOM and inject overlay highlights

// Prevent double-injection (can happen in SPAs or when extension reloads)
if (typeof window.guideMeInstance !== 'undefined') {
  console.log('GuideMe: Content script already loaded, skipping re-initialization');
} else {

class GuideMeContent {
  constructor() {
    this.currentSteps = [];
    this.currentStepIndex = 0;
    this.completedSteps = []; // Track completed steps across pages
    this.totalStepsCompleted = 0; // Total steps done in this session
    this.isMultiPageTask = false; // Flag for multi-page tasks
    this.isSavedGuideReplay = false; // Flag for replaying saved guides (no AI)
    this.isRecordedGuide = false; // Flag for recorded guides
    this.savedGuideId = null; // ID of saved guide being played (for edit persistence)
    this.guideWasEdited = false; // Track if any edits were made during replay
    this.isFinalStepBatch = false; // Flag when AI says this is the last batch
    this.allStepsForSaving = []; // Store ALL steps for auto-save
    this.allOriginalSteps = null; // All original steps for saved guide replay
    this.originalStepIndex = 0; // Position in original steps (for multi-page)
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
    this.lastExtractedElements = {};
    this.lastDomSnapshot = null;
    this.pageIntelligence = new GuideMeRuntime.PageIntelligence(document);
    this.stepVerifier = new GuideMeRuntime.StepVerifier(this.pageIntelligence);
    this.completedStepObjects = new WeakSet();
    this.highlightController = null;
    this.actionController = null;
    this.pendingAction = null;
    this.requestVersion = 0;
    this.panelOwned = false;
    this.panelVisibleUntil = 0;
    this.panelPhase = 'idle';
    this.panelMessage = '';
    this.isPreparingTask = false;
    this.lastGuideSummary = null;
    this.lastInteraction = null;
    this.guidancePreference = 'auto';
    this.ownerTabId = null;
    this.appearanceTheme = 'light';
    this.appearanceRevision = 0;
    
    // AI request tracking - prevents highlighting stale elements while AI is processing
    this.isWaitingForAI = false;
    
    // Click processing flag - prevents double-advancement
    this.isProcessingClick = false;
    
    // SPA Navigation Detection
    this.lastUrl = window.location.href;
    this.urlCheckInterval = null;
    this.popstateHandler = null;
    this.originalPushState = null;
    this.originalReplaceState = null;

    // Voice overlay tracking (recognition runs in offscreen document)
    this.voiceOverlayVisible = false;
    
    // ========== RECORDING MODE ==========
    this.isRecording = false;
    this.recordedSteps = [];
    this.recordingStartUrl = '';
    this.recordingStartTime = null;
    this.recordingClickHandler = null;
    this.recordingInputHandler = null;
    this.recordingOverlay = null;
    
    this.init();
  }

  init() {
    this.setupAppearance();
    // Listen for messages from popup/background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    // Setup SPA navigation detection (for YouTube, Gmail, etc.)
    this.setupSPADetection();
    
    // Setup visibility change detection (for new tab scenarios)
    this.setupVisibilityDetection();
    
    // Setup keyboard shortcut (Escape to stop guide)
    this.setupKeyboardShortcuts();

    // Check for saved guide state on page load (for cross-page navigation)
    this.restoreTabGuide();
    
    // Check for active recording session (cross-page)
    this.checkForActiveRecording();
  }
  
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Escape key stops the guide
      if (e.key === 'Escape' && this.isGuideActive) {
        console.log('GuideMe: Escape pressed - stopping guide');
        this.stopGuide();
      }
    });
  }

  setupAppearance() {
    const apply = value => {
      this.appearanceTheme = value === 'dark' ? 'dark' : 'light';
      if (this.companionDock) this.companionDock.dataset.guidemeTheme = this.appearanceTheme;
    };
    const revision = this.appearanceRevision;
    chrome.storage.local.get(['appearanceTheme']).then(settings => {
      if (revision === this.appearanceRevision) apply(settings.appearanceTheme);
    }).catch(() => {});
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.appearanceTheme) {
        this.appearanceRevision++;
        apply(changes.appearanceTheme.newValue);
      }
    });
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
        if (hiddenDuration > 5000 && this.isGuideActive && !this.panelOwned) {
          // User spent significant time in another tab - likely following guide there
          // IMPORTANT: Only stop LOCAL guide instance, do NOT clear shared storage!
          // The new tab needs the saved state (allStepsForSaving, etc.)
          console.log('GuideMe: Guide likely continued in another tab, stopping LOCAL instance only');
          this.stopGuideLocalOnly();
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
    
    // The in-flight verifier owns click-triggered navigation. It checks the URL
    // and advances once; navigation detection must not race it.
    if (this.pendingAction) return;
    this.actionController?.abort();
    this.highlightController?.abort();
    this.isProcessingClick = false;
    if (this.isSavedGuideReplay) {
      this.extractDOM();
      this.highlightStep(this.currentStepIndex);
      this.showVerificationHint('The page changed. Continue with the current saved step, or use Next to confirm it.');
    } else if (this.originalTask) {
      // Unrelated navigation is not completion of the previous step.
      this.requestGuideContinuation();
    }
  }

  async restoreTabGuide() {
    const version = this.requestVersion;
    try { this.ownerTabId = (await chrome.runtime.sendMessage({ type: 'GET_GUIDEME_TAB_ID' })).tabId || null; } catch {}
    if (version !== this.requestVersion) return;
    if (this.ownerTabId) {
      try {
        const key = `guideme_summary_${this.ownerTabId}`;
        const summary = (await chrome.storage.local.get([key]))[key];
        if (version !== this.requestVersion) return;
        if (summary?.url === window.location.href) {
          this.lastGuideSummary = summary;
          this.originalTask = summary.task;
          this.completedSteps = summary.completedSteps || [];
          this.panelOwned = true;
          this.panelPhase = summary.status || 'handoff';
          this.startCompanionUpdates();
          return;
        }
      } catch {}
    }
    this.checkForSavedGuide();
  }

  guideStorageKey() {
    return this.panelOwned && this.ownerTabId ? `activeGuide_${this.ownerTabId}` : 'activeGuide';
  }

  async checkForSavedGuide() {
    const version = this.requestVersion;
    // Don't re-activate if guide is already running
    if (this.isGuideActive) {
      console.log('GuideMe: Guide already active, skipping check');
      return;
    }
    
    try {
      // Check chrome.storage first
      let guideState = null;
      const result = await chrome.storage.local.get(['activeGuide', `activeGuide_${this.ownerTabId}`]);
      if (version !== this.requestVersion || this.isGuideActive) return;
      
      const candidate = result[`activeGuide_${this.ownerTabId}`] || result.activeGuide;
      if (candidate?.panelOwned && candidate.ownerTabId && candidate.ownerTabId !== this.ownerTabId) return;
      if (candidate?.task) guideState = candidate;
      
      // Also check localStorage backup (more reliable for navigation)
      try {
        const backup = localStorage.getItem('guideme_backup');
        if (backup) {
          const backupState = JSON.parse(backup);
          // Use backup if it's newer or if we don't have chrome.storage data
          const belongsHere = !backupState.panelOwned || !backupState.ownerTabId || backupState.ownerTabId === this.ownerTabId;
          if (belongsHere && (!guideState || (backupState.savedAt > (guideState.savedAt || 0)))) {
            guideState = backupState;
          }
          // Clear the backup after reading
          if (belongsHere) this.clearGuideBackup();
        }
      } catch (e) {}
      
      // Check if guide was marked as completed - DO NOT RESUME
      if (!guideState || guideState.completed || !guideState.task) {
        console.log('GuideMe: No active guide to resume or guide completed');
        this.clearGuideState();
        return;
      }
      
      // Check if state is expired (2 minutes - reduced to prevent stale resumptions)
      const stateAge = Date.now() - (guideState.savedAt || 0);
      const MAX_AGE = 2 * 60 * 1000; // 2 minutes - reduced from 5
      
      if (stateAge > MAX_AGE) {
        console.log('GuideMe: Saved state expired after 2 minutes, clearing...');
        this.clearGuideState();
        return;
      }
      
      // Check if this is a BACK navigation (not forward)
      // Back navigation should NOT auto-resume - causes confusion
      const navEntries = performance.getEntriesByType('navigation');
      const navType = navEntries.length > 0 ? navEntries[0].type : null;
      
      if (navType === 'back_forward') {
        console.log('GuideMe: Back/forward navigation detected, clearing guide');
        this.clearGuideState();
        return;
      }
      
      // Check if this is a fresh page load (reload or direct navigation) - don't resume
      if (navType === 'reload') {
        console.log('GuideMe: Page reload detected, clearing guide');
        this.clearGuideState();
        return;
      }
      
      // Also check our visited URL tracking
      const isBackNavigation = this.wasUrlVisited(window.location.href);
      if (isBackNavigation && !guideState.remainingSteps?.length) {
        console.log('GuideMe: Back navigation detected (URL visited before), not auto-resuming');
        this.clearGuideState();
        return;
      }
      
      console.log('GuideMe: Found saved guide task:', guideState.task);
      console.log('GuideMe: Remaining steps:', guideState.remainingSteps?.length || 0);
      console.log('GuideMe: Restored allStepsForSaving:', guideState.allStepsForSaving?.length || 0);
      console.log('GuideMe: Restored continuationCount:', guideState.continuationCount || 0);
      console.log('GuideMe: Restored savedGuideId:', guideState.savedGuideId || 'none');
      
      this.panelOwned = guideState.panelOwned || false;
      this.startCompanionUpdates();
      this.isFinalStepBatch = guideState.isFinalStepBatch || false;
      this.originalTask = guideState.task;
      this.highlightColor = guideState.highlightColor || '#4F46E5';
      this.completedSteps = guideState.completedSteps || [];
      this.isSavedGuideReplay = guideState.isSavedGuideReplay || false;
      this.isRecordedGuide = guideState.isRecordedGuide || false;
      this.savedGuideId = guideState.savedGuideId || null; // Restore guide ID for editing!
      this.guideWasEdited = guideState.guideWasEdited || false; // Restore edit tracking
      this.allStepsForSaving = guideState.allStepsForSaving || [];
      this.visitedUrls = guideState.visitedUrls || [];
      
      // Restore full step list for recorded/saved guides
      this.allOriginalSteps = guideState.allOriginalSteps || null;
      this.originalStepIndex = guideState.originalStepIndex || 0;
      
      // IMPORTANT: Restore multi-page tracking state
      this.totalStepsCompleted = guideState.totalStepsCompleted || (this.allStepsForSaving?.length || 0);
      this.continuationCount = guideState.continuationCount || 0;
      this.isMultiPageTask = guideState.isMultiPageTask || false;
      
      // Mark current URL as visited
      this.markUrlVisited(window.location.href);
      
      // Wait for page to be fully interactive
      await this.waitForPageReady();
      if (version !== this.requestVersion || this.isGuideActive) return;
      
      // Check if we have remaining steps
      if (guideState.remainingSteps && guideState.remainingSteps.length > 0) {
        console.log('GuideMe: Continuing with', guideState.remainingSteps.length, 'remaining steps');
        console.log('GuideMe: isSavedGuideReplay:', this.isSavedGuideReplay, 'isRecordedGuide:', this.isRecordedGuide);
        this.extractDOM();
        this.currentSteps = guideState.remainingSteps;
        this.currentStepIndex = 0;
        this.isMultiPageTask = true;
        this.startGuide();
        const pending = guideState.pendingAction;
        if (pending && pending.fromUrl !== window.location.href &&
            (!pending.step.expectedResult || pending.step.expectedResult.type === 'url-changed')) {
          this.pendingAction = { step: this.currentSteps[0], robustSelectors: pending.robustSelectors, index: 0, before: { url: pending.fromUrl } };
          this.nextStep('verified');
        } else if (pending) {
          this.showVerificationHint('The page changed. Check the result, then use Next to confirm this step.');
        }
        this.saveGuideState();
      } else if (!this.isSavedGuideReplay) {
        // Live AI guide needs continuation - set waiting flag first
        console.log('GuideMe: Requesting AI for new page (continuation:', this.continuationCount, ')');
        this.isMultiPageTask = true;
        this.isWaitingForAI = true; // Prevent stale highlights
        this.requestGuideContinuation();
      } else {
        // Saved/recorded guide with no remaining steps = complete
        console.log('GuideMe: Saved guide completed (all steps done)');
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

  trackStepCompletion(verification = 'manual') {
    const step = this.currentSteps[this.currentStepIndex];
    if (!step) return;
    if (this.isSavedGuideReplay && this.allOriginalSteps) {
      this.originalStepIndex = this.allOriginalSteps.length - this.currentSteps.length + this.currentStepIndex + 1;
    }
    if (this.completedStepObjects.has(step)) return;
    this.completedStepObjects.add(step);
    const pending = this.pendingAction?.step === step ? this.pendingAction : null;
    const element = pending?.element || this.currentHighlightedElement;
    const robustSelectors = pending?.robustSelectors || (element?.isConnected ? this.generateRobustSelectors(element) : step.robustSelectors);
    const captured = {
      ...step,
      robustSelectors,
      verification,
      pageUrl: pending?.before?.url || window.location.href,
      completedAt: Date.now(),
      resultUrl: window.location.href
    };
    this.completedSteps.push(captured);
    if (!this.isSavedGuideReplay) this.allStepsForSaving.push(captured);
  }

  async saveStateForNavigation() {
    // Compatibility entry point. Only verified/confirmed steps are consumed.
    return this.saveGuideState();
  }

  async requestGuideContinuation() {
    const version = ++this.requestVersion;
    const task = this.originalTask;
    const pageUrl = window.location.href;
    if (!task) return;
    this.actionController?.abort();
    this.highlightController?.abort();
    this.isRevealingTarget = false;
    this.isProcessingClick = false;
    this.pendingAction = null;
    this.continuationCount = (this.continuationCount || 0) + 1;
    const isCurrent = () => version === this.requestVersion && task === this.originalTask && pageUrl === window.location.href;
    // IMPORTANT: Set flag to prevent stale element highlighting
    this.lastGuideSummary = null;
    if (this.ownerTabId) chrome.storage.local.remove([`guideme_summary_${this.ownerTabId}`]).catch(() => {});
    this.isWaitingForAI = true;
    this.saveGuideState();
    
    // Clear any existing highlights before showing loading
    this.clearHighlights();
    this.currentHighlightedElement = null;
    
    // Show loading state
    this.showContinuationLoading();
    
    console.log('GuideMe: requestGuideContinuation - current allStepsForSaving:', (this.allStepsForSaving || []).length);
    
    try {
      // Get current page DOM
      const dom = this.extractDOM();
      this.lastDomSnapshot = dom;
      
      // Ask background to continue the guide
      const response = await chrome.runtime.sendMessage({
        type: 'CONTINUE_GUIDE',
        payload: {
          task: this.originalTask,
          completedSteps: this.completedSteps,
          guidancePreference: this.guidancePreference,
          dom: dom,
          url: window.location.href,
          title: document.title
        }
      });
      
      if (!isCurrent()) return;
      console.log('GuideMe: requestGuideContinuation response:', {
        hasSteps: !!(response.steps && response.steps.length),
        stepCount: response.steps?.length || 0,
        completed: response.completed,
        error: response.error
      });
      
      if (response.error) {
        console.error('GuideMe: Continuation failed:', response.error);
        this.isWaitingForAI = false; // Clear flag on error
        this.showContinuationError(response.error);
        return;
      }
      
      // IMPORTANT: Check for steps FIRST before checking completed flag
      if (response.steps && response.steps.length > 0) {
        this.hideContinuationLoading();
        this.isWaitingForAI = false; // Clear flag - ready to highlight new elements
        this.currentSteps = response.steps;
        this.currentStepIndex = 0;
        this.isFinalStepBatch = response.completed === true;
        console.log('GuideMe: Got', response.steps.length, 'steps, isFinalBatch:', this.isFinalStepBatch);
        this.startGuide();
        this.saveGuideState();
      } else {
        await this.finishGuidance(response);
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('GuideMe: Failed to continue guide:', error);
      this.isWaitingForAI = false; // Clear flag on error
      this.showContinuationError(error.message);
    }
  }

  showContinuationLoading() {
    this.panelPhase = 'planning';
    this.panelMessage = '';
    this.updateCompanionUI();
    if (this.panelOwned) return;
    this.hideContinuationLoading();
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
    this.panelPhase = 'error';
    this.panelMessage = message;
    this.updateCompanionUI();
    if (this.panelOwned) return;
    this.hideContinuationLoading();
    console.error('GuideMe: Could not continue guide:', message);
    
    // DON'T clear state - show retry UI instead
    // Model/provider messages are text, never markup.
    document.getElementById('guideme-error-panel')?.remove();
    const panel = document.createElement('div');
    panel.id = 'guideme-error-panel';
    const isRateLimit = message.toLowerCase().includes('rate') || message.toLowerCase().includes('limit') || message.toLowerCase().includes('quota');
    
    panel.innerHTML = `
      <div style="position:fixed;bottom:20px;right:20px;background:#1f2937;color:white;padding:20px 24px;border-radius:16px;font-family:system-ui;z-index:2147483647;box-shadow:0 10px 40px rgba(0,0,0,0.4);max-width:320px;">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;">
          <span style="font-size:24px;">${isRateLimit ? '⏳' : '⚠️'}</span>
          <div>
            <div style="font-weight:600;margin-bottom:4px;">${isRateLimit ? 'API Rate Limited' : 'Connection Issue'}</div>
            <div class="guideme-error-message" style="font-size:13px;opacity:0.8;"></div>
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
    panel.querySelector('.guideme-error-message').textContent = isRateLimit ? 'Too many requests. Wait 10-15 seconds.' : message;
    document.body.appendChild(panel);
    
    // Bind events
    document.getElementById('guideme-retry-btn').addEventListener('click', () => {
      panel.remove();
      this.requestGuideContinuation();
    });
    document.getElementById('guideme-cancel-btn').addEventListener('click', () => {
      panel.remove();
      this.stopGuide();
    });
  }

  async showTaskCompleted() {
    this.hideContinuationLoading();
    if (!this.controlPanel) this.createControlPanel();
    return this.showFinalCompletion();
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
      // IMPORTANT: Enhance steps with robust selectors before saving
      // This ensures saved guides can find elements even when gm-* IDs change
      const enhancedSteps = this.enhanceStepsForSaving(this.allStepsForSaving || this.currentSteps);
      
      console.log('GuideMe: Saving guide with', enhancedSteps.length, 'enhanced steps');
      
      // Send save request to background
      await chrome.runtime.sendMessage({
        type: 'SAVE_MACRO',
        payload: {
          name: name,
          task: this.originalTask,
          steps: enhancedSteps,
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

  // Enhance steps with multiple robust selectors for reliable replay
  enhanceStepsForSaving(steps) {
    if (!steps || !Array.isArray(steps)) return [];
    
    return steps.map((step, index) => {
      const enhanced = { ...step };
      const elementId = step.element || step.selector;
      
      // Try to find the actual element to extract robust selectors
      let element = null;
      if (elementId && elementId.startsWith('gm-')) {
        element = this.pageIntelligence.elements.get(elementId);
      }
      
      if (element?.isConnected) {
        // Generate multiple fallback selectors
        enhanced.robustSelectors = this.generateRobustSelectors(element);
        console.log(`GuideMe: Step ${index + 1} enhanced with selectors:`, enhanced.robustSelectors);
      } else if (!enhanced.robustSelectors) {
        // Element not in current DOM - use text-based fallback
        enhanced.robustSelectors = {
          description: step.description || step.instruction || '',
          keywords: this.extractKeywords(step.description || step.instruction || '')
        };
      }
      
      // Keep original element reference too
      enhanced.originalElement = elementId;
      
      return enhanced;
    });
  }

  // Generate multiple selectors for an element (for robust replay)
  // Generate a stable CSS selector that doesn't rely on dynamic IDs
  generateStableSelector(element) {
    try {
      // Try data-testid first
      const testId = element.dataset?.testid || element.getAttribute('data-test-id');
      if (testId) return `[data-testid="${testId}"]`;
      
      // Try aria-label
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.length < 50) {
        return `${element.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
      }
      
      // Try name attribute
      if (element.name) {
        return `${element.tagName.toLowerCase()}[name="${element.name}"]`;
      }
      
      // Try stable ID (not dynamic-looking)
      if (element.id && !element.id.match(/[0-9]{4,}/) && !element.id.match(/^:r/)) {
        return `#${element.id}`;
      }
      
      // Try role + text combo
      const role = element.getAttribute('role');
      const text = this.getElementText(element)?.substring(0, 30)?.trim();
      if (role && text) {
        return `[role="${role}"]`;  // Will combine with text search
      }
      
      // Build path selector as last resort
      return this.buildPathSelector(element);
    } catch (e) {
      return null;
    }
  }

  buildPathSelector(element, maxDepth = 3) {
    const path = [];
    let current = element;
    let depth = 0;
    
    while (current && current !== document.body && depth < maxDepth) {
      let selector = current.tagName.toLowerCase();
      
      // Add distinguishing attributes
      if (current.getAttribute('role')) {
        selector += `[role="${current.getAttribute('role')}"]`;
      } else if (current.className && typeof current.className === 'string') {
        const stableClasses = current.className.split(' ')
          .filter(c => c && !c.match(/^[a-z]{1,3}[A-Z0-9]/) && !c.match(/[0-9]{4,}/))
          .slice(0, 2);
        if (stableClasses.length) {
          selector += '.' + stableClasses.join('.');
        }
      }
      
      path.unshift(selector);
      current = current.parentElement;
      depth++;
    }
    
    return path.join(' > ');
  }

  getElementPosition(element) {
    try {
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let horizontal = 'center';
      if (rect.left < viewportWidth * 0.33) horizontal = 'left';
      else if (rect.right > viewportWidth * 0.67) horizontal = 'right';
      
      let vertical = 'middle';
      if (rect.top < viewportHeight * 0.33) vertical = 'top';
      else if (rect.bottom > viewportHeight * 0.67) vertical = 'bottom';
      
      return `${vertical}-${horizontal}`;
    } catch (e) {
      return null;
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
    if (!this.originalTask) return;
    const pending = this.pendingAction;
    const guideState = {
      task: this.originalTask,
      steps: this.currentSteps,
      currentStepIndex: this.currentStepIndex,
      highlightColor: this.highlightColor,
      completedSteps: this.completedSteps,
      pageUrl: window.location.href,
      savedAt: Date.now(),
      remainingSteps: this.currentSteps.slice(this.currentStepIndex + (this.completedStepObjects.has(this.currentSteps[this.currentStepIndex]) ? 1 : 0)),
      pendingAction: pending ? {
        fromUrl: pending.before.url,
        step: pending.step,
        robustSelectors: pending.robustSelectors
      } : null,
      isSavedGuideReplay: this.isSavedGuideReplay,
      isRecordedGuide: this.isRecordedGuide,
      savedGuideId: this.savedGuideId,
      guideWasEdited: this.guideWasEdited,
      allOriginalSteps: this.allOriginalSteps,
      originalStepIndex: this.originalStepIndex,
      allStepsForSaving: this.allStepsForSaving,
      visitedUrls: this.visitedUrls,
      totalStepsCompleted: this.allStepsForSaving.length,
      continuationCount: this.continuationCount || 0,
      isMultiPageTask: this.isMultiPageTask,
      isFinalStepBatch: this.isFinalStepBatch,
      panelOwned: this.panelOwned,
      ownerTabId: this.ownerTabId
    };
    // Write the full checkpoint synchronously before navigation can unload us.
    try { localStorage.setItem('guideme_backup', JSON.stringify(guideState)); } catch {}
    try { await chrome.storage.local.set({ [this.guideStorageKey()]: guideState }); }
    catch (error) { console.error('GuideMe: Failed to save guide state', error); }
  }

  clearGuideBackup() {
    try {
      const backup = JSON.parse(localStorage.getItem('guideme_backup') || 'null');
      if (!backup?.panelOwned || !backup.ownerTabId || backup.ownerTabId === this.ownerTabId) localStorage.removeItem('guideme_backup');
    } catch {}
  }

  async clearGuideState() {
    try {
      // Set completed flag BEFORE removing, in case of race conditions
      await chrome.storage.local.set({ 
        [this.guideStorageKey()]: { completed: true, clearedAt: Date.now() }
      });
      // Then remove completely
      await chrome.storage.local.remove([this.guideStorageKey()]);
      // Also clear localStorage backup
      try {
        this.clearGuideBackup();
      } catch (e) {}
      console.log('GuideMe: Guide state cleared completely');
    } catch (error) {
      console.error('GuideMe: Failed to clear guide state', error);
    }
  }

  handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'SET_PANEL_VISIBILITY':
        this.panelOwned = true;
        this.panelVisibleUntil = message.visible ? Date.now() + 3000 : 0;
        this.startCompanionUpdates();
        this.updateCompanionUI();
        sendResponse({ success: true });
        break;

      case 'PREPARE_GUIDE_TASK':
        this.stopGuide();
        this.panelOwned = true;
        this.isPreparingTask = true;
        this.panelPhase = 'planning';
        this.lastGuideSummary = null;
        this.originalTask = message.task;
        this.guidancePreference = 'auto';
        this.startCompanionUpdates();
        this.updateCompanionUI();
        sendResponse({ success: true });
        break;

      case 'GUIDE_TASK_ERROR':
        this.isPreparingTask = false;
        this.panelPhase = 'error';
        this.panelMessage = message.error;
        this.updateCompanionUI();
        sendResponse({ success: true });
        break;

      case 'SHOW_GUIDE_OUTCOME':
        this.panelOwned = true;
        this.ownerTabId ||= message.payload.tabId || null;
        this.originalTask = message.payload.task || this.originalTask;
        this.finishGuidance(message.payload).then(() => sendResponse({ success: true })).catch(error => sendResponse({ error: error.message }));
        break;

      case 'DISMISS_GUIDE_OUTCOME':
        this.lastGuideSummary = null;
        this.panelPhase = 'idle';
        if (this.ownerTabId) chrome.storage.local.remove([`guideme_summary_${this.ownerTabId}`]).catch(() => {});
        sendResponse({ success: true });
        break;

      case 'REFRESH_GUIDE':
        if (message.preferSteps) this.guidancePreference = 'step-by-step';
        this.refreshAndReHighlight();
        sendResponse({ success: true });
        break;

      case 'GET_DOM':
        sendResponse(this.extractDOM());
        break;
      
      case 'START_GUIDE':
        this.isPreparingTask = false;
        this.lastGuideSummary = null;
        this.panelOwned = message.payload.presentationMode === 'sidepanel' || this.panelOwned;
        this.panelMessage = '';
        this.panelPhase = 'locating';
        this.startCompanionUpdates();
        this.requestVersion++;
        this.removeEventListeners();
        this.isWaitingForAI = false;
        this.isRevealingTarget = false;
        this.completedStepObjects = new WeakSet();
        this.completedSteps = [];
        this.totalStepsCompleted = 0;
        this.currentSteps = message.payload.steps;
        this.highlightColor = message.payload.highlightColor || '#4F46E5';
        this.currentStepIndex = 0;
        this.originalTask = message.payload.task || '';
        this.isSavedGuideReplay = message.payload.isMacro || message.payload.isSavedGuide || false;
        this.isRecordedGuide = message.payload.isRecorded || false;
        this.savedGuideId = message.payload.guideId || null; // Store guide ID for editing
        this.guideWasEdited = false; // Reset edit flag for new guide
        // CRITICAL: Use the isFinalStepBatch from AI response - tells us if single-page task
        this.isFinalStepBatch = message.payload.isFinalStepBatch || false;
        // Reset multi-page flag - will be set to true only if we actually continue to next page
        this.isMultiPageTask = false;
        
        console.log('GuideMe: START_GUIDE received');
        console.log('GuideMe: guideId:', this.savedGuideId);
        console.log('GuideMe: isSavedGuideReplay:', this.isSavedGuideReplay);
        console.log('GuideMe: isFinalStepBatch:', this.isFinalStepBatch);
        
        // For saved/recorded guides, store ALL original steps for multi-page navigation
        // IMPORTANT: Deep copy each step to prevent shared references
        if (this.isSavedGuideReplay) {
          this.allOriginalSteps = message.payload.steps.map(step => ({...step}));
          // Also ensure currentSteps is a deep copy to prevent cross-contamination
          this.currentSteps = message.payload.steps.map(step => ({...step}));
          this.originalStepIndex = 0; // Reset position tracking
          console.log('GuideMe: Stored all', this.allOriginalSteps.length, 'original steps for replay (deep copied)');
        } else {
          this.allOriginalSteps = null;
          this.originalStepIndex = 0;
        }
        
        // IMPORTANT: Start with EMPTY allStepsForSaving
        // Steps will be added WITH robust selectors as user completes them
        // This ensures we capture actual DOM selectors, not just gm-* IDs
        this.allStepsForSaving = [];
        
        console.log('GuideMe: Starting guide with', this.currentSteps.length, 'steps');
        console.log('GuideMe: Is saved guide replay:', this.isSavedGuideReplay);
        console.log('GuideMe: Is recorded guide:', this.isRecordedGuide);
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
      
      case 'ADVANCE_GUIDE':
        this.nextStep('manual');
        sendResponse({ success: true });
        break;

      case 'PREVIOUS_GUIDE_STEP':
        this.prevStep();
        sendResponse({ success: true });
        break;

      case 'HIGHLIGHT_STEP':
        this.actionController?.abort();
        this.pendingAction = null;
        this.isProcessingClick = false;
        this.currentStepIndex = message.payload.stepIndex;
        this.highlightColor = message.payload.highlightColor || this.highlightColor;
        this.highlightStep(this.currentStepIndex);
        this.updateControlPanel();
        this.saveGuideState(); // Save updated step
        sendResponse({ success: true });
        break;
      
      case 'UPDATE_STEPS':
        this.actionController?.abort();
        this.pendingAction = null;
        this.isProcessingClick = false;
        // Update steps from popup (after edit/delete)
        if (message.payload.steps) {
          // For saved guide replays, the popup sends ALL original steps
          // We should update allOriginalSteps (full guide) but be careful with currentSteps
          if (this.isSavedGuideReplay && this.allOriginalSteps) {
            // Update the full guide array
            this.allOriginalSteps = [...message.payload.steps];
            
            // Update currentSteps based on our position
            // If we're mid-guide, currentSteps might be a subset
            // Rebuild currentSteps from allOriginalSteps starting at originalStepIndex
            const startIdx = this.originalStepIndex || 0;
            this.currentSteps = this.allOriginalSteps.slice(startIdx);
            
            console.log('GuideMe: Updated allOriginalSteps from popup, total:', this.allOriginalSteps.length);
            console.log('GuideMe: Rebuilt currentSteps starting at', startIdx, ', count:', this.currentSteps.length);
          } else {
            // Non-saved guide or simple case
            this.currentSteps = message.payload.steps;
          }
        }
        if (typeof message.payload.currentStepIndex === 'number') {
          // For saved guide replays, we need to adjust the index
          // The popup sends the index into allOriginalSteps
          // We need the index into currentSteps
          if (this.isSavedGuideReplay && this.originalStepIndex) {
            const fullIndex = message.payload.currentStepIndex;
            const localIndex = fullIndex - this.originalStepIndex;
            this.currentStepIndex = Math.max(0, localIndex);
            console.log('GuideMe: Adjusted currentStepIndex from', fullIndex, 'to', this.currentStepIndex);
          } else {
            this.currentStepIndex = message.payload.currentStepIndex;
          }
        }
        // Mark that edits were made (from popup)
        if (message.payload.wasEdited) {
          this.guideWasEdited = true;
          console.log('GuideMe: Marked guide as edited from popup');
        }
        this.updateControlPanel();
        this.highlightStep(this.currentStepIndex);
        this.saveGuideState();
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
        // For saved guides, return allOriginalSteps (complete guide) + current position info
        sendResponse({
          task: this.originalTask,
          activity: this.getPanelActivity(),
          completedSteps: this.completedSteps.map(step => ({ description: step.description, verification: step.verification, completedAt: step.completedAt })),
          lastInteraction: this.lastInteraction,
          lastGuideSummary: this.lastGuideSummary,
          formContext: this.getFormContext(),
          pageStats: this.lastDomSnapshot ? { elements: this.lastDomSnapshot.elements.length, truncated: this.lastDomSnapshot.truncated } : null,
          isGuideActive: this.isGuideActive,
          isWaitingForAI: this.isWaitingForAI,
          isFinalStepBatch: this.isFinalStepBatch,
          steps: this.currentSteps,
          allOriginalSteps: this.allOriginalSteps || null, // Full guide for proper editing
          currentStepIndex: this.currentStepIndex,
          originalStepIndex: this.originalStepIndex || 0, // Position in full guide
          url: window.location.href,
          savedGuideId: this.savedGuideId || null,
          isSavedGuideReplay: this.isSavedGuideReplay || false,
          isRecordedGuide: this.isRecordedGuide || false
        });
        break;
      
      // ========== RECORDING MODE MESSAGES ==========
      case 'START_RECORDING':
        this.startRecording();
        sendResponse({ success: true });
        break;
        
      case 'STOP_RECORDING':
        const recordedData = this.stopRecording();
        sendResponse({ success: true, data: recordedData });
        break;
        
      case 'GET_RECORDING_STATUS':
        sendResponse({ 
          isRecording: this.isRecording,
          stepCount: this.recordedSteps.length,
          startUrl: this.recordingStartUrl
        });
        break;
        
      case 'PAUSE_RECORDING':
        this.pauseRecording();
        sendResponse({ success: true });
        break;
        
      case 'RESUME_RECORDING':
        this.resumeRecording();
        sendResponse({ success: true });
        break;
      
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  // ========== GUIDE RECORDING MODE ==========
  // Record user actions to create perfect guides with real selectors
  
  async checkForActiveRecording() {
    try {
      const result = await chrome.storage.local.get(['activeRecording']);
      if (result.activeRecording && result.activeRecording.isRecording) {
        console.log('GuideMe: Found active recording session, resuming...');
        this.recordedSteps = result.activeRecording.steps || [];
        this.recordingStartUrl = result.activeRecording.startUrl;
        this.recordingStartTime = result.activeRecording.startTime;
        this.isRecording = true;
        
        // Mark page navigation as a step
        if (this.recordedSteps.length > 0) {
          const lastStep = this.recordedSteps[this.recordedSteps.length - 1];
          if (lastStep.causesNavigation && window.location.href !== lastStep.pageUrl) {
            // We navigated! Record the new page context
            console.log('GuideMe: Page changed during recording');
          }
        }
        
        this.setupRecordingListeners();
        this.showRecordingOverlay();
      }
    } catch (e) {
      console.log('GuideMe: No active recording to resume');
    }
  }
  
  startRecording() {
    if (this.isRecording) {
      console.log('GuideMe: Already recording');
      return;
    }
    
    // Stop any active guide
    if (this.isGuideActive) {
      this.stopGuide();
    }
    
    console.log('GuideMe: 🔴 Starting recording mode');
    this.isRecording = true;
    this.recordedSteps = [];
    this.recordingStartUrl = window.location.href;
    this.recordingStartTime = Date.now();
    
    // Save recording state for cross-page persistence
    this.saveRecordingState();
    
    // Setup event listeners
    this.setupRecordingListeners();
    
    // Show recording indicator
    this.showRecordingOverlay();
  }
  
  setupRecordingListeners() {
    // Click handler - capture all clicks
    this.recordingClickHandler = (e) => {
      if (!this.isRecording) return;
      
      // Ignore clicks on our own overlay
      if (e.target.closest('#guideme-recording-overlay')) return;
      if (e.target.closest('#guideme-control-panel')) return;
      
      const element = e.target;
      
      // Check if this click will cause navigation
      const isLink = element.closest('a[href]');
      const isSubmit = element.closest('button[type="submit"], input[type="submit"]');
      const willNavigate = !!(isLink && !isLink.href.startsWith('javascript:') && !isLink.href.startsWith('#'));
      
      // Generate robust selectors for this element
      const selectors = this.generateRobustSelectors(element);
      const elementText = this.getElementText(element);
      
      // Determine action type
      let actionType = 'click';
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
        actionType = 'focus'; // We'll capture the value on blur/change
      }
      
      const step = {
        id: this.recordedSteps.length + 1,
        action: actionType,
        description: this.generateStepDescription(element, actionType),
        element: element.tagName.toLowerCase(),
        text: elementText?.substring(0, 60) || '',
        robustSelectors: selectors,
        pageUrl: window.location.href,
        pageTitle: document.title,
        timestamp: Date.now(),
        causesNavigation: willNavigate,
        viewport: {
          x: e.clientX,
          y: e.clientY
        }
      };
      
      console.log('GuideMe: 📍 Recorded step', step.id, '-', step.description);
      this.recordedSteps.push(step);
      
      // Update overlay
      this.updateRecordingOverlay();
      
      // Save state (for cross-page)
      if (willNavigate) {
        this.saveRecordingState();
      } else {
        // Debounce saves for non-navigation clicks
        clearTimeout(this.recordingSaveTimeout);
        this.recordingSaveTimeout = setTimeout(() => this.saveRecordingState(), 500);
      }
    };
    
    // Input handler - capture text input
    this.recordingInputHandler = (e) => {
      if (!this.isRecording) return;
      
      const element = e.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
      
      // Ignore password fields for privacy
      if (element.type === 'password') {
        console.log('GuideMe: Skipping password field for privacy');
        return;
      }
      
      // Check if we already have a focus step for this element
      const existingStepIndex = this.recordedSteps.findIndex(s => 
        s.action === 'focus' && 
        s.robustSelectors?.name === element.name &&
        s.pageUrl === window.location.href
      );
      
      const value = element.value;
      const selectors = this.generateRobustSelectors(element);
      
      if (existingStepIndex >= 0) {
        // Update existing step with the typed value
        this.recordedSteps[existingStepIndex].action = element.tagName === 'SELECT' ? 'select' : 'type';
        this.recordedSteps[existingStepIndex].value = value;
        this.recordedSteps[existingStepIndex].description = this.generateStepDescription(element, 'type', value);
      } else {
        // Create new input step
        const step = {
          id: this.recordedSteps.length + 1,
          action: element.tagName === 'SELECT' ? 'select' : 'type',
          description: this.generateStepDescription(element, 'type', value),
          element: element.tagName.toLowerCase(),
          value: value,
          robustSelectors: selectors,
          pageUrl: window.location.href,
          pageTitle: document.title,
          timestamp: Date.now()
        };
        
        console.log('GuideMe: ⌨️ Recorded input -', step.description);
        this.recordedSteps.push(step);
      }
      
      this.updateRecordingOverlay();
      this.saveRecordingState();
    };
    
    // Add listeners
    document.addEventListener('click', this.recordingClickHandler, true);
    document.addEventListener('change', this.recordingInputHandler, true);
    document.addEventListener('blur', this.recordingInputHandler, true);
    
    console.log('GuideMe: Recording listeners attached');
  }
  
  generateStepDescription(element, action, value = null) {
    const text = this.getElementText(element)?.substring(0, 40) || '';
    const tag = element.tagName.toLowerCase();
    const type = element.type || '';
    const placeholder = element.placeholder || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const name = element.name || '';
    
    // Determine what to call this element
    let elementName = text || ariaLabel || placeholder || name || tag;
    elementName = elementName.trim();
    
    if (action === 'click') {
      if (tag === 'button' || element.getAttribute('role') === 'button') {
        return `Click the "${elementName}" button`;
      } else if (tag === 'a') {
        return `Click the "${elementName}" link`;
      } else if (tag === 'input' && type === 'checkbox') {
        return element.checked ? `Check "${elementName}"` : `Uncheck "${elementName}"`;
      } else if (tag === 'input' && type === 'radio') {
        return `Select "${elementName}" option`;
      } else if (element.getAttribute('role') === 'tab') {
        return `Click the "${elementName}" tab`;
      } else if (element.getAttribute('role') === 'menuitem') {
        return `Click "${elementName}" in the menu`;
      } else {
        return `Click on "${elementName}"`;
      }
    } else if (action === 'type' || action === 'input') {
      if (value) {
        const displayValue = value.length > 20 ? value.substring(0, 20) + '...' : value;
        return `Type "${displayValue}" in the ${elementName || 'input field'}`;
      }
      return `Enter text in the ${elementName || 'input field'}`;
    } else if (action === 'select') {
      return `Select "${value || 'option'}" from ${elementName || 'dropdown'}`;
    } else if (action === 'focus') {
      return `Click on the ${elementName || 'input field'}`;
    }
    
    return `Interact with ${elementName || 'element'}`;
  }
  
  removeRecordingListeners() {
    if (this.recordingClickHandler) {
      document.removeEventListener('click', this.recordingClickHandler, true);
      this.recordingClickHandler = null;
    }
    if (this.recordingInputHandler) {
      document.removeEventListener('change', this.recordingInputHandler, true);
      document.removeEventListener('blur', this.recordingInputHandler, true);
      this.recordingInputHandler = null;
    }
  }
  
  stopRecording() {
    if (!this.isRecording) {
      return { steps: [], startUrl: '' };
    }
    
    console.log('GuideMe: ⏹️ Stopping recording -', this.recordedSteps.length, 'steps captured');
    
    this.isRecording = false;
    this.removeRecordingListeners();
    this.hideRecordingOverlay();
    
    // Clear saved state
    chrome.storage.local.remove(['activeRecording']);
    
    const result = {
      steps: this.recordedSteps,
      startUrl: this.recordingStartUrl,
      duration: Date.now() - this.recordingStartTime,
      endUrl: window.location.href
    };
    
    // Reset
    this.recordedSteps = [];
    this.recordingStartUrl = '';
    this.recordingStartTime = null;
    
    return result;
  }
  
  pauseRecording() {
    if (!this.isRecording) return;
    this.removeRecordingListeners();
    this.updateRecordingOverlay('paused');
    console.log('GuideMe: ⏸️ Recording paused');
  }
  
  resumeRecording() {
    if (!this.isRecording) return;
    this.setupRecordingListeners();
    this.updateRecordingOverlay();
    console.log('GuideMe: ▶️ Recording resumed');
  }
  
  async saveRecordingState() {
    try {
      await chrome.storage.local.set({
        activeRecording: {
          isRecording: this.isRecording,
          steps: this.recordedSteps,
          startUrl: this.recordingStartUrl,
          startTime: this.recordingStartTime
        }
      });
    } catch (e) {
      console.error('GuideMe: Failed to save recording state', e);
    }
  }
  
  showRecordingOverlay() {
    this.hideRecordingOverlay();
    
    const overlay = document.createElement('div');
    overlay.id = 'guideme-recording-overlay';
    overlay.innerHTML = `
      <div class="guideme-recording-badge">
        <div class="guideme-recording-dot"></div>
        <span class="guideme-recording-text">Recording</span>
        <span class="guideme-recording-count">0 steps</span>
        <button class="guideme-recording-stop" title="Stop recording">⏹</button>
      </div>
      <style>
        #guideme-recording-overlay {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          animation: guideme-slide-in 0.3s ease;
        }
        
        @keyframes guideme-slide-in {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        
        .guideme-recording-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
          color: white;
          padding: 10px 16px;
          border-radius: 24px;
          box-shadow: 0 4px 20px rgba(220, 38, 38, 0.4);
          font-size: 14px;
          font-weight: 600;
        }
        
        .guideme-recording-dot {
          width: 10px;
          height: 10px;
          background: white;
          border-radius: 50%;
          animation: guideme-pulse-dot 1s ease-in-out infinite;
        }
        
        @keyframes guideme-pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
        
        .guideme-recording-count {
          background: rgba(255,255,255,0.2);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
        }
        
        .guideme-recording-stop {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: background 0.2s;
        }
        
        .guideme-recording-stop:hover {
          background: rgba(255,255,255,0.3);
        }
        
        .guideme-recording-badge.paused {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          box-shadow: 0 4px 20px rgba(245, 158, 11, 0.4);
        }
        
        .guideme-recording-badge.paused .guideme-recording-dot {
          animation: none;
          background: #fef3c7;
        }
        
        .guideme-recording-badge.paused .guideme-recording-text::after {
          content: ' (Paused)';
        }
      </style>
    `;
    
    document.body.appendChild(overlay);
    this.recordingOverlay = overlay;
    
    // Bind stop button
    overlay.querySelector('.guideme-recording-stop').addEventListener('click', async () => {
      const data = this.stopRecording();
      
      // Store completed recording in storage so popup can retrieve it
      await chrome.storage.local.set({ 
        completedRecording: {
          ...data,
          completedAt: Date.now()
        }
      });
      
      // Show completion notification
      this.showRecordingCompleteNotification(data.steps.length);
      
      // Notify popup that recording stopped (if open)
      try {
        await chrome.runtime.sendMessage({ 
          type: 'RECORDING_STOPPED', 
          payload: data 
        });
      } catch (e) {
        // Popup might be closed - data is in storage
        console.log('GuideMe: Recording saved to storage, open popup to save guide');
      }
    });
  }
  
  showRecordingCompleteNotification(stepCount) {
    const notification = document.createElement('div');
    notification.id = 'guideme-recording-complete';
    notification.innerHTML = `
      <div class="guideme-complete-badge">
        <span class="guideme-complete-icon">✓</span>
        <div class="guideme-complete-text">
          <strong>${stepCount} steps recorded!</strong>
          <span>Open GuideMe extension to save your guide</span>
        </div>
      </div>
      <style>
        #guideme-recording-complete {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          animation: guideme-slide-in 0.3s ease;
        }
        
        .guideme-complete-badge {
          display: flex;
          align-items: center;
          gap: 12px;
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          color: white;
          padding: 12px 20px;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(34, 197, 94, 0.4);
        }
        
        .guideme-complete-icon {
          font-size: 24px;
          background: rgba(255,255,255,0.2);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .guideme-complete-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .guideme-complete-text strong {
          font-size: 15px;
        }
        
        .guideme-complete-text span {
          font-size: 12px;
          opacity: 0.9;
        }
      </style>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      notification.style.animation = 'guideme-slide-out 0.3s ease forwards';
      const style = document.createElement('style');
      style.textContent = `
        @keyframes guideme-slide-out {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(-20px); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }
  
  updateRecordingOverlay(state = 'recording') {
    if (!this.recordingOverlay) return;
    
    const badge = this.recordingOverlay.querySelector('.guideme-recording-badge');
    const countEl = this.recordingOverlay.querySelector('.guideme-recording-count');
    
    if (countEl) {
      countEl.textContent = `${this.recordedSteps.length} step${this.recordedSteps.length !== 1 ? 's' : ''}`;
    }
    
    if (badge) {
      badge.classList.toggle('paused', state === 'paused');
    }
  }
  
  hideRecordingOverlay() {
    if (this.recordingOverlay) {
      this.recordingOverlay.remove();
      this.recordingOverlay = null;
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
    this.isPreparingTask = false;
    this.isGuideActive = true;
    this.isProcessingClick = false; // Reset click processing flag
    // Reset counters for fresh guide (but not if continuing)
    if (this.totalStepsCompleted === 0) {
      this.isMultiPageTask = false;
      this.continuationCount = 0; // Reset continuation counter
    }
    this.createControlPanel();
    this.highlightStep(this.currentStepIndex);
    this.setupEventListeners();
  }

  stopGuide() {
    this.isPreparingTask = false;
    this.panelPhase = 'idle';
    this.panelMessage = '';
    this.lastGuideSummary = null;
    this.lastInteraction = null;
    if (this.ownerTabId) chrome.storage.local.remove([`guideme_summary_${this.ownerTabId}`]).catch(() => {});
    this.companionDock?.remove();
    this.companionDock = null;
    this.requestVersion++;
    this.highlightController?.abort();
    this.isGuideActive = false;
    this.isWaitingForAI = false; // Reset AI waiting flag
    this.isProcessingClick = false; // Reset click processing flag
    // Cancel any pending retries
    if (this.pendingRetry) {
      clearTimeout(this.pendingRetry);
      this.pendingRetry = null;
    }
    this.clearHighlights();
    this.hideContinuationLoading();
    document.getElementById('guideme-error-panel')?.remove();
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
    this.continuationCount = 0; // Reset continuation counter
    
    // Clear ALL saved state to prevent unwanted resumption
    this.clearGuideState();
    try {
      this.clearGuideBackup();
    } catch (e) {}
    
    // Note: We keep SPA detection active as it's needed for new guides
    console.log('GuideMe: Guide stopped and all state cleared');
  }

  // Stop only the LOCAL guide instance without clearing shared storage
  // Used when user navigates to a new tab - we don't want to wipe state needed by the new tab
  stopGuideLocalOnly() {
    this.requestVersion++;
    this.highlightController?.abort();
    this.isGuideActive = false;
    // Cancel any pending retries
    if (this.pendingRetry) {
      clearTimeout(this.pendingRetry);
      this.pendingRetry = null;
    }
    this.clearHighlights();
    this.removeControlPanel();
    this.removeEventListeners();
    
    // Reset local state but DON'T clear shared storage
    this.currentSteps = [];
    this.currentStepIndex = 0;
    // Keep completedSteps, allStepsForSaving, etc. in memory
    // but don't use them (isGuideActive = false)
    
    console.log('GuideMe: Local guide instance stopped (shared state preserved for other tabs)');
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
    this.removeEventListeners();
    // CRITICAL: Save state before page unloads (navigation)
    this.beforeUnloadHandler = () => {
      if (this.isGuideActive && this.originalTask) this.saveGuideState();
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

    const editingTarget = event => {
      const element = this.currentHighlightedElement;
      const step = this.currentSteps[this.currentStepIndex];
      if (!event.isTrusted || !this.isGuideActive || this.isWaitingForAI || !element || !['type', 'select'].includes(step?.action)) return null;
      if (event.target !== element && !element.contains(event.target)) return null;
      return { element, step };
    };
    this.fieldInputHandler = event => {
      const target = editingTarget(event);
      if (!target) return;
      this.stepVerifier.recordEdit(target.element);
      this.panelPhase = 'ready';
      this.panelMessage = 'Finish this field, then press Tab or choose Next. Your field contents stay on this page.';
      this.updateCompanionUI();
    };
    this.fieldCommitHandler = event => {
      const target = editingTarget(event);
      if (!target || !this.stepBaseline || this.stepBaseline.element !== target.element) return;
      if (event.type === 'change') {
        this.stepVerifier.recordEdit(target.element);
        if (target.step.action !== 'select') return;
      }
      if (event.type === 'keydown' && (event.key !== 'Enter' || target.element.matches('textarea, [contenteditable="true"]'))) return;
      const edited = { ...target.step, expectedResult: { type: 'field-edited' } };
      if (this.stepVerifier.check(edited, this.stepBaseline)) this.nextStep('verified');
    };
    document.addEventListener('input', this.fieldInputHandler, true);
    document.addEventListener('focusout', this.fieldCommitHandler, true);
    document.addEventListener('change', this.fieldCommitHandler, true);
    document.addEventListener('keydown', this.fieldCommitHandler, true);

    // Detect clicks on highlighted element to auto-advance
    this.clickHandler = async (event) => {
      if (!event.isTrusted || !this.isGuideActive || this.isProcessingClick || !this.currentHighlightedElement) return;
      const element = this.currentHighlightedElement;
      const step = this.currentSteps[this.currentStepIndex];
      if (['type', 'select'].includes(step?.action)) return; // Editing completes on commit, never merely on focus.
      const path = event.composedPath ? event.composedPath() : [];
      if (event.target !== element && !element.contains(event.target) && !path.includes(element)) return;
      // Field focus is not evidence that typing/selecting has finished.
      if (!['click', 'focus'].includes(step?.action || 'click')) return;
      if (!this.pageIntelligence.isReachable(element)) return;
      if (this.findElement(step.element || step.selector, step.description, step.robustSelectors, step.targetDescriptor) !== element) {
        this.clearHighlights();
        this.currentHighlightedElement = null;
        this.showVerificationHint('This control changed. Refresh the guide before continuing.');
        return;
      }
      this.isProcessingClick = true;
      this.actionController?.abort();
      this.actionController = new AbortController();
      const { signal } = this.actionController;
      const before = this.stepVerifier.capture(step, element);
      // Native checkboxes/radios toggle before the click capture phase. Use the
      // last highlighted baseline so their default action is still observable.
      if (before.state.nativeChecked !== null && this.stepBaseline?.element === element) {
        before.state.nativeChecked = this.stepBaseline.state.nativeChecked;
      }
      this.lastInteraction = { action: 'click', targetName: this.pageIntelligence.name(element), elementId: step.element, at: Date.now(), result: 'checking' };
      this.panelMessage = `Click on “${this.lastInteraction.targetName || 'the control'}” registered. Checking the page.`;
      this.updateCompanionUI();
      this.pendingAction = {
        step, before, element,
        robustSelectors: this.generateRobustSelectors(element),
        index: this.currentStepIndex
      };
      // Persist the CURRENT step before the page's own handlers can navigate.
      // It is only consumed after navigation or another expected result is observed.
      this.saveGuideState();
      const result = await this.stepVerifier.wait(step, before, { signal, timeout: this.isSavedGuideReplay ? 5000 : 1800 });
      if (signal.aborted || !this.isGuideActive || this.currentSteps[this.currentStepIndex] !== step) return;
      if (result.status === 'verified') {
        this.lastInteraction.result = 'verified';
        this.nextStep('verified');
      } else if (!this.isSavedGuideReplay && (step.action || 'click') === 'click') {
        this.lastInteraction.result = 'unverified';
        this.nextStep('observed');
      } else {
        this.pendingAction = null;
        this.isProcessingClick = false;
        this.showVerificationHint('Result not confirmed. Check the page, then choose Next to confirm this step, or retry the control.');
        this.saveGuideState();
      }
    };
    document.addEventListener('click', this.clickHandler, true);

    // Watch for DOM changes (for dynamically loaded content)
    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.isGuideActive) return;
      
      // Don't try to highlight while waiting for AI response
      if (this.isWaitingForAI) {
        console.log('GuideMe: DOM changed but waiting for AI, skipping highlight');
        return;
      }
      
      if (this.isRevealingTarget || this.isProcessingClick) return;
      if (!this.currentHighlightedElement || !this.currentHighlightedElement.isConnected) {
        if (this.pendingRetry) return;
        this.pendingRetry = setTimeout(() => {
          this.pendingRetry = null;
          if (this.isGuideActive && !this.isWaitingForAI) this.highlightStep(this.currentStepIndex);
        }, 200);
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  removeEventListeners() {
    this.actionController?.abort();
    this.pendingAction = null;
    this.isProcessingClick = false;
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
    if (this.fieldInputHandler) document.removeEventListener('input', this.fieldInputHandler, true);
    if (this.fieldCommitHandler) {
      for (const type of ['focusout', 'change', 'keydown']) document.removeEventListener(type, this.fieldCommitHandler, true);
    }
    this.fieldInputHandler = this.fieldCommitHandler = null;
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }

  getFormContext() {
    const surface = this.currentHighlightedElement?.closest('[role="dialog"], [aria-modal="true"], dialog[open], form') ||
      document.activeElement?.closest('[role="dialog"], [aria-modal="true"], dialog[open], form');
    return surface && this.pageIntelligence.isVisible(surface) ? this.pageIntelligence.surfaceContext(surface) : null;
  }

  getPanelActivity() {
    const phase = this.isRecording ? 'recording' : this.isPreparingTask || this.isWaitingForAI ? 'planning'
      : this.isProcessingClick ? 'verifying'
      : this.isRevealingTarget ? 'locating'
      : this.lastGuideSummary && !this.isGuideActive ? this.lastGuideSummary.status || 'handoff'
      : this.isGuideActive ? this.panelPhase === 'idle' ? 'ready' : this.panelPhase
      : this.panelPhase;
    return { phase, detail: this.panelMessage, task: this.originalTask || this.lastGuideSummary?.task || '' };
  }

  startCompanionUpdates() {
    if (!this.panelOwned || this.companionInterval) return;
    this.companionInterval = setInterval(() => this.updateCompanionUI(), 750);
  }

  updateCompanionUI() {
    if (!this.panelOwned) return;
    const visible = Date.now() < this.panelVisibleUntil;
    if (this.controlPanel) this.controlPanel.style.display = 'none';
    const activity = this.getPanelActivity();
    const fingerprint = JSON.stringify([activity, this.completedSteps.length]);
    if (fingerprint !== this.lastPublishedActivity) {
      this.lastPublishedActivity = fingerprint;
      chrome.runtime.sendMessage({ type: 'GUIDE_ACTIVITY', payload: activity }).catch(() => {});
    }
    const running = this.isGuideActive || this.isPreparingTask || ['planning', 'error', 'attention', 'handoff', 'blocked', 'complete'].includes(activity.phase);
    if (visible || !running) {
      this.companionDock?.remove();
      this.companionDock = null;
      return;
    }
    if (!this.companionDock) {
      const dock = document.createElement('div');
      dock.id = 'guideme-companion-dock';
      dock.dataset.guidemeTheme = this.appearanceTheme;
      dock.setAttribute('data-guideme-ui', '');
      dock.innerHTML = `<button class="gm-dock-open" aria-label="Open GuideMe workspace"><span class="gm-dock-dot"></span><span class="gm-dock-label">GuideMe</span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg></button><button class="gm-dock-next" title="Confirm this step manually">Next</button><button class="gm-dock-stop" aria-label="Stop guide">Stop</button>`;
      dock.querySelector('.gm-dock-open').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_GUIDE_PANEL' }).then(result => {
          if (result?.error) dock.querySelector('.gm-dock-label').textContent = 'Open GuideMe from the toolbar';
        }).catch(() => {});
      });
      dock.querySelector('.gm-dock-next').addEventListener('click', () => this.nextStep('manual'));
      dock.querySelector('.gm-dock-stop').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'CANCEL_GUIDE_TASK' }).catch(() => {});
        this.stopGuide();
      });
      document.body.append(dock);
      this.companionDock = dock;
    }
    const busy = ['reading', 'planning', 'locating', 'verifying'].includes(activity.phase);
    this.companionDock.dataset.busy = String(busy);
    this.companionDock.querySelector('.gm-dock-label').textContent = ['handoff', 'blocked', 'complete'].includes(activity.phase) ? 'GuideMe · View summary' : busy ? activity.phase === 'verifying' ? 'Checking result' : 'GuideMe is working' : activity.phase === 'error' || activity.phase === 'attention' ? 'GuideMe needs you' : 'GuideMe · Guide active';
    this.companionDock.querySelector('.gm-dock-next').hidden = !this.isGuideActive || busy;
  }

  createControlPanel() {
    this.removeControlPanel();

    const panel = document.createElement('div');
    panel.id = 'guideme-control-panel';
    panel.innerHTML = `
      <div class="guideme-panel-header">
        <div class="guideme-logo">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6"/>
            <circle cx="12" cy="12" r="2"/>
            <line x1="12" y1="2" x2="12" y2="6"/>
            <line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="6" y2="12"/>
            <line x1="18" y1="12" x2="22" y2="12"/>
          </svg>
          <span>GuideMe</span>
        </div>
        <div class="guideme-header-actions">
          <button class="guideme-save-btn" title="Save this guide for later">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
          </button>
          <button class="guideme-close-btn" title="Close guide">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="guideme-panel-content">
        <div class="guideme-step-info">
          <span class="guideme-step-number">Step 1 of ${this.currentSteps.length}</span>
          <div class="guideme-step-actions">
            <button class="guideme-edit-btn" title="Edit step description">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              </svg>
            </button>
            <button class="guideme-delete-step-btn" title="Delete this step">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
            </button>
            <button class="guideme-refresh-btn" title="Can't find element? Click to re-scan page">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 16h5v5"/>
              </svg>
            </button>
          </div>
        </div>
        <p class="guideme-instruction"></p>
        <p class="guideme-hint"></p>
        <p class="guideme-not-found" style="display:none;">Element not found. Open any dropdowns, then click refresh to re-scan.</p>
      </div>
      <div class="guideme-panel-controls">
        <button class="guideme-prev-btn" disabled>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
          </svg>
          Prev
        </button>
        <button class="guideme-next-btn">
          Next
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
          </svg>
        </button>
      </div>
      <div class="guideme-progress-bar">
        <div class="guideme-progress-fill"></div>
      </div>
      <button class="guideme-exit-btn">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" x2="9" y1="12" y2="12"/>
        </svg>
        Exit Tutorial
      </button>
      
      <!-- Edit Step Inline Modal -->
      <div class="guideme-edit-modal" style="display:none;">
        <div class="guideme-edit-modal-header">
          <h3>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            </svg>
            Edit Step
          </h3>
          <button class="guideme-edit-modal-close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
        <div class="guideme-edit-modal-body">
          <textarea class="guideme-edit-input" rows="3" placeholder="Step description..."></textarea>
        </div>
        <div class="guideme-edit-actions">
          <button class="guideme-edit-cancel">Cancel</button>
          <button class="guideme-edit-save">Save</button>
        </div>
      </div>
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
    
    // Edit step events
    panel.querySelector('.guideme-edit-btn').addEventListener('click', () => this.showInlineEditModal());
    panel.querySelector('.guideme-delete-step-btn').addEventListener('click', () => this.deleteCurrentStep());
    panel.querySelector('.guideme-edit-cancel').addEventListener('click', () => this.hideInlineEditModal());
    panel.querySelector('.guideme-edit-save').addEventListener('click', () => this.saveInlineEdit());
    panel.querySelector('.guideme-edit-modal-close')?.addEventListener('click', () => this.hideInlineEditModal());

    // Make panel draggable
    this.makeDraggable(panel);

    this.updateControlPanel();
    this.updateCompanionUI();
  }

  async refreshAndReHighlight() {
    this.actionController?.abort();
    this.pendingAction = null;
    this.isProcessingClick = false;
    this.isRevealingTarget = false;
    if (this.isSavedGuideReplay) {
      this.extractDOM();
      this.highlightStep(this.currentStepIndex);
      this.updateControlPanel();
      return;
    }
    return this.requestGuideContinuation();
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
    
    // Calculate overall step: steps from previous pages + current page step
    // allStepsForSaving contains ALL completed steps across pages
    const overallCompleted = (this.allStepsForSaving || []).length;
    const overallStep = overallCompleted + 1; // +1 for the current step we're showing
    
    console.log('GuideMe: updateControlPanel - step', pageStepNum, 'of', pageTotal, '(overall:', overallStep, ')');
    console.log('GuideMe: Step description:', step.description?.substring(0, 50));

    // Show step number based on context
    const stepNumberEl = this.controlPanel.querySelector('.guideme-step-number');
    if ((this.isMultiPageTask || overallCompleted > 0) && !this.isFinalStepBatch) {
      // Multi-page: show overall progress (but not if this is a single-page task marked final)
      stepNumberEl.textContent = `Step ${overallStep} • Multi-page`;
    } else {
      // Single page: show X of Y
      stepNumberEl.textContent = `Step ${pageStepNum} of ${pageTotal}`;
    }
    
    this.controlPanel.querySelector('.guideme-instruction').textContent = 
      step.description || step.instruction || 'Follow this step';
    
    // Show helpful hint based on action type
    const hintEl = this.controlPanel.querySelector('.guideme-hint');
    const action = step.action || 'click';
    const isNavStep = this.isNavigationStep(step);
    
    // Build a clear instruction hint
    let hintText = '';
    switch (action) {
      case 'click':
      case 'focus':
        if (isNavStep) {
          hintText = '👆 Click the highlighted element (this will navigate to a new page)';
        } else {
          hintText = 'Click the highlighted control. GuideMe checks the result; Next confirms manually.';
        }
        break;
      case 'type':
        hintText = '⌨️ Type in the highlighted field, then click Next →';
        break;
      case 'scroll':
        hintText = '📜 Scroll the page, then click Next →';
        break;
      case 'hover':
        hintText = '🖱️ Hover over the highlighted element';
        break;
      case 'wait':
        hintText = '⏳ Wait for the page to load, then click Next →';
        break;
      case 'info':
        hintText = 'ℹ️ Read this information, then click Next →';
        break;
      default:
        hintText = `💡 Action: ${action}`;
    }
    
    hintEl.textContent = hintText;
    hintEl.style.display = 'block';

    // Update buttons
    const prevBtn = this.controlPanel.querySelector('.guideme-prev-btn');
    const nextBtn = this.controlPanel.querySelector('.guideme-next-btn');
    
    prevBtn.disabled = this.currentStepIndex === 0 && this.totalStepsCompleted === 0;
    
    // On the last step, show appropriate button based on whether this is the final batch
    const isLastStep = this.currentStepIndex === this.currentSteps.length - 1;
    
    // Disable Next button for click/navigation steps - user must click the element
    const shouldDisableNext = false; // Next is explicit user confirmation when evidence is unavailable.
    
    if (isLastStep) {
      if (this.isFinalStepBatch) {
        // This is truly the final step - show Done
        nextBtn.textContent = '✓ Done';
        nextBtn.title = 'Click to complete this guide';
      } else {
        // More steps will come after this - show Continue
        nextBtn.textContent = 'Continue →';
        nextBtn.title = 'Continue to next steps';
      }
      nextBtn.disabled = false;
      nextBtn.style.opacity = '1';
    } else if (shouldDisableNext) {
      nextBtn.textContent = 'Next →';
      nextBtn.title = 'Click the highlighted element to proceed';
      nextBtn.disabled = true;
      nextBtn.style.opacity = '0.5';
    } else {
      nextBtn.textContent = 'Next →';
      nextBtn.title = 'Move to next step';
      nextBtn.disabled = false;
      nextBtn.style.opacity = '1';
    }

    // Update progress bar (pulse if multi-page to show ongoing, but not for final batch)
    const progressBar = this.controlPanel.querySelector('.guideme-progress-fill');
    const progress = (pageStepNum / pageTotal) * 100;
    progressBar.style.width = `${progress}%`;
    if (this.isMultiPageTask && !this.isFinalStepBatch) {
      progressBar.style.animation = 'guideme-pulse 2s ease-in-out infinite';
    } else {
      progressBar.style.animation = 'none';
    }
  }
  
  // ============ INLINE STEP EDITING (in floating panel) ============
  
  showInlineEditModal() {
    const step = this.currentSteps[this.currentStepIndex];
    if (!step) return;
    
    const modal = this.controlPanel?.querySelector('.guideme-edit-modal');
    const input = this.controlPanel?.querySelector('.guideme-edit-input');
    if (modal && input) {
      input.value = step.description || step.instruction || '';
      modal.style.display = 'flex';
      input.focus();
      input.select();
    }
  }
  
  hideInlineEditModal() {
    const modal = this.controlPanel?.querySelector('.guideme-edit-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }
  
  async saveInlineEdit() {
    const input = this.controlPanel?.querySelector('.guideme-edit-input');
    const newDescription = input?.value?.trim();
    
    if (!newDescription) {
      input.style.borderColor = '#dc2626';
      return;
    }
    
    console.log('GuideMe: saveInlineEdit - currentStepIndex:', this.currentStepIndex);
    console.log('GuideMe: saveInlineEdit - savedGuideId:', this.savedGuideId);
    console.log('GuideMe: saveInlineEdit - isSavedGuideReplay:', this.isSavedGuideReplay);
    console.log('GuideMe: saveInlineEdit - currentSteps.length:', this.currentSteps.length);
    console.log('GuideMe: saveInlineEdit - allOriginalSteps?.length:', this.allOriginalSteps?.length);
    
    // Update current step (this updates the visible step)
    this.currentSteps[this.currentStepIndex].description = newDescription;
    this.currentSteps[this.currentStepIndex].instruction = newDescription;
    
    // For saved guide replays, we need to update the SAME step in allOriginalSteps
    if (this.isSavedGuideReplay && this.allOriginalSteps) {
      // For single-page guides (currentSteps.length === allOriginalSteps.length),
      // currentStepIndex directly maps to allOriginalSteps
      // For multi-page where currentSteps is a subset, we need to calculate the offset
      let actualIndex;
      
      if (this.currentSteps.length === this.allOriginalSteps.length) {
        // Single-page or full guide visible - direct index mapping
        actualIndex = this.currentStepIndex;
        console.log('GuideMe: Single-page mode - using currentStepIndex directly:', actualIndex);
      } else {
        // Multi-page scenario - currentSteps is a subset of allOriginalSteps
        // The current visible step corresponds to position in full guide
        // We need to match by step content to find the right index
        const currentStep = this.currentSteps[this.currentStepIndex];
        actualIndex = this.allOriginalSteps.findIndex((s, idx) => {
          // Match by original properties (before edit)
          return s.action === currentStep.action && 
                 s.element === currentStep.element &&
                 idx >= (this.allOriginalSteps.length - this.currentSteps.length);
        });
        
        // Fallback to linear offset if no match found
        if (actualIndex === -1) {
          actualIndex = (this.allOriginalSteps.length - this.currentSteps.length) + this.currentStepIndex;
        }
        console.log('GuideMe: Multi-page mode - calculated actualIndex:', actualIndex);
      }
      
      if (actualIndex >= 0 && actualIndex < this.allOriginalSteps.length) {
        this.allOriginalSteps[actualIndex].description = newDescription;
        this.allOriginalSteps[actualIndex].instruction = newDescription;
        console.log('GuideMe: Updated allOriginalSteps at index:', actualIndex);
      } else {
        console.log('GuideMe: actualIndex out of bounds:', actualIndex);
      }
    }
    
    // Persist to storage if this is a saved guide
    if (this.savedGuideId) {
      this.guideWasEdited = true; // Mark that edits were made
      await this.updateSavedGuideInStorage();
    } else {
      console.log('GuideMe: No savedGuideId, cannot persist edit');
    }
    
    this.hideInlineEditModal();
    this.updateControlPanel();
    this.saveGuideState();
    this.showToast('Step updated!');
  }
  
  async deleteCurrentStep() {
    // Don't allow deleting if only 1 step
    if (this.currentSteps.length <= 1) {
      this.showToast('Cannot delete the only step');
      return;
    }
    
    const stepDesc = this.currentSteps[this.currentStepIndex]?.description || 'this step';
    if (!confirm(`Delete step: "${stepDesc.substring(0, 50)}"?`)) {
      return;
    }
    
    console.log('GuideMe: deleteCurrentStep - currentStepIndex:', this.currentStepIndex);
    console.log('GuideMe: deleteCurrentStep - savedGuideId:', this.savedGuideId);
    console.log('GuideMe: deleteCurrentStep - currentSteps.length:', this.currentSteps.length);
    console.log('GuideMe: deleteCurrentStep - allOriginalSteps.length:', this.allOriginalSteps?.length);
    
    // For saved guide replays, we need to figure out which step in allOriginalSteps to remove
    // Key insight: during replay, currentSteps IS allOriginalSteps (same array or copy of it)
    // So currentStepIndex directly corresponds to allOriginalSteps index
    let actualIndex = this.currentStepIndex;
    
    // If currentSteps was sliced (multi-page scenario), we need to adjust
    // We can detect this by comparing lengths
    if (this.isSavedGuideReplay && this.allOriginalSteps) {
      // If lengths match, currentSteps is the full array, use index directly
      if (this.currentSteps.length === this.allOriginalSteps.length) {
        actualIndex = this.currentStepIndex;
        console.log('GuideMe: Full array mode - using currentStepIndex directly:', actualIndex);
      } else {
        // currentSteps is a subset - need to find the actual position
        // The step at currentStepIndex in currentSteps should be at 
        // (originalStepIndex + currentStepIndex) in allOriginalSteps
        // But originalStepIndex might be stale, so let's verify by matching
        const stepToDelete = this.currentSteps[this.currentStepIndex];
        
        if (stepToDelete) {
          // Find matching step, but start from where we expect it to be
          const expectedIndex = (this.originalStepIndex || 0) + this.currentStepIndex;
          
          // First check if the expected index matches
          if (expectedIndex < this.allOriginalSteps.length &&
              this.allOriginalSteps[expectedIndex]?.description === stepToDelete.description) {
            actualIndex = expectedIndex;
            console.log('GuideMe: Subset mode - expected index matches:', actualIndex);
          } else {
            // Fall back to counting occurrences to find the right duplicate
            let matchCount = 0;
            for (let i = 0; i < this.allOriginalSteps.length; i++) {
              if (this.allOriginalSteps[i].description === stepToDelete.description &&
                  this.allOriginalSteps[i].element === stepToDelete.element) {
                matchCount++;
                // We want the Nth occurrence where N = how many times this step appears in currentSteps up to currentStepIndex
                let occurrencesInCurrent = 0;
                for (let j = 0; j <= this.currentStepIndex; j++) {
                  if (this.currentSteps[j].description === stepToDelete.description &&
                      this.currentSteps[j].element === stepToDelete.element) {
                    occurrencesInCurrent++;
                  }
                }
                if (matchCount === occurrencesInCurrent) {
                  actualIndex = i;
                  console.log('GuideMe: Subset mode - found by occurrence matching:', actualIndex);
                  break;
                }
              }
            }
          }
        }
      }
    }
    
    console.log('GuideMe: Will remove from allOriginalSteps at actualIndex:', actualIndex);
    
    // Remove from current steps
    this.currentSteps.splice(this.currentStepIndex, 1);
    
    // Also remove from allOriginalSteps if this is a saved guide replay
    if (this.isSavedGuideReplay && this.allOriginalSteps) {
      console.log('GuideMe: Removing from allOriginalSteps at index:', actualIndex);
      if (actualIndex >= 0 && actualIndex < this.allOriginalSteps.length) {
        this.allOriginalSteps.splice(actualIndex, 1);
        console.log('GuideMe: After removal, allOriginalSteps.length:', this.allOriginalSteps.length);
      } else {
        console.log('GuideMe: Index out of bounds, skipping removal from allOriginalSteps');
      }
    }
    
    // Adjust index if needed
    if (this.currentStepIndex >= this.currentSteps.length) {
      this.currentStepIndex = this.currentSteps.length - 1;
    }
    
    // Persist to storage if this is a saved guide
    if (this.savedGuideId) {
      this.guideWasEdited = true; // Mark that edits were made
      await this.updateSavedGuideInStorage();
    } else {
      console.log('GuideMe: No savedGuideId, cannot persist delete');
    }
    
    this.updateControlPanel();
    this.highlightStep(this.currentStepIndex);
    this.saveGuideState();
    this.showToast('Step deleted!');
  }
  
  async updateSavedGuideInStorage() {
    if (!this.savedGuideId) {
      console.log('GuideMe: updateSavedGuideInStorage - No savedGuideId');
      return;
    }
    
    try {
      console.log('GuideMe: Updating storage for guide:', this.savedGuideId);
      const result = await chrome.storage.local.get(['guideme_macros']);
      const guides = result.guideme_macros || [];
      const guideIndex = guides.findIndex(g => g.id === this.savedGuideId);
      
      console.log('GuideMe: Found guide at index:', guideIndex, 'of', guides.length, 'guides');
      
      if (guideIndex >= 0) {
        // Use allOriginalSteps if available (has all steps), otherwise currentSteps
        const stepsToSave = this.allOriginalSteps || this.currentSteps;
        const stepsCopy = stepsToSave.map(s => ({...s})); // Deep copy each step
        
        console.log('GuideMe: Saving', stepsCopy.length, 'steps');
        console.log('GuideMe: Step descriptions:', stepsCopy.map(s => s.description?.substring(0, 30)));
        
        guides[guideIndex].steps = stepsCopy;
        guides[guideIndex].updatedAt = Date.now();
        
        await chrome.storage.local.set({ guideme_macros: guides });
        
        // Verify the save worked
        const verify = await chrome.storage.local.get(['guideme_macros']);
        const savedSteps = verify.guideme_macros?.[guideIndex]?.steps;
        console.log('GuideMe: Verified saved steps count:', savedSteps?.length);
        
        console.log('GuideMe: ✓ Guide updated in storage successfully');
      } else {
        console.error('GuideMe: ✗ Guide not found in storage:', this.savedGuideId);
      }
    } catch (e) {
      console.error('GuideMe: ✗ Failed to update saved guide:', e);
    }
  }
  
  showToast(message) {
    // Remove existing toast
    const existingToast = document.getElementById('guideme-toast');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.id = 'guideme-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 2147483647;
      animation: guideme-toast-in 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'guideme-toast-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  removeControlPanel() {
    if (this.controlPanel) {
      this.controlPanel.remove();
      this.controlPanel = null;
    }
  }

  prevStep() {
    this.actionController?.abort();
    this.pendingAction = null;
    this.isRevealingTarget = false;
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      if (this.isSavedGuideReplay) this.originalStepIndex = Math.max(0, this.originalStepIndex - 1);
      this.pendingRetry = null; // Cancel any pending retries
      this.isProcessingClick = false; // Reset click processing so user can click again
      this.highlightStep(this.currentStepIndex);
      this.updateControlPanel();
      this.saveGuideState(); // Save progress
    }
  }

  showVerificationHint(message) {
    this.panelPhase = 'attention';
    this.panelMessage = message;
    this.updateCompanionUI();
    const hint = this.controlPanel?.querySelector('.guideme-hint');
    if (hint) {
      hint.textContent = message;
      hint.style.display = 'block';
      hint.setAttribute('role', 'status');
    }
  }

  nextStep(verification = 'manual') {
    if (!this.isGuideActive || this.isWaitingForAI || !this.currentSteps[this.currentStepIndex]) return;
    this.actionController?.abort();
    this.highlightController?.abort();
    if (this.pendingRetry) clearTimeout(this.pendingRetry);
    this.pendingRetry = null;
    this.isRevealingTarget = false;
    const step = this.currentSteps[this.currentStepIndex];
    if (['type', 'select'].includes(step.action)) this.lastInteraction = { action: 'edit', elementId: step.element, targetName: step.targetDescriptor?.name || 'the field', at: Date.now(), result: verification === 'verified' ? 'verified' : 'unverified' };
    this.trackStepCompletion(verification);
    this.pendingAction = null;
    this.isProcessingClick = false;
    if (this.currentStepIndex < this.currentSteps.length - 1) {
      this.currentStepIndex++;
      this.highlightStep(this.currentStepIndex);
      this.updateControlPanel();
      this.saveGuideState();
    } else if (this.isSavedGuideReplay) {
      this.showFinalCompletion();
    } else {
      this.requestGuideContinuation();
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

  async finishGuidance(outcome = {}) {
    const status = ['complete', 'handoff', 'blocked'].includes(outcome.status) ? outcome.status : 'handoff';
    const version = ++this.requestVersion;
    this.isGuideActive = false;
    this.isPreparingTask = false;
    this.isWaitingForAI = false;
    this.isRevealingTarget = false;
    this.highlightController?.abort();
    this.removeEventListeners();
    this.hideContinuationLoading();
    this.clearHighlights();
    this.removeControlPanel();
    const last = this.completedSteps.at(-1);
    const summary = {
      id: crypto.randomUUID(), status, task: this.originalTask, url: window.location.href,
      summary: typeof outcome.summary === 'string' && outcome.summary.trim() ? outcome.summary.slice(0, 1400)
        : last ? `Your action on “${last.targetDescriptor?.name || last.description}” was recorded. Continue from the current page using the instructions for your task.`
        : 'Guidance has ended here. Review the current page and add more context if you need a specific next action.',
      remainingActions: Array.isArray(outcome.remainingActions) ? outcome.remainingActions.slice(0, 8).map(action => ({ text: String(typeof action === 'string' ? action : action?.text || '').slice(0, 600) })).filter(action => action.text) : [],
      completedSteps: this.completedSteps.map(step => ({ description: step.description, verification: step.verification, completedAt: step.completedAt })),
      finishedAt: Date.now()
    };
    this.lastGuideSummary = summary;
    this.panelPhase = status;
    this.panelMessage = '';
    this.currentSteps = [];
    this.currentStepIndex = 0;
    this.updateCompanionUI();
    // Persist the terminal report separately from resumable action checkpoints.
    await this.clearGuideState();
    if (version !== this.requestVersion) return;
    if (this.ownerTabId) await chrome.storage.local.set({ [`guideme_summary_${this.ownerTabId}`]: summary });
    if (version !== this.requestVersion) {
      if (this.ownerTabId) {
        const key = `guideme_summary_${this.ownerTabId}`;
        if ((await chrome.storage.local.get([key]))[key]?.id === summary.id) await chrome.storage.local.remove([key]);
      }
      return;
    }
    if (this.guideWasEdited && this.savedGuideId && this.allOriginalSteps) await this.updateSavedGuideInStorage();
    if (status === 'complete') await this.autoSaveGuideIfEnabled();
    if (!this.panelOwned && version === this.requestVersion) {
      this.panelOwned = true;
      this.startCompanionUpdates();
      this.updateCompanionUI();
    }
  }

  async showFinalCompletion() {
    return this.finishGuidance({ status: 'handoff', summary: 'Your saved walkthrough is finished. Review the result on the page.' });
  }

  async autoSaveGuideIfEnabled() {
    const version = this.requestVersion;
    try {
      // Check if auto-save is enabled
      const result = await chrome.storage.local.get(['autoSaveGuides']);
      if (version !== this.requestVersion) return;
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
      
      console.log('GuideMe: ========== AUTO-SAVE DEBUG ==========');
      console.log('GuideMe: Total steps to save:', stepsToSave.length);
      stepsToSave.forEach((step, i) => {
        console.log(`GuideMe: Step ${i + 1}:`, {
          desc: step.description?.substring(0, 40),
          hasRobustSelectors: !!step.robustSelectors,
          selectorKeys: step.robustSelectors ? Object.keys(step.robustSelectors) : []
        });
      });
      console.log('GuideMe: =====================================');
      
      if (stepsToSave.length === 0) {
        console.log('GuideMe: No steps to save');
        return;
      }
      
      // Generate a name from the task
      const guideName = this.originalTask.substring(0, 50) + (this.originalTask.length > 50 ? '...' : '');
      
      // Save via background script
      const saveResponse = await chrome.runtime.sendMessage({
        type: 'SAVE_MACRO',
        payload: {
          name: guideName,
          task: this.originalTask,
          steps: stepsToSave,
          startUrl: window.location.href
        }
      });
      
      console.log('GuideMe: ✅ Guide auto-saved!', {
        name: guideName,
        steps: stepsToSave.length,
        response: saveResponse
      });
    } catch (error) {
      console.error('GuideMe: ❌ Auto-save failed:', error);
    }
  }

  showCompletionMessage() {
    if (this.controlPanel) {
      this.controlPanel.querySelector('.guideme-instruction').textContent = 'Guide finished. Check that your task is complete.';
      this.controlPanel.querySelector('.guideme-hint').textContent = 'Great job!';
      this.controlPanel.querySelector('.guideme-hint').style.display = 'block';
    }
  }

  async highlightStep(stepIndex, retryCount = 0) {
    this.panelPhase = 'locating';
    this.panelMessage = '';
    this.isRevealingTarget = false;
    this.highlightController?.abort();
    this.highlightController = new AbortController();
    const { signal } = this.highlightController;
    if (this.pendingRetry) clearTimeout(this.pendingRetry);
    this.pendingRetry = null;
    if (!this.isGuideActive || this.isWaitingForAI || stepIndex !== this.currentStepIndex) return;
    this.clearHighlights();
    this.currentHighlightedElement = null;
    const step = this.currentSteps[stepIndex];
    if (!step) return;
    const selector = step.element || step.selector || step.originalElement;
    const description = step.description || step.instruction || '';
    const element = this.findElement(selector, description, step.robustSelectors, step.targetDescriptor);
    if (!element) {
      if (retryCount < 3 && this.lastResolution?.status !== 'ambiguous') {
        this.pendingRetry = setTimeout(() => {
          if (!signal.aborted && this.isGuideActive && this.currentSteps[stepIndex] === step) this.highlightStep(stepIndex, retryCount + 1);
        }, (retryCount + 1) * 400);
      } else {
        this.showNotFoundMessage(this.lastResolution?.status === 'ambiguous'
          ? 'Several controls match this step. Use a more specific guide or confirm the correct control yourself.' : description);
      }
      return;
    }
    this.isRevealingTarget = true;
    const reachable = await this.pageIntelligence.reveal(element, { signal });
    if (signal.aborted || !this.isGuideActive || this.currentSteps[this.currentStepIndex] !== step) return;
    this.isRevealingTarget = false;
    // Resolve again after layout changes; never highlight a recycled or replaced node.
    const fresh = this.findElement(selector, description, step.robustSelectors, step.targetDescriptor);
    if (!reachable || fresh !== element) {
      this.showNotFoundMessage('This control is hidden, covered, or changed. Reveal it and refresh the guide.');
      return;
    }
    this.currentHighlightedElement = element;
    this.createHighlight(element);
    this.stepBaseline = this.stepVerifier.capture(step, element);
    this.panelPhase = 'ready';
    this.updateCompanionUI();
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
    this.panelPhase = 'attention';
    this.panelMessage = instruction || 'This control is not available. Try refreshing the guide.';
    this.updateCompanionUI();
    // Show a message in the control panel that element wasn't found
    if (this.controlPanel) {
      const hintEl = this.controlPanel.querySelector('.guideme-hint');
      hintEl.textContent = instruction || 'Control not found. Refresh the guide or confirm the step manually.';
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
    
    if (this.panelOwned) {
      highlight.style.boxShadow = '0 0 0 6px rgba(80,120,93,.12)';
      highlight.style.borderWidth = '2px';
      highlight.style.animation = 'none';
    }
    document.body.appendChild(highlight);
    this.overlayElements.push(highlight);
    if (this.panelOwned) return;

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
    const snapshot = this.pageIntelligence.snapshot();
    this.lastExtractedElements = Object.fromEntries(snapshot.elements.map(element => [element.id, element]));
    this.lastDomSnapshot = snapshot;
    return snapshot;
  }

  getElementText(element) {
    return this.pageIntelligence.name(element);
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

  // Detect page context for better AI understanding
  detectPageContext() {
    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyClasses = document.body.className.toLowerCase();
    
    const context = {
      platform: 'unknown',
      pageType: 'general',
      hasModal: false,
      hasDropdownOpen: false,
      isLoading: false
    };
    
    // Detect platform
    if (url.includes('github.com')) context.platform = 'github';
    else if (url.includes('aws.amazon.com') || url.includes('console.aws')) context.platform = 'aws';
    else if (url.includes('figma.com')) context.platform = 'figma';
    else if (url.includes('stripe.com') || url.includes('dashboard.stripe')) context.platform = 'stripe';
    else if (url.includes('vercel.com')) context.platform = 'vercel';
    else if (url.includes('notion.so') || url.includes('notion.site')) context.platform = 'notion';
    else if (url.includes('slack.com')) context.platform = 'slack';
    else if (url.includes('shopify.com') || url.includes('myshopify.com')) context.platform = 'shopify';
    else if (url.includes('mailchimp.com')) context.platform = 'mailchimp';
    else if (url.includes('analytics.google.com')) context.platform = 'google-analytics';
    else if (url.includes('canva.com')) context.platform = 'canva';
    
    // Detect page type based on URL patterns
    if (url.includes('/pull') || url.includes('/pulls')) context.pageType = 'pull-requests';
    else if (url.includes('/compare')) context.pageType = 'compare';
    else if (url.includes('/actions')) context.pageType = 'actions';
    else if (url.includes('/settings')) context.pageType = 'settings';
    else if (url.includes('/new') || url.includes('/create')) context.pageType = 'creation-form';
    else if (url.includes('/edit')) context.pageType = 'edit-form';
    
    // Detect modal state
    context.hasModal = !!document.querySelector('[role="dialog"]:not([aria-hidden="true"]), .modal.show, .modal.active, [aria-modal="true"]');
    
    // Detect open dropdowns
    context.hasDropdownOpen = !!document.querySelector('[aria-expanded="true"], .dropdown.open, .dropdown-menu.show');
    
    // Detect loading states
    context.isLoading = !!document.querySelector('.loading, .spinner, [aria-busy="true"], .skeleton');
    
    return context;
  }

  /**
   * Determine if a step is likely to cause navigation to a new page
   * Used to handle click behavior differently for navigation vs non-navigation steps
   * CONSERVATIVE: Only return true for definite page-changing navigations
   */
  isNavigationStep(step) {
    if (!step) return false;
    
    // Check if the step has explicit navigation marker
    if (step.causesNavigation === true) return true;
    if (step.waitAfter?.type === 'navigation') return true;
    
    // Check if the highlighted element is a link or navigation element
    if (this.currentHighlightedElement) {
      const el = this.currentHighlightedElement;
      
      // Check for SPA indicators - these buttons don't cause full navigation
      // Common SPA frameworks add these attributes
      const isSpaButton = el.hasAttribute('data-toggle') || 
                          el.hasAttribute('data-target') ||
                          el.hasAttribute('data-bs-toggle') ||
                          el.hasAttribute('data-action') ||
                          el.getAttribute('role') === 'tab' ||
                          el.getAttribute('role') === 'button' ||
                          el.classList.contains('dropdown-toggle') ||
                          el.classList.contains('accordion-button') ||
                          el.classList.contains('modal-trigger');
      
      if (isSpaButton) {
        console.log('GuideMe: SPA button detected, not treating as navigation');
        return false;
      }
      
      // Direct link with href
      if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:') && !el.href.startsWith('#')) {
        // Check if it's an external link or same-origin navigation
        const currentHost = window.location.host;
        try {
          const linkUrl = new URL(el.href, window.location.origin);
          const linkHost = linkUrl.host;
          if (currentHost === linkHost) {
            // Same origin - check if it's a different path (not just hash/query change)
            const currentPath = window.location.pathname;
            const linkPath = linkUrl.pathname;
            // Only consider as navigation if path is genuinely different
            if (currentPath !== linkPath && !el.href.includes('#')) {
              return true;
            }
          } else {
            // External link - definitely navigation
            return true;
          }
        } catch (e) {
          // Invalid URL, not navigation
          return false;
        }
      }
      
      // Button or element inside a link - be more conservative
      const parentLink = el.closest('a[href]');
      if (parentLink && parentLink.href && 
          !parentLink.href.startsWith('javascript:') && 
          !parentLink.href.startsWith('#') &&
          !parentLink.href.includes('#')) {
        try {
          const linkUrl = new URL(parentLink.href, window.location.origin);
          const currentPath = window.location.pathname;
          const linkPath = linkUrl.pathname;
          if (currentPath !== linkPath) {
            return true;
          }
        } catch (e) {
          return false;
        }
      }
      
      // Form submit buttons - only if form action goes to different page
      if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && el.type === 'submit') {
        const form = el.closest('form');
        if (form && form.action) {
          try {
            const formUrl = new URL(form.action, window.location.origin);
            if (formUrl.pathname !== window.location.pathname) {
              return true;
            }
          } catch (e) {
            return false;
          }
        }
      }
    }
    
    // DON'T rely on description keywords - too unreliable
    // Keywords like 'submit', 'save', 'create' often don't cause page navigation
    
    return false;
  }

  isVisible(element) {
    return this.pageIntelligence.isVisible(element) && this.pageIntelligence.isEnabled(element);
  }

  // Generate robust selectors for recording mode - multiple fallback strategies
  generateRobustSelectors(element) {
    const selectors = {};
    
    // 1. data-testid (most stable for testing-aware apps)
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
    if (testId) {
      selectors.dataTestId = testId;
    }
    
    // 2. aria-label (semantic, usually stable)
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      selectors.ariaLabel = ariaLabel;
    }
    
    // 3. ID (if not dynamic/generated)
    if (element.id && !element.id.match(/^[0-9]/) && !element.id.match(/^:r[0-9a-z]+:/)) {
      // Skip IDs that look generated (like React's :r0:, :r1a2:)
      selectors.id = element.id;
    }
    
    // 4. name attribute (for forms)
    if (element.name) {
      selectors.name = element.name;
    }
    
    // 5. Text content (very important for buttons/links)
    const text = this.getElementText(element);
    if (text && text.length > 0 && text.length < 100) {
      selectors.textContent = text.trim();
    }
    
    // 6. Tag name (for context)
    selectors.tagName = element.tagName.toLowerCase();
    
    // 7. Role attribute
    const role = element.getAttribute('role');
    if (role) {
      selectors.role = role;
    }
    
    // 8. Placeholder (for inputs)
    if (element.placeholder) {
      selectors.placeholder = element.placeholder;
    }
    
    // 9. href for links (partial, without dynamic params)
    if (element.tagName === 'A' && element.href) {
      // Extract meaningful path parts
      try {
        const url = new URL(element.href);
        const cleanPath = url.pathname.replace(/\/[a-f0-9]{32,}/gi, '/:id')
          .replace(/\/[0-9]+/g, '/:num');
        selectors.hrefPath = cleanPath;
      } catch (e) {}
    }
    
    // 10. CSS selector (last resort)
    selectors.cssSelector = this.generateCSSSelector(element);
    
    // 11. Parent context (for disambiguation)
    const parent = element.closest('form, section, article, main, nav, aside, header, footer, [role="dialog"], [role="main"]');
    if (parent && parent !== document.body) {
      if (parent.id) {
        selectors.parentId = parent.id;
      } else if (parent.getAttribute('aria-label')) {
        selectors.parentAriaLabel = parent.getAttribute('aria-label');
      } else if (parent.tagName) {
        selectors.parentTag = parent.tagName.toLowerCase();
        if (parent.getAttribute('role')) {
          selectors.parentRole = parent.getAttribute('role');
        }
      }
    }
    
    // 12. Position hint (for lists, grids)
    const siblings = element.parentElement?.querySelectorAll(element.tagName);
    if (siblings && siblings.length > 1) {
      const index = Array.from(siblings).indexOf(element);
      selectors.siblingIndex = index;
      selectors.siblingCount = siblings.length;
    }
    
    const descriptor = this.pageIntelligence.describe(element);
    selectors.accessibleName = descriptor.name;
    selectors.role = descriptor.role;
    selectors.region = descriptor.region;
    selectors.context = descriptor.context;
    selectors.location = descriptor.location;

    return selectors;
  }
  
  generateCSSSelector(element) {
    // Generate a CSS selector path
    const path = [];
    let current = element;
    
    while (current && current !== document.body && path.length < 5) {
      let selector = current.tagName.toLowerCase();
      
      // Add ID if available and not dynamic
      if (current.id && !current.id.match(/^[0-9]/) && !current.id.match(/^:r[0-9a-z]+:/)) {
        selector = `#${current.id}`;
        path.unshift(selector);
        break;
      }
      
      // Add meaningful class
      const meaningfulClass = Array.from(current.classList).find(c => 
        !c.match(/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/) && // Not CSS module hash
        !c.match(/^_[a-zA-Z0-9]+$/) && // Not styled-component
        !c.match(/^css-/) && // Not emotion
        c.length > 2 && c.length < 30
      );
      
      if (meaningfulClass) {
        selector = `.${meaningfulClass}`;
      }
      
      // Add nth-of-type for disambiguation
      const parent = current.parentElement;
      if (parent) {
        const siblings = parent.querySelectorAll(`:scope > ${selector.split('.')[0] || current.tagName.toLowerCase()}`);
        if (siblings.length > 1) {
          const index = Array.from(siblings).indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      
      path.unshift(selector);
      current = current.parentElement;
    }
    
    return path.join(' > ');
  }

  findElement(selector, text, robustSelectors = null, targetDescriptor = null) {
    const step = this.currentSteps[this.currentStepIndex];
    const descriptor = targetDescriptor || (step?.element === selector ? step.targetDescriptor : null);
    this.lastResolution = this.pageIntelligence.resolve({
      element: selector,
      description: text,
      robustSelectors,
      targetDescriptor: descriptor
    });
    return this.lastResolution.element;
  }

  // Find element using robust selectors (multiple fallback strategies)
  findByRobustSelectors(selectors) {
    return this.pageIntelligence.resolve({ robustSelectors: selectors }).element;
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

}

// Initialize content script
const guideme = new GuideMeContent();
window.guideMeInstance = guideme; // Mark as initialized to prevent double-injection

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
    width: 340px;
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.15), 0 10px 20px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }

  .guideme-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: linear-gradient(135deg, #4F46E5 0%, #6366F1 50%, #7C3AED 100%);
    color: white;
    cursor: grab;
  }

  .guideme-header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .guideme-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 15px;
  }

  .guideme-logo svg {
    opacity: 0.9;
  }

  .guideme-save-btn {
    background: rgba(255,255,255,0.15);
    border: none;
    color: white;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .guideme-save-btn:hover {
    background: rgba(245, 158, 11, 0.9);
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
  }

  .guideme-close-btn {
    background: rgba(255,255,255,0.15);
    border: none;
    color: white;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .guideme-close-btn:hover {
    background: rgba(255,255,255,0.25);
  }

  .guideme-panel-content {
    padding: 16px;
  }

  .guideme-step-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .guideme-step-number {
    display: inline-block;
    background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%);
    color: #4F46E5;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(79, 70, 229, 0.1);
  }

  .guideme-step-actions {
    display: flex;
    gap: 4px;
  }

  .guideme-edit-btn, .guideme-delete-step-btn, .guideme-refresh-btn {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #f9fafb;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .guideme-edit-btn:hover {
    background: #EEF2FF;
    border-color: #c7d2fe;
    color: #4F46E5;
  }

  .guideme-delete-step-btn:hover {
    background: #FEF2F2;
    border-color: #fecaca;
    color: #dc2626;
  }

  .guideme-refresh-btn:hover {
    background: #f0fdf4;
    border-color: #bbf7d0;
    color: #16a34a;
  }

  .guideme-persist-badge {
    font-size: 14px;
    opacity: 0.7;
    cursor: help;
  }

  .guideme-instruction {
    margin: 14px 0 8px;
    font-size: 15px;
    line-height: 1.6;
    color: #1f2937;
    font-weight: 500;
  }

  .guideme-hint {
    margin: 0;
    font-size: 13px;
    color: #6b7280;
    line-height: 1.5;
  }

  .guideme-not-found {
    margin: 8px 0 0;
    font-size: 12px;
    color: #f59e0b;
    background: #fffbeb;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #fef3c7;
  }

  .guideme-panel-controls {
    display: flex;
    gap: 10px;
    padding: 0 16px 16px;
  }

  .guideme-prev-btn, .guideme-next-btn {
    flex: 1;
    padding: 12px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    background: white;
    color: #374151;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .guideme-prev-btn:hover:not(:disabled), .guideme-next-btn:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #d1d5db;
  }

  .guideme-prev-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .guideme-next-btn {
    background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
    color: white;
    border: none;
    box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
  }

  .guideme-next-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #4338ca 0%, #4F46E5 100%);
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
    transform: translateY(-1px);
  }

  .guideme-progress-bar {
    height: 4px;
    background: #e5e7eb;
  }

  .guideme-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4F46E5, #6366F1, #7C3AED);
    transition: width 0.3s ease;
  }

  .guideme-exit-btn {
    width: calc(100% - 32px);
    margin: 0 16px 16px;
    padding: 11px 16px;
    background: white;
    border: 1px solid #fecaca;
    border-radius: 10px;
    color: #dc2626;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .guideme-exit-btn:hover {
    background: #dc2626;
    border-color: #dc2626;
    color: white;
    box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
  }

  /* Inline edit modal */
  .guideme-edit-modal {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: white;
    z-index: 10;
    display: none;
    flex-direction: column;
    border-radius: 16px;
    overflow: hidden;
  }

  .guideme-edit-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: linear-gradient(135deg, #4F46E5 0%, #6366F1 50%, #7C3AED 100%);
    color: white;
  }

  .guideme-edit-modal-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .guideme-edit-modal-close {
    background: rgba(255,255,255,0.15);
    border: none;
    color: white;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .guideme-edit-modal-close:hover {
    background: rgba(255,255,255,0.25);
  }

  .guideme-edit-modal-body {
    flex: 1;
    padding: 16px;
  }

  .guideme-edit-input {
    width: 100%;
    padding: 12px;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
    min-height: 80px;
    box-sizing: border-box;
  }

  .guideme-edit-input:focus {
    outline: none;
    border-color: #4F46E5;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
  }

  .guideme-edit-actions {
    display: flex;
    gap: 10px;
    padding: 0 16px 16px;
  }

  .guideme-edit-cancel {
    flex: 1;
    padding: 11px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    background: white;
    color: #374151;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .guideme-edit-cancel:hover {
    background: #f3f4f6;
    border-color: #d1d5db;
  }

  .guideme-edit-save {
    flex: 1;
    padding: 11px 16px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
  }

  .guideme-edit-save:hover {
    background: linear-gradient(135deg, #4338ca 0%, #4F46E5 100%);
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
    transform: translateY(-1px);
  }

  /* Toast notification */
  .guideme-toast {
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
    color: white;
    padding: 12px 24px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    z-index: 2147483647;
    animation: guideme-toast-in 0.3s ease, guideme-toast-out 0.3s ease 1.7s forwards;
    box-shadow: 0 8px 30px rgba(0,0,0,0.25);
  }

  @keyframes guideme-toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @keyframes guideme-toast-out {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
  }

  @keyframes guideme-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
`;
document.head.appendChild(style);

} // End of double-injection guard
