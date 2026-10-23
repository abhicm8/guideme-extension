// Presentation only. Every indicator reflects an observed or explicit state.
(() => {
  const phases = {
    idle: ['Ready', '', ''],
    reading: ['Reading page', 'Getting the lay of the page', 'Finding the controls that matter to your request.'],
    planning: ['Thinking', 'Finding your next step', 'Connecting your request to what is on this page.'],
    locating: ['Locating', 'Bringing it into view', 'Finding a clear, reachable control for this step.'],
    verifying: ['Checking', 'Checking what changed', 'Looking for the expected result before moving on.'],
    ready: ['Your turn', '', ''],
    attention: ['Needs you', '', ''],
    error: ['Paused', '', ''],
    complete: ['Finished', '', ''],
    handoff: ['Over to you', '', ''],
    blocked: ['Needs context', '', ''],
    recording: ['Recording', '', '']
  };
  class GuideMePanelUI {
    constructor(doc = document) {
      this.doc = doc;
    }

    text(id, value) { const element = this.doc.getElementById(id); if (element) element.textContent = value; }

    render(activity = { phase: 'idle' }, data = {}) {
      const phase = phases[activity.phase] ? activity.phase : 'idle';
      const [label, title, detail] = phases[phase];
      this.doc.body.dataset.phase = phase;
      this.text('phaseLabel', label);
      const active = !!data.isGuideActive || ['reading', 'planning', 'locating', 'verifying', 'attention', 'error'].includes(phase);
      this.doc.body.dataset.taskActive = String(active);
      this.doc.getElementById('stopGuideBtn')?.classList.toggle('hidden', !active);
      const busy = ['reading', 'planning', 'locating', 'verifying'].includes(phase);
      this.doc.getElementById('processingCard')?.classList.toggle('hidden', !busy);
      this.doc.getElementById('guideBtn')?.setAttribute('aria-busy', String(busy));
      this.text('processingTitle', title);
      this.text('processingDetail', detail);
      this.text('processingStage', phase === 'verifying' ? 'VERIFYING THE RESULT' : 'WORKING WITH THIS PAGE');
      this.text('guideTaskTitle', data.task || activity.task || 'Your guide');
      const step = data.steps?.[data.currentStepIndex || 0];
      const target = step?.targetDescriptor;
      const role = { button: 'Button', link: 'Link', textbox: 'Field', combobox: 'Menu', checkbox: 'Checkbox', tab: 'Tab', switch: 'Switch', menuitem: 'Menu item' }[target?.role] || 'Control';
      this.text('targetContext', target ? [role, target.region || 'On this page'].join(' · ') : 'Follow the highlight on the page');
      let outcome = 'GuideMe checks the page after you act. You can also confirm the step yourself.';
      const expected = step?.expectedResult;
      if (expected?.type === 'url-changed') outcome = 'We’ll check that a new destination opens.';
      if (expected?.type === 'visible') outcome = `We’ll look for “${expected.targetDescriptor?.name || expected.target?.name || 'the expected result'}” on the page.`;
      if (expected?.type === 'hidden') outcome = 'We’ll check that this control disappears.';
      if (expected?.type === 'attribute') outcome = 'We’ll check that the control changes to the expected state.';
      if (expected?.type === 'manual') outcome = 'GuideMe can recognise a newly opened form. If this action has no visible result, choose Next once to confirm it.';
      if (expected?.type === 'field-edited') outcome = 'We’ll continue after you edit this field and press Tab. Next also confirms your entry.';
      const interaction = data.lastInteraction;
      const receipt = interaction && ['planning', 'verifying', 'error'].includes(phase);
      this.doc.getElementById('actionReceipt')?.classList.toggle('hidden', !receipt);
      this.text('actionReceipt', receipt ? `${interaction.action === 'edit' ? 'Entry in' : 'Click on'} “${interaction.targetName || 'the control'}” registered. ${phase === 'verifying' ? 'Checking the page…' : phase === 'error' ? 'Further guidance is paused.' : 'Finding the right continuation…'}` : '');
      this.doc.getElementById('currentStep')?.classList.toggle('hidden', !!receipt);
      this.text('verificationTitle', phase === 'verifying' ? 'Checking the result' : phase === 'attention' || phase === 'error' ? 'Your attention is needed' : 'Waiting for your action');
      this.text('verificationDetail', activity.detail || outcome);
      const editing = step && ['type', 'select'].includes(step.action);
      this.doc.getElementById('fieldGuidance')?.classList.toggle('hidden', !editing);
      this.text('fieldGuidanceTitle', step?.action === 'select' ? 'What to choose' : 'What to enter');
      this.text('fieldGuidanceDetail', editing ? step.hint || step.description || `Enter the requested details in ${target?.name || 'the highlighted field'}.` : '');
      this.text('fieldCompletionDetail', 'Finish the field, then press Tab or choose Next. Clicking the field alone does not complete this step.');
      const form = data.formContext;
      this.doc.getElementById('formOverview')?.classList.toggle('hidden', !form?.fields?.length);
      this.text('formOverviewTitle', form?.name ? `On this form · ${form.name}` : 'On this form');
      const fields = this.doc.getElementById('formFieldList');
      const formFingerprint = JSON.stringify(form);
      if (fields && this.lastForm !== formFingerprint) {
        this.lastForm = formFingerprint;
        fields.replaceChildren();
        for (const field of form?.fields || []) {
          const item = this.doc.createElement('li');
          const label = this.doc.createElement('span'); label.textContent = field.name || 'Unnamed field';
          const state = this.doc.createElement('small'); state.textContent = field.filled ? 'Entered' : field.required ? 'Required' : 'Not entered';
          item.append(label, state); fields.append(item);
        }
      }
      const completed = data.completedSteps || data.lastGuideSummary?.completedSteps || [];
      this.text('verifiedCount', completed.filter(step => step.verification === 'verified').length);
      this.text('confirmedCount', completed.filter(step => step.verification === 'manual').length);
      this.text('observedCount', completed.filter(step => step.verification === 'observed').length);
      this.text('observedPageInfo', 'Latest steps');
      const list = this.doc.getElementById('activityList');
      const fingerprint = JSON.stringify(completed.slice(-4));
      if (list && fingerprint !== this.lastTimeline) {
        this.lastTimeline = fingerprint;
        list.replaceChildren();
        for (const step of completed.slice(-4).reverse()) {
          const item = this.doc.createElement('li');
          const icon = this.doc.createElement('span'); icon.className = 'activity-icon'; icon.textContent = step.verification === 'verified' ? '✓' : '·'; icon.setAttribute('aria-hidden', 'true');
          const copy = this.doc.createElement('div'); copy.className = 'activity-copy'; copy.textContent = step.description;
          const method = this.doc.createElement('small'); method.textContent = step.verification === 'verified' ? 'Result verified on page' : step.verification === 'observed' ? 'Click recorded · result unverified' : 'Confirmed by you';
          copy.append(method); item.append(icon, copy); list.append(item);
        }
        if (!completed.length) {
          const empty = this.doc.createElement('li'); empty.className = 'activity-empty'; empty.textContent = 'Your confirmed steps will appear here.'; list.append(empty);
        }
      }
      if (data.lastGuideSummary) {
        const report = data.lastGuideSummary;
        const count = report.completedSteps?.length || 0;
        const status = report.status || 'handoff';
        this.text('summaryEyebrow', status === 'complete' ? 'OUTCOME OBSERVED ON PAGE' : status === 'blocked' ? 'GUIDANCE PAUSED HERE' : 'OVER TO YOU');
        this.text('summaryTitle', status === 'complete' ? 'The page reports completion.' : status === 'blocked' ? 'Here’s what I could establish.' : 'Continue from here.');
        this.text('summarySymbol', status === 'complete' ? '✓' : '→');
        this.text('completionDetail', report.summary || `${count} guide step${count === 1 ? '' : 's'} finished. Check the result on the page before moving on.`);
        const actions = this.doc.getElementById('summaryActions');
        const history = this.doc.getElementById('summaryHistoryList');
        const reportFingerprint = JSON.stringify(report);
        if (reportFingerprint !== this.lastReport) {
          this.lastReport = reportFingerprint;
          actions?.replaceChildren(); history?.replaceChildren();
          for (const action of report.remainingActions || []) {
            const item = this.doc.createElement('li'); item.textContent = typeof action === 'string' ? action : action.text;
            actions?.append(item);
          }
          for (const step of report.completedSteps || []) {
            const item = this.doc.createElement('li');
            item.textContent = `${step.description} · ${step.verification === 'observed' ? 'Click recorded; result unverified' : step.verification === 'verified' ? 'Result verified' : 'Confirmed by you'}`;
            history?.append(item);
          }
        }
        this.doc.getElementById('summaryHistory')?.classList.toggle('hidden', !count);
        this.text('summaryHistoryLabel', `${count} recorded action${count === 1 ? '' : 's'}`);
        this.text('summarySaveStatus', report.save?.message || '');
        const saveButton = this.doc.getElementById('saveSessionBtn');
        saveButton?.classList.toggle('hidden', !['error', 'disabled'].includes(report.save?.state));
        if (saveButton) saveButton.textContent = report.save?.state === 'disabled' ? 'Save guided steps' : 'Retry saving';
        this.doc.getElementById('resumeGuideBtn')?.classList.toggle('hidden', status === 'complete');
      }
    }
  }
  globalThis.GuideMePanelUI = GuideMePanelUI;
})();
