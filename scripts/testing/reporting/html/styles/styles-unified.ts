export function getUnifiedStyles(): string {
  return `
    /* Unified Hierarchy & Metrics Styles */
    .unified-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .unified-kpi-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 0.85rem;
      padding: 1.15rem;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      backdrop-filter: blur(12px);
    }
    .unified-kpi-card:hover {
      border-color: var(--border-strong);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    }

    .tree-table-wrapper {
      width: 100%;
      overflow-x: auto;
      border-radius: 1rem;
      border: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }
    .unified-tree-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    .unified-tree-table th {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--bg-card);
      padding: 0.85rem 1.15rem;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .unified-tree-table th:hover {
      color: var(--text-main);
    }
    .unified-tree-table td {
      padding: 0.75rem 1.15rem;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.88rem;
      vertical-align: middle;
    }
    .unified-tree-table tr:last-child td {
      border-bottom: none;
    }
    .unified-tree-table tr:hover td {
      background: rgba(255, 255, 255, 0.025);
    }

    /* Density Modifier Classes */
    body.density-compact .unified-tree-table td,
    body.density-compact table td {
      padding: 0.4rem 0.85rem;
      font-size: 0.8rem;
      line-height: 1.3;
    }
    body.density-compact .unified-tree-table th,
    body.density-compact table th {
      padding: 0.5rem 0.85rem;
      font-size: 0.7rem;
    }
    body.density-compact .metric-card,
    body.density-compact .runtime-kpi-card,
    body.density-compact .unified-kpi-card {
      padding: 0.85rem;
    }
    body.density-compact .metric-value,
    body.density-compact .kpi-value {
      font-size: 1.5rem;
    }
    body.density-compact .badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    body.density-compact .mini-progress {
      height: 4px;
      width: 70px;
    }

    /* Coverage Progress Bars */
    .cov-bar-cell {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.25rem;
      min-width: 140px;
    }
    .cov-bar-counts {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-weight: 500;
      line-height: 1.2;
    }
    .cov-bar-track {
      position: relative;
      width: 140px;
      height: 20px;
      background: #141414;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
    }
    .cov-bar-fill {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .cov-bar-fill-pass { background: linear-gradient(90deg, #059669, #10b981); }
    .cov-bar-fill-warn { background: linear-gradient(90deg, #d97706, #f59e0b); }
    .cov-bar-fill-fail { background: linear-gradient(90deg, #dc2626, #ef4444); }
    .cov-bar-text {
      position: relative;
      z-index: 2;
      font-size: 0.75rem;
      font-weight: 700;
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      color: #ffffff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
      pointer-events: none;
      letter-spacing: 0.02em;
    }
    body.density-compact .cov-bar-cell { min-width: 110px; gap: 0.15rem; }
    body.density-compact .cov-bar-counts { font-size: 0.7rem; }
    body.density-compact .cov-bar-track { width: 110px; height: 16px; }
    body.density-compact .cov-bar-text { font-size: 0.68rem; }

    /* Tree Node Elements */
    .tree-cell-name {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
    }
    .tree-expander {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      font-size: 0.7rem;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 3px;
      user-select: none;
      transition: all 0.15s ease;
    }
    .tree-expander:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }
    .tree-expander-leaf {
      display: inline-block;
      width: 18px;
      height: 18px;
      visibility: hidden;
    }
    .tree-indent-space {
      display: inline-block;
      width: 16px;
      flex-shrink: 0;
    }

    /* Pareto & Status Badges */
    .badge-p50 {
      background: rgba(245, 158, 11, 0.18);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.4);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.25);
      font-weight: 700;
      border-radius: 4px;
    }
    .badge-p90 {
      background: rgba(99, 102, 241, 0.18);
      color: #818cf8;
      border: 1px solid rgba(99, 102, 241, 0.4);
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.25);
      font-weight: 700;
      border-radius: 4px;
    }
    .badge-pnormal {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 4px;
    }

    .test-telemetry-cell {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      white-space: nowrap;
    }

    /* Toolbar Actions & Density Switcher */
    .tree-actions-group {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .tree-action-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      padding: 0.4rem 0.75rem;
      border-radius: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .tree-action-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
      border-color: var(--border-strong);
    }

    .density-switch-group {
      display: inline-flex;
      background: var(--bg-base);
      border: 1px solid var(--border-subtle);
      border-radius: 0.5rem;
      padding: 2px;
      gap: 2px;
    }
    .density-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.3rem 0.65rem;
      border-radius: 0.375rem;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .density-btn.active {
      background: var(--bg-card);
      color: var(--text-main);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
    .density-btn:hover:not(.active) {
      color: var(--text-main);
    }
  `;
}
