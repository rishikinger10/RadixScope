import { useEffect, useState } from "react";

type Activity = {
  agent: string;
  status: "Generating" | "Cache Hit" | "Cache Miss" | "Queued";
  ttft: number | null;
};

const activityStates: Activity[][] = [
  [
    {
      agent: "Planner",
      status: "Generating",
      ttft: 112,
    },
    {
      agent: "Worker 1",
      status: "Cache Hit",
      ttft: 128,
    },
    {
      agent: "Worker 2",
      status: "Generating",
      ttft: 143,
    },
    {
      agent: "Worker 3",
      status: "Cache Miss",
      ttft: 432,
    },
  ],

  [
    {
      agent: "Planner",
      status: "Cache Hit",
      ttft: 96,
    },
    {
      agent: "Worker 1",
      status: "Generating",
      ttft: 151,
    },
    {
      agent: "Worker 2",
      status: "Cache Hit",
      ttft: 118,
    },
    {
      agent: "Worker 3",
      status: "Generating",
      ttft: 167,
    },
  ],

  [
    {
      agent: "Planner",
      status: "Generating",
      ttft: 134,
    },
    {
      agent: "Worker 1",
      status: "Cache Hit",
      ttft: 104,
    },
    {
      agent: "Worker 2",
      status: "Cache Miss",
      ttft: 389,
    },
    {
      agent: "Worker 3",
      status: "Queued",
      ttft: null,
    },
  ],

  [
    {
      agent: "Planner",
      status: "Cache Hit",
      ttft: 91,
    },
    {
      agent: "Worker 1",
      status: "Generating",
      ttft: 142,
    },
    {
      agent: "Worker 2",
      status: "Cache Hit",
      ttft: 109,
    },
    {
      agent: "Worker 3",
      status: "Generating",
      ttft: 156,
    },
  ],

  [
    {
      agent: "Planner",
      status: "Generating",
      ttft: 121,
    },
    {
      agent: "Worker 1",
      status: "Cache Miss",
      ttft: 367,
    },
    {
      agent: "Worker 2",
      status: "Cache Hit",
      ttft: 113,
    },
    {
      agent: "Worker 3",
      status: "Generating",
      ttft: 148,
    },
  ],
];

export default function LiveActivity() {
  const [stateIndex, setStateIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStateIndex((current) => {
        return (current + 1) % activityStates.length;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const activities = activityStates[stateIndex];

  return (
    <div className="live-activity">

      <div className="panel-header">

        <div>
          <h3>Live Activity</h3>

          <span>
            Recent inference activity
          </span>
        </div>

        <button className="view-all">
          View all →
        </button>

      </div>


      <div className="activity-list">

        {activities.map((activity) => (

          <div
            className="activity-row"
            key={activity.agent}
          >

            <span
              className={`activity-dot status-${activity.status
                .toLowerCase()
                .replace(" ", "-")}`}
            />

            <div className="activity-agent">
              {activity.agent}
            </div>

            <div
              className={`activity-status status-text-${activity.status
                .toLowerCase()
                .replace(" ", "-")}`}
            >
              {activity.status}
            </div>

            <div className="activity-signal">
              <span />
              <span />
              <span />
              <span />
            </div>

            <div className="activity-ttft">
              {activity.ttft !== null
                ? `${activity.ttft} ms`
                : "—"}
            </div>

          </div>

        ))}

      </div>

    </div>
  );
}