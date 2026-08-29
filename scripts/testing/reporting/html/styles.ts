/**
 * Coverage Dashboard CSS Stylesheet Generator
 * Provides modern dark theme styles, metrics gauges, responsive grids, and code viewer highlighting.
 */

import { getCodeViewerStyles } from "./styles-code-viewer.ts";

export function getHtmlStyles(): string {
  return `
    :root {
      --bg-base: #080b11;
      --bg-surface: #0f172a;
      --bg-card: #1e293b;
      --bg-hover: #334155;
      --border-subtle: #334155;
      --border-strong: #475569;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --brand-accent: #6366f1;
      --status-pass: #10b981;
      --status-warn: #f59e0b;
      --status-fail: #ef4444;
      --line-hit-bg: rgba(16, 185, 129, 0.08);
      --line-hit-border: #10b981;
      --line-miss-bg: rgba(239, 68, 68, 0.16);
      --line-miss-border: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
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
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-subtle);
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #6366f1, #3b82f6);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: white;
    }
    .brand-text {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
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
    .badge-pass { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-fail { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-neutral { background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.3); }
    
    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 2rem;
      width: 100%;
      flex: 1;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 1rem;
      padding: 1.5rem;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }
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
    .radial-gauge {
      width: 68px;
      height: 68px;
      position: relative;
    }
    .radial-gauge svg {
      transform: rotate(-90deg);
      width: 68px;
      height: 68px;
    }
    .radial-gauge circle {
      fill: none;
      stroke-width: 6;
      stroke-linecap: round;
    }
    .gauge-bg { stroke: var(--bg-card); }
    .gauge-fill {
      stroke: var(--brand-accent);
      transition: stroke-dashoffset 0.8s ease;
    }

    .controls-bar {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 0.75rem;
      padding: 0.75rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.9rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .crumb-chip {
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 0.375rem;
      transition: all 0.15s ease;
    }
    .crumb-chip:hover {
      background: var(--bg-card);
      color: var(--text-main);
    }
    .crumb-active {
      color: var(--text-main);
      font-weight: 600;
    }
    .filters-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
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
    .filter-btn.active {
      background: var(--brand-accent);
      color: white;
      border-color: var(--brand-accent);
    }
    .search-input {
      background: var(--bg-base);
      border: 1px solid var(--border-subtle);
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      color: var(--text-main);
      font-size: 0.85rem;
      width: 280px;
      transition: border-color 0.15s ease;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--brand-accent);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-surface);
      border-radius: 1rem;
      overflow: hidden;
      border: 1px solid var(--border-subtle);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }
    th {
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
  `.trim();
}
