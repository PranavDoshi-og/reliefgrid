import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, Circle, CircleMarker, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { buildClientSnapshot, clientDispatch, WORLD } from "./sim";

const api = (path, opts = {}) =>
  fetch("/api" + path, { headers: { "Content-Type": "application/json" }, ...opts }).then((r) => {
    if (!r.ok) throw new Error("API error: " + r.statusText);
    return r.json();
  });

const ROUTE_COLORS = ["#22d3ee", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#60a5fa"];
const NODE_STYLE = {
  warehouse: { color: "#38bdf8", r: 9 },
  shelter: { color: "#f87171", r: 9 },
  junction: { color: "#64748b", r: 4 },
};

function ClickToFlood({ active, onPick }) {
  useMapEvents({ click: (e) => active && onPick(e.latlng) });
  return null;
}

export default function App() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [floodMode, setFloodMode] = useState(false);
  const [run, setRun] = useState(null); // {mode, trace}
  const [mapStyle, setMapStyle] = useState("dark"); // "dark" | "osm" | "satellite"

  const BASEMAPS = {
    dark: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      attribution: "&copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
      maxZoom: 16,
    },
    osm: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: "&copy; Esri, Maxar, Earthstar Geographics",
      maxZoom: 17,
    },
  };

  useEffect(() => {
    api("/state")
      .then((data) => {
        setS(data);
        setIsBackendOnline(true);
      })
      .catch(() => {
        // Fallback to client-side simulation
        setIsBackendOnline(false);
        const initialZones = WORLD.scenarios["cascade"] || [];
        setS(buildClientSnapshot(initialZones));
      });
  }, []);

  if (!s) return <div className="p-8 text-slate-300">Loading ReliefGrid...</div>;

  const scenario = async (name) => {
    setRun(null);
    if (isBackendOnline) {
      try {
        setS(await api(`/scenarios/${name}`, { method: "POST" }));
        return;
      } catch (e) {
        setIsBackendOnline(false);
      }
    }
    const newZones = WORLD.scenarios[name] || [];
    setS(buildClientSnapshot(newZones));
  };

  const reset = async () => {
    setRun(null);
    if (isBackendOnline) {
      try {
        setS(await api("/reset", { method: "POST" }));
        return;
      } catch (e) {
        setIsBackendOnline(false);
      }
    }
    setS(buildClientSnapshot([]));
  };

  const addZone = async ({ lat, lng }) => {
    setFloodMode(false);
    setRun(null);
    if (isBackendOnline) {
      try {
        setS(await api("/zones", { method: "POST", body: JSON.stringify({ name: "New flood zone", lat, lon: lng, radius_km: 5 }) }));
        return;
      } catch (e) {
        setIsBackendOnline(false);
      }
    }
    const updatedZones = [...s.zones, { name: `Flood Zone #${s.zones.length + 1}`, lat, lon: lng, radius_km: 5 }];
    setS(buildClientSnapshot(updatedZones, []));
  };

  const dispatch = async () => {
    setBusy(true);
    if (isBackendOnline) {
      try {
        const r = await api("/dispatch", { method: "POST" });
        setRun({ mode: r.mode, trace: r.trace });
        setS(r.state);
        setBusy(false);
        return;
      } catch (e) {
        setIsBackendOnline(false);
      }
    }
    // Client-side dispatcher
    const res = clientDispatch(s.zones);
    setRun({ mode: res.mode, trace: res.trace });
    setS(res.state);
    setBusy(false);
  };

  const people = new Set(s.orders.map((o) => o.shelter));
  const served = [...people].reduce((a, id) => a + s.shelters[id].people, 0);
  const units = s.orders.reduce((a, o) => a + Object.values(o.items).reduce((x, y) => x + y, 0), 0);
  const reroutes = s.orders.filter((o) => o.rerouted).length;
  const blocked = s.edges.filter((e) => e.blocked).length;

  return (
    <div className="flex h-full text-slate-200">
      <aside className="flex w-[26rem] flex-col gap-4 overflow-y-auto border-r border-slate-800 bg-slate-950 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">ReliefGrid</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono font-medium">
              {isBackendOnline ? "LIVE API" : "STANDALONE"}
            </span>
          </div>
          <p className="text-xs text-amber-400 font-medium mt-1">Track 2: Climate & Supply Resilience</p>
          <p className="text-xs text-slate-400 mt-0.5">Flood relief logistics, replanned live around cut-off roads.</p>
        </div>

        <section className="grid grid-cols-4 gap-2 text-center">
          {[["People served", served], ["Units sent", units], ["Rerouted", reroutes], ["Roads cut", blocked]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-800 bg-slate-900 p-2">
              <div className="text-lg font-semibold">{v}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
            </div>
          ))}
        </section>

        <section className="flex flex-wrap gap-2">
          {s.scenarios.map((n) => (
            <button key={n} onClick={() => scenario(n)} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700 capitalize">
              {n.replace("-", " ")}
            </button>
          ))}
          <button onClick={() => setFloodMode(!floodMode)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${floodMode ? "bg-amber-500 text-black" : "bg-slate-800 hover:bg-slate-700"}`}>
            {floodMode ? "Click the map…" : "+ Add flood zone"}
          </button>
          <button onClick={reset} className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:text-white">
            Reset
          </button>
        </section>

        <button onClick={dispatch} disabled={busy} className="rounded-lg bg-cyan-500 py-2.5 font-semibold text-black hover:bg-cyan-400 disabled:opacity-50 text-sm">
          {busy ? "Agent planning…" : "Plan & dispatch relief"}
        </button>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Relief orders</h2>
          {s.orders.length === 0 && <p className="text-sm text-slate-500">No orders yet. Pick a scenario, then dispatch.</p>}
          <div className="flex flex-col gap-2">
            {s.orders.map((o, i) => (
              <div key={o.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm" style={{ borderLeft: `4px solid ${ROUTE_COLORS[i % 6]}` }}>
                <div className="flex justify-between font-medium">
                  <span>{o.vehicle}: {s.nodes[o.warehouse].name} → {s.nodes[o.shelter].name}</span>
                </div>
                <div className="text-slate-400 text-xs mt-1">
                  {Object.entries(o.items).map(([k, v]) => `${v} ${k}`).join(", ")} · {o.distance_km} km
                  {o.rerouted && <span className="ml-1 text-amber-400">· rerouted +{o.detour_km} km</span>}
                </div>
                {o.reason && <div className="mt-1 text-xs text-slate-300 leading-relaxed">{o.reason}</div>}
              </div>
            ))}
          </div>
        </section>

        {run && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Agent trace ({run.mode === "claude" ? "Claude" : run.mode === "gemini" ? "Gemini" : "rule-based fallback"})
            </h2>
            <div className="flex flex-col gap-1 text-xs text-slate-400">
              {run.trace.map((t, i) =>
                t.type === "thought" ? (
                  <p key={i} className="rounded bg-slate-900 p-2 text-slate-300 text-[11px] leading-relaxed">{t.text}</p>
                ) : (
                  <p key={i} className="font-mono text-[10px] truncate">
                    <span className="text-cyan-400">{t.name}</span>({JSON.stringify(t.input)}) → {t.output?.ok === false ? <span className="text-red-400">{t.output.error}</span> : "ok"}
                  </p>
                )
              )}
            </div>
          </section>
        )}
      </aside>

      <main className="relative flex-1 bg-slate-950">
        {/* Floating Layer Control & Style Switcher */}
        <div className="absolute top-4 right-4 z-[1000] flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700 p-1 rounded-lg text-xs shadow-xl">
          <button
            onClick={() => setMapStyle("dark")}
            className={`px-2.5 py-1 rounded font-medium transition ${mapStyle === "dark" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
          >
            Tactical Dark
          </button>
          <button
            onClick={() => setMapStyle("osm")}
            className={`px-2.5 py-1 rounded font-medium transition ${mapStyle === "osm" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
          >
            Streets (OSM)
          </button>
          <button
            onClick={() => setMapStyle("satellite")}
            className={`px-2.5 py-1 rounded font-medium transition ${mapStyle === "satellite" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
          >
            Satellite
          </button>
        </div>

        <MapContainer center={[9.95, 76.35]} zoom={10} className={`h-full w-full ${floodMode ? "cursor-crosshair" : ""}`}>
          <TileLayer
            key={mapStyle}
            url={BASEMAPS[mapStyle].url}
            attribution={BASEMAPS[mapStyle].attribution}
            maxZoom={BASEMAPS[mapStyle].maxZoom}
          />
          <ClickToFlood active={floodMode} onPick={addZone} />
          {s.zones.map((z, i) => (
            <Circle key={i} center={[z.lat, z.lon]} radius={z.radius_km * 1000} pathOptions={{ color: "#38bdf8", fillColor: "#0284c7", fillOpacity: 0.35, weight: 2 }}>
              <Tooltip sticky>{z.name} ({z.radius_km} km radius)</Tooltip>
            </Circle>
          ))}
          {s.edges.map((e, i) => (
            <Polyline key={i} positions={e.coords} pathOptions={e.blocked ? { color: "#ef4444", dashArray: "6 8", weight: 4 } : { color: "#475569", weight: 2.5 }}>
              <Tooltip sticky>{e.road}{e.blocked ? " [FLOODED / SEVERED]" : ""}</Tooltip>
            </Polyline>
          ))}
          {s.orders.map((o, i) => (
            <Polyline key={o.id} positions={o.coords} pathOptions={{ color: ROUTE_COLORS[i % 6], weight: 6, opacity: 0.95 }} />
          ))}
          {Object.entries(s.nodes).map(([id, n]) => (
            <CircleMarker
              key={id}
              center={[n.lat, n.lon]}
              radius={NODE_STYLE[n.type].r}
              pathOptions={{ color: "#0f172a", fillColor: NODE_STYLE[n.type].color, fillOpacity: 1, weight: 2 }}
            >
              <Tooltip permanent={n.type !== "junction"} direction="top" offset={[0, -8]}>
                {n.name}{s.shelters[id] ? ` (${s.shelters[id].people}p)` : ""}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </main>
    </div>
  );
}
