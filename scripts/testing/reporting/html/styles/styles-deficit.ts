export function getDeficitStyles(): string {
  return `
    /* Deficit Clustering Styles */
    .deficit-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .deficit-kpi-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 0.85rem;
      padding: 0.85rem 1rem;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      backdrop-filter: blur(12px);
    }
    .deficit-kpi-card:hover {
      border-color: var(--border-strong);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    }

    .deficit-table-wrapper {
      width: 100%;
      overflow-x: auto;
      border-radius: 1rem;
      border: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }
    .deficit-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    .deficit-table th {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--bg-card);
      padding: 0.85rem 1.15rem;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #ffffff !important;
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .deficit-table th:hover {
      color: var(--text-main);
    }
    .deficit-table td {
      padding: 0.85rem 1.15rem;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.88rem;
      vertical-align: middle;
    }
    .deficit-table tr:last-child td {
      border-bottom: none;
    }
    .deficit-table tr:hover td {
      background: rgba(255, 255, 255, 0.025);
    }

    /* Rank Badge */
    .deficit-rank {
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--text-dim);
      padding: 0.2rem 0.45rem;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: inline-block;
      min-width: 32px;
      text-align: center;
    }

    /* Target link chip */
    .deficit-target-link {
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      font-weight: 600;
      color: #e9d5ff;
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.15s ease;
    }
    .deficit-target-link:hover {
      color: #ffffff;
      text-decoration: underline;
    }

    /* Gain badges */
    .gain-badge-repo {
      background: #3b0764;
      color: #e9d5ff;
      border: 1px solid rgba(168, 85, 247, 0.35);
      box-shadow: 0 0 8px rgba(168, 85, 247, 0.2);
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.78rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      display: inline-block;
      white-space: nowrap;
    }
    .gain-badge-file {
      background: #042f2e;
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.35);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.2);
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.78rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      display: inline-block;
      white-space: nowrap;
    }

    /* Category Badges */
    .badge-cat-error-handling {
      background: #450a0a;
      color: #fecaca;
      border: 1px solid rgba(239, 68, 68, 0.35);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.2);
      border-radius: 4px;
    }
    .badge-cat-branching {
      background: #451a03;
      color: #fef08a;
      border: 1px solid rgba(245, 158, 11, 0.35);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.2);
      border-radius: 4px;
    }
    .badge-cat-initialization {
      background: #083344;
      color: #a5f3fc;
      border: 1px solid rgba(6, 182, 212, 0.35);
      box-shadow: 0 0 8px rgba(6, 182, 212, 0.2);
      border-radius: 4px;
    }
    .badge-cat-unexercised-logic {
      background: #3b0764;
      color: #e9d5ff;
      border: 1px solid rgba(168, 85, 247, 0.35);
      box-shadow: 0 0 8px rgba(168, 85, 247, 0.2);
      border-radius: 4px;
    }

    /* Detail / snippet display */
    .deficit-detail-box {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      max-width: 480px;
    }
    .deficit-reason {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .deficit-snippet {
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.75rem;
      background: #09090b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 0.2rem 0.5rem;
      border-radius: 0.35rem;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: inline-block;
      max-width: 440px;
    }

    /* Density Compact overrides */
    body.density-compact .deficit-kpi-card {
      padding: 0.85rem;
    }
    body.density-compact .deficit-table td {
      padding: 0.4rem 0.85rem;
      font-size: 0.8rem;
      line-height: 1.3;
    }
    body.density-compact .deficit-table th {
      padding: 0.5rem 0.85rem;
      font-size: 0.7rem;
    }
    body.density-compact .deficit-snippet {
      font-size: 0.7rem;
      padding: 0.15rem 0.35rem;
    }
  `;
}
