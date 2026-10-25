import './ai-config.js';
const config = globalThis.GuideMeAIConfig;
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const encode = value => btoa(String.fromCharCode(...(typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export class GeminiClient {
  constructor({ fetcher = (...args) => fetch(...args), cryptoProvider = globalThis.crypto, now = () => Date.now() } = {}) {
    this.fetcher = fetcher;
    this.crypto = cryptoProvider;
    this.now = now;
    this.tokens = new Map();
  }

  async accessToken(credentials, refresh = false) {
    const fingerprint = encode(await this.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${credentials.client_email}\n${credentials.private_key}`)));
    if (refresh) this.tokens.delete(fingerprint);
    const cached = this.tokens.get(fingerprint);
    if (cached && cached.expiresAt > this.now() + 60000) return cached.token;
    const pem = credentials.private_key.replace(/-----[^-]+-----|\s/g, '');
    let key;
    try {
      key = await this.crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    } catch { throw new Error('The service-account private key could not be read. Import the original JSON key again.'); }
    const issued = Math.floor(this.now() / 1000);
    const unsigned = `${encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${encode(JSON.stringify({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: tokenEndpoint, iat: issued, exp: issued + 3600 }))}`;
    const signature = await this.crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const response = await this.request(tokenEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${encode(signature)}` }).toString()
    });
    if (!response.ok) throw new Error('Vertex authentication failed. Check that the service-account key is valid and your device clock is correct.');
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Google did not return an access token.');
    // Access tokens stay in worker memory; never persist them or send them to pages.
    this.tokens.clear();
    this.tokens.set(fingerprint, { token: data.access_token, expiresAt: this.now() + Math.min(Number(data.expires_in) || 3600, 3600) * 1000 });
    return data.access_token;
  }

  async request(url, options) {
    // Chrome can terminate a worker if fetch headers take over 30 seconds.
    // Streamed generation sends headers early; bound that wait independently.
    const headersDeadline = new AbortController();
    const timer = setTimeout(() => headersDeadline.abort(), 25000);
    try {
      return await this.fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.any([headersDeadline.signal, AbortSignal.timeout(120000)]) });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('Google took too long to respond. Try again or choose a lower thinking level.');
      throw new Error('Could not reach Google. Check your connection and try again.');
    } finally { clearTimeout(timer); }
  }

  async readGeneration(response) {
    if (!response.body?.getReader) return response.json(); // Lightweight test adapters.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', size = 0;
    const result = { candidates: [{ content: { parts: [] } }] };
    const consume = event => {
      const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
      if (!payload || payload === '[DONE]') return;
      const chunk = JSON.parse(payload);
      if (chunk.promptFeedback) result.promptFeedback = chunk.promptFeedback;
      const candidate = chunk.candidates?.find(item => item.index === 0 || item.index === undefined);
      if (!candidate) return;
      result.candidates[0].content.parts.push(...(candidate.content?.parts || []));
      if (candidate.finishReason) result.candidates[0].finishReason = candidate.finishReason;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) throw new Error('Response too large');
          buffer += decoder.decode(value, { stream: true });
        }
        // Accept CRLF and arbitrary byte boundaries between stream events.
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          consume(buffer.slice(0, boundary.index).replace(/\r\n/g, '\n'));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer.replace(/\r\n/g, '\n')); break; }
      }
      if (!result.candidates[0].finishReason && !result.promptFeedback?.blockReason) throw new Error('Stream ended before completion');
      return result;
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('Google took too long to respond. Choose a lower thinking level and try again.');
      throw new Error('Google returned an interrupted or invalid response. Try again.');
    } finally { reader.releaseLock(); }
  }

  async generate(settings, systemPrompt, userPrompt) {
    config.assertCredentials(settings);
    const { id, generationConfig } = config.modelConfig(settings);
    const vertex = settings.apiProvider === 'vertex';
    const headers = { 'Content-Type': 'application/json' };
    let url, credentials;
    if (vertex) {
      credentials = config.parseCredentials(settings.vertexCredentials);
      const { project, location } = config.vertexTarget(settings, credentials);
      const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
      url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${id}:streamGenerateContent?alt=sse`;
      headers.Authorization = `Bearer ${await this.accessToken(credentials)}`;
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${id}:streamGenerateContent?alt=sse`;
      headers['x-goog-api-key'] = settings.apiKey.trim();
    }
    const options = { method: 'POST', headers, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: 'user', parts: [{ text: userPrompt }] }], generationConfig }) };
    let response = await this.request(url, options);
    if (vertex && response.status === 401) {
      headers.Authorization = `Bearer ${await this.accessToken(credentials, true)}`;
      response = await this.request(url, options);
    }
    if (!response.ok) {
      const details = {
        400: 'Google rejected the request. Check the model, thinking setting, and Vertex location.',
        401: 'Authentication failed. Replace your API key or Vertex credential in Settings.',
        403: 'Access denied. For Vertex, enable the Vertex AI API and grant this service account Vertex AI User access to the selected project.',
        404: `Model ${id} is unavailable for this project or location. Choose another model or Vertex location.`,
        429: 'Google quota or rate limit reached. Wait and retry, or check your project quota.'
      };
      // Do not relay remote errors that might echo credentials or request contents.
      throw new Error(details[response.status] || `Google request failed (HTTP ${response.status}). Try again.`);
    }
    const data = await this.readGeneration(response);
    const candidate = data.candidates?.[0];
    if (data.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY') throw new Error('Google blocked this request. Try rephrasing it.');
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('The model reached its output limit. Choose a lower thinking level and try again.');
    const text = candidate?.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    if (!text) throw new Error('Google returned no guide. Try again with a more specific task.');
    return text;
  }
}
