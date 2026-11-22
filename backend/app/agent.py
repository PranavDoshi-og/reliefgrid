import json
import os
from .state import ITEMS

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")

SYSTEM = """You are the dispatch coordinator for a flood-relief logistics system.
Goal: serve as many people as possible, highest-priority shelters first (priority 5 = most critical).
Rules: each vehicle makes ONE trip (depot -> one warehouse -> one shelter), cannot exceed capacity,
and cannot use flooded roads. Stock is limited, so you must prioritise and trade off.
Always call get_safe_route before assigning, prefer short safe routes, and put a one-sentence
plain-language reason in every assign_vehicle call (mention reroutes around flooding).
Medicine is most urgent, then water, then food. Finish with a 2-3 sentence summary
of who is served, who is short, and why."""

TOOLS = [
    {"name": "check_inventory", "description": "Current stock at a warehouse.",
     "input_schema": {"type": "object", "properties": {"warehouse_id": {"type": "string"}}, "required": ["warehouse_id"]}},
    {"name": "get_safe_route", "description": "Safest shortest route between two node ids, avoiding flooded roads. Reports reroute and detour km.",
     "input_schema": {"type": "object", "properties": {"from_id": {"type": "string"}, "to_id": {"type": "string"}}, "required": ["from_id", "to_id"]}},
    {"name": "assign_vehicle", "description": "Dispatch a vehicle from a warehouse to a shelter with items. Validates capacity, stock and route.",
     "input_schema": {"type": "object", "properties": {
         "vehicle_id": {"type": "string"}, "warehouse_id": {"type": "string"}, "shelter_id": {"type": "string"},
         "items": {"type": "object", "description": "e.g. {\"water\":100,\"medicine\":20}"},
         "reason": {"type": "string"}}, "required": ["vehicle_id", "warehouse_id", "shelter_id", "items", "reason"]}},
]


def run_tool(S, name, args):
    if name == "check_inventory":
        wh = S.world["warehouses"].get(args["warehouse_id"])
        return wh["stock"] if wh else {"error": "unknown warehouse"}
    if name == "get_safe_route":
        r = S.route(args["from_id"], args["to_id"])
        r.pop("coords", None)
        return r
    if name == "assign_vehicle":
        return S.assign(args["vehicle_id"], args["warehouse_id"], args["shelter_id"], args["items"], args.get("reason", ""))
    return {"error": "unknown tool"}


def situation(S):
    blocked = [e["road"] for e in S.snapshot()["edges"] if e["blocked"]]
    return json.dumps({
        "flooded_zones": [z["name"] for z in S.zones],
        "blocked_roads": blocked,
        "warehouses": {k: v["stock"] for k, v in S.world["warehouses"].items()},
        "shelters": S.world["shelters"],
        "vehicles": S.world["vehicles"],
    })


def run_claude(S):
    import anthropic
    client = anthropic.Anthropic()
    msgs = [{"role": "user", "content": "Current situation (JSON):\n" + situation(S) + "\nPlan and dispatch relief now."}]
    trace = []
    for _ in range(25):
        r = client.messages.create(model=MODEL, max_tokens=2000, system=SYSTEM, tools=TOOLS, messages=msgs)
        msgs.append({"role": "assistant", "content": r.content})
        results = []
        for b in r.content:
            if b.type == "text" and b.text.strip():
                trace.append({"type": "thought", "text": b.text.strip()})
            elif b.type == "tool_use":
                out = run_tool(S, b.name, b.input)
                trace.append({"type": "tool", "name": b.name, "input": b.input, "output": out})
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(out)})
        if r.stop_reason != "tool_use":
            break
        msgs.append({"role": "user", "content": results})
    return trace


