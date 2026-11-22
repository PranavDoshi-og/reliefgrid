# ReliefGrid: AI Flood Relief Coordinator

> **Track 2:** Climate, Resource Infrastructure & Global Supply Resilience (Autonomous Emergency Response & Supply Chain Logistics)  
> **One-liner:** An AI dispatcher that plans relief deliveries during floods and replans in seconds when roads get cut.

---

## 🌐 Hosted Interactive Demo
- **Live Demo Link:** [https://pranavdoshi-og.github.io/reliefgrid/](https://pranavdoshi-og.github.io/reliefgrid/)
- **Self-contained browser version:** Runs anywhere with zero installation, featuring a tactical Kerala SVG map, real-time flood simulation, Dijkstra safe-routing, and autonomous dispatch agent tracing.

---

## 🚨 Problem
During floods, relief operations frequently stall because:
1. Nobody knows in real time which roads are passable versus submerged.
2. Warehouse stock is never sufficient for every camp simultaneously.
3. Coordinators are forced to decide by phone and guesswork, and convoys get dispatched down roads that are already underwater.
4. District authorities and NGOs need an automated system to prioritise the most critical camps (medicine > water > food) and reroute as flood conditions rapidly evolve.

---

## 💡 Solution
ReliefGrid unifies geospatial flood data, road network routing, and an autonomous AI agent:

- **Dynamic Flood Zones:** Marks roads as submerged/cut, either from seeded scenarios (`cascade`, `periyar-surge`, `kuttanad-flood`) or interactive map clicks.
- **Safe Routing Engine:** Finds the shortest non-submerged route and computes detour distance (`+X km`) compared to baseline.
- **Autonomous AI Dispatcher:** Reads shelter needs, warehouse inventories, and vehicle capacities, then generates optimal convoy orders with human-readable reasoning.
- **Live Replanning:** When new flood zones appear, the network graph updates instantly, rerouting affected convoys in seconds.

---

## 🧠 How the AI Works
The agent runs an autonomous tool loop (Google Gemini / Claude, with an offline rule-based fallback):
- `check_inventory`: Inspects warehouse stocks.
- `get_safe_route`: Computes shortest non-flooded path and detour km.
- `assign_vehicle`: Validates vehicle load, road safety, and medical priority tiers.

If the LLM API is unavailable, the zero-break priority planner automatically takes over so the demo never fails.

---

## 🛠 Tech Stack
- **Frontend:** React, Vite, Tailwind CSS, Leaflet Map, Interactive SVG Map
- **Backend:** FastAPI, Python, NetworkX, Haversine routing
- **AI:** Google Gemini (`gemini-2.5-flash`) / Claude (`claude-sonnet`) with Function Calling
- **Hosted Demo:** Self-contained browser version with standalone SVG map published via GitHub Pages.

---

## 🚀 Running Locally (Windows cmd)

### Backend
```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      (paste your GEMINI_API_KEY into .env)
uvicorn app.main:app --reload --port 8000
```

### Frontend
```cmd
cd frontend
npm install
npm run dev                 (opens http://localhost:5173)
```

---

## 🎯 Demo Recording Flow (Step 1 to 4)
1. **Initial State:** Open dashboard showing the 16-road Central Kerala network.
2. **Trigger Scenario:** Click `cascade` scenario — Aluva (Periyar) and Kuttanad flood, roads turn red (cut).
3. **Dispatch:** Click **"Plan & dispatch relief"** — routes illuminate, orders appear with explainable reasons prioritizing medicine.
4. **Dynamic Replanning:** Click **"+ Add flood zone"**, click on an active convoy route to simulate unexpected rising waters, and click **"Plan & dispatch relief"** again — watch the engine dynamically calculate a safe detour!
