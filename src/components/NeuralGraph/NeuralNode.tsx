import { Handle, Position } from "@xyflow/react";

type NeuralNodeProps = {
  data: {
    label: string;
    status: "cached" | "active" | "divergence" | "miss";
  };
};

export default function NeuralNode({ data }: NeuralNodeProps) {
  return (
    <div className={`neural-node status-${data.status}`}>
      <Handle
        type="target"
        position={Position.Top}
        className="neural-handle"
      />

      <div className="neural-aura">
        <div className="neural-ring" />
        <div className="neural-core" />
        <div className="neural-shine" />
      </div>

      <span className="neural-label">{data.label}</span>

      <Handle
        type="source"
        position={Position.Bottom}
        className="neural-handle"
      />
    </div>
  );
}