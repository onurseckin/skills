export function getCodeViewerStyles(): string {
  return `
    .file-viewer-header {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 0.75rem;
      padding: 1rem 1.5rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .missed-chips-bar {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 0.75rem;
      padding: 0.75rem 1.25rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .miss-chip {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .miss-chip:hover {
      background: rgba(239, 68, 68, 0.4);
      transform: translateY(-1px);
    }
    .code-container {
      background: #080808;
      border: 1px solid var(--border-subtle);
      border-radius: 0.75rem;
      overflow-x: auto;
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
    }
    .code-line {
      display: flex;
      line-height: 1.65;
      min-height: 1.65em;
    }
    .code-line.hit {
      background: var(--line-hit-bg);
      border-left: 3px solid var(--line-hit-border);
    }
    .code-line.miss {
      background: var(--line-miss-bg);
      border-left: 3px solid var(--line-miss-border);
    }
    .code-line.neutral {
      border-left: 3px solid transparent;
    }
    .line-num {
      width: 64px;
      padding: 0 0.85rem;
      text-align: right;
      color: var(--text-dim);
      user-select: none;
      border-right: 1px solid var(--border-subtle);
      background: rgba(0, 0, 0, 0.15);
    }
    .line-hits {
      width: 58px;
      padding: 0 0.5rem;
      text-align: right;
      font-size: 0.75rem;
      user-select: none;
      border-right: 1px solid var(--border-subtle);
      font-weight: 600;
    }
    .line-content {
      padding: 0 1rem;
      white-space: pre;
      flex: 1;
    }
    .btn {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      color: var(--text-main);
      padding: 0.45rem 0.9rem;
      border-radius: 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.15s ease;
    }
    .btn:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
    }
  `;
}
