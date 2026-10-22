import React from 'react';

export interface ToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  tableCount: number;
  relationCount: number;
  warningCount: number;
  showInferred: boolean;
  onToggleInferred: () => void;
  onRelayout: () => void;
  onFitView: () => void;
  onRefresh: () => void;
  onOpenWarnings: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  searchQuery,
  onSearchChange,
  tableCount,
  relationCount,
  warningCount,
  showInferred,
  onToggleInferred,
  onRelayout,
  onFitView,
  onRefresh,
  onOpenWarnings,
}) => {
  return (
    <div className="erd-toolbar">
      {/* Brand / Stats */}
      <div className="erd-toolbar-section">
        <span className="erd-brand-title">Laravel ERD</span>
        <span className="erd-stats-tag">
          {tableCount} tables · {relationCount} relations
        </span>
      </div>

      {/* Search */}
      <div className="erd-toolbar-section erd-search-section">
        <input
          type="text"
          className="erd-search-input"
          placeholder="Filter tables..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          id="erd-search-tables"
        />
        {searchQuery && (
          <button
            className="erd-btn-icon"
            onClick={() => onSearchChange('')}
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="erd-toolbar-section">
        <button
          className={`erd-btn ${showInferred ? 'active' : ''}`}
          onClick={onToggleInferred}
          title="Toggle inferred convention relations (e.g. user_id -> users.id)"
          id="btn-toggle-inferred"
        >
          <span>⚏</span> Inferred
        </button>

        <button
          className="erd-btn"
          onClick={onRelayout}
          title="Auto arrange layout using ELK"
          id="btn-auto-layout"
        >
          <span>⊞</span> Auto Layout
        </button>

        <button
          className="erd-btn"
          onClick={onFitView}
          title="Fit diagram to screen"
          id="btn-fit-view"
        >
          <span>⊡</span> Fit
        </button>

        <button
          className="erd-btn"
          onClick={onRefresh}
          title="Scan and refresh migrations"
          id="btn-refresh"
        >
          <span>↻</span> Refresh
        </button>

        {warningCount > 0 && (
          <button
            className="erd-btn erd-btn-warning"
            onClick={onOpenWarnings}
            title={`${warningCount} warnings encountered during migration parsing`}
            id="btn-warnings"
          >
            <span>⚠️</span> {warningCount}
          </button>
        )}
      </div>
    </div>
  );
};
