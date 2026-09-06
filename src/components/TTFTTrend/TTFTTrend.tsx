import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  type TooltipItem,
} from "chart.js";

import { Line } from "react-chartjs-2";
import { useEffect, useState } from "react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler
);

const initialLabels = [
  "60s",
  "50s",
  "40s",
  "30s",
  "20s",
  "10s",
  "Now",
];

const initialData = [
  520,
  430,
  390,
  350,
  410,
  310,
  348,
];

export default function TTFTTrend() {

  const [labels, setLabels] = useState(initialLabels);
  const [ttftData, setTtftData] = useState(initialData);

  useEffect(() => {

    const interval = setInterval(() => {

      setTtftData((currentData) => {

        const lastValue =
          currentData[currentData.length - 1];

        // Small random movement around the previous value
        const change =
          Math.floor(Math.random() * 81) - 40;

        let nextValue = lastValue + change;

        // Keep values within a realistic demo range
        nextValue = Math.max(180, Math.min(550, nextValue));

        return [
          ...currentData.slice(1),
          nextValue,
        ];

      });

      setLabels((currentLabels) => {

        const nextLabels = currentLabels.map(
          (_, index) => {
            const seconds =
              (6 - index) * 10;

            return seconds === 0
              ? "Now"
              : `${seconds}s`;
          }
        );

        return nextLabels;
      });

    }, 1500);

    return () => clearInterval(interval);

  }, []);

  const data = {
    labels,

    datasets: [
      {
        label: "TTFT",

        data: ttftData,

        borderColor: "#8b5cf6",

        backgroundColor:
          "rgba(139, 92, 246, 0.12)",

        borderWidth: 2,

        pointRadius: 0,

        pointHoverRadius: 4,

        tension: 0.4,

        fill: true,
      },
    ],
  };

  const options = {
    responsive: true,

    maintainAspectRatio: false,

    animation: {
      duration: 800,
      easing: "easeOutQuart" as const,
    },

    plugins: {

      legend: {
        display: false,
      },

      tooltip: {

        displayColors: false,

        callbacks: {

          label: (context: TooltipItem<"line">) => {
            return `${context.parsed.y} ms`;
          },

        },

      },

    },

    scales: {

      x: {

        grid: {
          display: false,
        },

        ticks: {

          color: "rgba(255,255,255,0.3)",

          font: {
            size: 8,
          },

        },

        border: {
          display: false,
        },

      },

      y: {

        beginAtZero: true,

        suggestedMax: 600,

        grid: {

          color:
            "rgba(255,255,255,0.05)",

        },

        ticks: {

          color:
            "rgba(255,255,255,0.3)",

          font: {
            size: 8,
          },

          callback: (
            value: string | number
          ) => {
            return `${value}ms`;
          },

        },

        border: {
          display: false,
        },

      },

    },

  };

  return (
    <div className="ttft-trend">

      <div className="panel-header">

        <div>

          <h3>
            TTFT Trend
          </h3>

          <span>
            Last 60 seconds
          </span>

        </div>

        <button className="view-all">
          Live
        </button>

      </div>

      <div className="ttft-chart">

        <Line
          data={data}
          options={options}
        />

      </div>

    </div>
  );
}