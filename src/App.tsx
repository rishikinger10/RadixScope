import { useEffect, useState } from "react";

import LiveActivity from "./components/LiveActivity/LiveActivity";
import NeuralGraph from "./components/NeuralGraph/NeuralGraph";
import TTFTTrend from "./components/TTFTTrend/TTFTTrend";
import CacheEvents from "./components/CacheEvents/CacheEvents";
import OptimizationSuggestion from "./components/OptimizationSuggestion/OptimizationSuggestion";

import "./components/NeuralGraph/NeuralGraph.css";
import "./App.css";

function App() {

  // ================= LIVE METRICS =================

  const [liveMetrics, setLiveMetrics] = useState({
    cacheHit: 84.2,
    ttft: 348,
    tokensPerSec: 112.4,
    gpu: 72,
    kvUsage: 85,
  });


  // ================= LIVE UPDATE =================

  useEffect(() => {

    const interval = setInterval(() => {

      setLiveMetrics((current) => ({

        cacheHit: Math.max(
          78,
          Math.min(
            92,
            current.cacheHit + (Math.random() * 2 - 1)
          )
        ),

        ttft: Math.max(
          260,
          Math.min(
            450,
            current.ttft +
              Math.floor(Math.random() * 41) - 20
          )
        ),

        tokensPerSec: Math.max(
          95,
          Math.min(
            130,
            current.tokensPerSec +
              (Math.random() * 6 - 3)
          )
        ),

        gpu: Math.max(
          65,
          Math.min(
            82,
            current.gpu +
              Math.floor(Math.random() * 7) - 3
          )
        ),

        kvUsage: Math.max(
          72,
          Math.min(
            92,
            current.kvUsage +
              Math.floor(Math.random() * 5) - 2
          )
        ),

      }));

    }, 2000);

    return () => clearInterval(interval);

  }, []);


  return (
    <div className="dashboard">


      {/* ================= SIDEBAR ================= */}

      <aside className="sidebar">

        <div className="brand">

          <div className="brand-mark">
            R
          </div>

          <div>

            <div className="brand-name">
              RadixScope
            </div>

            <div className="brand-subtitle">
              CACHE INTELLIGENCE
            </div>

          </div>

        </div>


        <div className="sidebar-section">

          <div className="sidebar-title">
            OBSERVE
          </div>

          <button className="nav-item">
            <span className="nav-dot" />
            Overview
          </button>

          <button className="nav-item active">
            <span className="nav-dot" />
            Live Tree
          </button>

          <button className="nav-item">
            <span className="nav-dot" />
            Agents
          </button>

          <button className="nav-item">
            <span className="nav-dot" />
            Cache Analytics
          </button>

          <button className="nav-item">
            <span className="nav-dot" />
            Prompt Inspector
          </button>

          <button className="nav-item">
            <span className="nav-dot" />
            System Health
          </button>

        </div>


        <div className="sidebar-section">

          <div className="sidebar-title">
            SYSTEM
          </div>

          <div className="system-status">

            <span className="status-dot" />

            <div>

              <div className="status-name">
                SGLang
              </div>

              <div className="status-text">
                Online
              </div>

            </div>

          </div>

        </div>


        <div className="sidebar-bottom">

          <div className="connection">

            <span className="connection-dot" />

            Local environment

          </div>

          <div className="version">
            RadixScope v0.1
          </div>

        </div>

      </aside>



      {/* ================= MAIN ================= */}

      <main className="main-content">


        {/* ================= TOPBAR ================= */}

        <header className="topbar">

          <div className="search-bar-container">

            <input
              type="text"
              className="search-input"
              placeholder="Run multi-agent swarm..."
            />

            <span className="keyboard-shortcut">
              ⌘ K
            </span>

          </div>


          <div className="topbar-actions">


            <button className="run-button primary-btn">

              <span className="run-icon">
                ▶
              </span>

              Run Swarm

            </button>


            <div className="topbar-status connected">

              <span className="status-dot" />

              <div>

                <div className="status-title">
                  SGLang
                </div>

                <div className="status-sub">
                  Connected
                </div>

              </div>

            </div>


            {/* ================= GPU ================= */}

            <div className="gpu-status">

              <div className="gpu-label">

                GPU{" "}

                <span className="gpu-val">
                  {Math.round(liveMetrics.gpu)}%
                </span>

              </div>

              <div className="progress-bar">

                <div
                  className="progress-fill"
                  style={{
                    width: `${liveMetrics.gpu}%`,
                  }}
                />

              </div>

            </div>


            <button className="theme-toggle">
              ☾
            </button>

          </div>

        </header>



        {/* ================= METRICS ================= */}

        <section className="metrics-grid">


          {/* CACHE HIT RATE */}

          <div className="metric-card">

            <div className="metric-label">

              <span
                className="metric-icon"
                style={{
                  color: "#4ade80",
                }}
              >
                ○
              </span>

              Cache Hit Rate

            </div>


            <div className="metric-value">

              {liveMetrics.cacheHit.toFixed(1)}

              <span>
                %
              </span>

            </div>


            <div className="metric-change positive">
              ▲ +12.4%
            </div>

          </div>



          {/* TTFT */}

          <div className="metric-card">

            <div className="metric-label">

              <span
                className="metric-icon"
                style={{
                  color: "#60a5fa",
                }}
              >
                ⚡
              </span>

              Avg. TTFT

            </div>


            <div className="metric-value">

              {liveMetrics.ttft}

              <span>
                ms
              </span>

            </div>


            <div className="metric-change positive">
              ▼ -68.1%
            </div>

          </div>



          {/* TOKENS / SEC */}

          <div className="metric-card">

            <div className="metric-label">

              <span
                className="metric-icon"
                style={{
                  color: "#4ade80",
                }}
              >
                📊
              </span>

              Tokens / Sec

            </div>


            <div className="metric-value">

              {liveMetrics.tokensPerSec.toFixed(1)}

            </div>


            <div className="metric-change positive">
              ▲ +23%
            </div>

          </div>



          {/* KV CACHE */}

          <div className="metric-card">

            <div className="metric-label">

              <span
                className="metric-icon"
                style={{
                  color: "#60a5fa",
                }}
              >
                🗄️
              </span>

              KV Cache Usage

            </div>


            <div className="metric-value">

              {(liveMetrics.kvUsage * 0.08).toFixed(1)}

              <span>
                / 8 GB
              </span>

            </div>


            <div className="metric-change">

              <div className="kv-progress-container">

                <div
                  className="progress-bar kv-bar"
                  style={{
                    width: "100%",
                    background:
                      "rgba(255,255,255,0.1)",
                  }}
                >

                  <div
                    className="progress-fill"
                    style={{
                      width:
                        `${liveMetrics.kvUsage}%`,
                    }}
                  />

                </div>


                <span className="kv-percent">

                  {Math.round(
                    liveMetrics.kvUsage
                  )}%

                </span>

              </div>

            </div>

          </div>

        </section>



        {/* ================= GRAPH ================= */}

        <section className="graph-section">


          <div className="section-header">

            <div>

              <h2>
                Neural Prefix Graph
              </h2>

              <span>
                Shared prompt structure
              </span>

            </div>


            <div className="graph-badge">
              LIVE
            </div>

          </div>



          <div className="graph-layout">


            {/* ================= NEURAL GRAPH ================= */}

            <div className="graph-main">

              <div className="graph-container">

                <NeuralGraph />

              </div>

            </div>



            {/* ================= RIGHT PANELS ================= */}

            <div className="right-panels">

              <LiveActivity />

              <TTFTTrend />

              <CacheEvents />

              <OptimizationSuggestion />

            </div>


          </div>

        </section>


      </main>

    </div>
  );
}

export default App;