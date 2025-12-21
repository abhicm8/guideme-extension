<div align="center">

# 🎯 GuideMe

**AI-powered step-by-step guidance for any website**

*Like game hints, but for website*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Platform-Chrome%20Extension-blue)](https://developer.chrome.com/docs/extensions/)
[![AI Powered](https://img.shields.io/badge/AI-Gemini%20%7C%20OpenAI%20%7C%20Claude-purple)](https://ai.google.dev/)

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Configuration](#%EF%B8%8F-configuration) • [Contributing](#-contributing)

</div>

---

## 🤔 What is GuideMe?

Ever been stuck on a website, not knowing where to click? **GuideMe** is like having a helpful friend looking over your shoulder, pointing exactly where to click next.

Ask a question like *"How do I change my profile picture?"* and GuideMe will:
1. Analyze the current page
2. Identify the exact buttons/links to click
3. Highlight them one by one
4. Guide you through multi-page flows automatically

**No more hunting through menus. No more confusing UIs.**

## ✨ Features

- 🧠 **AI-Powered** - Uses Gemini (free!), OpenAI, or Claude to understand any website
- 🎯 **Precise Highlighting** - Points to exact elements with visual overlays
- 📄 **Multi-Page Flows** - Automatically continues guidance across page navigations
- 🔄 **Dynamic Content** - Refresh button to re-scan after opening dropdowns/menus
- 🆓 **Free to Use** - Works with Google Gemini's free API tier
- 🔒 **Privacy First** - All processing happens locally, your API key stays in your browser
- 🌐 **Universal** - Works on any website

## 📸 Screenshots

<img width="1272" height="668" alt="1" src="https://github.com/user-attachments/assets/ac876298-a78a-4d7f-93c5-3a264bf0c2fe" />


https://github.com/user-attachments/assets/f46b46e2-f838-4d7a-a443-b61b5e7a59a1


<img width="543" height="762" alt="image" src="https://github.com/user-attachments/assets/f00d5821-895c-4f15-9424-2558e1185077" />

<img width="911" height="706" alt="image" src="https://github.com/user-attachments/assets/8cb5d9c6-888c-4070-99f9-c642a5fb5675" />


## 📦 Installation

### From Source (Developer Mode)

1. **Clone the repository**
   ```bash
   git clone https://github.com/abhicm8/guideme-extension.git
   cd guideme-extension
   ```

2. **Load in Chrome**
   - Open Chrome and go to `chrome://extensions/`
   - Enable **"Developer mode"** (top right toggle)
   - Click **"Load unpacked"**
   - Select the `guideme-extension` folder

3. **Get an API Key** (Free!)
   - Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Create a free API key
   - Click the GuideMe extension icon → ⚙️ Settings → Paste your key

### From Chrome Web Store
*Coming soon*

## 🚀 Usage

1. **Click the GuideMe icon** in your browser toolbar
2. **Type your question** in natural language:
   - *"How do I change my password?"*
   - *"Where are the notification settings?"*
   - *"How to create a new repository?"*
3. **Click "Guide Me"** and follow the highlighted elements
4. **Click the highlighted element** to auto-advance to the next step

### Tips

- 🔄 **Can't find element?** Click the refresh button to re-scan the page (useful after opening dropdowns)
- ✕ **Stop anytime** by clicking the X on the floating panel
- 🔗 **Multi-page flows** work automatically - the guide persists when you navigate

## ⚙️ Configuration

Click the ⚙️ icon in the extension popup to access settings.

### API Providers

| Provider | Cost | Quality | Get API Key |
|----------|------|---------|-------------|
| **Gemini** (default) | 🆓 Free | Good | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **OpenAI** | 💰 Paid | Excellent | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Claude** | 💰 Paid | Excellent | [console.anthropic.com](https://console.anthropic.com/) |

### Settings

| Setting | Description |
|---------|-------------|
| **API Provider** | Choose your AI provider (Gemini recommended for free usage) |
| **API Key** | Your provider's API key (stored locally in browser) |
| **Highlight Color** | Customize the highlight color for better visibility |

## 🏗️ How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  User asks: "How do I change my profile picture?"           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Content Script extracts all clickable elements          │
│     Each element gets a unique ID: gm-0, gm-1, gm-2...      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Background Script sends element list + question to AI   │
│     AI sees: gm-5: "Settings" [link] (sidebar)              │
│              gm-12: "Profile" [button] (main)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  3. AI returns steps with exact element IDs                 │
│     Step 1: Click gm-5 ("Settings")                         │
│     Step 2: Click gm-12 ("Profile")                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Content Script highlights elements by ID                │
│     User clicks → Auto-advances → Page navigates            │
│     → Re-extracts DOM → Continues guidance                  │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
guideme-extension/
├── manifest.json          # Chrome extension manifest (V3)
├── popup/                 # Extension popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/               # Injected into web pages
│   ├── content.js         # DOM extraction, highlighting
│   └── overlay.css        # Highlight styles
├── background/            # Service worker
│   └── background.js      # AI API communication
└── icons/                 # Extension icons
```

## 🤝 Contributing

Contributions are welcome! Whether it's bug fixes, new features, or documentation improvements.

### Getting Started

1. **Fork** the repository
2. **Clone** your fork
   ```bash
   git clone https://github.com/YOUR_USERNAME/guideme-extension.git
   ```
3. **Create** a feature branch
   ```bash
   git checkout -b feature/amazing-feature
   ```
4. **Make** your changes
5. **Test** by loading the extension in Chrome
6. **Commit** your changes
   ```bash
   git commit -m 'Add amazing feature'
   ```
7. **Push** to your branch
   ```bash
   git push origin feature/amazing-feature
   ```
8. **Open** a Pull Request

### Ideas for Contribution

- 🦊 Firefox extension support
- 📹 Guide recording and sharing
- 🌍 Internationalization (i18n)
- 🎨 Theme customization
- 📊 Usage analytics dashboard
- 🤖 Support for more AI providers
- 🧩 Plugin architecture for custom features
- 🐛 Bug fixes and performance improvements

## 📋 Roadmap

- [ ] Publish to Chrome Web Store
- [ ] Firefox support
- [ ] Guide recording/playback
- [ ] Share guides with others
- [ ] Pre-built guides for popular sites
- [ ] Enterprise/team features
- [ ] Analytics dashboard

## 🐛 Known Limitations

- Works best on well-structured pages with clear labels
- Dynamic content (dropdowns, modals) may require clicking the refresh button
- AI responses may vary - use refresh if guidance seems incorrect
- Some complex workflows may need multiple guide sessions

## ❓ FAQ

**Q: Is my API key safe?**
> Yes! Your API key is stored only in your browser's local storage and is only sent to your chosen AI provider (Google, OpenAI, or Anthropic).

**Q: Does GuideMe work offline?**
> No, it requires an internet connection to communicate with the AI provider.

**Q: Why did GuideMe highlight the wrong element?**
> AI isn't perfect. Try clicking the 🔄 refresh button to re-scan the page, especially after opening menus or dropdowns.

**Q: Can I use this commercially?**
> Yes! GuideMe is MIT licensed, allowing commercial use.

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

This means you can:
- ✅ Use commercially
- ✅ Modify
- ✅ Distribute
- ✅ Use privately

## 👤 Author

<div align="center">

**Abhishek C M**

[![GitHub](https://img.shields.io/badge/GitHub-@abhicm8-black?style=flat&logo=github)](https://github.com/abhicm8)

</div>

---

<div align="center">

### ⭐ Star this repo if GuideMe helped you!

**[Report Bug](https://github.com/abhicm8/guideme-extension/issues)** • **[Request Feature](https://github.com/abhicm8/guideme-extension/issues)**

</div>
