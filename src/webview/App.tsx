import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  ReactFlowInstance,
  MarkerType,
  NodeTypes,
} from '@xyflow/react';

import { SchemaIR, SourceRef } from '../shared/model';
import { SavedLayout, ToWebview } from '../shared/protocol';
import { getVsCodeApi } from './vscode';
import { TableNode } from './nodes/TableNode';
import { RelationEdge } from './edges/RelationEdge';
import { layoutSchema } from './layout/elk';
import { Toolbar } from './components/Toolbar';
import { WarningsModal } from './components/WarningsModal';

const nodeTypes: NodeTypes = {
  table: TableNode as any,
};

const edgeTypes = {
  relation: RelationEdge,
};

export const App: React.FC = () => {
  const [schema, setSchema] = useState<SchemaIR | null>(null);
  const [savedLayout, setSavedLayout] = useState<SavedLayout | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showInferred, setShowInferred] = useState<boolean>(true);
  const [isWarningsOpen, setIsWarningsOpen] = useState<boolean>(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const saveLayoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  const vscode = useMemo(() => getVsCodeApi(), []);

  // Handle open source jump
  const handleOpenSource = useCallback(
    (source: SourceRef) => {
      vscode.postMessage({ type: 'openSource', source });
    },
    [vscode]
  );

  // Collect set of FK columns per table
  const fkColumnsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!schema) return map;
    for (const rel of schema.relations) {
      if (!map.has(rel.from.table)) {
        map.set(rel.from.table, new Set());
      }
      map.get(rel.from.table)!.add(rel.from.column);
    }
    return map;
  }, [schema]);

  // Determine connected neighbors of selected table
  const connectedTables = useMemo(() => {
    if (!selectedTable || !schema) return null;
    const neighbors = new Set<string>([selectedTable]);
    for (const rel of schema.relations) {
      if (rel.from.table === selectedTable && rel.to.table !== '*') {
        neighbors.add(rel.to.table);
      }
      if (rel.to.table === selectedTable) {
        neighbors.add(rel.from.table);
      }
    }
    return neighbors;
  }, [selectedTable, schema]);

  // Recompute and apply layout
  const applyLayout = useCallback(
    async (currentSchema: SchemaIR, layoutToUse?: SavedLayout | null) => {
      if (currentSchema.tables.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
      }

      const positions = await layoutSchema(
        currentSchema.tables,
        currentSchema.relations,
        layoutToUse?.nodes || null
      );

      // Construct React Flow Nodes
      const newNodes: Node[] = currentSchema.tables.map((table) => {
        const isDimmed =
          connectedTables !== null && !connectedTables.has(table.name);
        const isHighlighted = selectedTable === table.name;

        return {
          id: table.name,
          type: 'table',
          position: positions[table.name] || { x: 0, y: 0 },
          data: {
            table,
            isHighlighted,
            isDimmed,
            fkColumns: fkColumnsMap.get(table.name) || new Set(),
            onOpenSource: handleOpenSource,
          },
        };
      });

      // Construct React Flow Edges
      const newEdges: Edge[] = [];
      for (const rel of currentSchema.relations) {
        if (rel.to.table === '*') continue; // Polymorphic handled in node badges
        if (rel.kind === 'inferred' && !showInferred) continue;

        const isEdgeConnected =
          !selectedTable ||
          rel.from.table === selectedTable ||
          rel.to.table === selectedTable;
        const isDimmed = selectedTable !== null && !isEdgeConnected;

        newEdges.push({
          id: rel.id,
          source: rel.from.table,
          sourceHandle: `${rel.from.column}-source`,
          target: rel.to.table,
          targetHandle: `${rel.to.column}-target`,
          type: 'relation',
          animated: rel.kind === 'inferred',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color:
              rel.kind === 'inferred'
                ? 'var(--vscode-charts-orange, #e09a3e)'
                : 'var(--vscode-charts-blue, #3794ff)',
          },
          data: {
            relation: rel,
            isHighlighted: selectedTable !== null && isEdgeConnected,
            isDimmed,
          },
        });
      }

      setNodes(newNodes);
      setEdges(newEdges);

      // Fit view if first load
      setTimeout(() => {
        rfInstanceRef.current?.fitView({ padding: 0.2 });
      }, 50);
    },
    [connectedTables, fkColumnsMap, handleOpenSource, selectedTable, setEdges, setNodes, showInferred]
  );

  // Listen to messages from extension host
  useEffect(() => {
    const handleMessage = async (event: MessageEvent<ToWebview>) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'schema':
          setLoading(false);
          setErrorMessage(null);
          setSchema(msg.schema);
          setSavedLayout(msg.layout);
          await applyLayout(msg.schema, msg.layout);
          break;

        case 'loading':
          setLoading(msg.value);
          break;

        case 'error':
          setLoading(false);
          setErrorMessage(msg.message);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [applyLayout, vscode]);

  // Update highlighting whenever selectedTable or showInferred changes
  useEffect(() => {
    if (schema) {
      applyLayout(schema, savedLayout);
    }
  }, [selectedTable, showInferred, applyLayout, schema, savedLayout]);

  // Persist node position on drag stop
  const onNodeDragStop = useCallback(
    () => {
      if (saveLayoutTimerRef.current) {
        clearTimeout(saveLayoutTimerRef.current);
      }

      saveLayoutTimerRef.current = setTimeout(() => {
        setNodes((currentNodes) => {
          const nodePositions: Record<string, { x: number; y: number }> = {};
          for (const n of currentNodes) {
            nodePositions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
          }
          const newLayout: SavedLayout = {
            version: 1,
            nodes: nodePositions,
          };
          setSavedLayout(newLayout);
          vscode.postMessage({ type: 'saveLayout', layout: newLayout });
          return currentNodes;
        });
      }, 400);
    },
    [setNodes, vscode]
  );

  // Table selection
  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedTable((prev) => (prev === node.id ? null : node.id));
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedTable(null);
  }, []);

  // Search handler
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSelectedTable(null);
      return;
    }

    const match = schema?.tables.find((t) =>
      t.name.toLowerCase().includes(query.toLowerCase())
    );
    if (match) {
      setSelectedTable(match.name);
      const targetNode = nodes.find((n) => n.id === match.name);
      if (targetNode && rfInstanceRef.current) {
        rfInstanceRef.current.setCenter(
          targetNode.position.x + 140,
          targetNode.position.y + 100,
          { zoom: 1.1, duration: 400 }
        );
      }
    }
  };

  // Auto arrange re-layout button
  const handleRelayout = () => {
    if (schema) {
      applyLayout(schema, null);
    }
  };

  const handleFitView = () => {
    rfInstanceRef.current?.fitView({ padding: 0.2, duration: 300 });
  };

  const handleRefresh = () => {
    vscode.postMessage({ type: 'refresh' });
  };

  return (
    <div className="erd-container">
      {/* Top Toolbar */}
      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        tableCount={schema?.tables.length ?? 0}
        relationCount={schema?.relations.length ?? 0}
        warningCount={schema?.warnings.length ?? 0}
        showInferred={showInferred}
        onToggleInferred={() => setShowInferred((prev) => !prev)}
        onRelayout={handleRelayout}
        onFitView={handleFitView}
        onRefresh={handleRefresh}
        onOpenWarnings={() => setIsWarningsOpen(true)}
      />

      {/* Loading or Error banner */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: '64px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            padding: '4px 14px',
            borderRadius: '9999px',
            background: 'rgba(0, 127, 212, 0.2)',
            color: 'var(--accent)',
            fontSize: '0.8rem',
            border: '1px solid var(--accent)',
            backdropFilter: 'blur(4px)',
          }}
        >
          Loading migrations...
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            position: 'absolute',
            top: '64px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            padding: '6px 16px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
            fontSize: '0.85rem',
            border: '1px solid #ef4444',
            backdropFilter: 'blur(4px)',
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Main React Flow Canvas */}
      <div className="erd-flow-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => {
            rfInstanceRef.current = instance;
          }}
          fitView
          minZoom={0.2}
          maxZoom={2.5}
        >
          <Background color="var(--card-border, #333333)" gap={24} size={1} />
          <Controls position="bottom-right" />
          <MiniMap
            position="bottom-left"
            nodeColor="var(--card-bg, #252526)"
            maskColor="rgba(0, 0, 0, 0.4)"
            style={{
              backgroundColor: 'var(--header-bg, #1e1e1e)',
              border: '1px solid var(--card-border, #3c3c3c)',
              borderRadius: '6px',
            }}
          />
        </ReactFlow>
      </div>

      {/* Warnings Drawer / Modal */}
      <WarningsModal
        warnings={schema?.warnings ?? []}
        isOpen={isWarningsOpen}
        onClose={() => setIsWarningsOpen(false)}
        onOpenSource={(src) => {
          setIsWarningsOpen(false);
          handleOpenSource(src);
        }}
      />
    </div>
  );
};
