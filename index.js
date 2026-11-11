/**
 * dsh-cost-guard Host half.
 * Read-only token/cost analysis plus an automatic budget guard and savings mode.
 * Independent of the management-console data file.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROUTE = '/api/cost-guard';
const AUTH_PATH = ROUTE + '/auth';
const USAGE_PATH = ROUTE + '/usage';
const SAVINGS_PATH = ROUTE + '/savings';
const POLICY_PATH = ROUTE + '/policy';
const DEFAULT_PRICING = { inputHit: 0.04, inputMiss: 2, output: 8 };
const runtime = { mode: false, provider: '', model: '', maxOutput: 1200, thriftWorkspaces: [] };
let authToken = null;
let guardContext = null;

function resolveDshHome() {
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim().length > 0) return process.env.DSH_HOME.trim();
  return path.join(os.homedir(), '.dsh');
}

function settingsFile() {
  return path.join(resolveDshHome(), 'cost-guard', 'settings.json');
}

async function loadSettings() {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
    return normalizeSettings(raw);
  } catch (error) {
    return normalizeSettings({});
  }
}

async function saveSettings(settings) {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const number = (value, min, max, fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const pricing = source.pricing && typeof source.pricing === 'object' ? source.pricing : {};
  return {
    dailyBudget: number(source.dailyBudget, 0, 1000000, 0),
    monthlyBudget: number(source.monthlyBudget, 0, 10000000, 0),
    savingsGuard: source.savingsGuard !== false,
    savingsMode: source.savingsMode === true,
    savingsProvider: typeof source.savingsProvider === 'string' ? source.savingsProvider.slice(0, 100) : '',
    savingsModel: typeof source.savingsModel === 'string' ? source.savingsModel.slice(0, 200) : '',
    savingsMaxOutput: number(source.savingsMaxOutput, 0, 32768, 1200),
    savingsActivatedAt: typeof source.savingsActivatedAt === 'number' ? source.savingsActivatedAt : 0,
    thriftWorkspaces: Array.isArray(source.thriftWorkspaces) ? source.thriftWorkspaces.filter((item) => typeof item === 'string').slice(0, 30) : [],
    pricing: {
      inputHit: number(pricing.inputHit, 0, 100000, DEFAULT_PRICING.inputHit),
      inputMiss: number(pricing.inputMiss, 0, 100000, DEFAULT_PRICING.inputMiss),
      output: number(pricing.output, 0, 100000, DEFAULT_PRICING.output),
    },
    budgetWebhookUrl: typeof source.budgetWebhookUrl === 'string' ? source.budgetWebhookUrl.slice(0, 500) : '',
  };
}

function applyRuntime(settings) {
  runtime.mode = settings.savingsMode;
  runtime.provider = settings.savingsProvider;
  runtime.model = settings.savingsModel;
  runtime.maxOutput = settings.savingsMaxOutput;
  runtime.thriftWorkspaces = settings.thriftWorkspaces;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function matchesPath(req, expected) {
  try {
    return new URL(req.url || '/', 'http://localhost').pathname === expected;
  } catch (error) {
    return false;
  }
}

function requireToken(req, res) {
  const provided = req.headers['x-cost-guard-token'];
  if (typeof provided === 'string' && authToken !== null && provided === authToken) return true;
  sendJson(res, 401, { error: 'unauthorized' });
  return false;
}

function createAuthRoute() {
  return async (req, res) => {
    if (!matchesPath(req, AUTH_PATH)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (authToken === null) authToken = randomBytes(24).toString('hex');
    sendJson(res, 200, { token: authToken });
  };
}

function createReadRoute(endpoint, build) {
  return async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    if (!matchesPath(req, endpoint)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (!requireToken(req, res)) return;
    try {
      sendJson(res, 200, await build(req));
    } catch (error) {
      sendJson(res, 500, { error: String((error && error.message) || error) });
    }
  };
}

function optionalService(ctx, name) {
  try {
    return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined;
  } catch (error) {
    return undefined;
  }
}

function costOf(tokens, pricing) {
  return Math.round(((tokens.inputMiss * pricing.inputMiss + tokens.inputHit * pricing.inputHit + tokens.output * pricing.output) / 1000000) * 1000000) / 1000000;
}

async function readWorkspaceMap() {
  const map = new Map();
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(resolveDshHome(), 'storages', 'workspace.json'), 'utf8'));
    const table = parsed && parsed.tables && parsed.tables.workspaces;
    for (const workspace of table && typeof table === 'object' ? Object.values(table) : []) {
      if (!workspace || typeof workspace !== 'object') continue;
      const workspacePath = typeof workspace.path === 'string' ? workspace.path : '';
      const title = typeof workspace.title === 'string' && workspace.title.length > 0 ? workspace.title : path.basename(workspacePath);
      for (const sessionId of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
        if (typeof sessionId === 'string') map.set(sessionId, { path: workspacePath, title });
      }
    }
  } catch (error) {
    // workspace storage is optional
  }
  return map;
}

async function collectUsage(settings) {
  const pricing = normalizeSettings(settings).pricing;
  const workspaceMap = await readWorkspaceMap();
  const root = path.join(resolveDshHome(), 'storages', 'session_projcache', 'sessions');
  const entries = (await fs.readdir(root).catch(() => [])).filter((name) => name.endsWith('.json'));
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const days = new Map();
  for (let offset = 29; offset >= 0; offset -= 1) {
    days.set(dayStart.getTime() - offset * 86400000, { at: dayStart.getTime() - offset * 86400000, sessions: 0, inputMiss: 0, inputHit: 0, output: 0, totalTokens: 0, cost: 0 });
  }
  const byWorkspace = new Map();
  const sessions = [];
  for (const name of entries) {
    const sessionId = name.slice(0, -5);
    let parsed;
    let stat;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
      stat = await fs.stat(path.join(root, name));
    } catch (error) {
      continue;
    }
    const rows = parsed && parsed.record && parsed.record.rows;
    const totals = rows && rows.tokenUsage && rows.tokenUsage.val && rows.tokenUsage.val.totals;
    if (!totals || typeof totals !== 'object') continue;
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    const tokens = { inputMiss: num(totals.uncachedInputTokens) + num(totals.cacheWriteTokens), inputHit: num(totals.cacheReadTokens), output: num(totals.outputTokens) };
    const info = workspaceMap.get(sessionId) || { path: '', title: '未登记工作区' };
    const key = info.path || info.title;
    if (!byWorkspace.has(key)) byWorkspace.set(key, { path: info.path, title: info.title, sessions: 0, inputMiss: 0, inputHit: 0, output: 0, totalTokens: 0, cost: 0, lastAt: null });
    const row = byWorkspace.get(key);
    row.sessions += 1;
    row.inputMiss += tokens.inputMiss;
    row.inputHit += tokens.inputHit;
    row.output += tokens.output;
    row.lastAt = Math.max(row.lastAt || 0, stat.mtimeMs);
    sessions.push({ sessionId, workspace: info.title, path: info.path, lastAt: stat.mtimeMs, ...tokens });
    const bucketDate = new Date(stat.mtimeMs);
    bucketDate.setHours(0, 0, 0, 0);
    const bucket = days.get(bucketDate.getTime());
    if (bucket) {
      bucket.sessions += 1;
      bucket.inputMiss += tokens.inputMiss;
      bucket.inputHit += tokens.inputHit;
      bucket.output += tokens.output;
    }
  }
  const workspaces = [...byWorkspace.values()].map((row) => {
    const totalTokens = row.inputMiss + row.inputHit + row.output;
    return {
      ...row,
      totalTokens,
      cacheHitRate: row.inputHit + row.inputMiss === 0 ? 0 : Math.round((row.inputHit / (row.inputHit + row.inputMiss)) * 1000) / 1000,
      cost: costOf(row, pricing),
    };
  }).sort((left, right) => right.cost - left.cost);
  const totals = workspaces.reduce(
    (sum, row) => ({
      sessions: sum.sessions + row.sessions,
      inputMiss: sum.inputMiss + row.inputMiss,
      inputHit: sum.inputHit + row.inputHit,
      output: sum.output + row.output,
      totalTokens: sum.totalTokens + row.totalTokens,
      cost: 0,
    }),
    { sessions: 0, inputMiss: 0, inputHit: 0, output: 0, totalTokens: 0, cost: 0 },
  );
  totals.cost = costOf(totals, pricing);
  totals.cacheHitRate = totals.inputHit + totals.inputMiss === 0 ? 0 : Math.round((totals.inputHit / (totals.inputHit + totals.inputMiss)) * 1000) / 1000;
  const daily30 = [...days.values()];
  for (const day of daily30) {
    day.totalTokens = day.inputMiss + day.inputHit + day.output;
    day.cost = costOf(day, pricing);
  }
  const todayCost = daily30[daily30.length - 1].cost;
  const weekCost = daily30.slice(-7).reduce((sum, day) => sum + day.cost, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthToDateCost = daily30.filter((day) => day.at >= monthStart.getTime()).reduce((sum, day) => sum + day.cost, 0);
  const sessionsTop = sessions.sort((left, right) => right.totalTokens - left.totalTokens).slice(0, 12).map((session) => ({ ...session, totalTokens: session.inputMiss + session.inputHit + session.output, cost: costOf(session, pricing) }));
  return {
    generatedAt: Date.now(),
    pricing,
    currency: 'CNY',
    workspaces,
    totals,
    daily30,
    topSessions: sessionsTop,
    efficiency: {
      todayCost: Math.round(todayCost * 1000) / 1000,
      weekCost: Math.round(weekCost * 1000) / 1000,
      monthToDateCost: Math.round(monthToDateCost * 1000) / 1000,
      cacheHitRate: totals.cacheHitRate,
      targetCacheHit: 0.7,
      totalCost: totals.cost,
      totalTokens: totals.totalTokens,
    },
  };
}

async function currentDefaultModel(ctx) {
  try {
    const service = optionalService(ctx, 'agentDefaultModel');
    return service && typeof service.currentSelection === 'function' ? service.currentSelection() : null;
  } catch (error) {
    return null;
  }
}

async function discoverModels(ctx, onlyCheap) {
  const llm = optionalService(ctx, 'llm');
  if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return [];
  const list = [];
  try {
    const providers = await llm.listProviders();
    for (const provider of Array.isArray(providers) ? providers.slice(0, 8) : []) {
      const providerId = provider && typeof provider.id === 'string' ? provider.id : '';
      if (providerId.length === 0) continue;
      const models = await llm.listModels(providerId);
      for (const model of Array.isArray(models) ? models : []) {
        if (!model || typeof model.id !== 'string') continue;
        const text = model.id + ' ' + (model.name || '');
        const cheap = /flash|lite|mini|fast|turbo|economy|cheap/i.test(text) && !/max|pro|ultra|reason|thinking/i.test(text);
        if (onlyCheap && !cheap) continue;
        list.push({ provider: providerId, model: model.id, name: model.name || model.id, cheap });
      }
    }
  } catch (error) {
    return [];
  }
  return list.slice(0, onlyCheap ? 8 : 40);
}

async function chooseModel(ctx, settings) {
  if (settings.savingsProvider && settings.savingsModel) return { provider: settings.savingsProvider, model: settings.savingsModel };
  const current = await currentDefaultModel(ctx);
  const candidates = await discoverModels(ctx, true);
  return candidates.find((candidate) => !current || candidate.provider !== current.provider || candidate.model !== current.model) || null;
}

async function activateSavings(ctx, reason) {
  const settings = await loadSettings();
  if (settings.savingsMode) return settings;
  const next = { ...settings, savingsMode: true, savingsActivatedAt: Date.now() };
  const picked = await chooseModel(ctx, next);
  if (picked) {
    next.savingsProvider = picked.provider;
    next.savingsModel = picked.model;
    try {
      const service = optionalService(ctx, 'agentDefaultModel');
      if (service && typeof service.saveSelection === 'function') await service.saveSelection(picked);
    } catch (error) {
      // best-effort default model switch for new sessions
    }
  }
  await saveSettings(next);
  applyRuntime(next);
  if (next.budgetWebhookUrl.length > 0) {
    try {
      await fetch(next.budgetWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'auto-savings', reason, savingsMode: true }) });
    } catch (error) {
      // webhook is best-effort
    }
  }
  return next;
}

async function readSavingsStatus(ctx) {
  const settings = await loadSettings();
  const compaction = optionalService(ctx, 'compaction');
  const pruner = optionalService(ctx, 'toolResultPruner');
  const tokenMeter = optionalService(ctx, 'tokenMeter');
  const agents = optionalService(ctx, 'agents');
  const live = agents && typeof agents.list === 'function' ? agents.list() : [];
  const sessions = [];
  for (const agent of live) {
    let session;
    try {
      session = agent && agent.session;
    } catch (error) {
      session = undefined;
    }
    if (!session || !session.header) continue;
    let pressure = {};
    try {
      pressure = tokenMeter && typeof tokenMeter.contextPressure === 'function' ? tokenMeter.contextPressure(session) || {} : {};
    } catch (error) {
      pressure = {};
    }
    const pressureTokens = typeof pressure.pressureTokens === 'number' ? pressure.pressureTokens : 0;
    const contextWindow = typeof pressure.contextWindow === 'number' ? pressure.contextWindow : 0;
    const ratio = contextWindow > 0 ? Math.round((pressureTokens / contextWindow) * 1000) / 1000 : 0;
    const target = Math.round(contextWindow * 0.5);
    sessions.push({ id: String(agent.id), cwd: session.header.cwd || '', pressureTokens, contextWindow, ratio, compressibleTokens: Math.max(0, pressureTokens - target) });
  }
  sessions.sort((left, right) => right.ratio - left.ratio);
  const requested = '';
  return {
    generatedAt: Date.now(),
    settings,
    budgets: { daily: settings.dailyBudget, monthly: settings.monthlyBudget },
    compaction: { enabled: Boolean(compaction && typeof compaction.compactIfNeeded === 'function') },
    pruner: { enabled: Boolean(pruner && typeof pruner.pruneSession === 'function') },
    savings: { mode: runtime.mode, guard: settings.savingsGuard, provider: runtime.provider, model: runtime.model, maxOutput: runtime.maxOutput, activatedAt: settings.savingsActivatedAt },
    thriftWorkspaces: settings.thriftWorkspaces,
    modelCandidates: await discoverModels(ctx, true),
    availableModels: await discoverModels(ctx, false),
    defaultModel: await currentDefaultModel(ctx),
    sessions,
    selected: sessions.find((session) => session.id === requested) || sessions[0] || null,
  };
}

function createPolicyRoute(ctx) {
  return async (req, res) => {
    if (!matchesPath(req, POLICY_PATH)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    if (!requireToken(req, res)) return;
    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (error) {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }
    if (body.action === 'discover') {
      sendJson(res, 200, { ok: true, candidates: await discoverModels(ctx, true), availableModels: await discoverModels(ctx, false), current: await currentDefaultModel(ctx) });
      return;
    }
    if (body.action === 'evaluate') {
      const settings = await loadSettings();
      const usage = await collectUsage(settings);
      const over = (settings.dailyBudget > 0 && usage.efficiency.todayCost > settings.dailyBudget) || (settings.monthlyBudget > 0 && usage.efficiency.monthToDateCost > settings.monthlyBudget);
      if (over && settings.savingsGuard) await activateSavings(ctx, 'budget guard');
      sendJson(res, 200, { ok: true, usage: usage.efficiency, savings: { mode: runtime.mode, guard: settings.savingsGuard } });
      return;
    }
    const current = await loadSettings();
    const next = normalizeSettings({ ...current, ...body });
    if (next.savingsMode && (!next.savingsProvider || !next.savingsModel)) {
      const picked = await chooseModel(ctx, next);
      if (picked) {
        next.savingsProvider = picked.provider;
        next.savingsModel = picked.model;
      }
    }
    await saveSettings(next);
    applyRuntime(next);
    if (next.savingsMode && next.savingsProvider && next.savingsModel) {
      try {
        const service = optionalService(ctx, 'agentDefaultModel');
        if (service && typeof service.saveSelection === 'function') await service.saveSelection({ provider: next.savingsProvider, model: next.savingsModel });
      } catch (error) {
        // model switch is best-effort
      }
    }
    sendJson(res, 200, { ok: true, settings: next });
  };
}

function apply(ctx) {
  guardContext = ctx;
  loadSettings().then(applyRuntime).catch(() => {});
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: AUTH_PATH, handler: createAuthRoute() }), 'cost-guard: auth');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: USAGE_PATH, handler: createReadRoute(USAGE_PATH, async () => collectUsage(await loadSettings())) }), 'cost-guard: usage');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: SAVINGS_PATH, handler: createReadRoute(SAVINGS_PATH, () => readSavingsStatus(ctx)) }), 'cost-guard: savings');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: POLICY_PATH, handler: createPolicyRoute(ctx) }), 'cost-guard: policy');
  ctx.effect(() => {
    const systemPrompt = optionalService(ctx, 'systemPrompt');
    if (!systemPrompt || typeof systemPrompt.section !== 'function') return () => {};
    return systemPrompt.section({
      name: 'cost-guard-savings',
      order: 900,
      text: () =>
        runtime.mode
          ? '[COST SAVING MODE] Keep responses concise. Do not restate files or established context; prefer diffs and targeted reads.' +
            (runtime.maxOutput > 0 ? ' Keep the final answer under about ' + runtime.maxOutput + ' tokens.' : '') +
            (runtime.thriftWorkspaces.length > 0 ? ' Thrift workspaces: ' + runtime.thriftWorkspaces.slice(0, 10).join(', ') + '. For these, prefer targeted reads and never paste whole files.' : '')
          : '',
    });
  }, 'cost-guard: savings prompt');
  const timer = setInterval(async () => {
    try {
      const settings = await loadSettings();
      if (!settings.savingsGuard) return;
      const usage = await collectUsage(settings);
      const over = (settings.dailyBudget > 0 && usage.efficiency.todayCost > settings.dailyBudget) || (settings.monthlyBudget > 0 && usage.efficiency.monthToDateCost > settings.monthlyBudget);
      if (over && !runtime.mode) await activateSavings(guardContext, 'budget guard');
    } catch (error) {
      // budget guard is best-effort
    }
  }, 60000);
  if (typeof timer.unref === 'function') timer.unref();
  ctx.effect(() => () => clearInterval(timer), 'cost-guard: budget timer');
}

export { apply };
export const inject = ['webServer'];
