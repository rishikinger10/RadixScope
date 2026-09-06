import React from 'react';
import './BackgroundEffects.css';

export default function BackgroundEffects() {
  // Create an array of star data to avoid rendering hundreds of separate DOM elements manually,
  // or we can just use CSS radial gradients for the starfield which is much more performant.
  // We'll use CSS multiple backgrounds for the stars to keep DOM elements to a minimum.

  return (
    <div className="background-effects-container">
      {/* Subtle atmospheric glow */}
      <div className="atmospheric-glow"></div>
      
      {/* The main starfield layer (handled via CSS for performance) */}
      <div className="starfield-layer layer-1"></div>
      <div className="starfield-layer layer-2"></div>
      <div className="starfield-layer layer-3"></div>

      {/* Subtle decorative neural signal stream near the bottom */}
      <div className="neural-signal-stream">
        <svg 
          width="100%" 
          height="40" 
          viewBox="0 0 1000 40" 
          preserveAspectRatio="none" 
          className="signal-svg"
        >
          {/* Main glowing line */}
          <path 
            className="signal-line" 
            d="M 0,20 L 200,20 L 220,10 L 240,30 L 260,20 L 600,20 L 620,5 L 640,35 L 660,20 L 1000,20" 
          />
          {/* Faint trail */}
          <path 
            className="signal-trail" 
            d="M 0,20 L 200,20 L 220,10 L 240,30 L 260,20 L 600,20 L 620,5 L 640,35 L 660,20 L 1000,20" 
          />
          {/* Tiny particles moving along the path */}
          <circle className="signal-particle p1" cx="0" cy="0" r="1.5" />
          <circle className="signal-particle p2" cx="0" cy="0" r="1.5" />
          <circle className="signal-particle p3" cx="0" cy="0" r="2" />
        </svg>
      </div>
    </div>
  );
}
