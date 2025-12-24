// GuideMe Background Service Worker
// Handles AI API communication

class GuideMeBackground {
  constructor() {
    this.init();
  }

  init() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GENERATE_GUIDE') {
        this.generateGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      if (message.type === 'CONTINUE_GUIDE') {
        this.continueGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }

      // Macro Management
      if (message.type === 'SAVE_MACRO') {
        this.saveMacro(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }

      if (message.type === 'GET_MACROS') {
        this.getMacros()
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }

      if (message.type === 'DELETE_MACRO') {
        this.deleteMacro(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
    });
  }

  // ============ MACRO MANAGEMENT ============
  async saveMacro(payload) {
    const { name, steps, startUrl, task } = payload;
    const macros = await this.getMacros();
    
    const macro = {
      id: `macro_${Date.now()}`,
      name: name,
      task: task,
      steps: steps,
      startUrl: startUrl,
      startUrlPattern: new URL(startUrl).hostname,
      createdAt: Date.now()
    };
    
    macros.push(macro);
    await chrome.storage.local.set({ guideme_macros: macros });
    
    return { success: true, macro };
  }

  async getMacros() {
    const result = await chrome.storage.local.get(['guideme_macros']);
    return result.guideme_macros || [];
  }

  async deleteMacro(payload) {
    const { macroId } = payload;
    const macros = await this.getMacros();
    const filtered = macros.filter(m => m.id !== macroId);
    await chrome.storage.local.set({ guideme_macros: filtered });
    return { success: true };
  }

