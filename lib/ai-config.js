// Shared, credential-free provider configuration for the worker and settings UI.
// Catalog/capabilities checked against Google's model and thinking docs, 2026-10-22.
(() => {
  const levels = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
  const models = [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', levels: levels.slice(1) },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', levels: levels.slice(1), providers: ['vertex'] },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', levels },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', levels },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', levels },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)', levels: levels.slice(1) },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (legacy)', budgets: ['auto', 'off', '1024', '8192'] }
  ];
  const keys = ['apiProvider', 'apiKey', 'geminiModel', 'geminiThinking', 'vertexCredentials', 'vertexProject', 'vertexLocation'];
  function parseCredentials(value) {
    let data;
    try { data = typeof value === 'string' ? JSON.parse(value) : value; }
    catch { throw new Error('Enter a valid service-account JSON file.'); }
    if (data?.type !== 'service_account') throw new Error('Use a Google service-account JSON key (type: service_account).');
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(data.project_id || '')) throw new Error('The credential is missing a valid project_id.');
    if (!/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(data.client_email || '')) throw new Error('The credential is missing a valid service-account client_email.');
    if (typeof data.private_key !== 'string' || !/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+\s+-----END PRIVATE KEY-----\s*$/.test(data.private_key)) throw new Error('The credential must contain a PEM private_key.');
    // Never accept a credential-supplied token endpoint or retain unrelated fields.
    return { type: 'service_account', project_id: data.project_id, client_email: data.client_email, private_key: data.private_key };
  }
  function modelConfig(settings) {
    const id = settings.geminiModel || 'gemini-3.8-flash';
    if (!/^gemini-[a-z0-9][a-z0-9.-]{0,95}$/.test(id)) throw new Error('Enter a valid Gemini model ID.');
    const model = models.find(item => item.id === id);
    if (model?.providers && !model.providers.includes(settings.apiProvider)) throw new Error('This model is only listed for Vertex AI. Choose another model.');
    const thinking = settings.geminiThinking || 'auto';
    const generationConfig = { maxOutputTokens: 16384, responseMimeType: 'application/json' };
    if (thinking !== 'auto') {
      if (model?.levels?.includes(thinking)) generationConfig.thinkingConfig = { thinkingLevel: thinking };
      else if (model?.budgets?.includes(thinking)) generationConfig.thinkingConfig = { thinkingBudget: thinking === 'off' ? 0 : Number(thinking) };
      else throw new Error('This thinking setting is not supported by the selected model. Choose Model default.');
    }
    return { id, generationConfig };
  }
  function vertexTarget(settings, credentials) {
    const project = settings.vertexProject?.trim() || credentials.project_id;
    const location = settings.vertexLocation?.trim() || 'global';
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('Enter a valid Google Cloud project ID.');
    if (!/^(global|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.test(location) || location.length > 40) throw new Error('Enter a valid Vertex location, such as global or us-central1.');
    return { project, location };
  }
  function assertCredentials(settings) {
    if (settings.apiProvider === 'vertex') {
      const credentials = parseCredentials(settings.vertexCredentials);
      vertexTarget(settings, credentials);
    } else if (!settings.apiKey?.trim()) throw new Error('Add an API key in Settings to start a guide.');
  }
  globalThis.GuideMeAIConfig = { models, keys, parseCredentials, modelConfig, vertexTarget, assertCredentials };
})();
