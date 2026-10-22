import React, { memo } from 'react';
import { Handle, Position, NodeProps, Node } from '@xyflow/react';
import { Column, SourceRef, Table } from '../../shared/model';

export type TableNodeData = {
  table: Table;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  onOpenSource: (source: SourceRef) => void;
  fkColumns: Set<string>;
  [key: string]: unknown;
};

export type TableCustomNode = Node<TableNodeData, 'table'>;

export const TableNode = memo(({ data }: NodeProps<TableCustomNode>) => {
  const { table, isHighlighted, isDimmed, onOpenSource, fkColumns } = data;

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenSource(table.source);
  };

  const handleColumnDoubleClick = (col: Column, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenSource(col.source);
  };

  const formatColumnType = (col: Column): string => {
    if (col.length) return `${col.type}(${col.length})`;
    if (col.precision && col.scale) return `${col.type}(${col.precision},${col.scale})`;
    if (col.enumValues && col.enumValues.length > 0) {
      return `enum(${col.enumValues.length})`;
    }
    return col.type;
  };

  const nodeClasses = [
    'erd-table-node',
    isHighlighted ? 'is-highlighted' : '',
    isDimmed ? 'is-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={nodeClasses} id={`table-node-${table.name}`}>
      {/* Header */}
      <div
        className="erd-table-header"
        onDoubleClick={handleHeaderDoubleClick}
        title={`Table: ${table.name}`}
      >
        <div className="erd-table-title-group">
          <span className="erd-table-icon">▦</span>
          <span className="erd-table-name">{table.name}</span>
        </div>
        <span className="erd-col-count" title={`${table.columns.length} columns`}>
          {table.columns.length}
        </span>
      </div>

      {/* Migration Source bar (clickable link) */}
      <div
        className="erd-table-source-bar"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSource(table.source);
        }}
        title={`Click to open migration:\n${table.source.file}:${table.source.line}`}
      >
        <span className="erd-source-icon">📄</span>
        <span className="erd-source-name">{table.source.migration}.php</span>
        <span className="erd-source-line">:{table.source.line}</span>
        <span className="erd-source-arrow" title="Open file in editor">↗</span>
      </div>

      {/* Columns */}
      <div className="erd-columns-list">
        {table.columns.map((col) => {
          const isFk = fkColumns && fkColumns.has(col.name);
          const isPk = col.primary;

          return (
            <div
              key={col.name}
              className={`erd-column-row ${isPk ? 'is-pk' : ''} ${isFk ? 'is-fk' : ''}`}
              onDoubleClick={(e) => handleColumnDoubleClick(col, e)}
              title={`${col.name}: ${col.type}\nDefined in: ${col.source.file}:${col.source.line}\n(Double-click to open)`}
            >
              {/* Target handle (incoming foreign key relations) */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.name}-target`}
                className="erd-handle erd-handle-target"
              />

              {/* Column icon */}
              <span className="erd-col-icon">
                {isPk ? (
                  <span className="badge-pk" title="Primary Key">PK</span>
                ) : isFk ? (
                  <span className="badge-fk" title="Foreign Key">FK</span>
                ) : (
                  <span className="bullet">·</span>
                )}
              </span>

              {/* Column name */}
              <span className="erd-col-name" title={col.name}>
                {col.name}
              </span>

              {/* Column type */}
              <span className="erd-col-type" title={formatColumnType(col)}>
                {formatColumnType(col)}
              </span>

              {/* Flags / Badges */}
              <div className="erd-col-badges">
                {col.nullable && <span className="erd-badge badge-null" title="Nullable">null</span>}
                {col.unique && !isPk && <span className="erd-badge badge-uq" title="Unique">uq</span>}
              </div>

              {/* Source handle (outgoing foreign key relations) */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${col.name}-source`}
                className="erd-handle erd-handle-source"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

TableNode.displayName = 'TableNode';
