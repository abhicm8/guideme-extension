# GuideMe Architecture & Design Decisions

This document explains the technical architecture, design decisions, and lessons learned while building GuideMe. It's intended to help contributors understand *why* things are built the way they are.

## Table of Contents

- [Overview](#overview)
- [Core Components](#core-components)
- [The .guideme File Format](#the-guideme-file-format)
- [Element Matching Strategy](#element-matching-strategy)
- [Multi-Page Flow Handling](#multi-page-flow-handling)
- [UI Design Decisions](#ui-design-decisions)
- [Common Pitfalls & Solutions](#common-pitfalls--solutions)
- [Performance Considerations](#performance-considerations)

---

## Overview

GuideMe is a Chrome extension that provides AI-powered step-by-step guidance for any website. The architecture follows Chrome's Manifest V3 structure with three main contexts:

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Popup     │    │  Background │    │   Content Script    │  │
│  │  (popup/)   │◄──►│  (Service   │◄──►│   (content/)        │  │
│  │             │    │   Worker)   │    │                     │  │
│  │ - UI/UX     │    │             │    │ - DOM extraction    │  │
│  │ - Settings  │    │ - AI APIs   │    │ - Highlighting      │  │
│  │ - Guide mgmt│    │ - Storage   │    │ - Click detection   │  │
│  └─────────────┘    │ - Messaging │    │ - Page navigation   │  │
│                     └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Communication Flow

1. **User → Popup**: User asks a question
2. **Popup → Content Script**: Request DOM extraction
3. **Content Script → Background**: Send extracted elements
4. **Background → AI API**: Generate guide steps
5. **Background → Content Script**: Send steps for highlighting
6. **Content Script → User**: Visual highlights and guidance

---

## Core Components

### `/popup/` - Extension Popup UI

| File | Purpose |
|------|---------|
| `popup.html` | Persistent native side-panel workspace with inline SVG icons |
| `popup.css` | Responsive glass surfaces, layout tokens and reduced-motion states |
| `panel-ui.js` | Actual processing phases, verification insights and recent activity |
| `theme.js` | Explicit light/dark preference, early appearance initialization and cross-panel synchronization |
| `popup.js` | UI logic, state management, guide playback |

**Key Classes:**
- `GuideMePopup` - Main controller class managing all popup functionality

### `/background/` - Service Worker

| File | Purpose |
|------|---------|
| `background.js` | AI API calls, message routing, storage management |
| `panel-controller.js` | Native side-panel lifecycle, initial task delivery, cancellation and toolbar status |

**Key Classes:**
- `GuideMeBackground` - Handles all background operations
- Uses Chrome's Manifest V3 service worker (not persistent background page)

### `/content/` - Content Scripts

| File | Purpose |
|------|---------|
| `content.js` | Extension adapter, guide lifecycle, recording and overlay UI |
| `page-intelligence.js` | Semantic observation, document-scoped identity, contextual resolution and target revealing |
| `step-verifier.js` | Observable step outcomes, bounded waits and cancellation |
| `overlay.css` | Highlight styles injected into pages |

**Key Classes:**
- `GuideMeContent` - Injected into every webpage

### `/lib/` - Shared Libraries

| File | Purpose |
|------|---------|
| `guideme-format.js` | .guideme file format specification and utilities |
| `guide-planner.js` | Shared planner prompt, snapshot binding and model-output validation |

---

## The .guideme File Format

### Why We Created It

We needed a way to share guides across browsers and users. The format needed to:
- Be human-readable (JSON-based)
- Include robust element selectors that work across sessions
- Support versioning for future compatibility
- Include integrity checking (checksums)

### Format Structure

```json
{
  "formatVersion": "1.0",
  "metadata": {
    "name": "Guide Name",
    "description": "What this guide does",
    "createdAt": "ISO timestamp",
    "author": "optional",
    "category": "navigation|settings|account|other"
  },
  "compatibility": {
    "urlPattern": "*.github.com",
    "minimumVersion": "1.0"
  },
  "steps": [
    {
      "description": "Human-readable instruction",
      "action": "click|type|scroll|wait",
      "robustSelectors": {
        "primary": "CSS selector",
        "fallback": "alternative selector",
        "text": "visible text content",
        "ariaLabel": "accessibility label",
        "testId": "data-testid value"
      }
    }
  ],
  "checksum": "SHA-256 hash for integrity"
}
```

### Key Design Decisions

1. **Multiple Selector Strategies**: We store multiple ways to find an element because websites change. If the primary selector fails, we try fallbacks.

2. **Text-Based Matching**: The `text` field allows matching by visible content, which is more stable than CSS selectors on many sites.

3. **Checksums**: Prevent tampering and detect corruption when sharing files.

---

## Element Matching Strategy

`PageIntelligence` is independent of Chrome extension APIs. Both manifest injection and popup fallback injection load `page-intelligence.js`, `step-verifier.js`, then `content.js`. The first two expose guarded classes through `globalThis.GuideMeRuntime`; reinjection does not replace an existing runtime. There is no bundler or production npm dependency.

### Observe and bind

An observation includes a schema version, snapshot ID, accessible names and roles, enabled state, region/row context, geometry and scroll-container references. It covers ordinary DOM and open shadow roots. Input, textarea and editable-field contents are excluded from extracted labels and context. This is a semantic approximation, not a complete implementation of the browser's accessibility tree.

IDs live in a WeakMap, are scoped to a document, and are never reassigned to another node. Extraction does not write tracking attributes into the site's DOM. Detached references are pruned on observation. A replaced node receives a new ID; saved replay finds it using semantic descriptors and legacy selectors.

The shared planner asks for one observed step at a time. Its boundary rejects unknown IDs, disabled targets, unsupported actions and unsupported verification rules, then attaches the observed descriptor and snapshot ID. Page text is explicitly treated as untrusted data. Malformed JSON is rejected rather than converted into guessed clickable steps.

### Resolve and reveal

1. Validate a document-local reference against its current name, role and context.
2. Rank semantic and legacy candidates using test IDs, element IDs, CSS, labels, text, region and row context. Invalid selectors cannot throw out the guide.
3. Require a minimum match score and a clear margin over the runner-up. Repeated indistinguishable controls return `ambiguous`, not the first match.
4. Scroll the target into view, including nested containers, and wait for stable geometry within a bounded timeout.
5. Check ancestor clipping and hit testing to detect overlays; re-resolve before highlighting and again when the user clicks.

Closed shadow roots, embedded cross-origin frames, canvas controls and searching unmounted virtualized rows remain outside this adapter's supported scope. They need additional observation/browser adapters rather than selector guesses.

### Verify and recover

The loop is **observe → plan → resolve/reveal → user action → verify → re-observe**. GuideMe remains a visual guide; these changes do not add autonomous clicking or typing.

`StepVerifier` supports actual URL changes, expected attribute transitions, a named element becoming visible, and the clicked element becoming hidden. Legacy guides can also use native checkbox/details and ARIA state transitions. An already-satisfied condition, unrelated DOM mutation, or elapsed timeout is not success. Ambiguous outcome targets do not verify a result.

Live guidance records trusted clicks immediately and waits up to 1.8 seconds for expected-result evidence. A verified result consumes the step as `verified`; otherwise the physical click consumes it as `observed`, without asserting success, and a fresh snapshot drives continuation or a handoff. Saved replay still waits up to five seconds and retains manual confirmation when evidence is unavailable. Records distinguish `verified`, `manual` and `observed`.

`status:next_step` always carries exactly one observed action and `completed:false`; live guidance reobserves even after a predicted final action. Endings carry no highlight steps and use `handoff`, `complete` or `blocked`, each with a summary and remaining instructions. `complete` requires currently observed status/alert/heading evidence IDs; form fields and a recorded click alone cannot qualify. Legacy final-batch flags remain usable for saved playback but cannot end a live task prematurely.

The existing `.guideme` v1 format remains unchanged and still imports/exports. Local saved steps retain richer descriptors and expected outcomes. Exporting to v1 preserves its selector-based targeting; richer verification metadata is not round-tripped by that older format, so replay may require manual confirmation.

---

## Multi-Page Flow Handling

`saveGuideState()` writes one complete checkpoint to `chrome.storage.local.activeGuide_<tabId>` for side-panel guides (the legacy adapter still uses `activeGuide`) and a synchronous per-origin `localStorage` backup. Both carry the owning tab ID, so another tab does not consume a side-panel guide checkpoint. The checkpoint keeps the current step until verified or explicitly confirmed. Before a user click can navigate, it includes a pending action with the source URL and selectors captured while the target exists.

A new document resumes the pending navigation step only when the URL actually changed and its verification rule permits navigation. Other outcomes remain available for manual confirmation. The final-batch flag does not discard unfinished saved steps. Saved replay continues locally without an AI call, including when the user presses Refresh.

SPA URL detection does not advance a step while its click verifier owns the pending action. This prevents duplicate advancement. Asynchronous highlights and verifications are abortable; planner requests carry a generation counter and source URL so a late response cannot revive a stopped/replaced guide. Delayed completion cleanup is also scoped to its originating guide.

Side-panel checkpoint and processing-status keys are scoped to their owning tab and cleaned up when the tab closes. Returning to a hidden guide tab preserves its local controller. Existing expiry and reload/back-navigation rules remain in place. Recording and legacy adapters retain their original persistence behavior; authenticated-site field testing is still needed.

---

## UI Design Decisions

### Native workspace and background lifetime

The toolbar action opens the manifest's native side panel instead of a temporary popup. The existing `popup/` paths are retained for saved-guide UI compatibility. Chrome 141+ is required for the panel's Close API. The panel fills the available height and scrolls independently of its fixed header and bottom navigation.

Initial generation is owned by `PanelController` in the service worker, including delivery of `START_GUIDE` to the original tab. Closing the panel during a model call does not discard its result. Cancellation tokens prevent an obsolete request from restarting a guide; a changed source URL rejects stale guidance.

Hide closes the panel without sending Stop. An active guide retains its page highlights and a compact companion with Reopen, manual Next and Stop. The old floating editor stays hidden in side-panel mode. Visibility events and a short heartbeat lease prevent a closed or destroyed panel from leaving its page controls permanently suppressed. Toolbar badges reflect ongoing work or attention states.

### Visual language and feedback

The workspace uses a warm neutral canvas, restrained green accents, translucent white cards and subtle blur confined to extension surfaces. Native side panels cannot blur the webpage behind them. High-contrast text and solid fallback surfaces keep the glass treatment readable. Controls have visible keyboard focus, processing messages have live-region semantics, and all animations respect reduced-motion preferences.

Processing feedback is driven by actual reading, planning, locating and verifying phases, not fabricated percentages. Live guidance has an indeterminate progress line until a total is known. Insights distinguish results verified on the page from steps confirmed by the user, with a short activity history. Completed walkthroughs retain a result summary when the panel is reopened. Task drafts are saved separately from settings and survive Hide.

### Form progress and cancellation

`PageIntelligence` reports visible form/dialog surfaces and non-sensitive field metadata (`editable`, input kind, `required`, `filled`, `valid`) without serializing field contents. Focused form controls are prioritized in bounded snapshots. The side panel renders field help and a list of field labels/presence; user-entered text stays in the page. Recorded-guide input capture remains its existing, separate opt-in behavior.

`StepVerifier` captures visible surfaces before a click. A newly visible form/dialog with editable fields and focus inside it can verify a click whose original rule was manual. Existing surfaces, unrelated notifications and newly inserted unfocused fields do not satisfy this fallback. Explicit URL/attribute/visible/hidden rules retain their own evidence checks.

Type/select steps listen to trusted input/change events and commit on focusout, single-line Enter, or a select change. `field-edited` requires an actual edit since the highlighted baseline plus nonempty, valid, editable field state. Focus alone, an invalid native email address, programmatic event dispatches and Enter inside a multiline editor do not consume the step. Next remains a deliberate manual fallback; verification proves an edit was made, not semantic correctness of the text.

Planner history now carries action/target identity, page URL and verification method. The prompt requires moving on from confirmed actions and working within already-open forms. The worker detects an immediately repeated unchanged completed click and gives the model one corrective replan; a second repetition ends with a grounded handoff rather than looping.

The labelled header Stop control is visible throughout planning, guidance and paused/error states, across workspace navigation. Cancellation and content cleanup both run even if one context disconnects. Panel request/poll revisions reject stale responses after Stop, and the page companion exposes a labelled Stop as well.

Email automation is a future execution layer, not part of guided mode. The user's chosen interaction is draft filling followed by an explicit Send approval in GuideMe. An implementation must bind approval to the reviewed recipient/subject/body and tab/draft identity, invalidate it on any change, and honour Stop before dispatching Send.

### Guidance endings and summaries

`lib/guide-outcome.js` normalizes terminal reports and builds a generic fallback from observed form/field metadata and action history. The planner generates task-specific summaries and remaining instructions; there are no domain checks or mail-specific workflow branches. Instructional requests can end with a handoff once the useful destination/context is reached, rather than forcing a confirmation for every ordinary field. The explicit step-by-step preference asks for further reliable highlights.

The worker allows a total of two planning attempts for a missing summary or repeated action. It preserves structured `status`, `summary`, `remainingActions` and `evidenceIds` across the provider parser. Unknown remaining-action target IDs are filtered out, and unsupported completion claims downgrade to a handoff. A known status/alert/heading must be visible for an outcome report; the UI labels this as what the page reports, not independently verified server state.

`PanelController` delivers a zero-step first result with `SHOW_GUIDE_OUTCOME`, instead of throwing an empty-guide error. Continuations call `finishGuidance` for the same ending contract. It cancels listeners, removes highlights and stale step cards, clears resumable checkpoints and retains a separate tab-owned `guideme_summary_<id>` report. Reports restore only for the same URL, are removed on Stop/new task/dismissal/tab closure, and cannot restart an action. Handoffs are not auto-saved as completed replay guides. The fixed summary card contains remaining instructions, recorded-action history and optional step-by-step resumption.

Trusted click receipts are visible during verification/planning, including when the planned accessible result name does not match. The observed action and expected outcome remain separate facts: `observed` history does not add to verified or manual-confirmation counts. New-form inference retains its existing strict conditions, while unmatched named outcomes can still lead to a truthful handoff through recorded interaction evidence.

### Gemini and Vertex providers

`lib/ai-config.js` is the shared configuration/catalog boundary, consumed by the settings page and worker. It validates service-account fields, model IDs, project/location path components and model-specific thinking settings. The curated catalog was checked against Google's official model and thinking documentation on 2026-10-22. Custom model IDs retain default thinking rather than guessing their capabilities.

`popup/provider-settings.js` owns credential drafts, JSON upload/paste, provider-specific controls, model capabilities and removal. Saving clears the JSON field; reopening displays only the account email. Private keys are persisted unencrypted under `vertexCredentials` in `chrome.storage.local`; access tokens are never persisted. No new dependencies or server are involved.

Initial and continuation planning both read the provider configuration in the worker. Message payloads cannot override that configuration, and the content controller receives only the bound plan. `lib/gemini-client.js` owns Gemini key-header authentication and Vertex OAuth: import a PKCS#8 RSA key with Web Crypto, sign an RS256 assertion with the cloud-platform scope and one-hour expiry, exchange it at the fixed `https://oauth2.googleapis.com/token` endpoint, then use a bearer token at the global or regional Google inference endpoint. Credential-supplied token URLs are ignored and redirects are rejected. The in-memory cache is keyed by a credential fingerprint, refreshes before expiry and retries a rejected token once. Provider errors are sanitized and never trigger a different-model fallback.

Generation uses `streamGenerateContent` over SSE, joins split UTF-8/events and excludes thought parts before JSON parsing. A 25-second header deadline and 120-second overall request deadline bound slow requests. A scoped extension API heartbeat keeps the worker active while reading a long reasoning stream, even with the panel hidden; it is cleared on success or error. No reasoning content is displayed as if it were a verified action.

Tests verify actual RSA signatures, claims, token caching/refresh, endpoint selection, malformed credentials, model capabilities, error handling and chunked/interrupted streams. Browser tests cover upload/paste, save/reload/removal, no-key Vertex startup, absence of credentials in page messages and both appearance palettes. Real project IAM/billing/model availability still require a live check with the user's own credential.

### User-selected appearance

Settings offers exactly two in-house palettes: **Light** (the default) and **Dark**. Selection applies and saves immediately to the separate `appearanceTheme` key in `chrome.storage.local`; saving provider settings cannot overwrite it. Neither OS preferences nor browser theme changes select a palette.

`theme.js` runs in the document head and initializes appearance before revealing the workspace, avoiding a light flash when reopening a dark panel. Invalid or missing values fall back to Light. Storage events synchronize open panels, and failed writes restore the previous selection with a visible error.

Components consume semantic color variables for text, translucent surfaces, form controls, dialogs, loading indicators and navigation. Preview swatches deliberately show both fixed palettes. The compact page companion listens for the same stored preference, with variables scoped to its own element so host website colors are unaffected. User-configured highlight colors remain a separate setting.

### Why Inline SVG Icons (Not Emojis)

**Problems with Emojis:**
- Render differently across operating systems
- Can look unprofessional
- Limited styling options
- Accessibility concerns

**Benefits of Inline SVGs:**
- Consistent across all platforms
- Can be styled with CSS (color, size)
- Crisp at any resolution
- Professional appearance

### CSS Design System

We use CSS custom properties (variables) for consistency:

```css
:root {
  /* Colors */
  --primary-500: #6366f1;
  --gray-500: #6b7280;
  
  /* Shadows */
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  
  /* Spacing */
  --space-4: 16px;
  
  /* Radius */
  --radius-md: 8px;
}
```

**Why?**
- Single source of truth for design tokens
- Easy theming in the future
- Consistent spacing and colors
- Reduces CSS bugs

### Guide Management Features

| Feature | Why We Added It |
|---------|-----------------|
| **Search** | Users accumulate many guides, need to find them quickly |
| **Categories** | Organize guides by purpose (navigation, settings, etc.) |
| **Rename** | Auto-generated names from AI aren't always good |
| **Delete Confirmation** | Prevent accidental deletions |
| **Scrollable List** | List grows tall with many guides |

---

## Common Pitfalls & Solutions

### Pitfall 1: Element Not Found After Page Load

**Problem:** Guide tries to highlight before page fully loads.

**Solution:** Use the bounded geometry-stability wait in `PageIntelligence.reveal()` and re-resolve the target after layout changes. A delay by itself is not evidence that a target is usable.

### Pitfall 2: Selector Works in DevTools But Not in Extension

**Problem:** Timing issue - element exists when you test manually but not when script runs.

**Solution:** Implement retry logic:
```javascript
async findElementWithRetry(selectors, maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    const element = this.findElement(selectors);
    if (element) return element;
    await new Promise(r => setTimeout(r, 200 * (i + 1)));
  }
  return null;
}
```

### Pitfall 3: Guides Break When Site Updates

**Problem:** CSS selectors become invalid after site redesign.

**Solution:** Store multiple selector types and use text-based fallbacks:
```javascript
robustSelectors: {
  primary: "button.submit-btn",      // May break
  text: "Submit",                    // Usually stable
  ariaLabel: "Submit form"           // Accessibility, stable
}
```

### Pitfall 4: Voice Recognition Doesn't Work

**Problem:** SpeechRecognition API only works in secure contexts with user gesture.

**Solution:** 
1. Must be HTTPS or localhost
2. Request microphone permission explicitly
3. Start recognition on user click (not programmatically)

### Pitfall 5: Background Script Stops

**Problem:** Manifest V3 service workers are not persistent.

**Solution:** Don't store state in background script variables. Use `chrome.storage`:
```javascript
// ❌ Bad - state lost when worker sleeps
this.currentGuide = guide;

// ✅ Good - persisted
chrome.storage.session.set({ currentGuide: guide });
```

---

## Performance Considerations

### DOM Extraction

Snapshots are capped at 150 elements and report truncation. Open dialog controls are prioritized. Node IDs are kept outside the DOM, avoiding extraction-induced mutations.

We only extract interactive elements to reduce payload:
- Buttons, links, inputs
- Elements with click handlers
- Skip hidden/invisible elements

### Debouncing

For search and filter inputs:
```javascript
// Don't filter on every keystroke
this.guideSearchInput.addEventListener('input', 
  debounce(() => this.filterGuides(), 150)
);
```

### Lazy Loading

Guide list items are only rendered when the saved guides view is opened.

---

## Automated Regression Checks

```bash
npm ci
npm run check
npm test
npm run test:browser
```

The browser suite runs the actual content scripts against a local dynamic fixture with mocked Chrome messaging/storage and mocked planner responses. It uses installed Google Chrome on macOS; elsewhere install Playwright Chromium with `npx playwright install chromium`, or set `GUIDEME_CHROME_PATH` to an executable. It does not call model providers or depend on authenticated accounts. The fixtures cover identity stability, semantic ambiguity, DOM replacement, privacy, nested scrolling, obstruction, verification, cancellation, full navigation, SPA navigation, saved replay and popup/controller communication. Provider quality and behavior on real sites still need manual testing.

## Testing Checklist

When making changes, test:

- [ ] Fresh guide generation (with AI)
- [ ] Saved guide playback (without AI)
- [ ] Multi-page navigation
- [ ] SPA navigation (test on YouTube)
- [ ] Import/export .guideme files
- [ ] Voice input
- [ ] Search and filter
- [ ] Rename and delete

---

## Questions?

Open an issue on GitHub or check existing discussions!
