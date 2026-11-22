# ReliefGrid: flood relief logistics coordinator

Multi-agent style dispatcher: flood zones cut roads, the AI agent (Gemini free tier or Claude, with tool use)
plans relief deliveries around them, and the map replans live when a new zone appears.
Real tool loop: `check_inventory`, `get_safe_route`, `assign_vehicle`. Without an API key it
falls back to a rule-based planner, so the demo never breaks.

Weather/roads are meant to be real data; fleet and inventory are simulated (say so in the pitch).

## Run (Windows cmd)

Backend:
    cd backend
    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt
    copy .env.example .env      (then paste GEMINI_API_KEY into .env, free key at aistudio.google.com/apikey)
    uvicorn app.main:app --reload --port 8000

Frontend (new terminal):
    cd frontend
    npm install
    npm run dev                 (opens http://localhost:5173)

## Demo flow
1. Click `cascade` scenario: Aluva and Kuttanad flood, roads go red.
2. Click "Plan & dispatch relief": routes appear, orders show reasons.
3. Click "+ Add flood zone" on a route, then dispatch again: watch it replan.

## Where to extend (day 2)
- app/world.json: swap the hand-built road graph for OSM (osmnx) or OSRM routing.
- app/routing.py: replace circle zones with Open-Meteo rainfall / GloFAS flood risk per segment.
- Deploy: Vercel (frontend, set rewrite /api -> backend URL) + Render (uvicorn app.main:app).