def run_gemini(S):
    """Same agent loop on Gemini (free tier). Tools are plain Python functions; the SDK calls them."""
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    trace = []

    def _log(name, args, out):
        trace.append({"type": "tool", "name": name, "input": args, "output": out})
        return out

    def check_inventory(warehouse_id: str) -> dict:
        """Current stock at a warehouse (W1, W2 or W3)."""
        out = run_tool(S, "check_inventory", {"warehouse_id": warehouse_id})
        return _log("check_inventory", {"warehouse_id": warehouse_id}, out)

    def get_safe_route(from_id: str, to_id: str) -> dict:
        """Safest shortest route between two node ids, avoiding flooded roads. Reports reroute and detour km."""
        out = run_tool(S, "get_safe_route", {"from_id": from_id, "to_id": to_id})
        return _log("get_safe_route", {"from_id": from_id, "to_id": to_id}, out)

    def assign_vehicle(vehicle_id: str, warehouse_id: str, shelter_id: str, reason: str,
                       water: int = 0, food: int = 0, medicine: int = 0) -> dict:
        """Dispatch a vehicle from a warehouse to a shelter with items. Validates capacity, stock and route."""
        items = {"water": water, "food": food, "medicine": medicine}
        out = S.assign(vehicle_id, warehouse_id, shelter_id, items, reason)
        return _log("assign_vehicle", {"vehicle_id": vehicle_id, "shelter_id": shelter_id, "items": items}, out)

    resp = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        contents="Current situation (JSON):\n" + situation(S) + "\nPlan and dispatch relief now.",
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM,
            tools=[check_inventory, get_safe_route, assign_vehicle],
            temperature=0.2,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(maximum_remote_calls=40),
        ),
    )
    if resp.text:
        trace.append({"type": "thought", "text": resp.text.strip()})
    return trace


def run_fallback(S):
    """Greedy priority planner. No LLM needed; keeps the demo alive offline."""
    trace = []
    order = sorted(S.world["shelters"], key=lambda s: -S.world["shelters"][s]["priority"])
    progress = True
    while progress:
        progress = False
        for sid in order:
            need = S.remaining_needs(sid)
            if sum(need.values()) == 0:
                continue
            best = None
            for v in S.world["vehicles"]:
                if v["id"] in S.used_vehicles():
                    continue
                for wid, wh in S.world["warehouses"].items():
                    if not any(wh["stock"][k] > 0 and need[k] > 0 for k in ITEMS):
                        continue
                    r = S.route(wid, sid)
                    if not r["reachable"]:
                        continue
                    d = r["distance_km"] + (S.route(v["depot"], wid).get("distance_km", 999) if v["depot"] != wid else 0)
                    if best is None or d < best[0]:
                        best = (d, v, wid, r)
            if not best:
                continue
            _, v, wid, r = best
            cap, items = v["capacity"], {}
            for k in ITEMS:
                q = min(need[k], S.world["warehouses"][wid]["stock"][k], cap)
                if q > 0:
                    items[k] = q
                    cap -= q
            if not items:
                continue
            reason = f"Priority-{S.world['shelters'][sid]['priority']} shelter; nearest safe supply is {wid}" + (
                f", rerouted +{r['detour_km']} km around flooding." if r["rerouted"] else ".")
            out = S.assign(v["id"], wid, sid, items, reason)
            trace.append({"type": "tool", "name": "assign_vehicle", "input": {"vehicle_id": v["id"], "shelter_id": sid, "items": items}, "output": out})
            progress = progress or out.get("ok", False)
    return trace


def dispatch(S):
    S.reset_orders()
    if os.getenv("GEMINI_API_KEY"):
        mode = "gemini"
    elif os.getenv("ANTHROPIC_API_KEY"):
        mode = "claude"
    else:
        mode = "fallback"
    try:
        trace = {"gemini": run_gemini, "claude": run_claude, "fallback": run_fallback}[mode](S)
    except Exception as e:  # network/key/model errors: degrade gracefully
        S.reset_orders()
        trace = [{"type": "thought", "text": f"LLM unavailable ({type(e).__name__}); using rule-based planner."}] + run_fallback(S)
        mode = "fallback"
    return {"mode": mode, "trace": trace, "orders": S.orders}
