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
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showInferred, setShowInferred] = useState<boolean>(true);
  const [isWarningsOpen, setIsWarningsOpen] = useState<boolean>(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const schemaRef = useRef<SchemaIR | null>(null);
  const savedLayoutRef = useRef<SavedLayout | null>(null);
  const hasFittedInitialViewRef = useRef<boolean>(false);
  const saveLayoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  const vscode = useMemo(() => getVsCodeApi(), []);

  // Update nodesRef whenever nodes change
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Update schemaRef whenever schema state changes
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  // Jump to migration source code
  const handleOpenSource = useCallback(
    (source: SourceRef) => {
      vscode.postMessage({ type: 'openSource', source });
    },
    [vscode]
  );

  // Helper to compute neighbor tables of selected table
  const getConnectedTables = useCallback(
    (tableToFocus: string | null, currentSchema: SchemaIR | null): Set<string> | null => {
      if (!tableToFocus || !currentSchema) return null;
      const neighbors = new Set<string>([tableToFocus]);
      for (const rel of currentSchema.relations) {
        if (rel.from.table === tableToFocus && rel.to.table !== '*') {
          neighbors.add(rel.to.table);
        }
        if (rel.to.table === tableToFocus) {
          neighbors.add(rel.from.table);
        }
      }
      return neighbors;
    },
    []
  );

  // Helper to build full nodes and edges with layout
  const buildGraphAndLayout = useCallback(
    async (
      currentSchema: SchemaIR,
      layoutToUse?: SavedLayout | null,
      shouldFitView = false
    ) => {
      if (currentSchema.tables.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
      }

      // Collect FK columns
      const fkMap = new Map<string, Set<string>>();
      for (const rel of currentSchema.relations) {
        if (!fkMap.has(rel.from.table)) {
          fkMap.set(rel.from.table, new Set());
        }
        fkMap.get(rel.from.table)!.add(rel.from.column);
      }

      // Collect current node positions from canvas so user's manual placement is preserved
      const currentCanvasPositions: Record<string, { x: number; y: number }> = {};
      for (const n of nodesRef.current) {
        currentCanvasPositions[n.id] = { x: n.position.x, y: n.position.y };
      }

      // Merge saved layout with currently active canvas positions
      const layoutPositions = {
        ...(layoutToUse?.nodes || {}),
        ...currentCanvasPositions,
      };

      // Compute positions with ELK (preserves existing positions, only places newly added tables)
      const positions = await layoutSchema(
        currentSchema.tables,
        currentSchema.relations,
        Object.keys(layoutPositions).length > 0 ? layoutPositions : null
      );

      const connected = getConnectedTables(selectedTable, currentSchema);

      // Create React Flow nodes
      const newNodes: Node[] = currentSchema.tables.map((table) => {
        const isDimmed = connected !== null && !connected.has(table.name);
        const isHighlighted = selectedTable === table.name;

        return {
          id: table.name,
          type: 'table',
          position: positions[table.name] || { x: 0, y: 0 },
          data: {
            table,
            isHighlighted,
            isDimmed,
            fkColumns: fkMap.get(table.name) || new Set(),
            onOpenSource: handleOpenSource,
          },
        };
      });

      // Create React Flow edges
      const newEdges: Edge[] = [];
      for (const rel of currentSchema.relations) {
        if (rel.to.table === '*') continue;

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
          hidden: rel.kind === 'inferred' && !showInferred,
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

      if (shouldFitView) {
        setTimeout(() => {
          rfInstanceRef.current?.fitView({ padding: 0.2 });
        }, 80);
      }
    },
    [getConnectedTables, handleOpenSource, selectedTable, setEdges, setNodes, showInferred]
  );

  // Main listener for messages from the extension host
  // RUNS ONCE ON MOUNT - DOES NOT RE-SEND 'ready' ON STATE CHANGES!
  useEffect(() => {
    const handleMessage = async (event: MessageEvent<ToWebview>) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'schema': {
          setLoading(false);
          setErrorMessage(null);
          setSchema(msg.schema);
          savedLayoutRef.current = msg.layout;

          const isFirstTime = !hasFittedInitialViewRef.current;
          if (isFirstTime) {
            hasFittedInitialViewRef.current = true;
          }

          // Build graph; fitView ONLY on the very first load
          await buildGraphAndLayout(msg.schema, msg.layout, isFirstTime);
          break;
        }

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

    // Send ready once on initial mount
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [buildGraphAndLayout, vscode]);

  // Update highlighting without re-running ELK layout when selectedTable changes
  useEffect(() => {
    const currentSchema = schemaRef.current;
    if (!currentSchema) return;

    const connected = getConnectedTables(selectedTable, currentSchema);

    // Update node highlights
    setNodes((currentNodes) =>
      currentNodes.map((n) => {
        const isDimmed = connected !== null && !connected.has(n.id);
        const isHighlighted = selectedTable === n.id;
        if (n.data.isDimmed === isDimmed && n.data.isHighlighted === isHighlighted) {
          return n;
        }
        return {
          ...n,
          data: {
            ...n.data,
            isHighlighted,
            isDimmed,
          },
        };
      })
    );

    // Update edge highlights
    setEdges((currentEdges) =>
      currentEdges.map((e) => {
        const rel = (e.data as any)?.relation;
        const isEdgeConnected =
          !selectedTable ||
          rel?.from.table === selectedTable ||
          rel?.to.table === selectedTable;
        const isDimmed = selectedTable !== null && !isEdgeConnected;
        const isHidden = rel?.kind === 'inferred' && !showInferred;

        return {
          ...e,
          hidden: isHidden,
          data: {
            ...e.data,
            isHighlighted: selectedTable !== null && isEdgeConnected,
            isDimmed,
          },
        };
      })
    );
  }, [selectedTable, showInferred, getConnectedTables, setEdges, setNodes]);

  // Persist node position on drag stop (debounced, without reloading or fitView)
  const onNodeDragStop = useCallback(() => {
    if (saveLayoutTimerRef.current) {
      clearTimeout(saveLayoutTimerRef.current);
    }

    saveLayoutTimerRef.current = setTimeout(() => {
      setNodes((currentNodes) => {
        const nodePositions: Record<string, { x: number; y: number }> = {};
        for (const n of currentNodes) {
          nodePositions[n.id] = {
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
          };
        }
        const newLayout: SavedLayout = {
          version: 1,
          nodes: nodePositions,
        };
        savedLayoutRef.current = newLayout;
        vscode.postMessage({ type: 'saveLayout', layout: newLayout });
        return currentNodes;
      });
    }, 400);
  }, [setNodes, vscode]);

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

    const currentSchema = schemaRef.current;
    const match = currentSchema?.tables.find((t) =>
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

  // Re-layout button (Auto arrange)
  const handleRelayout = () => {
    const currentSchema = schemaRef.current;
    if (currentSchema) {
      buildGraphAndLayout(currentSchema, null, true);
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

      {/* Loading banner (only on initial load before any schema is rendered) */}
      {loading && !schema && (
        <div
          style={{
            position: 'absolute',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            padding: '6px 16px',
            borderRadius: '9999px',
            background: 'rgba(0, 127, 212, 0.25)',
            color: 'var(--accent)',
            fontSize: '0.85rem',
            border: '1px solid var(--accent)',
            backdropFilter: 'blur(6px)',
          }}
        >
          Loading migrations...
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            position: 'absolute',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            padding: '6px 16px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.25)',
            color: '#ef4444',
            fontSize: '0.85rem',
            border: '1px solid #ef4444',
            backdropFilter: 'blur(6px)',
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
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
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
