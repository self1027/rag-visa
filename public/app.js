'use strict';
const $ = id => document.getElementById(id);
const busyStatuses = new Set(['queued', 'processing', 'deleting']);
const statusNames = { pending: 'Pendente', queued: 'Na fila', processing: 'Processando', completed: 'Pronto', failed: 'Falhou', deleting: 'Removendo' };
let apiBase = /^https?:$/.test(location.protocol) ? location.origin : '';
let token = '';
let documents = [];
let savedSettings;
let savedEmbedders;
let selectedDocument;
let polling;
let revision = 0;
let loading = false;
let refreshPending = false;
let connected = false;
try { apiBase = localStorage.getItem('rag-visa-api') || apiBase; } catch { /* Storage can be unavailable in private mode. */ }

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
}
function inlineError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function normalizeBase(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Informe apenas a origem HTTP ou HTTPS, sem caminhos ou credenciais.');
  }
  return url.origin;
}
async function request(path, options = {}, base = apiBase, credential = token) {
  const response = await fetch(`${base}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { ...options.headers, ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `A API respondeu com erro ${response.status}.`);
  return data;
}
function errorMessage(error) {
  return error instanceof TypeError ? 'Não foi possível acessar a API. Confira o endereço, a conexão e a permissão de acesso desta página.' : error.message;
}
function connectionState(online) {
  connected = online;
  $('connection-dot').classList.toggle('online', online);
  $('connection-label').textContent = online ? 'API conectada' : 'Conectar à API';
  $('add-pdf').disabled = !online;
  $('document-search').disabled = !online;
  $('refresh').disabled = !online;
}
function fillSettings(config) {
  $('search-limit').value = config.searchLimit;
  $('search-threshold').value = config.searchThreshold;
  $('response-tokens').value = config.maxResponseTokens;
  $('threshold-value').textContent = Number(config.searchThreshold).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  $('model-name').textContent = config.model || 'Não definido';
  $('model-name').title = config.model || '';
  $('detail-model').textContent = config.model || 'Não definido';
  $('detail-embedding').textContent = config.embeddingModel || 'Não definido';
  if (config.limits) {
    for (const [key, id] of Object.entries({ searchLimit: 'search-limit', searchThreshold: 'search-threshold', maxResponseTokens: 'response-tokens' })) {
      $(id).min = config.limits[key].min;
      $(id).max = config.limits[key].max;
    }
  }
  $('upload-limit').textContent = `PDF com texto selecionável · até ${Math.round(config.uploadMaxBytes / 1024 / 1024)} MB`;
}
function describeEmbedder() {
  const profile = savedEmbedders.profiles.find(profile => profile.id === $('embedder-select').value);
  $('embedder-description').textContent = profile ? `${profile.model} · ${profile.dimensions} dimensões · contexto de ${profile.contextTokens} tokens` : '';
  $('apply-embedder').disabled = !profile || profile.id === savedEmbedders.selectedId;
}
function fillEmbedders(config) {
  savedEmbedders = config;
  $('embedder-select').replaceChildren(...config.profiles.map(profile => {
    const option = element('option', profile.label); option.value = profile.id; return option;
  }));
  $('embedder-select').value = config.selectedId;
  describeEmbedder();
  const active = config.profiles.find(profile => profile.id === config.selectedId);
  $('embedder-status').textContent = `Em uso: ${active.label}.`;
  $('detail-embedding').textContent = active.model;
  if (savedSettings) savedSettings.embeddingModel = active.model;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function action(label, callback, className = '') {
  const button = element('button', label, className);
  button.type = 'button'; button.addEventListener('click', callback);
  return button;
}
function renderDocuments() {
  const query = $('document-search').value.trim().toLocaleLowerCase('pt-BR');
  const visible = documents.filter(doc => `${doc.titulo} ${doc.filename}`.toLocaleLowerCase('pt-BR').includes(query));
  $('total-count').textContent = documents.length;
  $('ready-count').textContent = documents.filter(doc => doc.ingestion.status === 'completed' && doc.vigencia !== 'revogada').length;
  $('processing-count').textContent = documents.filter(doc => busyStatuses.has(doc.ingestion.status)).length;
  $('document-count').textContent = `${documents.length} PDFs`;
  $('list-description').textContent = `${visible.length} de ${documents.length} documento(s) · Atualização automática durante o processamento.`;
  const rows = visible.map(doc => {
    const row = element('tr');
    const title = element('td');
    const heading = element('div', undefined, 'doc-title');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon'); icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#file'); icon.append(use);
    heading.append(icon, element('span', doc.titulo));
    title.append(heading, element('span', `${doc.filename} · ${doc.esfera} · ${doc.ano}${doc.vigencia === 'revogada' ? ' · Revogada' : ''}`, 'doc-meta'));
    const state = element('td'); const status = doc.ingestion.status;
    state.append(element('span', statusNames[status] || 'Pendente', `badge ${status === 'completed' ? 'success' : status === 'failed' ? 'error' : busyStatuses.has(status) ? 'warning' : ''}`));
    if (busyStatuses.has(status)) {
      const progress = element('progress'); progress.max = 100; progress.value = Math.max(0, Math.min(100, doc.ingestion.progress || 0));
      progress.setAttribute('aria-label', `Processamento de ${doc.titulo}`);
      state.append(progress, element('span', `${progress.value}%`, 'progress-label'));
    }
    if (status === 'failed' && doc.ingestion.error) state.append(element('p', doc.ingestion.error, 'error-detail'));
    const actions = element('td'); const controls = element('div', undefined, 'row-actions');
    const open = element('a', 'Abrir PDF');
    open.href = `${apiBase}/api/documents/${encodeURIComponent(doc.filename)}`; open.target = '_blank'; open.rel = 'noopener noreferrer';
    open.setAttribute('aria-label', `Abrir PDF: ${doc.titulo}`); controls.append(open);
    if (!busyStatuses.has(status)) {
      const retry = action(status === 'failed' ? 'Tentar novamente' : 'Reprocessar', () => reingest(doc, retry));
      retry.setAttribute('aria-label', `Reprocessar: ${doc.titulo}`);
      const remove = action('Remover', () => {
        selectedDocument = doc;
        $('delete-document-name').textContent = doc.titulo;
        inlineError('delete-error'); $('delete-dialog').showModal();
      }, 'remove');
      remove.setAttribute('aria-label', `Remover: ${doc.titulo}`);
      controls.append(retry, remove);
    }
    actions.append(controls); row.append(title, state, actions); return row;
  });
  if (!rows.length) {
    const row = element('tr'); const cell = element('td', query ? 'Nenhum documento corresponde à busca.' : 'Sua base está vazia. Adicione o primeiro PDF para começar.', 'empty');
    cell.colSpan = 3; row.append(cell); rows.push(row);
  }
  $('documents-list').replaceChildren(...rows);
}
function schedulePolling() {
  clearTimeout(polling);
  if (!document.hidden && connected && documents.some(doc => busyStatuses.has(doc.ingestion.status))) polling = setTimeout(() => refreshDocuments(), 2500);
}
async function refreshDocuments() {
  if (!connected) return;
  if (loading) { refreshPending = true; return; }
  loading = true; const current = revision;
  $('refresh').disabled = true;
  try {
    const data = await request('/api/documents');
    if (revision !== current) return;
    documents = data.documents; renderDocuments();
    if (data.embedderId && savedEmbedders && data.embedderId !== savedEmbedders.selectedId) {
      const embedders = await request('/api/embedders');
      if (revision === current) fillEmbedders(embedders);
    }
  } catch (error) { if (current === revision) notice(errorMessage(error), true); }
  finally {
    loading = false;
    if (current === revision) $('refresh').disabled = false;
    if (refreshPending) { refreshPending = false; void refreshDocuments(); }
    else if (current === revision) schedulePolling();
  }
}
async function connect(base, credential) {
  const current = ++revision; clearTimeout(polling);
  const [config, data, embedders] = await Promise.all([request('/api/settings', {}, base, credential), request('/api/documents', {}, base, credential), request('/api/embedders', {}, base, credential)]);
  if (current !== revision) return;
  apiBase = base; token = credential; documents = data.documents; savedSettings = config;
  try { localStorage.setItem('rag-visa-api', base); } catch { /* Connection still works without persistent storage. */ }
  fillSettings(config); fillEmbedders(embedders); renderDocuments(); connectionState(true);
  $('embedder-fields').disabled = false;
  $('settings-fields').disabled = false;
  $('settings-status').textContent = 'Configuração atual do servidor.';
  notice(''); schedulePolling();
}
async function reingest(doc, button) {
  button.disabled = true;
  try {
    await request(`/api/documents/${encodeURIComponent(doc.filename)}/ingest`, { method: 'POST' });
    notice('Documento enviado para processamento.'); await refreshDocuments();
  } catch (error) { notice(errorMessage(error), true); }
  finally { button.disabled = false; }
}
function formBusy(form, busy) {
  form.setAttribute('aria-busy', String(busy));
  form.querySelectorAll('button').forEach(button => { button.disabled = busy; });
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('cancel', event => {
  if (dialog.querySelector('form').getAttribute('aria-busy') === 'true') event.preventDefault();
});
$('connection-button').addEventListener('click', () => {
  $('api-url').value = apiBase; $('admin-token').value = token; inlineError('connection-error'); $('connection-dialog').showModal();
});
$('connection-form').addEventListener('submit', async event => {
  event.preventDefault(); formBusy(event.currentTarget, true); inlineError('connection-error');
  try {
    await connect(normalizeBase($('api-url').value.trim()), $('admin-token').value.trim());
    $('connection-dialog').close(); $('admin-token').value = '';
  } catch (error) { inlineError('connection-error', errorMessage(error)); }
  finally { formBusy($('connection-form'), false); }
});
$('refresh').addEventListener('click', () => refreshDocuments());
$('embedder-select').addEventListener('change', describeEmbedder);
$('embedder-form').addEventListener('submit', async event => {
  event.preventDefault();
  const current = revision;
  $('embedder-fields').disabled = true;
  $('embedder-status').textContent = 'Verificando o modelo e preparando a reindexação…';
  try {
    const config = await request('/api/embedders', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: $('embedder-select').value }) });
    if (revision !== current) return;
    fillEmbedders(config);
    notice(config.changed ? 'Embedder alterado. Os PDFs foram enviados para reindexação; acompanhe o progresso na base de conhecimento.' : 'Esse embedder já está em uso.');
    await refreshDocuments();
  } catch (error) {
    if (revision === current) { fillEmbedders(savedEmbedders); notice(errorMessage(error), true); }
  } finally { if (revision === current) $('embedder-fields').disabled = !connected; }
});
$('document-search').addEventListener('input', renderDocuments);
$('search-threshold').addEventListener('input', event => {
  $('threshold-value').textContent = Number(event.target.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
});
$('settings-form').addEventListener('input', () => { $('settings-status').textContent = 'Alterações ainda não salvas.'; });
$('discard-settings').addEventListener('click', () => { fillSettings(savedSettings); $('settings-status').textContent = 'Alterações descartadas.'; });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('settings-fields').disabled = true;
  const values = { searchLimit: Number($('search-limit').value), searchThreshold: Number($('search-threshold').value), maxResponseTokens: Number($('response-tokens').value) };
  try {
    const updated = await request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    savedSettings = { ...savedSettings, ...updated }; fillSettings(savedSettings);
    $('settings-status').textContent = 'Ajustes salvos. Válidos para as próximas perguntas.'; notice('Ajustes salvos com sucesso.');
  } catch (error) { $('settings-status').textContent = 'Não foi possível salvar.'; notice(errorMessage(error), true); }
  finally { $('settings-fields').disabled = !connected; }
});
$('add-pdf').addEventListener('click', () => { $('upload-form').reset(); inlineError('upload-error'); $('upload-dialog').showModal(); });
$('upload-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  const file = $('pdf-file').files[0];
  if (!file || !/\.pdf$/i.test(file.name) || file.size > savedSettings.uploadMaxBytes) {
    inlineError('upload-error', 'Selecione um PDF dentro do limite de tamanho informado.'); return;
  }
  formBusy(form, true); inlineError('upload-error'); $('upload-submit').textContent = 'Enviando…';
  try {
    await request('/api/documents', { method: 'POST', body: new FormData(form) });
    $('upload-dialog').close(); form.reset(); notice('PDF cadastrado. Acompanhe o processamento na lista.'); await refreshDocuments();
  } catch (error) { inlineError('upload-error', errorMessage(error)); }
  finally { formBusy(form, false); $('upload-submit').textContent = 'Cadastrar e processar'; }
});
$('delete-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!selectedDocument) return;
  formBusy(event.currentTarget, true); inlineError('delete-error');
  try {
    await request(`/api/documents/${encodeURIComponent(selectedDocument.filename)}`, { method: 'DELETE' });
    $('delete-dialog').close(); selectedDocument = undefined; notice('Documento removido da base.'); await refreshDocuments();
  } catch (error) { inlineError('delete-error', errorMessage(error)); }
  finally { formBusy($('delete-form'), false); }
});
document.addEventListener('visibilitychange', () => { clearTimeout(polling); if (!document.hidden && connected) void refreshDocuments(); });
window.addEventListener('pagehide', () => { clearTimeout(polling); revision++; });
for (const link of document.querySelectorAll('.nav-link')) link.addEventListener('click', () => {
  document.querySelectorAll('.nav-link').forEach(item => item.classList.toggle('current', item === link));
});
if (apiBase) {
  try { void connect(normalizeBase(apiBase), '').catch(error => { connectionState(false); notice(errorMessage(error), true); }); }
  catch (error) { notice(errorMessage(error), true); }
} else {
  notice('Informe o endereço da API em “Conectar à API” para começar.');
}
