import {
  BaseEdge,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

type NeuralEdgeData = {
  status: "cached" | "active" | "divergence" | "miss";
};

type NeuralEdgeType = Edge<NeuralEdgeData>;

export default function NeuralEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<NeuralEdgeType>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });

  const colors: Record<
    NeuralEdgeData["status"],
    {
      main: string;
      glow: string;
    }
  > = {
    cached: {
      main: "#60a5fa",
      glow: "rgba(96, 165, 250, 0.7)",
    },

    active: {
      main: "#a78bfa",
      glow: "rgba(167, 139, 250, 0.8)",
    },

    divergence: {
      main: "#f43f5e",
      glow: "rgba(244, 63, 94, 0.8)",
    },

    miss: {
      main: "#fb923c",
      glow: "rgba(251, 146, 60, 0.8)",
    },
  };

  const currentColor = colors[data?.status ?? "active"];

  return (
    <>
      {/* Outer glow */}
      <BaseEdge
        path={edgePath}
        style={{
          stroke: currentColor.main,
          strokeWidth: 9,
          opacity: 0.12,
          filter: "blur(7px)",
        }}
      />

      {/* Main branch */}
      <BaseEdge
        path={edgePath}
        style={{
          stroke: currentColor.main,
          strokeWidth: 2,
          opacity: 0.9,
          filter: `drop-shadow(0 0 6px ${currentColor.main})`,
        }}
      />

      {/* Bright center */}
      <BaseEdge
        path={edgePath}
        style={{
          stroke: "#ffffff",
          strokeWidth: 0.7,
          opacity: 0.65,
        }}
      />

      {/* Moving energy particle */}
      <circle
        r="3"
        fill="#ffffff"
        filter={`drop-shadow(0 0 6px ${currentColor.main})`}
      >
        <animateMotion
          dur={
            data?.status === "divergence"
              ? "1.5s"
              : "2.5s"
          }
          repeatCount="indefinite"
          path={edgePath}
        />
      </circle>

      {/* Particle halo */}
      <circle
        r="7"
        fill="none"
        stroke={currentColor.main}
        strokeWidth="1"
        opacity="0.35"
      >
        <animateMotion
          dur={
            data?.status === "divergence"
              ? "1.5s"
              : "2.5s"
          }
          repeatCount="indefinite"
          path={edgePath}
        />
      </circle>
    </>
  );
}