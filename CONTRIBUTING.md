# Contributing to GuideMe

First off, thanks for taking the time to contribute! 🎉

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs what actually happened
- **Screenshots** if applicable
- **Environment** (Chrome version, OS, website URL where issue occurred)
- **Console errors** (Right-click → Inspect → Console tab)

### Suggesting Features

Feature requests are welcome! Please provide:

- **Clear description** of the feature
- **Use case** - why would this be useful?
- **Possible implementation** (optional but helpful)

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. Ensure your code follows the existing style
4. Make sure your code lints
5. Issue your pull request!

## Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/guideme-extension.git
   ```

2. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `guideme-extension` folder

3. Make changes and reload:
   - After editing files, click the refresh icon on the extension card in `chrome://extensions/`
   - For popup changes, close and reopen the popup
   - For content script changes, refresh the webpage

## Code Style

- Use 2-space indentation
- Use meaningful variable names
- Comment complex logic
- Keep functions small and focused
- Use async/await for asynchronous code

## Project Structure

```
guideme-extension/
├── manifest.json      # Extension configuration
├── popup/             # Extension popup (user interface)
│   ├── popup.html     # Popup markup
│   ├── popup.css      # Popup styles
│   └── popup.js       # Popup logic
├── content/           # Runs on web pages
│   ├── content.js     # DOM interaction
│   └── overlay.css    # Highlight styles
├── background/        # Service worker (background)
│   └── background.js  # API calls, message handling
└── icons/             # Extension icons
```

## Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Keep first line under 72 characters
- Reference issues when relevant

Examples:
```
Add Firefox support
Fix element highlighting on dynamic content
Update README with new screenshots
```

## Need Help?

Feel free to open an issue with your question!

---

Thank you for contributing! 🙏
