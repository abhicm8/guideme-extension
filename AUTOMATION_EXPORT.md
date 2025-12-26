# GuideMe Automation Export

Convert your `.guideme` files into executable automation scripts for popular testing frameworks.

## Overview

The GuideMe ecosystem supports exporting step-by-step guides into automation scripts that can be run programmatically. This is useful for:

- **Automated Testing**: Convert user tutorials into test suites
- **Regression Testing**: Ensure workflows still work after updates
- **CI/CD Integration**: Run guides as part of your deployment pipeline
- **Bot Automation**: Automate repetitive tasks based on your guides

## Supported Frameworks

### 1. Puppeteer (Node.js)

[Puppeteer](https://pptr.dev/) is a Node.js library that provides a high-level API to control Chrome/Chromium.

**Generated Script Features:**
- Headless browser automation
- Configurable viewport size
- Multiple selector fallback strategy
- Automatic wait for elements
- Error screenshots on failure
- Console output for each step

**Requirements:**
```bash
npm install puppeteer
```

**Running:**
```bash
node guide-automation-puppeteer.js
```

### 2. Playwright (Test Framework)

[Playwright](https://playwright.dev/) enables reliable end-to-end testing with support for all modern browsers.

**Generated Script Features:**
- Test structure with `describe`/`test` blocks
- Built-in assertions
- Trace recording on failure
- Screenshot on error
- Multiple selector support with `locator.or()`
- Configurable browser (Chromium by default)

**Requirements:**
```bash
npm install @playwright/test
npx playwright install
```

**Running:**
```bash
npx playwright test guide-automation-playwright.spec.js
```

### 3. Selenium (Python)

[Selenium](https://www.selenium.dev/) is a portable framework for testing web applications.

**Generated Script Features:**
- Python with unittest framework
- Chrome WebDriver support
- Explicit waits with WebDriverWait
- Multiple selector fallback in order
- Error screenshots saved locally
- Clean setup/teardown methods

**Requirements:**
```bash
pip install selenium webdriver-manager
```

**Running:**
```bash
python guide_automation_selenium.py
```

## How It Works

### Selector Extraction

The export system extracts selectors from your `.guideme` steps in the following priority order:

1. **ID Selector** (`#element-id`)
2. **Data Attributes** (`[data-testid="..."]`, `[data-cy="..."]`)
3. **Class Selector** (`.class-name`)
4. **ARIA Label** (`[aria-label="..."]`)
5. **Element Type with Text** (button, link, input)

### Action Mapping

| GuideMe Action | Puppeteer | Playwright | Selenium |
|----------------|-----------|------------|----------|
| `click` | `page.click()` | `locator.click()` | `element.click()` |
| `type` | `page.type()` | `locator.fill()` | `element.send_keys()` |
| `navigate` | `page.goto()` | `page.goto()` | `driver.get()` |
| `wait` | `page.waitForSelector()` | `locator.waitFor()` | `WebDriverWait` |
| `scroll` | `page.evaluate()` | `locator.scrollIntoViewIfNeeded()` | `execute_script()` |
| `hover` | `page.hover()` | `locator.hover()` | `ActionChains.move_to_element()` |
| `select` | `page.select()` | `locator.selectOption()` | `Select().select_by_value()` |

## .guideme File Structure

For optimal automation export, ensure your `.guideme` files include proper selectors:

```json
{
  "version": "1.0",
  "format": "guideme",
  "metadata": {
    "title": "Create a GitHub Repository",
    "description": "Step-by-step guide to create a new repo",
    "author": "GuideMe",
    "created": "2024-01-15T10:00:00Z",
    "website": "https://github.com",
    "tags": ["github", "tutorial"]
  },
  "steps": [
    {
      "id": 1,
      "title": "Click New Repository",
      "description": "Click the green 'New' button to start creating a repository",
      "target": {
        "selector": "[data-testid='new-repo-button']",
        "fallback": "a[href='/new']",
        "description": "New repository button"
      },
      "action": "click",
      "highlight": {
        "style": "pulse",
        "color": "#4CAF50"
      },
      "position": "right"
    },
    {
      "id": 2,
      "title": "Enter Repository Name",
      "description": "Type a unique name for your repository",
      "target": {
        "selector": "#repository-name",
        "fallback": "input[name='repository[name]']"
      },
      "action": "type",
      "value": "my-awesome-repo",
      "position": "bottom"
    }
  ]
}
```

### Key Fields for Automation

| Field | Purpose |
|-------|---------|
| `target.selector` | Primary CSS selector to find the element |
| `target.fallback` | Backup selector if primary fails |
| `action` | What action to perform (click, type, etc.) |
| `value` | Input value for type/select actions |
| `metadata.website` | Starting URL for the automation |

## Best Practices

### 1. Use Stable Selectors

Prefer selectors that won't change with UI updates:

```json
// ✅ Good - Data attributes are stable
"selector": "[data-testid='submit-button']"

// ✅ Good - IDs are usually stable
"selector": "#login-form"

// ⚠️ Avoid - Classes may change
"selector": ".btn-primary-lg-v2"

// ⚠️ Avoid - Position-based selectors are fragile
"selector": "div > div > button:nth-child(3)"
```

### 2. Provide Fallback Selectors

Always include a fallback for critical elements:

```json
{
  "target": {
    "selector": "[data-testid='search-input']",
    "fallback": "input[type='search'], input[placeholder*='Search']"
  }
}
```

### 3. Include Wait Steps

Add explicit waits for dynamic content:

```json
{
  "action": "wait",
  "target": {
    "selector": ".loading-spinner",
    "waitFor": "hidden"
  }
}
```

### 4. Set Meaningful Titles

Step titles appear in test output and error messages:

```json
{
  "title": "Submit registration form",  // ✅ Clear
  "title": "Click button"               // ❌ Vague
}
```

## Exporting from GuideMe Website

1. Navigate to any guide detail page on the GuideMe website
2. Click the **"Export as Script"** button
3. Select your preferred framework:
   - **Puppeteer** - For Node.js automation
   - **Playwright** - For comprehensive testing
   - **Selenium** - For Python scripts
4. The script will download automatically

## Generated Script Example

### Puppeteer Output

```javascript
/**
 * GuideMe Automation Script
 * Generated from: Create a GitHub Repository
 * Framework: Puppeteer
 * 
 * Requirements:
 * - Node.js 14+
 * - npm install puppeteer
 * 
 * Usage:
 * node guide-automation-puppeteer.js
 */

const puppeteer = require('puppeteer');

const CONFIG = {
  headless: false,
  slowMo: 100,
  viewport: { width: 1280, height: 800 },
  timeout: 30000
};

async function runGuide() {
  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    slowMo: CONFIG.slowMo
  });
  
  const page = await browser.newPage();
  await page.setViewport(CONFIG.viewport);
  
  try {
    // Navigate to starting URL
    console.log('Navigating to https://github.com...');
    await page.goto('https://github.com', { waitUntil: 'networkidle2' });
    
    // Step 1: Click New Repository
    console.log('Step 1: Click New Repository');
    await page.waitForSelector("[data-testid='new-repo-button'], a[href='/new']", { timeout: CONFIG.timeout });
    await page.click("[data-testid='new-repo-button'], a[href='/new']");
    
    // Step 2: Enter Repository Name
    console.log('Step 2: Enter Repository Name');
    await page.waitForSelector("#repository-name, input[name='repository[name]']", { timeout: CONFIG.timeout });
    await page.type("#repository-name, input[name='repository[name]']", "my-awesome-repo");
    
    console.log('✅ Guide completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'error-screenshot.png' });
  } finally {
    await browser.close();
  }
}

runGuide();
```

## Customization

After exporting, you can customize the generated scripts:

### Headless Mode
```javascript
// Puppeteer/Playwright
headless: true  // Run without visible browser

# Selenium (Python)
options.add_argument('--headless')
```

### Custom Timeouts
```javascript
// Increase for slow networks
timeout: 60000  // 60 seconds
```

### Add Authentication
```javascript
// Before running steps
await page.type('#username', process.env.USERNAME);
await page.type('#password', process.env.PASSWORD);
await page.click('#login-button');
```

### Add Screenshots
```javascript
// Capture each step
await page.screenshot({ path: `step-${stepNumber}.png` });
```

## Troubleshooting

### Element Not Found

If automation fails to find an element:

1. Check if the selector in your `.guideme` file is correct
2. Add a more specific fallback selector
3. Increase the timeout value
4. Ensure the page has fully loaded before interacting

### Timing Issues

For dynamic content:

1. Add explicit wait steps in your guide
2. Use `waitForNavigation` after clicks that change pages
3. Increase `slowMo` value for debugging

### Cross-Browser Testing

Playwright supports multiple browsers:

```javascript
// Test in Firefox
const browser = await playwright.firefox.launch();

// Test in WebKit (Safari)
const browser = await playwright.webkit.launch();
```

## Contributing

Help improve automation export by:

1. Reporting issues with generated scripts
2. Suggesting new framework support
3. Improving selector extraction logic
4. Adding more action mappings

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - See [LICENSE](./LICENSE) for details.
