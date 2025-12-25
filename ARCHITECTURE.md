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
| `popup.html` | Main UI structure with inline SVG icons |
| `popup.css` | Design system with CSS variables |
| `popup.js` | UI logic, state management, guide playback |

**Key Classes:**
- `GuideMePopup` - Main controller class managing all popup functionality

### `/background/` - Service Worker

| File | Purpose |
|------|---------|
| `background.js` | AI API calls, message routing, storage management |

**Key Classes:**
- `GuideMeBackground` - Handles all background operations
- Uses Chrome's Manifest V3 service worker (not persistent background page)

### `/content/` - Content Scripts

| File | Purpose |
|------|---------|
| `content.js` | DOM extraction, element highlighting, click handling |
| `overlay.css` | Highlight styles injected into pages |

**Key Classes:**
- `GuideMeContent` - Injected into every webpage

### `/lib/` - Shared Libraries

| File | Purpose |
|------|---------|
| `guideme-format.js` | .guideme file format specification and utilities |

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

This is the most critical part of the extension. Here's the priority order:

### 1. Direct ID Match (Fastest)
```javascript
document.getElementById(step.elementId)
```

### 2. Robust Selectors (Most Reliable)
```javascript
// Try in order:
1. robustSelectors.testId     // data-testid attribute
2. robustSelectors.ariaLabel  // [aria-label="..."]
3. robustSelectors.primary    // Original CSS selector
4. robustSelectors.fallback   // Alternative selector
```

### 3. Text-Based Matching (Fallback)
```javascript
// Find by visible text content
findByTextAndTag(text, tagHint)  // "Submit" on a button
findByKeywords(keywords)         // Multiple keyword match
```

### Why This Order?

- **Test IDs** are added by developers for testing, rarely change
- **ARIA labels** are accessibility requirements, stable
- **CSS selectors** can break when site redesigns
- **Text content** is visible to users, usually stable

### Common Pitfalls

❌ **Don't rely only on CSS selectors** - They break when sites update
❌ **Don't use nth-child selectors** - Page structure changes
✅ **Always capture multiple selector types** - Redundancy is good
✅ **Use text content as fallback** - Most stable across updates

---

## Multi-Page Flow Handling

### The Challenge

When a user clicks a link and navigates to a new page:
1. Content script is destroyed
2. New page loads
3. New content script starts fresh
4. Guide state is lost!

### Our Solution

We persist guide state in `chrome.storage.session`:

```javascript
// Before navigation
chrome.storage.session.set({
  guideme_active_guide: {
    steps: [...],
    currentIndex: 2,
    task: "Original question"
  }
});

// On new page load
chrome.storage.session.get(['guideme_active_guide'], (result) => {
  if (result.guideme_active_guide) {
    // Resume guide from where we left off
    this.resumeGuide(result.guideme_active_guide);
  }
});
```

### Key Events We Handle

1. **`pageshow`** - Fires on navigation (including back/forward)
2. **SPA Navigation** - MutationObserver for URL changes without page reload
3. **`visibilitychange`** - Tab switching

### SPAs (Single Page Applications)

Sites like YouTube, Gmail, Twitter don't do full page reloads. We detect URL changes:

```javascript
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    this.handleSPANavigation();
  }
});
```

---

## UI Design Decisions

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

**Solution:** Wait for DOM stability:
```javascript
await new Promise(resolve => setTimeout(resolve, 500));
// Or use MutationObserver to detect when content stabilizes
```

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
