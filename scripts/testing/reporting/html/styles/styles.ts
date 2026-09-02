import { getCodeViewerStyles } from "./styles-code-viewer.ts";
import { getDeficitStyles } from "./styles-deficit.ts";
import { getRuntimeStyles } from "./styles-runtime.ts";
import { getUnifiedStyles } from "./styles-unified.ts";

export function getHtmlStyles(): string {
  return `
    :root {
      --bg-base: #09090b; --bg-surface: #0f1117; --bg-card: #18181b; --bg-hover: #222227;
      --border-subtle: rgba(255, 255, 255, 0.08); --border-strong: rgba(255, 255, 255, 0.18);
      --text-main: #f4f4f5; --text-muted: #a1a1aa; --text-dim: #71717a; --brand-accent: #38bdf8;
      --status-pass: #10b981; --status-info: #38bdf8; --status-warn: #f59e0b; --status-fail: #ef4444;
      --line-hit-bg: rgba(16, 185, 129, 0.12); --line-hit-border: #10b981;
      --line-miss-bg: rgba(239, 68, 68, 0.16); --line-miss-border: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg-base); }
    ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); }
    ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
      background-color: var(--bg-base); color: var(--text-main); line-height: 1.5; min-height: 100vh; display: flex; flex-direction: column;
    }
    header {
      background: rgba(9, 9, 11, 0.92); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border-subtle);
      padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50;
    }
    .brand { display: flex; align-items: center; gap: 0.75rem; }
    .brand-icon {
      width: 32px; height: 32px; background: linear-gradient(135deg, #27272a, #09090b);
      border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px;
      display: flex; align-items: center; justify-content: center; font-weight: 800; color: #38bdf8;
    }
    .brand-text { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em; color: var(--text-main); }
    .badge {
      font-size: 0.72rem; padding: 0.2rem 0.55rem; border-radius: 4px; font-weight: 700;
      letter-spacing: 0.04em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 0.35rem; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
    }
    .badge-pass { background: #052e16; color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.4); }
    .badge-info, .badge-sapphire { background: #083344; color: #67e8f9; border: 1px solid rgba(6, 182, 212, 0.4); }
    .badge-warn, .badge-amber { background: #451a03; color: #fde047; border: 1px solid rgba(250, 204, 21, 0.4); }
    .badge-fail, .badge-ruby { background: #450a0a; color: #fca5a5; border: 1px solid rgba(248, 113, 113, 0.4); }
    .badge-neutral { background: rgba(255, 255, 255, 0.08); color: #f4f4f5; border: 1px solid rgba(255, 255, 255, 0.16); }
    .badge-p50 { background: #451a03; color: #fde047; border: 1px solid rgba(234, 179, 8, 0.5); font-weight: 700; box-shadow: 0 0 8px rgba(234, 179, 8, 0.25); }
    .badge-p90 { background: #3b0764; color: #f0abfc; border: 1px solid rgba(192, 132, 252, 0.5); font-weight: 700; box-shadow: 0 0 8px rgba(192, 132, 252, 0.25); }
    .badge-pnormal { background: #052e16; color: #86efac; border: 1px solid rgba(74, 222, 128, 0.4); }
    
    .container { max-width: 100%; margin: 0 auto; padding: 1.5rem 2rem; width: 100%; flex: 1; position: relative; }
    .dashboard-loader {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;
      padding: 3rem 1rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 0.85rem; margin-bottom: 1.5rem;
    }
    .loader-spinner {
      width: 32px; height: 32px; border: 3px solid rgba(255, 255, 255, 0.1); border-top-color: var(--brand-accent);
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loader-text { font-size: 0.85rem; color: var(--text-muted); font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .metric-card {
      background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 0.85rem; padding: 0.85rem 1rem;
      display: flex; flex-direction: column; justify-content: space-between; gap: 0.5rem; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }
    .metric-card:hover { border-color: var(--border-strong); }
    .metric-info { flex: 1; }
    .metric-title { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; margin-bottom: 0.35rem; }
    .metric-value { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-main); }
    .metric-sub { font-size: 0.82rem; color: var(--text-dim); margin-top: 0.25rem; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; }
    .metric-progress-track {
      width: 100%; height: 20px; border-radius: 4px; background: #1c1c1f;
      border: 1px solid rgba(255, 255, 255, 0.12); overflow: hidden; position: relative;
      display: flex; align-items: center; justify-content: center; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
    }
    .metric-progress-fill {
      position: absolute; top: 0; left: 0; bottom: 0; height: 100%;
      transition: width 0.6s ease;
    }
    .metric-progress-text {
      position: relative; z-index: 2; font-size: 0.75rem; font-weight: 700; color: #ffffff;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95); font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      pointer-events: none;
    }

    .controls-bar {
      background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 0.75rem;
      padding: 0.75rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem 1rem; margin-bottom: 0.75rem; flex-wrap: wrap;
      max-width: 100%; box-sizing: border-box; overflow: hidden;
    }
    .view-mode-group { display: flex; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 0.2rem; gap: 0.25rem; flex-shrink: 0; }
    .view-mode-btn {
      background: transparent; border: none; color: var(--text-muted); padding: 0.35rem 0.85rem;
      border-radius: 0.375rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; white-space: nowrap;
    }
    .view-mode-btn.active { background: rgba(255, 255, 255, 0.12); color: var(--text-main); }
    .tree-actions-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; padding: 0 0.5rem; flex-wrap: wrap; }
    .tree-action-btn {
      background: transparent; border: 1px solid var(--border-subtle); color: var(--text-dim); padding: 0.25rem 0.65rem;
      border-radius: 0.375rem; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; white-space: nowrap;
    }
    .tree-action-btn:hover { background: var(--bg-card); color: var(--text-main); border-color: var(--border-strong); }
    .filters-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; flex: 1 1 auto; min-width: 0; max-width: 100%; }
    .filter-btn {
      background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text-muted); padding: 0.4rem 0.85rem;
      border-radius: 0.5rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; flex-shrink: 0;
    }
    .filter-btn:hover { background: var(--bg-hover); color: var(--text-main); }
    .filter-btn.active { background: rgba(255, 255, 255, 0.12); color: var(--text-main); border-color: var(--border-strong); }
    .search-wrapper { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; max-width: 100%; }
    .search-input {
      background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 0.5rem 1rem;
      color: var(--text-main); font-size: 0.85rem; width: 260px; max-width: 100%; transition: border-color 0.15s ease; box-sizing: border-box;
    }
    .search-input:focus { outline: none; border-color: var(--border-strong); }
    .reset-btn {
      background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-subtle); color: var(--text-muted); padding: 0.45rem 0.85rem;
      border-radius: 0.5rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.35rem;
    }
    .reset-btn:hover { background: var(--bg-hover); color: var(--text-main); border-color: var(--border-strong); }

    .table-responsive {
      width: 100%; overflow-x: auto; border-radius: 0.85rem; border: 1px solid var(--border-subtle);
      background: var(--bg-surface); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    table { width: 100%; border-collapse: collapse; background: var(--bg-surface); }
    th {
      position: sticky; top: 0; z-index: 10; background: var(--bg-card); padding: 1rem 1.25rem; text-align: left;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #ffffff !important;
      border-bottom: 1px solid var(--border-subtle); cursor: pointer; user-select: none;
    }
    th:hover { color: var(--text-main); }
    td { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .item-name { font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size: 0.85rem; font-weight: 500; display: flex; align-items: center; gap: 0.6rem; }
    .mini-progress { background: #27272a; height: 5px; border-radius: 999px; overflow: hidden; margin-top: 0.35rem; width: 100px; }
    .mini-progress-fill { height: 100%; border-radius: 999px; }

    ${getCodeViewerStyles()}
    ${getRuntimeStyles()}
    ${getUnifiedStyles()}
    ${getDeficitStyles()}
  `.trim();
}
