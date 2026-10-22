<div align="center">

# 🎯 GuideMe

**AI-powered step-by-step guidance for any website**

*Stop taking notes from tutorials. Let GuideMe point exactly where to click.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Platform-Chrome%20Extension-blue)](https://developer.chrome.com/docs/extensions/)
[![AI Powered](https://img.shields.io/badge/AI-Gemini%20%7C%20OpenAI%20%7C%20Claude-purple)](https://ai.google.dev/)
[![Video Tutorials](https://img.shields.io/badge/📹_Video-Tutorials-red?logo=youtube)](https://www.youtube.com/playlist?list=PLnhnGJlc9teGAHyv3gaXkxPGkjik1pHTi)

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Video Tutorials](https://www.youtube.com/playlist?list=PLnhnGJlc9teGAHyv3gaXkxPGkjik1pHTi) • [Contributing](#-contributing--guide-creation)
Visit : [https://guideme-web.vercel.app]
</div>

---

## Persistent workspace

GuideMe now opens alongside your webpage in Chrome's native side panel (Chrome 141+). Click the toolbar icon to open it. **Hide** keeps planning and the current guide active; a small page companion lets you reopen the workspace, confirm a step, or stop. The workspace shows processing stages, verified/manual step counts, and recent activity. Settings, the guide library, import/export, and recording remain available.

Choose **Light** or **Dark** under **Settings → Appearance**. The selection saves immediately and stays independent of your system or browser theme.

A labelled **Stop** button stays in the workspace header during planning and guidance, including when you switch to Settings or Library. Hiding the panel keeps the guide running; Stop cancels the pending guide and removes its highlights. The page companion also has a labelled Stop control.

Guided form steps show **What to enter** and an **On this form** checklist. Opening a new focused compose form can now verify the Compose click automatically. For supported type/select steps, edit the highlighted field and press **Tab**, or choose **Next** to confirm manually. Clicking a field alone does not finish it. Field presence/validity are reported as booleans; manually entered recipient, subject and body values are not copied into AI snapshots or checkpoints. Presence does not prove the content is correct. Repeated clicks trigger at most one corrective replan, then end with a useful handoff if highlighting would repeat the action.

For live guidance, a trusted click registers immediately. GuideMe distinguishes **result verified**, **confirmed by you**, and **click recorded; result unverified**. It can move on after observing your click without claiming that the requested change succeeded. Saved replay retains its stricter verification/manual-confirmation behaviour.

Guides now have explicit endings: **handoff** (explain the current state and remaining actions), **complete** (the page reports an outcome with visible evidence), or **blocked** (explain missing context and a useful way forward). The summary replaces stale highlights and persists for the owning tab across panel/page reopening. **Guide me step by step** resumes the same task if you want more help. The model derives summaries from your request and the current page; a generic fallback uses observed field labels, with no site-specific workflow mapping. Empty plans receive at most one summary repair request and do not leave the old step highlighted. An open form alone is never evidence that its business action succeeded.

The agreed design for a future email automation mode is: provide recipient, subject and body → fill a draft → review the exact draft → explicitly approve **Send in GuideMe**. Draft changes must invalidate that approval. This execution mode is not implemented yet; the current mode guides the user's own actions.


After updating an unpacked installation, reload the extension at `chrome://extensions` and refresh your webpage so the new panel and content scripts are loaded.

## ⚡ Quick Start

```bash
# 1. Clone
git clone https://github.com/abhicm8/guideme-extension.git

# 2. Load in Chrome
#    Go to chrome://extensions → Enable Developer Mode → Load Unpacked → Select folder

# 3. Get free API key from https://aistudio.google.com/apikey

# 4. Click GuideMe icon → Settings → Paste API key → Done!
```

---

## 🤔 What is GuideMe?

Most AI tools **summarize pages** or **give you text instructions** you have to follow manually. GuideMe is different — it **actually highlights the exact buttons and links** you need to click, guiding you step-by-step through any workflow.

**The Problem:** You're learning Figma, Photoshop, or navigating a complex admin panel. You ask an AI "how do I do X?" and get a wall of text. Now you have to hunt through menus trying to match the instructions.

**GuideMe's Solution:** Ask your question, and GuideMe will:
1. Analyze the current page
2. Identify the exact elements to click
3. Highlight them one by one
4. Guide you through multi-page flows automatically
5. **Export to automation scripts** (Puppeteer, Playwright, Selenium) for testing!

**No more hunting through menus. No more taking notes from YouTube tutorials.**

### 🤖 Bonus: Test Automation Made Easy

**Beyond just guiding users, GuideMe doubles as a test automation recorder!**

Manually record your clicks, export the guide, and instantly convert it into executable test scripts:
- **Puppeteer** (Node.js automation)
- **Playwright** (Cross-browser testing)
- **Selenium** (Python automation)

Perfect for QA engineers who need to create regression tests, or developers building CI/CD pipelines. See [AUTOMATION_EXPORT.md](AUTOMATION_EXPORT.md) for details.

visit : [https://guideme-web.vercel.app]

---

## 🌟 What Makes This Different?

| Traditional AI | GuideMe |
|----------------|---------|
| "Click on File > Export > Export As..." | *Highlights the File menu for you* |
| You read, remember, search | Just follow the highlights |
| Text instructions | Visual guidance |
| One-time answer | Save and replay guides forever |

### Three Powerful Modes

1. **AI Mode** - Ask any question, AI analyzes the page and creates a guide on-the-fly
2. **Recording Mode** - Manually record your clicks step-by-step (perfect for automation export!)
3. **Replay Mode** - Replay saved guides without any AI calls (works offline!)

This helps:
- **Users** who just want to get things done
- **QA Engineers** who need to create automated test scripts
- **Developers/teams** who can create guides and tests for their users

---

## ⚠️ Honest Limitations

**This is not perfect.** It's a work in progress and can definitely be improved.

- Works best on well-structured pages with clear labels
- Dynamic content (dropdowns, modals) may need a page refresh
- AI responses can vary — use refresh if guidance seems off
- Complex workflows may need multiple guide sessions
- Currently **websites only** — desktop apps are a future goal

But even with these limitations, it's useful. Most AI tools don't even try to show you *where* to click — they just tell you.

---

## 🧠 The Hard Truth: Why This Problem is Difficult

**What you're seeing is one of the hardest unsolved problems in AI right now.**

### The Core Challenge

When you look at a webpage, you instantly know which "Code" button to click — the big green one, not the small tab in the header. **You can SEE it.**

But the AI receives only text:
```
gm-5: "Code" [button] (main)
gm-12: "Code" [link] (header)
```

It cannot see:
- Visual prominence (colors, size, position)
- Spatial relationships (what's next to what)
- UI patterns (that green usually means "action")
- Context from surrounding elements

**Humans pick the right element instantly because we have eyes. The AI is essentially blind, making educated guesses from text hints.**

### Who Else is Working on This?

This isn't an unexplored problem — some of the biggest AI companies are tackling it:

| Company | Product | Funding |
|---------|---------|---------|
| **Adept.ai** | ACT-1 (AI that uses software) | $415M+ |
| **MultiOn** | Browser automation agent | $29M |
| **Anthropic** | Claude Computer Use | $8B+ |
| **OpenAI** | Operator (rumored) | $13B+ |

These companies have hundreds of engineers and billions in funding. **The fact that this is hard doesn't mean we shouldn't try — it means solving even part of it is meaningful.**

### What Would Make This Better

| Current Approach | What Could Help |
|-----------------|-----------------|
| Text-only DOM | **Vision AI** (send screenshots to GPT-4V/Claude Vision) |
| Generic prompts | **Site-specific training** (learn GitHub, AWS, Figma patterns) |
| One-shot guessing | **Feedback loops** (learn from user corrections) |
| Stateless | **Memory** (remember what worked on this site) |

### A Call to Contributors 🚀

**This is genuinely hard — and that's exactly why it's exciting.**

Every improvement you make helps thousands of users. Some ideas:
- **Add vision AI support** — send screenshots alongside DOM
- **Improve element extraction** — better hints, better context
- **Create site-specific guides** — pre-built paths for common sites
- **Build feedback mechanisms** — let users correct wrong selections

The gap between "working demo" and "magical experience" is where the interesting engineering happens. If you're looking for an impactful open source project to contribute to — this is it.

---

## ✨ Features

### Core
- 🧠 **AI-Powered** - Gemini (free!), OpenAI, or Claude
- 🎯 **Visual Highlighting** - Points to exact elements
- 📄 **Multi-Page Flows** - Continues across page navigations
- 🔄 **SPA Support** - Works on YouTube, Gmail, Twitter
- 🎤 **Voice Commands** - Speak your question
- 🆓 **Free Tier** - Works with Google Gemini's free API

### Guide Management
- 💾 **Save Guides** - Replay without AI
- 📁 **Categories** - Organize by type
- 🔍 **Search & Filter** - Find guides quickly
- 📤 **Export/Import** - Share `.guideme` files
- 🤖 **Automation Export** - Convert to Puppeteer/Playwright/Selenium scripts

## 📸 Screenshots & Video Tutorials

### 📹 Watch GuideMe in Action

**New to GuideMe? Watch our video tutorials!**

[![GuideMe Tutorial Playlist](https://img.shields.io/badge/▶️_Watch-Tutorial_Playlist-red?style=for-the-badge&logo=youtube)](https://www.youtube.com/playlist?list=PLnhnGJlc9teGAHyv3gaXkxPGkjik1pHTi)

Learn how to:
- Install and set up GuideMe
- Create AI-powered guides
- Record guides manually
- Export to automation scripts (Puppeteer, Playwright, Selenium)
- Share guides with your team

---

### Screenshots

<img width="1272" height="668" alt="GuideMe in action" src="https://github.com/user-attachments/assets/ac876298-a78a-4d7f-93c5-3a264bf0c2fe" />

https://github.com/user-attachments/assets/f46b46e2-f838-4d7a-a443-b61b5e7a59a1

<img width="911" height="706" alt="Guide in progress" src="https://github.com/user-attachments/assets/8cb5d9c6-888c-4070-99f9-c642a5fb5675" />

New UI Elements

<img width="575" height="723" alt="image" src="https://github.com/user-attachments/assets/b0a46192-5ce9-4d23-80d3-fe4e62cff456" />

Orgainsing the saved guideme steps. 

<img width="571" height="893" alt="image" src="https://github.com/user-attachments/assets/3724fb9c-cbb1-4857-b840-f37409294c92" />

Managing the api keys

<img width="570" height="811" alt="image" src="https://github.com/user-attachments/assets/98f0eed3-201a-4bf2-b9f6-7e713298fdcc" />


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

### Basic Usage
1. **Click the GuideMe icon** in your browser toolbar
2. **Type your question** in natural language:
   - *"How do I change my password?"*
   - *"Where are the notification settings?"*
   - *"How to upload a video?"*
3. **Click "Guide Me"** and follow the highlighted elements
4. **Click the highlighted element** to auto-advance to the next step

### 🎤 Voice Commands
1. Click the **microphone button** next to the text input
2. **Speak your question** naturally
3. GuideMe will transcribe and start guiding!

*Perfect for accessibility or when your hands are busy.*

### 💾 Saving Guides
1. Complete a guide successfully
2. Click **"Save This Guide"** button
3. Give your guide a name and select a category
4. Find it later in **Saved Guides** (book icon in header)

### 📁 Managing Saved Guides
- **Search**: Type in the search box to filter guides
- **Filter**: Click category pills (All, Navigation, Settings, Account, Other)
- **Rename**: Click the pencil icon on any guide
- **Export**: Click the export icon to save as `.guideme` file
- **Delete**: Click the trash icon (with confirmation)
- **Play**: Click on any guide to replay it instantly (no AI needed!)

### 📤 Sharing Guides
1. Open **Saved Guides**
2. Click the **export icon** on any guide
3. Share the `.guideme` file with others
4. They can **Import** it and use it immediately!

*Great for teams, documentation, or helping friends navigate complex sites.*

### 🤖 Automation Export (QA Engineers & Developers)

**Turn your guides into executable test scripts!**

1. Create or open a saved guide (manually recorded guides work best!)
2. Click the **automation export** icon
3. Choose your framework:
   - **Puppeteer** (Node.js browser automation)
   - **Playwright** (Cross-browser testing)
   - **Selenium** (Python automation)
4. Download the generated script
5. Run it in your CI/CD pipeline!

**Perfect for:**
- Regression testing
- Automated QA workflows
- CI/CD integration
- End-to-end testing

📖 **See [AUTOMATION_EXPORT.md](AUTOMATION_EXPORT.md) for detailed documentation and examples.**

### Tips
- 🔄 **Can't find element?** Click the refresh button to re-scan the page
- ✕ **Stop anytime** by clicking the X on the floating panel
- 🔗 **Multi-page flows** work automatically - the guide persists when you navigate

## ⚙️ Configuration

Open **Settings** in the GuideMe side panel to configure your provider.

### API Providers

| Provider | Cost | Quality | Get API Key |
|----------|------|---------|-------------|
| **Gemini** (default) | 🆓 Free | Good | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Vertex AI (Gemini)** | Google Cloud billing | Choose a Gemini model | Service-account JSON key |
| **OpenAI** | 💰 Paid | Excellent | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Claude** | 💰 Paid | Excellent | [console.anthropic.com](https://console.anthropic.com/) |

### Settings

| Setting | Description |
|---------|-------------|
| **API Provider** | Choose your AI provider (Gemini recommended for free usage) |
| **API Key** | Your provider's API key (stored locally in browser) |
| **Vertex credentials** | Paste or import a service-account JSON key; set project ID and location |
| **Gemini model** | Choose a listed model or enter a custom generateContent model ID |
| **Thinking** | Model default or supported effort levels; legacy 2.5 Flash offers token budgets |
| **Highlight Color** | Customize the highlight color for better visibility |
| **Auto-save Guides** | Automatically save completed guides |

For **Vertex AI**, choose **Google Vertex AI · service account**, paste your JSON contents or import the `.json` file, and save. The project defaults to the JSON's `project_id`; change it if billing and access belong to another project. Location defaults to `global`. Enable the Vertex AI API and billing, and grant the service account the Vertex AI User role (`roles/aiplatform.user`) in the target project. Model availability depends on that project and location.

The model menu includes Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash, 3.5 Flash-Lite, 3.1 Pro preview, and legacy 2.5 Flash. Vertex also lists 3.7 Flash. New configurations default to 3.8 Flash with model-default thinking. Thinking choices follow [Google's documented capabilities](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking): 3.8 Flash supports Low/Medium/High; earlier Flash models also support Minimal. On the Gemini API, [the 3.5 Flash endpoint routes to 3.6 Flash](https://ai.google.dev/gemini-api/docs/deprecations/). Custom model IDs use their default thinking configuration. GuideMe never silently switches models after an error.

Saved service-account private keys live **unencrypted in extension-local storage on this device**, like the existing API key. The saved key is not displayed again; use **Remove saved key** to delete it. The worker signs the OAuth assertion locally and sends it only to Google's fixed token endpoint. Short-lived access tokens stay in worker memory. Credentials are excluded from page messages, guide checkpoints and exports. This is intended for users bringing their own credentials, not for shipping a shared service-account key inside the extension.

## 🏗️ How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  User asks: "How do I change my profile picture?"           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Content Script extracts all clickable elements          │
│     Captures multiple selectors for reliability             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Background Script sends elements + question to AI       │
│     AI analyzes and returns step-by-step instructions       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Content Script highlights elements                      │
│     User clicks → Auto-advances → Persists across pages     │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
guideme-extension/
├── manifest.json          # Chrome extension manifest (V3)
├── popup/                 # Extension popup UI
│   ├── popup.html         # UI with inline SVG icons
│   ├── popup.css          # CSS design system
│   └── popup.js           # UI logic and state management
├── content/               # Injected into web pages
│   ├── content.js         # DOM extraction, highlighting
│   └── overlay.css        # Highlight styles
├── background/            # Service worker
│   └── background.js      # AI API communication
├── lib/                   # Shared libraries
│   └── guideme-format.js  # .guideme file format spec
└── icons/                 # Extension icons
```

## 📖 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical deep-dive, design decisions
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Code contributions, common pitfalls
- **[ECOSYSTEM_PLAN.md](ECOSYSTEM_PLAN.md)** - Vision and roadmap

---

## 🤝 Contributing & Guide Creation

The most valuable contribution isn't just code — it's **creating guides** that help others.

### 🎨 High-Impact Guide Ideas

**Creative Software** (where users constantly struggle):
- **Adobe Photoshop** - "Remove background", "Apply vintage filter", "Resize for Instagram"
- **Adobe Premiere** - "Add subtitles", "Export for YouTube", "Color grade footage"
- **Figma** - "Create a button component", "Set up auto-layout", "Export assets"
- **Canva** - "Create brand kit", "Animate text", "Remove background"
- **Blender** - "Basic modeling", "Add materials", "Render settings"

**Developer Tools**:
- **GitHub** - "Create PR from fork", "Set up Actions", "Configure branch protection"
- **Vercel/Netlify** - "Deploy from GitHub", "Add custom domain", "Environment variables"
- **AWS Console** - "Create S3 bucket", "Set up Lambda", "Configure IAM"

**Complex Admin Panels**:
- **WordPress** - "Install plugin", "Create custom post type"
- **Shopify** - "Add product variants", "Set up shipping zones"
- **Google Analytics** - "Create custom report", "Set up goals"

### Why This Matters

Every day, millions of people:
- Watch 10-minute YouTube tutorials for a 30-second task
- Take notes from AI and hunt through menus manually
- Get lost in complex UIs and give up

**Your guide can save thousands of people hours of frustration.**

### How to Contribute Guides

1. Complete a task using GuideMe's AI mode
2. Save the guide and test the replay
3. Export as `.guideme` file
4. Submit via PR or share in Discussions

See [CONTRIBUTING.md](CONTRIBUTING.md) for code contribution guidelines.

---

## 🎯 Vision & Roadmap

**Where we are:** Browser extension for websites

**Where we're going:** Desktop application software (Adobe, Figma, Blender, etc.)

New software and websites emerge every day. People will always need help navigating them. Our goal is to be the universal "show me where to click" solution.

### Potential Future

- [ ] Community guide library (browse/search guides)
- [ ] Desktop app support (beyond browser)
- [ ] Guide recording (watch clicks, generate guide)
- [ ] Team/enterprise features
- [ ] Automation integration (use guides for automated workflows)

---

## 🐛 Known Limitations

- Works best on well-structured pages with clear labels
- Dynamic content (dropdowns, modals) may require clicking refresh
- AI responses may vary — use refresh if guidance seems incorrect
- Some complex workflows may need multiple guide sessions
- **Currently websites only** — desktop apps are a future goal
- Press **Escape** to quickly stop any guide

---

## 🔒 Privacy & Security

**GuideMe takes privacy seriously.** Here's exactly what happens with your data:

### What We Collect

| Data | Where It Goes | Stored? |
|------|---------------|---------|
| **Button/link text** (e.g., "Settings", "Save") | Sent to AI provider | No - discarded after response |
| **Element types** (button, link, dropdown) | Sent to AI provider | No |
| **Page title & URL** | Sent to AI provider | No |
| **Your question** | Sent to AI provider | No |

### What We Do NOT Collect

- ❌ **Form data** (passwords, credit cards, personal info)
- ❌ **Page content** (articles, emails, messages)
- ❌ **Cookies or session data**
- ❌ **Any data sent to us** - we have no servers!

### Where Data Goes

```
Your Browser → AI Provider (Gemini/OpenAI/Claude) → Your Browser
                    ↑
             That's it. No middleman.
```

- **API Key**: Stored locally in your browser only
- **Saved Guides**: Stored locally in your browser only  
- **No analytics, no tracking, no telemetry**
- **100% open source** - verify the code yourself

### AI Provider Privacy

Your data is subject to the privacy policy of YOUR chosen provider:
- [Google Gemini Privacy](https://ai.google.dev/terms)
- [OpenAI Privacy](https://openai.com/policies/privacy-policy)
- [Anthropic Privacy](https://www.anthropic.com/privacy)

**Tip:** For maximum privacy, use saved guides (Guide Mode) — no AI calls needed!

---

## ❓ FAQ

**Q: Is my API key safe?**
> Yes! Stored only in your browser's local storage, sent only to your chosen AI provider.

**Q: Does GuideMe work offline?**
> Saved guides work offline! New guides require internet for AI.

**Q: Why did it highlight the wrong element?**
> AI isn't perfect. Click the refresh button to re-scan.

**Q: Can I share guides with my team?**
> Yes! Export as `.guideme` files and share them.

**Q: How is this different from other AI tools?**
> Most AI tools give you text instructions. GuideMe actually highlights the elements on screen — visual guidance, not just words.

**Q: Is it safe?**
Yes. We only extract button/link text (like "Settings", "Code", "Save") and element types. We do NOT read form fields, passwords, page content, or anything sensitive.

**Q: Where does data go?**
Directly to the AI provider YOU choose (Gemini, OpenAI, or Claude). We have no servers and collect nothing.

**Q: Can someone spy on my browsing?**
No. The extension only activates when you ask a question. Your API key and saved guides stay in YOUR browser's local storage.

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

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
