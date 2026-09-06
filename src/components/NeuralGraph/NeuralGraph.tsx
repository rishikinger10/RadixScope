import {
  ReactFlow,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";

import { useEffect, useState } from "react";

import "@xyflow/react/dist/style.css";
import "./NeuralGraph.css";

import NeuralNode from "./NeuralNode";
import NeuralEdge from "./NeuralEdge";

const nodeTypes = {
  neural: NeuralNode,
};

const edgeTypes = {
  neural: NeuralEdge,
};

const initialNodes = [
  {
    id: "root",
    type: "neural",
    position: { x: 430, y: 40 },
    data: {
      label: "System Prompt",
      status: "cached",
    },
  },

  {
    id: "context",
    type: "neural",
    position: { x: 270, y: 190 },
    data: {
      label: "Shared Context",
      status: "cached",
    },
  },

  {
    id: "tools",
    type: "neural",
    position: { x: 440, y: 330 },
    data: {
      label: "Tool Schema",
      status: "divergence",
    },
  },

  {
    id: "worker1",
    type: "neural",
    position: { x: 150, y: 500 },
    data: {
      label: "Worker 1",
      status: "active",
    },
  },

  {
    id: "worker2",
    type: "neural",
    position: { x: 690, y: 470 },
    data: {
      label: "Worker 2",
      status: "miss",
    },
  },
];

const initialEdges = [
  {
    id: "root-context",
    source: "root",
    target: "context",
    type: "neural",
    data: {
      status: "cached",
    },
  },

  {
    id: "context-tools",
    source: "context",
    target: "tools",
    type: "neural",
    data: {
      status: "cached",
    },
  },

  {
    id: "tools-worker1",
    source: "tools",
    target: "worker1",
    type: "neural",
    data: {
      status: "active",
    },
  },

  {
    id: "tools-worker2",
    source: "tools",
    target: "worker2",
    type: "neural",
    data: {
      status: "miss",
    },
  },
];

const particles = [
  { left: 12, top: 18, delay: 0 },
  { left: 22, top: 35, delay: 1.2 },
  { left: 31, top: 12, delay: 2.4 },
  { left: 39, top: 48, delay: 0.7 },
  { left: 48, top: 20, delay: 3.1 },
  { left: 57, top: 38, delay: 1.8 },
  { left: 66, top: 15, delay: 2.7 },
  { left: 76, top: 30, delay: 0.4 },
  { left: 87, top: 18, delay: 2.1 },
  { left: 92, top: 52, delay: 3.5 },
  { left: 15, top: 64, delay: 1.5 },
  { left: 28, top: 78, delay: 3.2 },
  { left: 43, top: 68, delay: 0.9 },
  { left: 55, top: 82, delay: 2.5 },
  { left: 70, top: 67, delay: 1.1 },
  { left: 82, top: 78, delay: 3.8 },
  { left: 94, top: 72, delay: 1.9 },
  { left: 7, top: 43, delay: 2.8 },
  { left: 36, top: 91, delay: 0.3 },
  { left: 63, top: 91, delay: 3.4 },
];

export default function NeuralGraph() {
  const [nodes, setNodes, onNodesChange] =
    useNodesState(initialNodes);

  const [edges, , onEdgesChange] =
    useEdgesState(initialEdges);

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % 5);
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const nodeIds = [
      "root",
      "context",
      "tools",
      "worker1",
      "worker2",
    ];

    setNodes((currentNodes) =>
      currentNodes.map((node, index) => {
        if (index === activeIndex) {
          return {
            ...node,
            data: {
              ...node.data,
              status: "active",
            },
          };
        }

        if (node.id === "tools") {
          return {
            ...node,
            data: {
              ...node.data,
              status: "divergence",
            },
          };
        }

        if (node.id === "worker2") {
          return {
            ...node,
            data: {
              ...node.data,
              status: "miss",
            },
          };
        }

        return {
          ...node,
          data: {
            ...node.data,
            status: "cached",
          },
        };
      })
    );

    setNodes((currentNodes) => currentNodes);

  }, [activeIndex, setNodes]);

  return (
    <div className="neural-graph">

      <div className="neural-particles">
        {particles.map((particle, index) => (
          <span
            key={index}
            className="neural-particle"
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      />

    </div>
  );
}