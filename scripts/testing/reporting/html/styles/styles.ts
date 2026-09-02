import { getCodeViewerStyles } from "./styles-code-viewer.ts";
import { getDeficitStyles } from "./styles-deficit.ts";
import { getRuntimeStyles } from "./styles-runtime.ts";
import { getUnifiedStyles } from "./styles-unified.ts";

export function getHtmlStyles(): string {
  return `
    :root {
      --bg-base: #050505;
      --bg-surface: #0e0e0e;
      --bg-card: #141414;
      --bg-hover: #1c1c1c;
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-strong: rgba(255, 255, 255, 0.18);
      --text-main: #ffffff;
      --text-muted: #a1a1aa;
      --text-dim: #71717a;
      --brand-accent: #e4e4e7;
      --status-pass: #10b981;
      --status-info: #a1a1aa;
      --status-warn: #f59e0b;
      --status-fail: #ef4444;
      --line-hit-bg: rgba(16, 185, 129, 0.08);
      --line-hit-border: #10b981;
      --line-miss-bg: rgba(239, 68, 68, 0.16);
      --line-miss-border: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg-base); }
    ::-webkit-scrollbar-thumb { background: #262626; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); }
    ::-webkit-scrollbar-thumb:hover { background: #404040; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background-color: var(--bg-base);
      color: var(--text-main);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(14, 14, 14, 0.95);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border-subtle);
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand { display: flex; align-items: center; gap: 0.75rem; }
    .brand-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #27272a, #09090b);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: white;
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.08);
    }
    .brand-text { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em; }
    .badge {
      font-size: 0.75rem;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-weight: 600;
      letter-spacing: 0.02em;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .badge-pass { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
    .badge-info, .badge-sapphire { background: rgba(161, 161, 170, 0.15); color: #d4d4d8; border: 1px solid rgba(161, 161, 170, 0.35); }
    .badge-warn, .badge-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); }
    .badge-fail, .badge-ruby { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); }
    .badge-neutral { background: rgba(255, 255, 255, 0.06); color: #a1a1aa; border: 1px solid rgba(255, 255, 255, 0.12); }
    .badge-p50 { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-weight: 700; }
    .badge-p90 { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; }
    .badge-pnormal { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
    
    .container {
      max-width: 100%;
      margin: 0 auto;
      padding: 1.5rem 2rem;
      width: 100%;
      flex: 1;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 0.85rem;
      padding: 1.25rem;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }
    .metric-card:hover { border-color: var(--border-strong); }
    .metric-info { flex: 1; }
    .metric-title {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
      margin-bottom: 0.35rem;
    }
    .metric-value {
      font-size: 2.25rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .metric-sub {
      font-size: 0.85rem;
      color: var(--text-dim);
      margin-top: 0.25rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .radial-gauge { width: 68px; height: 68px; position: relative; }
    .radial-gauge svg { transform: rotate(-90deg); width: 68px; height: 68px; }
    .radial-gauge circle { fill: none; stroke-width: 6; stroke-linecap: round; }
    .gauge-bg { stroke: var(--bg-card); }
    .gauge-fill { stroke: var(--brand-accent); transition: stroke-dashoffset 0.8s ease; }

    .controls-bar {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 0.75rem;
      padding: 0.75rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    .view-mode-group {
      display: flex;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 0.5rem;
      padding: 0.2rem;
      gap: 0.25rem;
    }
    .view-mode-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.35rem 0.85rem;
      border-radius: 0.375rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .view-mode-btn.active {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-main);
    }
    .tree-actions-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      padding: 0 0.5rem;
    }
    .tree-action-btn {
      background: transparent;
      border: 1px solid var(--border-subtle);
      color: var(--text-dim);
      padding: 0.25rem 0.65rem;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tree-action-btn:hover {
      background: var(--bg-card);
      color: var(--text-main);
      border-color: var(--border-strong);
    }
    .filters-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .filter-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      padding: 0.4rem 0.85rem;
      border-radius: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-btn:hover { background: var(--bg-hover); color: var(--text-main); }
    .filter-btn.active {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-main);
      border-color: var(--border-strong);
    }
    .search-input {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      color: var(--text-main);
      font-size: 0.85rem;
      width: 280px;
      transition: border-color 0.15s ease;
    }
    .search-input:focus { outline: none; border-color: var(--border-strong); }

    .table-responsive {
      width: 100%;
      overflow-x: auto;
      border-radius: 0.85rem;
      border: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-surface);
    }
    th {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--bg-card);
      padding: 1rem 1.25rem;
      text-align: left;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
      user-select: none;
    }
    th:hover { color: var(--text-main); }
    td {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.9rem;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .item-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .mini-progress {
      background: var(--bg-base);
      height: 5px;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 0.35rem;
      width: 100px;
    }
    .mini-progress-fill { height: 100%; border-radius: 999px; }

    ${getCodeViewerStyles()}
    ${getRuntimeStyles()}
    ${getUnifiedStyles()}
    ${getDeficitStyles()}
  `.trim();
}
