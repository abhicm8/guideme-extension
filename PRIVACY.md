# Privacy Policy for GuideMe Chrome Extension

**Last Updated:** October 25, 2026

GuideMe ("we", "our", or "the extension") is an open-source browser extension designed to provide step-by-step visual guidance and walkthroughs on web pages. We believe privacy is a fundamental right. GuideMe is designed from the ground up to operate client-side with zero tracking and zero telemetry.

---

## 1. Information We Do NOT Collect

- **No Personal Information**: We do not collect names, email addresses, phone numbers, IP addresses, or account credentials.
- **No Browsing History**: We do not track, log, or monitor your web browsing history.
- **No Form Or Sensitive Input Data**: GuideMe intentionally ignores passwords, credit card numbers, payment details, and personal form inputs.
- **No Analytics Or Tracking**: There are no third-party tracking scripts, cookies, or telemetry libraries embedded in GuideMe.
- **No Proprietary Backend Servers**: We do not operate any middleman servers. GuideMe communicates strictly between your browser and the AI provider you configure.

---

## 2. Information Processed Locally and How It Is Used

To guide you on a web page, GuideMe processes minimal page interface data strictly within your browser:

- **Interactive UI Elements**: GuideMe scans visible buttons, links, and form labels on the active tab solely to locate the controls relevant to your request.
- **Your Request**: When you enter a prompt or use voice input (e.g., "how do I change my password?"), this query and the sanitized element labels from the current page are transmitted directly to your chosen AI provider (e.g., Google Gemini, OpenAI, Anthropic Claude) via your own API key.
- **Local Storage**: Your API keys, saved walkthroughs, and user interface preferences (such as Light/Dark theme) are stored exclusively in your browser's local extension storage (`chrome.storage.local`). This data never leaves your device except when authenticating requests directly with the AI provider you specify.

---

## 3. Third-Party AI Services

GuideMe operates on a Bring-Your-Own-Key (BYOK) model. When an AI feature is invoked, data is handled according to the privacy policy of the provider you select:

- **Google Gemini**: [Google Privacy Policy & Terms](https://policies.google.com/privacy)
- **OpenAI**: [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- **Anthropic Claude**: [Anthropic Privacy Policy](https://www.anthropic.com/privacy)

Offline and recorded walkthroughs replayed from your local Library run 100% locally and make zero external network requests.

---

## 4. Permissions Explanation

In compliance with Chrome Web Store Developer Policies, here is why each permission is required:

- **`activeTab`**: Enables the extension to read the UI elements of the tab you are currently viewing and place visual guidance spotlights.
- **`storage`**: Allows you to save your API keys, preferences, and custom walkthrough guides locally in your browser.
- **`scripting`**: Injects the visual highlighting elements, tooltips, and companion controls onto the active page.
- **`sidePanel`**: Renders the GuideMe workspace alongside the web page using Chrome's native side panel API.
- **Host Permissions (`<all_urls>`)**: Allows GuideMe to provide guidance across any website you choose to navigate.

---

## 5. Data Security

Because all extension settings, API credentials, and saved guides are kept in sandboxed local browser storage, your data remains under your direct control. You can clear your data or remove stored API keys at any time through the GuideMe Settings panel or by uninstalling the extension.

---

## 6. Open Source Transparency

GuideMe is open-source software licensed under the MIT License. The complete source code is publicly accessible and auditable at:  
https://github.com/abhicm8/guideme-extension

---

## 7. Contact & Inquiries

If you have questions, feedback, or concerns regarding this privacy policy, please open an issue on our GitHub repository:  
https://github.com/abhicm8/guideme-extension/issues
