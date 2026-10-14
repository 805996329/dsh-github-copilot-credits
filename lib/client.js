// Prebuilt DSH Client module: React is supplied by DSH; no browser-side secret.
window.__ModuleLoader__.load({
  id: 'dsh-github-copilot-credits',
  factory: (require) => {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const { createElement: h, useEffect, useId, useLayoutEffect, useRef, useState } = React;
    const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
    const format = (value) => typeof value === 'number' && Number.isFinite(value) ? number.format(value) : '—';
    const colors = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l2)',
      panel: 'var(--dsw-alias-bg-overlay)',
      track: 'var(--dsw-alias-bg-layer-2)',
      warn: 'var(--dsw-alias-state-warn-primary)',
    };
    const progress = (data) => data?.ok === true && data.total > 0 && data.remaining !== null
      ? Math.max(0, Math.min(100, ((data.total - data.remaining) / data.total) * 100)) : null;
    const unitOf = (data) => data?.unit === 'credits' ? 'Credits'
      : data?.unit === 'requests' ? 'Premium Requests' : '配额';
    const timeOf = (value) => {
      if (typeof value !== 'string') return '—';
      const time = new Date(value);
      return Number.isNaN(time.getTime()) ? '—' : time.toLocaleTimeString('zh-CN', { hour12: false });
    };
    const resetOf = (value) => typeof value === 'string' ? value.slice(0, 10) : '—';

    function Lightning() {
      return h('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true,
        style: { flex: 'none', color: colors.warn } },
      h('path', { fill: 'currentColor', d: 'M11.6 1.5 3.8 10.8h5.4l-.7 7.7 7.7-10H11l.6-7z' }));
    }

    function CopilotCredits() {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(true);
      const [refreshing, setRefreshing] = useState(false);
      const [open, setOpen] = useState(false);
      const [position, setPosition] = useState(null);
      const triggerRef = useRef(null);
      const panelRef = useRef(null);
      const loadRef = useRef(null);
      const id = useId().replaceAll(':', '');
      const panelId = `dsh-copilot-credits-${id}`;

      // Opening the panel NEVER refreshes. Auto polling and the panel's Refresh
      // button are independent; only the latter requests an uncached sample.
      useEffect(() => {
        let disposed = false;
        let controller;
        let inFlight = false;
        async function load(force) {
          if (inFlight && !force) return;
          if (inFlight && force) controller?.abort();
          const active = new AbortController();
          controller = active;
          inFlight = true;
          if (force) setRefreshing(true);
          try {
            const response = await fetch(`/api/copilot-credits${force ? '?refresh=1' : ''}`, {
              credentials: 'same-origin', cache: 'no-store', signal: active.signal,
            });
            if (!response.ok) throw new Error('connection');
            const result = await response.json();
            if (disposed || active.signal.aborted) return;
            if (result.ok) {
              setData(result);
              setError(null);
            } else {
              // Network failures may retain a clearly marked old sample; an
              // account switch/sign-out must discard the previous account.
              const transient = ['network', 'rate-limit', 'github-unavailable', 'bad-response'];
              setData((previous) => transient.includes(result.code) && previous?.ok ? previous : result);
              setError(result.message || '用量暂不可用。');
            }
          } catch {
            if (disposed || active.signal.aborted) return;
            setData((previous) => previous?.ok ? previous : { ok: false, code: 'connection' });
            setError('无法连接 DSH 用量服务，请检查连接后重试。');
          } finally {
            if (controller === active) {
              inFlight = false;
              if (!disposed && !active.signal.aborted) {
                setLoading(false);
                setRefreshing(false);
              }
            }
          }
        }
        loadRef.current = load;
        void load(false);
        const interval = setInterval(() => { void load(false); }, 120000);
        return () => { disposed = true; clearInterval(interval); controller?.abort(); loadRef.current = null; };
      }, []);

      useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
          const trigger = triggerRef.current;
          const panel = panelRef.current;
          if (!trigger || !panel) return;
          const rect = trigger.getBoundingClientRect();
          const width = Math.min(panel.offsetWidth || 280, window.innerWidth - 24);
          const height = panel.offsetHeight || 200;
          const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - 12 - width));
          const above = rect.top - height - 8;
          const top = Math.max(12, above >= 12 ? above : Math.min(rect.bottom + 8, window.innerHeight - height - 12));
          setPosition((previous) => previous?.left === left && previous?.top === top ? previous : { left, top });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
      }, [open, data, error, refreshing]);

      useEffect(() => {
        if (!open) return;
        panelRef.current?.focus({ preventScroll: true });
        const outside = (event) => {
          if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
          setOpen(false);
        };
        const escape = (event) => {
          if (event.key !== 'Escape') return;
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
      }, [open]);

      const available = data?.ok === true && data.total !== null && data.remaining !== null;
      const label = available ? `${format(data.remaining)} / ${format(data.total)}`
        : data?.ok && data.used !== null ? `已用 ${format(data.used)} · 余额未知`
          : loading ? 'Copilot 查询中…' : 'Copilot 用量不可用';
      const percent = progress(data);
      const panel = open ? createPortal(h('section', {
        ref: panelRef, id: panelId, role: 'dialog', 'aria-modal': false,
        'aria-labelledby': `${panelId}-heading`, tabIndex: -1,
        style: {
          position: 'fixed', zIndex: 1100, boxSizing: 'border-box',
          left: position?.left ?? 0, top: position?.top ?? 0,
          visibility: position === null ? 'hidden' : 'visible',
          width: 'min(280px, calc(100vw - 24px))',
          maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
          padding: '14px 14px 10px', borderRadius: 12,
          border: `1px solid ${colors.border}`, background: colors.panel,
          boxShadow: 'var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.32))',
          color: colors.muted, font: 'inherit', fontSize: 12, lineHeight: '20px',
        },
      },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12,
        alignItems: 'baseline', marginBottom: 10 } },
      h('strong', { id: `${panelId}-heading`, style: { color: colors.text, fontSize: 13, fontWeight: 500 } }, 'GitHub Copilot'),
      h('span', { style: { maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, data?.plan || '—')),
      h('dl', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 14px', margin: 0 } },
      h('dt', null, '已用'), h('dd', { style: { margin: 0, textAlign: 'right', color: colors.text, fontVariantNumeric: 'tabular-nums' } }, format(data?.ok ? data.used : null)),
      h('dt', null, '剩余'), h('dd', { style: { margin: 0, textAlign: 'right', color: colors.text, fontVariantNumeric: 'tabular-nums' } }, format(data?.ok ? data.remaining : null)),
      h('dt', null, '总额度'), h('dd', { style: { margin: 0, textAlign: 'right', color: colors.text, fontVariantNumeric: 'tabular-nums' } }, format(data?.ok ? data.total : null)),
      h('dt', null, '重置日期'), h('dd', { style: { margin: 0, textAlign: 'right', color: colors.text, fontVariantNumeric: 'tabular-nums' } }, resetOf(data?.resetAt))),
      data?.overage > 0 ? h('div', { style: { marginTop: 8 } }, `另有超额记录：${format(data.overage)}`) : null,
      error ? h('div', { role: 'status', style: { marginTop: 8, color: colors.warn } }, error) : null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, borderTop: `1px solid ${colors.border}`, marginTop: 12, paddingTop: 8 } },
      h('span', { 'aria-live': 'polite', style: { whiteSpace: 'nowrap' } },
        `${data?.ok && error ? '上次更新于' : '更新于'} ${timeOf(data?.sampledAt)}`),
      h('button', { type: 'button', disabled: refreshing, onClick: () => { void loadRef.current?.(true); },
        'aria-label': '刷新 GitHub Copilot 用量',
        style: { border: 0, padding: '3px 5px', background: 'transparent',
          color: colors.text, cursor: refreshing ? 'wait' : 'pointer', font: 'inherit', fontSize: 12 } },
      refreshing ? '更新中…' : '刷新'))), document.body) : null;

      return h('span', { 'data-copilot-credits': '', style: { display: 'inline-flex', alignItems: 'center',
        order: 1, flex: 'none', maxWidth: '100%' } },
      h('button', { ref: triggerRef, type: 'button',
        'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': panelId,
        'aria-label': `GitHub Copilot ${unitOf(data)}：${label}。点击查看详情`,
        onClick: () => setOpen((value) => !value),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 8,
          boxSizing: 'border-box', minHeight: 26, maxWidth: '100%', padding: '2px 9px',
          border: `1px solid ${colors.border}`, borderRadius: 9,
          background: colors.track, color: error && !data?.ok ? colors.warn : colors.text,
          font: 'inherit', fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
        },
      }, h(Lightning), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
      percent === null ? null : h('span', {
        role: 'progressbar', 'aria-label': '本月额度已消耗比例',
        'aria-valuemin': 0, 'aria-valuemax': data.total,
        'aria-valuenow': Math.max(0, data.total - data.remaining),
        style: { display: 'inline-block', flex: 'none', width: 32, height: 4,
          borderRadius: 4, overflow: 'hidden', background: colors.border },
      }, h('span', { style: { display: 'block', height: '100%', width: `${percent}%`,
        background: colors.muted, borderRadius: 4 } }))), panel);
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'copilot-credits',
        order: 1, // slot: after stats; flex order on root: after fixed ContextMeter
        label: 'GitHub Copilot 用量',
      }, CopilotCredits));
    }
    return { apply, inject: ['slots'] };
  },
});
