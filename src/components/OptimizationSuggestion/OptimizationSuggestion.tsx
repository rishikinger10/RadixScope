import './OptimizationSuggestion.css';

export default function OptimizationSuggestion() {
  return (
    <div className="optimization-panel panel">
      <div className="opt-icon">
        💡
      </div>
      <div className="opt-content">
        <div className="opt-title">Optimization Suggestion</div>
        <div className="opt-desc">
          Dynamic session ID detected at token 428. Move dynamic values to the end of the prompt to improve cache reuse.
        </div>
      </div>
      <div className="opt-arrow">
        &gt;
      </div>
    </div>
  );
}
