window.__ModuleLoader__.load({
  id: '@tomjerrygit/dsh-cost-guard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PANEL_ID = 'cost-guard';
    const NS = 'costGuard';
    const zh = {
      panel: '费用护栏',
      title: 'Token 费用护栏',
      subtitle: '用量、缓存、预算与自动省钱模式',
      refresh: '刷新',
      today: '今日费用',
      month: '本月费用',
      total: '累计费用',
      cache: '缓存命中',
      forecast: '预计月费用',
      trend: '近 30 天费用趋势',
      actual: '实际费用',
      baseline: '无缓存基线',
      workspaces: '工作区费用',
      savings: '自动省钱',
      compaction: '自动压缩',
      pruner: '工具裁剪',
      context: '当前会话上下文',
      noContext: '暂无上下文数据',
      compressible: '预计可压缩 {n} tokens',
      budgets: '预算护栏',
      daily: '每日预算',
      monthly: '月度预算',
      save: '保存预算',
      modeOn: '关闭省钱模式',
      modeOff: '开启省钱模式',
      check: '检查预算',
      model: '省钱模型',
      auto: '自动选择',
      discover: '发现省钱模型',
      thrift: '高消耗工作区省流',
      effect: '省钱效果',
      before: '启用前日均',
      after: '启用后日均',
      noEffect: '暂无前后对比',
      loading: '正在读取费用数据…',
      failed: '费用数据不可用',
      thriftOn: '已加入省流',
      thriftOff: '加入省流',
      offline: 'Host 未响应',
    };
    const en = {
      panel: 'Cost Guard',
      title: 'Token Cost Guard',
      subtitle: 'Usage, cache, budgets, and automatic savings',
      refresh: 'Refresh',
      today: 'Today',
      month: 'Month to date',
      total: 'Total',
      cache: 'Cache hit',
      forecast: 'Forecast month',
      trend: '30-day cost trend',
      actual: 'Actual',
      baseline: 'No-cache baseline',
      workspaces: 'Workspace cost',
      savings: 'Auto savings',
      compaction: 'Auto compaction',
      pruner: 'Tool pruning',
      context: 'Current context',
      noContext: 'No context data yet',
      compressible: '{n} tokens compressible',
      budgets: 'Budget guard',
      daily: 'Daily budget',
      monthly: 'Monthly budget',
      save: 'Save budgets',
      modeOn: 'Disable savings mode',
      modeOff: 'Enable savings mode',
      check: 'Check budget',
      model: 'Savings model',
      auto: 'Auto select',
      discover: 'Discover models',
      thrift: 'High-cost thrift list',
      effect: 'Savings effect',
      before: 'Before avg',
      after: 'After avg',
      noEffect: 'No comparison yet',
      loading: 'Loading cost data…',
      failed: 'Cost data unavailable',
      thriftOn: 'In thrift list',
      thriftOff: 'Add to thrift',
      offline: 'Host unavailable',
    };
    const panelStyle = { display: 'flex', flexDirection: 'column', gap: '14px', padding: '24px 32px', minHeight: '100%', overflow: 'auto', color: 'var(--dsw-alias-label-primary)' };
    const card = { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '14px', padding: '14px', background: 'var(--dsw-alias-bg-layer-1)' };
    const money = (value) => '¥' + (Number(value) || 0).toFixed(3);
    const tokenText = (value) => String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match));

    function pointsOf(values, width, height, pad) {
      if (!Array.isArray(values) || values.length < 2) return '';
      const max = Math.max(0.000001, ...values);
      return values.map((value, index) => {
        const x = pad + (index / (values.length - 1)) * (width - pad * 2);
        const y = pad + (1 - Math.max(0, Number(value) || 0) / max) * (height - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
    }

    function Panel(props) {
      const t = (key) => { const dict = /^zh/i.test(String(window.navigator && window.navigator.language)) ? zh : en; return dict[key] || key; };
      const [token, setToken] = React.useState('');
      const [usage, setUsage] = React.useState(null);
      const [savings, setSavings] = React.useState(null);
      const [state, setState] = React.useState('loading');
      const [dailyDraft, setDailyDraft] = React.useState('');
      const [monthlyDraft, setMonthlyDraft] = React.useState('');
      const auth = () => {
        if (token.length > 0) return Promise.resolve(token);
        return fetch('/api/cost-guard/auth').then((res) => res.json()).then((payload) => { setToken(payload.token); return payload.token; });
      };
      const read = (url) => auth().then((value) => fetch(url, { headers: { 'x-cost-guard-token': value, accept: 'application/json' }, cache: 'no-store' })).then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); });
      const post = (body) => auth().then((value) => fetch('/api/cost-guard/policy', { method: 'POST', headers: { 'x-cost-guard-token': value, 'content-type': 'application/json' }, body: JSON.stringify(body) })).then((res) => res.json());
      const load = () => {
        auth().then(() => Promise.all([read('/api/cost-guard/usage'), read('/api/cost-guard/savings')]))
          .then(([nextUsage, nextSavings]) => {
            setUsage(nextUsage);
            setSavings(nextSavings);
            setDailyDraft(String(nextSavings.settings.dailyBudget || ''));
            setMonthlyDraft(String(nextSavings.settings.monthlyBudget || ''));
            setState('ready');
          })
          .catch(() => setState('failed'));
      };
      React.useEffect(() => { load(); }, []);
      if (state === 'loading') return h('div', { style: panelStyle }, h('h1', { style: { margin: 0, fontSize: '20px' } }, t('title')), h('p', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('loading')));
      if (state !== 'ready' || usage === null || savings === null) return h('div', { style: panelStyle }, h('h1', { style: { margin: 0, fontSize: '20px' } }, t('title')), h('p', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('failed')));
      const efficiency = usage.efficiency || {};
      const actual = Array.isArray(usage.daily30) ? usage.daily30.map((day) => Number(day.cost) || 0) : [];
      const baseline = Array.isArray(usage.daily30) ? usage.daily30.map((day) => ((Number(day.inputMiss) || 0) + (Number(day.inputHit) || 0)) * usage.pricing.inputMiss / 1000000 + (Number(day.output) || 0) * usage.pricing.output / 1000000) : [];
      const context = savings.selected || null;
      const settings = savings.settings;
      const selectedModel = settings.savingsProvider && settings.savingsModel ? settings.savingsProvider + '||' + settings.savingsModel : '';
      const thrift = Array.isArray(savings.thriftWorkspaces) ? savings.thriftWorkspaces : [];
      const effect = (() => {
        if (actual.length === 0) return null;
        const latest = usage.daily30[usage.daily30.length - 1].at;
        const cutoff = settings.savingsActivatedAt || latest - 6 * 86400000;
        const before = usage.daily30.filter((day) => day.at < cutoff).map((day) => Number(day.cost) || 0);
        const after = usage.daily30.filter((day) => day.at >= cutoff).map((day) => Number(day.cost) || 0);
        const avg = (rows) => rows.length > 0 ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
        return { before: avg(before), after: avg(after) };
      })();
      const forecast = (() => {
        const mtd = Number(efficiency.monthToDateCost) || 0;
        const now = new Date();
        return mtd > 0 ? mtd / Math.max(1, now.getDate()) * new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : (Number(efficiency.todayCost) || 0) * 30;
      })();
      const saveBudgets = () => post({ dailyBudget: Number(dailyDraft) || 0, monthlyBudget: Number(monthlyDraft) || 0 }).then(load);
      const toggleMode = () => post({ savingsMode: !settings.savingsMode }).then(load);
      const checkBudget = () => post({ action: 'evaluate' }).then(load);
      const discover = () => post({ action: 'discover' }).then(load);
      const toggleThrift = (pathValue) => post({ thriftWorkspaces: thrift.includes(pathValue) ? thrift.filter((entry) => entry !== pathValue) : [...thrift, pathValue] }).then(load);
      const setModel = (value) => { const parts = String(value || '').split('||'); return post({ savingsProvider: parts[0] || '', savingsModel: parts[1] || '' }).then(load); };
      return h('div', { style: panelStyle },
        h('header', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
          h('div', { style: { flex: '1 1 auto' } }, h('h1', { style: { margin: 0, fontSize: '22px' } }, t('title')), h('p', { style: { margin: '4px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, t('subtitle'))),
          h('button', { type: 'button', onClick: load, style: { padding: '6px 12px', borderRadius: '8px' } }, t('refresh')),
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' } },
          [[t('today'), money(efficiency.todayCost)], [t('month'), money(efficiency.monthToDateCost)], [t('total'), money(efficiency.totalCost)], [t('cache'), Math.round((efficiency.cacheHitRate || 0) * 100) + '%'], [t('forecast'), money(forecast)]].map(([label, value]) =>
            h('div', { key: label, style: card }, h('div', { style: { fontSize: '20px', fontWeight: '700' } }, value), h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginTop: '4px' } }, label)),
          ),
        ),
        h('section', { style: card },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' } }, h('strong', null, t('trend')), h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('actual') + ' / ' + t('baseline'))),
          actual.length > 1 ? h('svg', { viewBox: '0 0 600 150', preserveAspectRatio: 'none', style: { width: '100%', height: '150px' } },
            h('polyline', { points: pointsOf(baseline, 600, 150, 10), fill: 'none', stroke: 'var(--dsw-alias-state-warn-primary)', strokeWidth: '2', strokeDasharray: '5 4' }),
            h('polyline', { points: pointsOf(actual, 600, 150, 10), fill: 'none', stroke: 'var(--dshqn-accent, var(--dsw-alias-brand-primary))', strokeWidth: '2.5' }),
          ) : h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, t('failed')),
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' } },
          h('section', { style: card },
            h('strong', { style: { fontSize: '14px' } }, t('workspaces')),
            ...(usage.workspaces || []).slice(0, 6).map((row) => h('div', { key: row.path || row.title, style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '8px' } }, h('span', null, row.title), h('span', null, money(row.cost)))),
          ),
          h('section', { style: card },
            h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, h('strong', { style: { fontSize: '14px', flex: '1 1 auto' } }, t('savings')), h('span', { style: { fontSize: '11px' } }, (savings.compaction.enabled ? '✓ ' : '× ') + t('compaction')), h('span', { style: { fontSize: '11px' } }, (savings.pruner.enabled ? '✓ ' : '× ') + t('pruner'))),
            h('div', { style: { fontSize: '12px', marginTop: '10px' } }, t('context') + '：' + (context ? Math.round(context.ratio * 100) + '% · ' + tokenText(context.pressureTokens) + ' / ' + tokenText(context.contextWindow) + (context.compressibleTokens > 0 ? ' · ' + fill(t('compressible'), { n: tokenText(context.compressibleTokens) }) : '') : t('noContext'))),
            h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' } }, h('button', { type: 'button', onClick: toggleMode }, settings.savingsMode ? t('modeOn') : t('modeOff')), h('button', { type: 'button', onClick: checkBudget }, t('check')), h('button', { type: 'button', onClick: discover }, t('discover'))),
            h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } }, h('span', { style: { fontSize: '12px' } }, t('model')), h('select', { value: selectedModel, onChange: (event) => setModel(event.target.value) }, h('option', { value: '' }, t('auto')), (savings.availableModels || []).map((model) => h('option', { key: model.provider + '||' + model.model, value: model.provider + '||' + model.model }, model.provider + ' / ' + model.name)))),
            h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } }, h('span', { style: { fontSize: '12px' } }, t('daily')), h('input', { type: 'number', min: 0, value: dailyDraft, onChange: (event) => setDailyDraft(event.target.value), style: { width: '90px' } }), h('span', { style: { fontSize: '12px' } }, t('monthly')), h('input', { type: 'number', min: 0, value: monthlyDraft, onChange: (event) => setMonthlyDraft(event.target.value), style: { width: '100px' } }), h('button', { type: 'button', onClick: saveBudgets }, t('save'))),
            h('div', { style: { fontSize: '12px', marginTop: '10px' } }, t('thrift') + '：', ...(usage.workspaces || []).slice(0, 3).map((row) => h('button', { key: row.path, type: 'button', onClick: () => toggleThrift(row.path), style: { margin: '2px 4px 2px 0', fontSize: '11px' } }, row.title + (thrift.includes(row.path) ? ' ✓' : ' +')))),
            effect ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '8px' } }, t('effect') + '：' + (effect.before !== null ? t('before') + ' ' + money(effect.before) + ' · ' : '') + (effect.after !== null ? t('after') + ' ' + money(effect.after) : t('noEffect'))) : null,
          ),
        ),
      );
    }

    function SidebarIcon(props) {
      return h('svg', { width: props.size || 18, height: props.size || 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 19V5' }), h('path', { d: 'M8 17V9' }), h('path', { d: 'M12 19V7' }), h('path', { d: 'M16 15V5' }), h('path', { d: 'M20 19V11' }));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cost-guard: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Panel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 21, label: () => t('panel'), locale: NS }, SidebarIcon));
    }

    return { inject: ['slots', 'locale', 'layout'], apply };
  },
});
