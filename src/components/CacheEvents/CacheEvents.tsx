import { useEffect, useState } from "react";
import "./CacheEvents.css";

type EventType = "hit" | "miss" | "branch";

type CacheEvent = {
  type: EventType;
  text: string;
  time: string;
};

const eventSets: CacheEvent[][] = [
  [
    {
      type: "hit",
      text: "Prefix reused (7,842 tokens)",
      time: "2s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (1,024 tokens)",
      time: "4s ago",
    },
    {
      type: "miss",
      text: "Cache miss at token 428",
      time: "5s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (7,842 tokens)",
      time: "8s ago",
    },
    {
      type: "branch",
      text: "New branch created",
      time: "12s ago",
    },
  ],

  [
    {
      type: "hit",
      text: "Prefix reused (4,812 tokens)",
      time: "1s ago",
    },
    {
      type: "branch",
      text: "New branch created",
      time: "3s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (2,048 tokens)",
      time: "5s ago",
    },
    {
      type: "miss",
      text: "Cache miss at token 615",
      time: "7s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (7,842 tokens)",
      time: "10s ago",
    },
  ],

  [
    {
      type: "miss",
      text: "Cache miss at token 302",
      time: "1s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (6,120 tokens)",
      time: "3s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (1,024 tokens)",
      time: "5s ago",
    },
    {
      type: "branch",
      text: "New branch created",
      time: "8s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (3,456 tokens)",
      time: "11s ago",
    },
  ],

  [
    {
      type: "hit",
      text: "Prefix reused (8,192 tokens)",
      time: "1s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (4,096 tokens)",
      time: "3s ago",
    },
    {
      type: "branch",
      text: "New branch created",
      time: "5s ago",
    },
    {
      type: "miss",
      text: "Cache miss at token 741",
      time: "7s ago",
    },
    {
      type: "hit",
      text: "Prefix reused (2,048 tokens)",
      time: "10s ago",
    },
  ],
];

const eventColors: Record<EventType, string> = {
  hit: "#4ade80",
  miss: "#f43f5e",
  branch: "#60a5fa",
};

export default function CacheEvents() {
  const [eventSetIndex, setEventSetIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setEventSetIndex((current) => {
        return (current + 1) % eventSets.length;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const events = eventSets[eventSetIndex];

  return (
    <div className="cache-events-panel panel">

      <div className="panel-header">

        <h3>
          Cache Events
        </h3>

        <a href="#" className="view-all">
          View all &rarr;
        </a>

      </div>

      <div className="events-list">

        {events.map((event, index) => {

          const color = eventColors[event.type];

          return (
            <div
  className={`event-item event-${event.type}`}
  key={`${event.text}-${index}`}
>

              <span
                className="event-dot"
                style={{
                  background: color,
                  boxShadow: `0 0 8px ${color}`,
                }}
              />

              <div className="event-text">
                <strong>
                  {event.text.split(" (")[0].split(" at ")[0]}
                </strong>

                {event.text.includes(" (") &&
                  ` (${event.text.split(" (")[1]}`}

                {event.text.includes(" at ") &&
                  ` at ${event.text.split(" at ")[1]}`}
              </div>

              <div className="event-time">
                {event.time}
              </div>

            </div>
          );
        })}

      </div>

    </div>
  );
}