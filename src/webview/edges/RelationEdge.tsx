import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react';
import { Relation } from '../../shared/model';

export interface RelationEdgeData {
  relation: Relation;
  isHighlighted?: boolean;
  isDimmed?: boolean;
}

export const RelationEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}) => {
  const edgeData = data as RelationEdgeData | undefined;
  const relation = edgeData?.relation;
  const isHighlighted = edgeData?.isHighlighted;
  const isDimmed = edgeData?.isDimmed;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const isInferred = relation?.kind === 'inferred';

  const edgeStyle: React.CSSProperties = {
    ...style,
    strokeWidth: isHighlighted ? 2.5 : 1.5,
    stroke: isHighlighted
      ? 'var(--vscode-focusBorder, #007fd4)'
      : isDimmed
      ? 'var(--card-border, #333333)'
      : isInferred
      ? 'var(--vscode-charts-orange, #e09a3e)'
      : 'var(--vscode-charts-blue, #3794ff)',
    strokeDasharray: isInferred ? '5,5' : undefined,
    opacity: isDimmed ? 0.25 : 1,
    transition: 'stroke 0.2s, stroke-width 0.2s, opacity 0.2s',
  };

  const labelText = relation
    ? relation.onDelete
      ? `${relation.cardinality} (${relation.onDelete})`
      : relation.cardinality
    : '';

  const tooltipTitle = relation
    ? `${relation.from.table}.${relation.from.column} -> ${relation.to.table}.${relation.to.column}\nType: ${relation.kind}${relation.onDelete ? `\nonDelete: ${relation.onDelete}` : ''}`
    : '';

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd} />
      {labelText && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              opacity: isDimmed ? 0.2 : 0.9,
            }}
            className="erd-edge-label"
            title={tooltipTitle}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
