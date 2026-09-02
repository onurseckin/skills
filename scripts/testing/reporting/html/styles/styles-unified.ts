export function getUnifiedStyles(): string {
  return `
    /* Unified Hierarchy & Metrics Styles */
    .unified-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .unified-kpi-card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 0.85rem; padding: 0.85rem 1rem; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2); display: flex; flex-direction: column; justify-content: space-between; backdrop-filter: blur(12px); }
    .unified-kpi-card:hover { border-color: var(--border-strong); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); }

    .tree-table-wrapper { width: 100%; overflow-x: auto; border-radius: 1rem; border: 1px solid var(--border-subtle); background: var(--bg-surface); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2); }
    .unified-tree-table { width: 100%; border-collapse: collapse; text-align: left; }
    .unified-tree-table th { position: sticky; top: 0; z-index: 10; background: var(--bg-card); padding: 0.85rem 1.15rem; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); cursor: pointer; user-select: none; white-space: nowrap; }
    .unified-tree-table th:hover { color: var(--text-main); }
    .unified-tree-table td { padding: 0.75rem 1.15rem; border-bottom: 1px solid var(--border-subtle); font-size: 0.88rem; vertical-align: middle; }
    .unified-tree-table tr:last-child td { border-bottom: none; }
    .unified-tree-table tbody tr { cursor: pointer; transition: background 0.15s ease; }
    .unified-tree-table tbody tr:hover td,
    .unified-tree-table tr:hover td { background: rgba(255, 255, 255, 0.03); }
    .tree-row-dir, .tree-row-file { cursor: pointer; }

    /* Density Modifier Classes */
    body.density-compact .unified-tree-table td, body.density-compact table td { padding: 0.4rem 0.85rem; font-size: 0.8rem; line-height: 1.3; }
    body.density-compact .unified-tree-table th, body.density-compact table th { padding: 0.5rem 0.85rem; font-size: 0.7rem; }
    body.density-compact .metric-card, body.density-compact .runtime-kpi-card, body.density-compact .unified-kpi-card { padding: 0.85rem; }
    body.density-compact .metric-value, body.density-compact .kpi-value { font-size: 1.5rem; }
    body.density-compact .badge { font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 4px; }
    body.density-compact .mini-progress { height: 4px; width: 70px; }

    /* Coverage Progress Bars */
    .cov-bar-cell { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; min-width: 140px; }
    .cov-bar-counts { font-size: 0.75rem; color: #d4d4d8; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-weight: 600; line-height: 1.2; }
    .cov-bar-track { position: relative; width: 140px; height: 20px; background: #141414; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4); }
    .cov-bar-fill { position: absolute; top: 0; left: 0; bottom: 0; height: 100%; border-radius: 3px; transition: width 0.3s ease; }
    .cov-bar-fill-pass { background: linear-gradient(90deg, #065f46, #047857); }
    .cov-bar-fill-warn { background: linear-gradient(90deg, #92400e, #b45309); }
    .cov-bar-fill-fail { background: linear-gradient(90deg, #991b1b, #b91c1c); }
    .cov-bar-text { position: relative; z-index: 2; font-size: 0.75rem; font-weight: 700; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; color: #ffffff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85); pointer-events: none; letter-spacing: 0.02em; }
    body.density-compact .cov-bar-cell { min-width: 110px; gap: 0.15rem; }
    body.density-compact .cov-bar-counts { font-size: 0.7rem; }
    body.density-compact .cov-bar-track { width: 110px; height: 16px; }
    body.density-compact .cov-bar-text { font-size: 0.68rem; }

    /* Tree Node Elements */
    .tree-cell-name { display: flex; align-items: center; gap: 0.35rem; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size: 0.85rem; }
    .tree-expander { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; font-size: 0.7rem; color: var(--text-muted); cursor: pointer; border-radius: 3px; user-select: none; transition: all 0.15s ease; }
    .tree-expander:hover { background: var(--bg-hover); color: var(--text-main); }
    .tree-expander-leaf { display: inline-block; width: 18px; height: 18px; visibility: hidden; }
    .tree-indent-space { display: inline-block; width: 16px; flex-shrink: 0; }

    /* Pareto & Status Badges */
    .badge-p50 { background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); box-shadow: 0 0 8px rgba(245, 158, 11, 0.25); font-weight: 700; border-radius: 4px; }
    .badge-p90 { background: rgba(99, 102, 241, 0.18); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4); box-shadow: 0 0 8px rgba(99, 102, 241, 0.25); font-weight: 700; border-radius: 4px; }
    .badge-pnormal { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 4px; }
    .test-telemetry-cell { display: flex; align-items: center; gap: 0.5rem; white-space: nowrap; }

    /* Deficits & Misses Column Styles */
    .deficit-cell-dir, .deficit-cell-file { display: inline-flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; max-width: 480px; }
    .deficit-pill { display: inline-flex; align-items: center; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; font-weight: 600; padding: 0.2rem 0.55rem; border-radius: 6px; white-space: nowrap; letter-spacing: -0.01em; }
    .deficit-pill-dir { background: rgba(239, 68, 68, 0.12); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); box-shadow: 0 0 6px rgba(239, 68, 68, 0.1); }
    .deficit-pill-file { background: rgba(245, 158, 11, 0.12); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.28); box-shadow: 0 0 6px rgba(245, 158, 11, 0.08); }
    .deficit-pill-perfect { display: inline-flex; align-items: center; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; font-weight: 600; padding: 0.2rem 0.55rem; border-radius: 6px; background: rgba(16, 185, 129, 0.12); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.28); white-space: nowrap; }
    .deficit-subtle-cats { display: inline-flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
    .deficit-cat-badge { font-size: 0.68rem; font-weight: 600; padding: 0.12rem 0.38rem; border-radius: 4px; text-transform: lowercase; letter-spacing: 0.02em; opacity: 0.85; }
    .deficit-cat-badge.cat-error-handling { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .deficit-cat-badge.cat-branching { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .deficit-cat-badge.cat-initialization { background: rgba(6, 182, 212, 0.15); color: #22d3ee; border: 1px solid rgba(6, 182, 212, 0.3); }
    .deficit-cat-badge.cat-unexercised-logic { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
    .deficit-ranges-group { display: inline-flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
    .miss-range-chip { background: rgba(99, 102, 241, 0.14); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.32); border-radius: 4px; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; user-select: none; line-height: 1.2; }
    .miss-range-chip:hover { background: rgba(99, 102, 241, 0.28); color: #ffffff; border-color: #818cf8; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25); }
    .miss-range-chip.miss-range-more { background: rgba(255, 255, 255, 0.05); color: var(--text-dim); border-color: rgba(255, 255, 255, 0.1); }
    .miss-range-chip.miss-range-more:hover { background: rgba(255, 255, 255, 0.1); color: var(--text-main); border-color: rgba(255, 255, 255, 0.25); }
    body.density-compact .deficit-pill { font-size: 0.72rem; padding: 0.12rem 0.4rem; }
    body.density-compact .miss-range-chip { font-size: 0.68rem; padding: 0.1rem 0.35rem; }
    body.density-compact .deficit-cat-badge { font-size: 0.62rem; padding: 0.08rem 0.3rem; }

    /* Toolbar Actions & Density Switcher */
    .tree-actions-group { display: flex; align-items: center; gap: 0.4rem; }
    .tree-action-btn { background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text-muted); padding: 0.4rem 0.75rem; border-radius: 0.5rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 0.35rem; }
    .tree-action-btn:hover { background: var(--bg-hover); color: var(--text-main); border-color: var(--border-strong); }

    .density-switch-group { display: inline-flex; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 2px; gap: 2px; }
    .density-btn { background: transparent; border: none; color: var(--text-muted); padding: 0.3rem 0.65rem; border-radius: 0.375rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
    .density-btn.active { background: var(--bg-card); color: var(--text-main); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
    .density-btn:hover:not(.active) { color: var(--text-main); }
  `;
}
