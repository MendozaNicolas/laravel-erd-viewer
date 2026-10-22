import React from 'react';
import { SourceRef, Warning } from '../../shared/model';

export interface WarningsModalProps {
  warnings: Warning[];
  isOpen: boolean;
  onClose: () => void;
  onOpenSource: (source: SourceRef) => void;
}

export const WarningsModal: React.FC<WarningsModalProps> = ({
  warnings,
  isOpen,
  onClose,
  onOpenSource,
}) => {
  if (!isOpen) return null;

  return (
    <div className="erd-modal-backdrop" onClick={onClose}>
      <div className="erd-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="erd-modal-header">
          <h3>Parsing Warnings ({warnings.length})</h3>
          <button className="erd-btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="erd-modal-body">
          {warnings.length === 0 ? (
            <p className="erd-empty-text">No warnings detected. Schema was cleanly parsed.</p>
          ) : (
            <div className="erd-warnings-list">
              {warnings.map((w, idx) => (
                <div
                  key={idx}
                  className="erd-warning-item"
                  onClick={() => onOpenSource(w.source)}
                  title="Click to jump to file"
                >
                  <div className="erd-warning-badge">{w.code}</div>
                  <div className="erd-warning-info">
                    <div className="erd-warning-message">{w.message}</div>
                    <div className="erd-warning-source">
                      {w.source.file}:{w.source.line} ({w.source.migration})
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
