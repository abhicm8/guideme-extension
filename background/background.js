// GuideMe Background Service Worker
// Handles AI API communication

// Import GuideMe file format utilities
import { GuideMeFormat } from '../lib/guideme-format.js';

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

      if (message.type === 'UPDATE_MACRO') {
        this.updateMacro(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      // Export guide to .guideme format
      if (message.type === 'EXPORT_GUIDE') {
        this.exportGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      // Import guide from .guideme format
      if (message.type === 'IMPORT_GUIDE') {
        this.importGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      // Get AI template for guide generation
      if (message.type === 'GET_AI_TEMPLATE') {
        sendResponse({ template: GuideMeFormat.getAITemplate() });
        return true;
      }
    });
  }

  // ============ MACRO MANAGEMENT ============
  async saveMacro(payload) {
    const { name, steps, startUrl, task, category } = payload;
    
    console.log('GuideMe BG: saveMacro called with', steps?.length, 'steps');
    steps?.forEach((step, i) => {
      console.log(`GuideMe BG: Step ${i + 1}:`, {
        desc: step.description?.substring(0, 30),
        hasRobustSelectors: !!step.robustSelectors,
        selectorKeys: step.robustSelectors ? Object.keys(step.robustSelectors) : []
      });
    });
    
    const macros = await this.getMacros();
    
    const macro = {
      id: `macro_${Date.now()}`,
      name: name,
      task: task,
      steps: steps,
      startUrl: startUrl,
      startUrlPattern: new URL(startUrl).hostname,
      category: category || 'other',
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

  async updateMacro(payload) {
    const { macroId, updates } = payload;
    const macros = await this.getMacros();
    const index = macros.findIndex(m => m.id === macroId);
    
    if (index === -1) {
      throw new Error('Guide not found');
    }
    
    // Apply updates
    macros[index] = {
      ...macros[index],
      ...updates,
      updatedAt: Date.now()
    };
    
    await chrome.storage.local.set({ guideme_macros: macros });
    return { success: true, macro: macros[index] };
  }

  // ============ EXPORT/IMPORT (.guideme format) ============
  async exportGuide(payload) {
    const { guideId } = payload;
    const macros = await this.getMacros();
    const guide = macros.find(m => m.id === guideId);
    
    if (!guide) {
      throw new Error('Guide not found');
    }
    
    // Convert to .guideme format with checksum
    const exported = await GuideMeFormat.exportGuide(guide);
    
    // Generate filename
    const safeName = guide.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const filename = `${safeName}.guideme`;
    
    return { 
      success: true, 
      data: exported,
      filename: filename,
      summary: GuideMeFormat.generateSummary(exported)
    };
  }
  
  async importGuide(payload) {
    const { jsonContent } = payload;
    
    // Validate and parse the .guideme file
    const result = await GuideMeFormat.importGuide(jsonContent);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // Check for duplicate (same importedFrom ID)
    const macros = await this.getMacros();
    const existingImport = macros.find(m => 
      m.importedFrom && m.importedFrom === result.guide.importedFrom
    );
    
    if (existingImport) {
      return {
        success: false,
        error: 'This guide has already been imported',
        existingGuide: existingImport.name
      };
    }
    
    // Save the imported guide
    macros.push(result.guide);
    await chrome.storage.local.set({ guideme_macros: macros });
    
    return { 
      success: true, 
      guide: result.guide,
      metadata: result.metadata,
      warnings: result.warnings
    };
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
    return `You are a website navigation assistant guiding a user through a task. After the user clicks something, you provide next steps.

CRITICAL - WHEN TO MARK COMPLETED:
Mark "completed": true when ANY of these conditions are met:

1. ✅ USER REACHED THE DESTINATION - They're now on the page/form they asked about
   - Task: "how to create a repo" → User is on the repo creation page = DONE
   - Task: "find billing settings" → User is viewing billing settings = DONE

2. ✅ USER CAN NOW PERFORM THE ACTION - You've shown them the final button
   - Task: "create a repository" → You highlighted the "Create repository" button = DONE
   - DO NOT continue after showing the final action button

3. ✅ FORM IS VISIBLE - For "how to" tasks, showing the form IS the completion
   - "How to create a new project" → Repository creation form is visible = DONE
   - User asked HOW, not to actually create it

4. ✅ TOO MANY STEPS - If 5+ steps have been completed, strongly consider ending
   - Most tasks can be done in 3-7 steps
   - After 5 steps, set completed: true unless something is clearly missing

5. ✅ FINAL ACTION IN COMPLETED STEPS - Look at what was already done
   - If completed steps include "Click Create" or "Click Submit" = DONE
   - The user already did the final action!

IMPORTANT: Users HATE infinite loops. When in doubt, END THE GUIDE.

OUTPUT FORMAT (JSON only):
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click 'Create' button to finish"}
  ],
  "completed": true,
  "reason": "User has reached the creation form and clicked Create",
  "progress": "Complete"
}

If task is complete with no more steps needed:
{
  "steps": [],
  "completed": true,
  "reason": "Task complete - user has reached the destination"
}

RULES:
- Maximum 3 steps per response
- If showing a final action button, this MUST be the last step with completed: true
- Use ONLY element IDs from the provided list
- ALWAYS include "reason" explaining your decision`;
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
    
    const stepCount = completedSteps ? completedSteps.length : 0;
    const completedDesc = completedSteps && completedSteps.length > 0
      ? completedSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')
      : 'None yet';
    
    // Check if any completed step was a final action
    const hasFinalAction = completedSteps && completedSteps.some(s => {
      const d = (s.description || '').toLowerCase();
      return d.includes('create') || d.includes('submit') || d.includes('save') || 
             d.includes('confirm') || d.includes('finish');
    });

    return `ORIGINAL TASK: "${task}"

COMPLETED STEPS (${stepCount} total):
${completedDesc}
${hasFinalAction ? '\n⚠️ NOTE: A FINAL ACTION (create/submit/save) WAS ALREADY COMPLETED - consider marking task as done!' : ''}
${stepCount >= 5 ? '\n⚠️ NOTE: 5+ steps completed - strongly consider marking completed: true' : ''}

NOW ON PAGE: ${title}
URL: ${url}
PAGE CONTEXT: ${headings || 'Main page'}

AVAILABLE ELEMENTS ON THIS PAGE:
${elementList}

Analyze: Is the task "${task}" complete? If user is on the right page/form and can perform the action, set completed: true.
If more steps needed, provide maximum 3 steps using element IDs from above.`;
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

CRITICAL - YOU MUST ALWAYS PROVIDE AT LEAST ONE STEP:
- Even for simple tasks, provide the first step to get started
- NEVER return an empty steps array unless the task is literally impossible
- If user asks "how to X", show them the FIRST element to click toward X

CRITICAL - NEVER GIVE UP OR REDIRECT TO DOCS:
- NEVER suggest "go to documentation" or "read the help" as a step
- NEVER tell the user to search externally
- Your job is to find the ACTUAL button/link on THIS page
- If the exact button isn't visible, find the CLOSEST action (dropdown, menu, related button)
- Think about what button MIGHT lead to the feature (e.g., "Code" button for cloning)

CRITICAL - THINK ABOUT SYNONYMS AND RELATED UI:
Common UI patterns to remember:
- "Clone/Download" is often under a "Code" button (GitHub, GitLab)
- "Settings" might be a gear icon or "..." menu
- "Create new" might be a "+" button
- Actions are often hidden in dropdown menus
- Look for buttons that MIGHT contain the action when expanded

CRITICAL - PROVIDE ALL STEPS FOR THIS PAGE:
- Include ALL steps that can be completed on the current page
- If 3 buttons need clicking before navigation, include ALL 3 in one response
- Only stop at steps that would cause page navigation (links to new pages)

YOUR JOB ON THIS PAGE:
1. Look at all clickable elements available
2. Find element(s) that move toward the goal
3. If exact match not found, find the NEAREST related element (dropdown, menu)
4. Return steps for THIS page only
5. Set willNavigate: true if any step causes navigation
6. NEVER set completed: true unless user is LITERALLY at final destination

OUTPUT FORMAT:
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click the 'Code' button to open clone options"}
  ],
  "canComplete": true,
  "completed": false,
  "willNavigate": false,
  "navigationHint": "This opens a dropdown with clone URLs"
}

RULES:
1. ONLY use element IDs from the provided list - never invent IDs
2. DO NOT suggest using search boxes - guide through visual navigation
3. Each step = ONE click action
4. Be specific: say WHERE (header, sidebar) and WHAT text to click
5. If step causes navigation, only include steps up to that point
6. DEFAULT to completed: false for any task involving navigation
7. NEVER suggest documentation, help pages, or external resources`;
  }

  buildUserPrompt(task, url, title, dom) {
    // Format elements with rich context for AI
    const elementList = dom.elements
      .filter(e => e.type !== 'heading')
      .map(e => {
        let desc = `${e.id}: "${e.text}" [${e.type}] (${e.location})`;
        // Add hints if available (dropdown, primary-action, navigation, etc.)
        if (e.hints) desc += ` {${e.hints}}`;
        // Add nearby context if available
        if (e.near) desc += ` near: "${e.near}"`;
        return desc;
      })
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

ELEMENT HINTS EXPLAINED:
- {dropdown} = Opens a menu/popup with more options
- {primary-action} = Visually prominent button (colored, stands out)
- {navigation} = Part of site navigation tabs/menu
- {form} = Inside a form

CRITICAL SELECTION RULES:
1. When multiple elements have SAME TEXT, use hints to pick the right one:
   - For ACTIONS (clone, download, create): prefer {dropdown} or {primary-action} over {navigation}
   - Navigation tabs are for switching views, NOT for actions
   - Action buttons are usually in 'main' location, not 'sidebar'

2. Example: "clone repository" - there might be:
   - "Code" [link] (navigation) {navigation} ← WRONG, this is a nav tab
   - "Code" [button] (main) {dropdown, primary-action} ← CORRECT, this opens clone options

3. ALWAYS prefer: main > header > sidebar for action tasks
4. ALWAYS prefer: {primary-action} or {dropdown} over {navigation} for actions

Use ONLY the element IDs listed above.`;
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

      // CRITICAL: If AI returns 0 steps on initial request, that's an error
      // (Empty steps on continuation with completed:true is OK)
      if (validatedSteps.length === 0 && !parsed.completed) {
        throw new Error('AI returned no steps. Try rephrasing your question or being more specific.');
      }

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
