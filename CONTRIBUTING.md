# Contributing to GuideMe

First off, thanks for taking the time to contribute! 🎉

This guide will help you understand the codebase and avoid common pitfalls.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Understanding the Codebase](#understanding-the-codebase)
- [Code Style](#code-style)
- [Making Changes](#making-changes)
- [Testing Your Changes](#testing-your-changes)
- [Common Pitfalls](#common-pitfalls)
- [Pull Request Process](#pull-request-process)

---

## Getting Started

### Prerequisites

- Chrome browser (latest version)
- Basic knowledge of JavaScript, HTML, CSS
- Familiarity with Chrome Extension APIs (helpful but not required)
- Git

### Quick Links

- 📖 [Architecture Guide](ARCHITECTURE.md) - Deep dive into how everything works
- 🗺️ [Ecosystem Plan](ECOSYSTEM_PLAN.md) - Future roadmap and vision
- 🐛 [Issue Tracker](https://github.com/abhicm8/guideme-extension/issues)

---

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/guideme-extension.git
cd guideme-extension
```

### 2. Load in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `guideme-extension` folder

### 3. Get an API Key (for testing AI features)

- Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
- Create a free API key
- Open the extension popup → Settings → Paste your key

### 4. Making Changes

After editing files:
- **Popup/Background changes**: Click the 🔄 refresh icon on the extension card
- **Content script changes**: Refresh the webpage you're testing on
- **Manifest changes**: Reload the entire extension

---

## Project Structure

```
guideme-extension/
├── manifest.json           # Extension configuration (Manifest V3)
├── popup/                  # Extension popup UI
│   ├── popup.html          # UI structure (inline SVG icons)
│   ├── popup.css           # Design system with CSS variables
│   └── popup.js            # Main popup logic (GuideMePopup class)
├── content/                # Injected into web pages
│   ├── content.js          # DOM extraction, highlighting, navigation
│   └── overlay.css         # Highlight and overlay styles
├── background/             # Service worker
│   └── background.js       # AI APIs, storage, message handling
├── lib/                    # Shared libraries
│   └── guideme-format.js   # .guideme file format specification
├── icons/                  # Extension icons (16, 48, 128px)
├── ARCHITECTURE.md         # Technical deep-dive (READ THIS!)
├── CONTRIBUTING.md         # This file
└── README.md               # User-facing documentation
```

---

## Understanding the Codebase

### Key Concepts

#### 1. Message Passing

Components communicate via Chrome's messaging API:

```javascript
// From popup to background
chrome.runtime.sendMessage({ type: 'GENERATE_GUIDE', payload: {...} });

// From popup to content script
chrome.tabs.sendMessage(tabId, { type: 'HIGHLIGHT_STEP', payload: {...} });

// Listening for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_DOM') {
    // Handle request
    sendResponse(result);
  }
  return true; // Keep channel open for async response
});
```

#### 2. Storage

We use Chrome's storage APIs:

```javascript
// Persistent storage (survives browser restart)
chrome.storage.local.set({ apiKey: 'xxx' });
chrome.storage.local.get(['apiKey']);

// Session storage (cleared when browser closes)
chrome.storage.session.set({ activeGuide: {...} });
```

#### 3. Robust Element Selectors

When capturing elements, we store multiple ways to find them:

```javascript
robustSelectors: {
  primary: '#submit-btn',           // CSS selector
  fallback: 'form button[type=submit]',
  text: 'Submit',                   // Visible text
  ariaLabel: 'Submit form',         // Accessibility
  testId: 'submit-button'           // data-testid
}
```

This redundancy ensures guides work even when sites update.

#### 4. Multi-Page State

Guide state persists across page navigations via `chrome.storage.session`. See [ARCHITECTURE.md](ARCHITECTURE.md#multi-page-flow-handling) for details.

---

## Code Style

### JavaScript

- **2-space indentation**
- **Single quotes** for strings
- **async/await** over raw promises
- **Meaningful variable names**
- **Comments for complex logic**

```javascript
// ✅ Good
async function findElement(selectors) {
  // Try primary selector first, fall back to text matching
  const element = document.querySelector(selectors.primary);
  if (element) return element;
  
  return this.findByText(selectors.text);
}

// ❌ Bad
async function f(s) {
  var e = document.querySelector(s.p);
  if(e)return e;
  return this.fbt(s.t);
}
```

### CSS

- Use **CSS custom properties** (variables) for colors, spacing, shadows
- Follow the existing design system in `popup.css`
- Use **BEM-like naming**: `.guide-item`, `.guide-item-name`, `.guide-action-btn`

```css
/* ✅ Good - uses design tokens */
.my-button {
  background: var(--primary-500);
  padding: var(--space-3);
  border-radius: var(--radius-md);
}

/* ❌ Bad - hardcoded values */
.my-button {
  background: #6366f1;
  padding: 12px;
  border-radius: 8px;
}
```

### HTML

- Use **inline SVG icons** (not emojis)
- Keep structure semantic
- Include accessibility attributes where appropriate

```html
<!-- ✅ Good -->
<button class="icon-btn" title="Delete guide">
  <span class="icon icon-sm">
    <svg viewBox="0 0 24 24">...</svg>
  </span>
</button>

<!-- ❌ Bad -->
<button onclick="deleteGuide()">🗑️</button>
```

---

## Making Changes

### Adding a New Feature

1. **Check existing issues** - Someone might already be working on it
2. **Read [ARCHITECTURE.md](ARCHITECTURE.md)** - Understand how components interact
3. **Start small** - Make incremental changes, test frequently
4. **Update documentation** - If you add features, document them

### Modifying the Popup UI

1. **HTML** (`popup.html`): Add structure with inline SVG icons
2. **CSS** (`popup.css`): Use existing design tokens
3. **JS** (`popup.js`): Add element bindings in `bindElements()`, handlers in `bindEvents()`

### Modifying Element Matching

This is the most sensitive part. Changes here can break guide playback.

1. **Always test on multiple sites** - GitHub, YouTube, Gmail, Wikipedia
2. **Keep fallback strategies** - Never remove fallback matching
3. **Log extensively** - Use `console.log` to debug matching failures

### Modifying the .guideme Format

The format is versioned. If you change the schema:

1. Increment `formatVersion` in `lib/guideme-format.js`
2. Add migration logic for old versions
3. Update the format documentation

---

## Testing Your Changes

### Manual Testing Checklist

Before submitting a PR, test these scenarios:

#### Basic Flow
- [ ] Ask AI a question, get guide
- [ ] Follow guide to completion
- [ ] Save guide with name and category
- [ ] Replay saved guide

#### Multi-Page
- [ ] Guide that navigates to new page
- [ ] State persists after navigation
- [ ] Works on SPAs (test YouTube: "How to upload a video")

#### Guide Management
- [ ] Search filters guides
- [ ] Category pills filter correctly
- [ ] Rename guide works
- [ ] Delete with confirmation
- [ ] List scrolls when many guides

#### Import/Export
- [ ] Export guide to .guideme file
- [ ] Import .guideme file
- [ ] Imported guide plays correctly

#### Edge Cases
- [ ] Voice input works
- [ ] Handles elements not found gracefully
- [ ] Works on different sites (test 3-4 different sites)

### Debug Tips

1. **Popup Console**: Right-click extension icon → Inspect popup
2. **Background Console**: `chrome://extensions/` → Click "Service worker"
3. **Content Script Console**: Regular DevTools on the webpage (F12)

---

## Common Pitfalls

### ❌ Storing State in Background Variables

**Problem**: Manifest V3 service workers sleep when idle. Variables are lost.

```javascript
// ❌ Bad - state lost when worker sleeps
class Background {
  constructor() {
    this.currentGuide = null;
  }
}

// ✅ Good - persisted
chrome.storage.session.set({ currentGuide: guide });
```

### ❌ Relying Only on CSS Selectors

**Problem**: Sites update, selectors break, guides fail.

```javascript
// ❌ Bad
element: { selector: '#old-button-id' }

// ✅ Good
robustSelectors: {
  primary: '#new-button-id',
  text: 'Submit',
  ariaLabel: 'Submit form'
}
```

### ❌ Not Handling Async Properly

**Problem**: Chrome message handlers need `return true` for async responses.

```javascript
// ❌ Bad - sendResponse called after handler returns
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  fetchData().then(data => sendResponse(data));
});

// ✅ Good
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  fetchData().then(data => sendResponse(data));
  return true; // Keep channel open
});
```

### ❌ Using Emojis in UI

**Problem**: Render differently across OS, look unprofessional.

```html
<!-- ❌ Bad -->
<button>🗑️ Delete</button>

<!-- ✅ Good -->
<button>
  <span class="icon"><svg>...</svg></span>
  Delete
</button>
```

### ❌ Hardcoding CSS Values

**Problem**: Inconsistent styling, hard to maintain.

```css
/* ❌ Bad */
.button { background: #6366f1; }
.link { color: #6366f1; }

/* ✅ Good */
.button { background: var(--primary-500); }
.link { color: var(--primary-500); }
```

---

## Pull Request Process

### 1. Fork and Branch

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/bug-description
```

### 2. Make Changes

- Follow code style guidelines
- Test thoroughly
- Update documentation if needed

### 3. Commit

Use clear, descriptive commit messages:

```bash
# Good examples
git commit -m "Add category filter to saved guides"
git commit -m "Fix element matching on YouTube"
git commit -m "Update README with new screenshots"

# Bad examples
git commit -m "fix stuff"
git commit -m "wip"
```

### 4. Push and Create PR

```bash
git push origin feature/my-feature
```

Then open a Pull Request on GitHub with:
- Clear title describing the change
- Description of what and why
- Screenshots/videos if UI changes
- Testing notes

### 5. Review Process

- Maintainers will review your PR
- Address any feedback
- Once approved, it will be merged!

---

## Ideas for Contribution

Looking for something to work on?

| Difficulty | Idea |
|------------|------|
| 🟢 Easy | Fix typos, improve documentation |
| 🟢 Easy | Add more quick action buttons |
| 🟡 Medium | Firefox extension support |
| 🟡 Medium | Dark mode theme |
| 🟡 Medium | Keyboard shortcuts |
| 🔴 Hard | Guide recording (watch user clicks) |
| 🔴 Hard | Guide sharing platform |
| 🔴 Hard | Support more AI providers |

---

## Questions?

- Check existing [Issues](https://github.com/abhicm8/guideme-extension/issues)
- Read the [Architecture Guide](ARCHITECTURE.md)
- Open a new issue with your question

Thank you for contributing! 🙏