  async continueGuide(payload) {
    const { task, completedSteps, dom, url, title } = payload;
    
    // Get API settings from chrome.storage.local (same as popup uses)
    const settings = await chrome.storage.local.get(['apiProvider', 'apiKey']);
    const apiProvider = settings.apiProvider || 'gemini';
    const apiKey = settings.apiKey;
    
    if (!apiKey) {
      throw new Error('No API key configured. Please set your API key in the extension settings.');
    }

    console.log('GuideMe: Continuing guide with provider:', apiProvider);

    // Build continuation prompt
    const systemPrompt = this.buildContinuationSystemPrompt();
    const userPrompt = this.buildContinuationUserPrompt(task, completedSteps, url, title, dom);

    // Call API
    if (apiProvider === 'gemini') {
      return await this.callGemini(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'openai') {
      return await this.callOpenAI(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'anthropic') {
      return await this.callAnthropic(apiKey, systemPrompt, userPrompt);
    } else {
      throw new Error('Unknown API provider');
    }
  }

  buildContinuationSystemPrompt() {
    return `You are continuing to guide a user through a multi-page task. The user clicked something and navigated to a new page or view.

YOUR MISSION: Provide ALL steps needed on THIS PAGE to continue toward the goal.

CRITICAL - GIVE ALL STEPS FOR CURRENT PAGE:
- If 3 buttons need to be clicked on this page, include ALL 3 steps
- If user can complete multiple actions without page navigation, include ALL of them
- Only stop giving steps when the NEXT action would cause page navigation
- This reduces API calls - we want ALL non-navigating steps in ONE response

CRITICAL - WHEN TO MARK COMPLETED:
- ONLY mark completed: true when the user is LITERALLY on the final screen
- "Find Budgets page" → completed ONLY when user is ON the Budgets page
- If user just clicked to navigate somewhere, completed should be FALSE

OUTPUT FORMAT (JSON only):
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click on 'Settings' in the menu"},
    {"elementId": "gm-12", "action": "click", "description": "Click on 'Billing' tab"},
    {"elementId": "gm-18", "action": "click", "description": "Click on 'Budgets' option"}
  ],
  "canComplete": true,
  "completed": false,
  "progress": "In Settings menu, navigating to Budgets"
}

RULES:
1. Include ALL clickable steps until a navigation event would occur
2. Use ONLY element IDs from the provided list
3. DO NOT suggest searching - guide through clicking visible elements
4. If multiple steps can be done on this page, include ALL of them
5. NEVER mark completed:true unless the FINAL destination is reached
6. If stuck with no path forward, set canComplete: false`;
  }

  buildContinuationUserPrompt(task, completedSteps, url, title, dom) {
    const elementList = dom.elements
      .filter(e => e.type !== 'heading')
      .map(e => `${e.id}: "${e.text}" [${e.type}] (${e.location})`)
      .join('\n');
    
    const headings = dom.elements
      .filter(e => e.type === 'heading')
      .map(e => e.text)
      .join(' > ');
    
    const completedDesc = completedSteps && completedSteps.length > 0
      ? completedSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')
      : 'None yet';

    return `ORIGINAL TASK: "${task}"

STEPS ALREADY COMPLETED:
${completedDesc}

NOW ON PAGE: ${title}
URL: ${url}
PAGE CONTEXT: ${headings || 'Main page'}

AVAILABLE ELEMENTS ON THIS PAGE:
${elementList}

What steps are needed on THIS page to continue the task? Use element IDs from above.`;
  }

  async generateGuide(payload) {
    const { task, url, title, dom, apiProvider, apiKey } = payload;

    // Build prompt
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(task, url, title, dom);

    // Call appropriate API
    if (apiProvider === 'gemini') {
      return await this.callGemini(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'openai') {
      return await this.callOpenAI(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'anthropic') {
      return await this.callAnthropic(apiKey, systemPrompt, userPrompt);
    } else {
      throw new Error('Unknown API provider');
    }
  }

  buildSystemPrompt() {
    return `You are a precise website navigation assistant. Guide users step-by-step through clicking EXACT elements on the page.

INPUT: You receive a list of ACTUAL clickable elements with unique IDs (like "gm-5").
OUTPUT: JSON with steps referencing these exact IDs.

CRITICAL - PROVIDE ALL STEPS FOR THIS PAGE:
- Include ALL steps that can be completed on the current page
- If 3 buttons need clicking before navigation, include ALL 3 in one response
- Only stop at steps that would cause page navigation (links to new pages)
- This is important to minimize API calls!

CRITICAL - UNDERSTANDING MULTI-PAGE TASKS:
Most tasks require MULTIPLE pages/screens. Examples:
- "Go to billing settings" = Click menu → Click Settings → Click Billing (3+ pages!)
- "Find the Budgets page" = Click profile → Click Settings → Click Billing → Click Budgets (4+ pages!)
- These are NOT single-step tasks!

YOUR JOB ON THIS PAGE:
1. Look at all clickable elements available
2. Find element(s) that move toward the goal
3. Return steps for THIS page only
4. Set willNavigate: true if any step causes navigation
5. NEVER set completed: true unless user is LITERALLY at final destination

OUTPUT FORMAT:
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "In the header, click your profile picture to open the menu"}
  ],
  "canComplete": true,
  "completed": false,
  "willNavigate": true,
  "navigationHint": "This opens a menu - we'll continue from there"
}

COMPLETED FIELD:
- completed: false = More steps needed after this (DEFAULT for navigation tasks!)
- completed: true = ONLY when literally on the FINAL screen (e.g., Billing page is showing)

For "billing settings" on GitHub home page:
- Step 1: Click profile menu → completed: FALSE (just opening menu)
- After menu opens, Step 2: Click Settings → completed: FALSE (going to settings)
- After settings loads, Step 3: Click Billing → completed: TRUE (now on billing!)

RULES:
1. ONLY use element IDs from the provided list - never invent IDs
2. DO NOT suggest using search boxes - guide through visual navigation
3. Each step = ONE click action
4. Be specific: say WHERE (header, sidebar) and WHAT text to click
5. If step causes navigation, only include steps up to that point
6. DEFAULT to completed: false for any task involving navigation`;
  }

  buildUserPrompt(task, url, title, dom) {
    // Format elements in a clear way for AI
    const elementList = dom.elements
      .filter(e => e.type !== 'heading') // Filter out headings from clickable elements
      .map(e => `${e.id}: "${e.text}" [${e.type}] (${e.location})`)
      .join('\n');
    
    const headings = dom.elements
      .filter(e => e.type === 'heading')
      .map(e => e.text)
      .join(' > ');
    
    return `CURRENT PAGE: ${title}
URL: ${url}
PAGE SECTIONS: ${headings || 'Main page'}

USER WANTS TO: "${task}"

AVAILABLE CLICKABLE ELEMENTS (use these exact IDs):
${elementList}

Guide the user by telling them which elements to click. Use ONLY the element IDs listed above.
Do NOT suggest using search - navigate through the menus and buttons shown.`;
  }

  condenseDom(dom) {
    // No longer needed - buildUserPrompt handles this
    return dom;
  }

  async callOpenAI(apiKey, systemPrompt, userPrompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    return this.parseAIResponse(content);
  }

  async callGemini(apiKey, systemPrompt, userPrompt) {
    // Use stable free-tier models
    const models = [
      'gemini-flash-latest',             // Primary free tier model
    ];
    
    let lastError = null;
    
    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `${systemPrompt}\n\n${userPrompt}` }
                ]
              }
            ],
            generationConfig: {
              temperature: 0,  // Zero for consistent, deterministic responses
              maxOutputTokens: 4096,
              responseMimeType: "application/json"
            }
          })
        });

        if (!response.ok) {
          const error = await response.json();
          const errorMsg = error.error?.message || 'Unknown error';
          
          // If model not found or quota exceeded, try next model
          if (errorMsg.includes('not found') || 
              errorMsg.includes('quota') || 
              errorMsg.includes('exceeded') ||
              error.error?.code === 404 ||
              error.error?.code === 429) {
            lastError = errorMsg;
            console.log(`GuideMe: Model ${model} unavailable, trying next...`);
            continue;
          }
          throw new Error(errorMsg);
        }

        const data = await response.json();
        
        // Check for blocked content
        if (data.candidates?.[0]?.finishReason === 'SAFETY') {
          throw new Error('Response blocked by safety filters. Try rephrasing your request.');
        }
        
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!content) {
          throw new Error('No response from Gemini. Please try again.');
        }

        console.log(`GuideMe: Success with model: ${model}`);
        return this.parseAIResponse(content);
        
      } catch (error) {
        lastError = error.message;
        // If quota/rate limit error, try next model
        if (error.message?.includes('quota') || error.message?.includes('exceeded')) {
          console.log(`GuideMe: Quota issue with ${model}, trying next...`);
          continue;
        }
        // For other errors, throw immediately
        if (!error.message?.includes('not found')) {
          throw error;
        }
      }
    }
    
    // If all models failed, add helpful message
    console.error('GuideMe: All Gemini models exhausted. Last error:', lastError);
    throw new Error(`API rate limited. Please wait 10-15 seconds and try again. (${lastError})`);
  }

  async callAnthropic(apiKey, systemPrompt, userPrompt) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Anthropic API error');
    }

    const data = await response.json();
    const content = data.content[0]?.text;

    return this.parseAIResponse(content);
  }

  parseAIResponse(content) {
    try {
      console.log('Raw AI response:', content);
      
      if (!content || content.length === 0) {
        throw new Error('Empty response from AI');
      }
      
      let jsonStr = content;
      
      // Method 1: Remove markdown code blocks - handle various formats
      // Match ```json or ``` at start and ``` at end
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      
      // Also handle case where ``` is in the middle
      if (jsonStr.includes('```')) {
        const parts = jsonStr.split('```');
        // Find the part that looks like JSON
        for (const part of parts) {
          const trimmed = part.replace(/^json\s*/i, '').trim();
          if (trimmed.startsWith('{')) {
            jsonStr = trimmed;
            break;
          }
        }
      }

      // Method 2: Find JSON object by looking for opening brace
      if (!jsonStr.trim().startsWith('{')) {
        const braceIndex = jsonStr.indexOf('{');
        if (braceIndex !== -1) {
          jsonStr = jsonStr.substring(braceIndex);
        }
      }
      
      // Find the matching closing brace
      let depth = 0;
      let endIndex = -1;
      let inString = false;
      let escape = false;
      
      for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        
        if (escape) {
          escape = false;
          continue;
        }
        
        if (char === '\\') {
          escape = true;
          continue;
        }
        
        if (char === '"') {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') depth++;
          if (char === '}') {
            depth--;
            if (depth === 0) {
              endIndex = i;
              break;
            }
          }
        }
      }
      
      if (endIndex !== -1) {
        jsonStr = jsonStr.substring(0, endIndex + 1);
      }

      // Clean up common issues
      jsonStr = jsonStr
        .replace(/,\s*}/g, '}')  // Remove trailing commas
        .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
        .replace(/[\x00-\x1F\x7F]/g, ' ') // Remove control characters
        .trim();

      console.log('Cleaned JSON:', jsonStr.substring(0, 500) + (jsonStr.length > 500 ? '...' : ''));
      
      const parsed = JSON.parse(jsonStr);

      // Validate structure
      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        console.error('Missing steps array in parsed response:', parsed);
        throw new Error('Invalid response format - missing steps');
      }

      // Validate each step has required fields
      const validatedSteps = parsed.steps.map((step, index) => ({
        element: step.elementId || step.element || step.selector || 'body',
        action: step.action || 'click',
        description: step.description || step.instruction || `Step ${index + 1}`
      }));

      console.log('GuideMe: Parsed steps:', validatedSteps);
      console.log('GuideMe: completed:', parsed.completed, 'willNavigate:', parsed.willNavigate);

      return {
        steps: validatedSteps,
        canComplete: parsed.canComplete !== false,
        completed: parsed.completed === true,  // Must explicitly be true
        willNavigate: parsed.willNavigate === true,
        progress: parsed.progress || parsed.navigationHint || null,
        note: parsed.note || parsed.message || null
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error.message);
      console.error('Original content:', content);
      
      // Last resort: try to extract any useful steps from partial JSON
      if (content && content.length > 0) {
        // Try to extract step descriptions even from broken JSON
        const stepMatches = content.match(/"description"\s*:\s*"([^"]+)"/g);
        if (stepMatches && stepMatches.length > 0) {
          const extractedSteps = stepMatches.map((match, index) => {
            const desc = match.match(/"description"\s*:\s*"([^"]+)"/);
            return {
              element: 'body',
              action: 'info',
              description: desc ? desc[1] : `Step ${index + 1}`
            };
          });
          console.log('GuideMe: Recovered partial steps from broken JSON');
          return {
            steps: extractedSteps,
            canComplete: true,
            note: 'Guide recovered from partial response'
          };
        }
        
        // Check if AI said it can't do something
        const lowerContent = content.toLowerCase();
        if (lowerContent.includes("can't") || lowerContent.includes("cannot") || lowerContent.includes("unable")) {
          return {
            steps: [{
              element: 'body',
              action: 'info',
              description: 'The AI was unable to create a guide for this task. Try rephrasing your request or being more specific.'
            }],
            canComplete: false,
            note: content.substring(0, 200)
          };
        }
      }
      
      throw new Error('Failed to parse AI response. The AI may have returned an incomplete response. Please try again.');
    }
  }
}

// Initialize background service
const guideme = new GuideMeBackground();
