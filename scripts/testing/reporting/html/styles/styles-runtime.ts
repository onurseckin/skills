export function getRuntimeStyles(): string {
  return `
    .tab-bar {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 1.5rem;
      padding-bottom: 0.25rem;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.65rem 1.25rem;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      border-radius: 0.5rem 0.5rem 0 0;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.15s ease;
      border-bottom: 2px solid transparent;
    }
    .tab-btn:hover {
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.03);
    }
    .tab-btn.active {
      color: var(--brand-accent);
      border-bottom: 2px solid var(--brand-accent);
      background: rgba(99, 102, 241, 0.08);
    }
    
    .runtime-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .runtime-kpi-card {
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
    .runtime-kpi-card:hover {
      border-color: var(--border-strong);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    }
    .kpi-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }
    .kpi-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 700;
    }
    .kpi-icon {
      font-size: 1.1rem;
    }
    .kpi-value {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--text-main);
    }
    .kpi-sub {
      font-size: 0.8rem;
      color: var(--text-dim);
      margin-top: 0.35rem;
      font-family: 'JetBrains Mono', monospace;
    }

    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 0.75rem;
      padding: 0.75rem 1.25rem;
      margin-top: 1rem;
      flex-wrap: wrap;
      gap: 0.75rem;
      backdrop-filter: blur(12px);
    }
    .page-controls {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .page-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      color: var(--text-main);
      padding: 0.35rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .page-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      border-color: var(--border-strong);
    }
    .page-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .page-indicator {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
      margin: 0 0.5rem;
    }

    .runtime-bar-cell {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .runtime-bar-track {
      flex: 1;
      background: var(--bg-base);
      height: 6px;
      border-radius: 999px;
      overflow: hidden;
      max-width: 140px;
    }
    .runtime-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #ef4444);
      border-radius: 999px;
    }
  `;
}
