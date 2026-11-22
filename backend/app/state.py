import copy
import json
from pathlib import Path
from .routing import safe_route, build_graph

WORLD = json.loads((Path(__file__).parent / "world.json").read_text())
ITEMS = ("medicine", "water", "food")


class State:
    def __init__(self):
        self.reset()

    def reset(self):
        self.world = copy.deepcopy(WORLD)
        self.zones = []
        self.orders = []

    def reset_orders(self):
        self.world["warehouses"] = copy.deepcopy(WORLD["warehouses"])
        self.orders = []

    def add_zone(self, name, lat, lon, radius_km):
        self.zones.append({"name": name, "lat": lat, "lon": lon, "radius_km": radius_km})

    def route(self, src, dst):
        return safe_route(self.world, self.zones, src, dst)

    def used_vehicles(self):
        return {o["vehicle"] for o in self.orders}

    def remaining_needs(self, sid):
        need = dict(self.world["shelters"][sid]["needs"])
        for o in self.orders:
            if o["shelter"] == sid:
                for k, v in o["items"].items():
                    need[k] = max(0, need[k] - v)
        return need

    def assign(self, vehicle_id, warehouse_id, shelter_id, items, reason=""):
        w = self.world
        veh = next((v for v in w["vehicles"] if v["id"] == vehicle_id), None)
        if not veh:
            return {"ok": False, "error": f"unknown vehicle {vehicle_id}"}
        if vehicle_id in self.used_vehicles():
            return {"ok": False, "error": f"{vehicle_id} already dispatched"}
        if warehouse_id not in w["warehouses"] or shelter_id not in w["shelters"]:
            return {"ok": False, "error": "unknown warehouse or shelter"}
        items = {k: int(v) for k, v in items.items() if k in ITEMS and int(v) > 0}
        if not items:
            return {"ok": False, "error": "no valid items"}
        if sum(items.values()) > veh["capacity"]:
            return {"ok": False, "error": f"load {sum(items.values())} exceeds capacity {veh['capacity']}"}
        stock = w["warehouses"][warehouse_id]["stock"]
        for k, v in items.items():
            if v > stock[k]:
                return {"ok": False, "error": f"{warehouse_id} only has {stock[k]} {k}"}
        legs = []
        if veh["depot"] != warehouse_id:
            legs.append(self.route(veh["depot"], warehouse_id))
        legs.append(self.route(warehouse_id, shelter_id))
        if not all(l["reachable"] for l in legs):
            return {"ok": False, "error": "no safe route available"}
        for k, v in items.items():
            stock[k] -= v
        coords = [c for l in legs for c in l["coords"]]
        order = {
            "id": f"ORD-{len(self.orders) + 1}",
            "vehicle": vehicle_id,
            "warehouse": warehouse_id,
            "shelter": shelter_id,
            "items": items,
            "reason": reason,
            "distance_km": round(sum(l["distance_km"] for l in legs), 1),
            "rerouted": any(l["rerouted"] for l in legs),
            "detour_km": round(sum(l["detour_km"] for l in legs), 1),
            "roads": [r for l in legs for r in l["roads"]],
            "coords": coords,
        }
        self.orders.append(order)
        return {"ok": True, "order": {k: order[k] for k in ("id", "distance_km", "rerouted", "detour_km", "roads")}}

    def snapshot(self):
        w = self.world
        G = build_graph(w, self.zones)
        edges = [
            {
                "a": u, "b": v, "road": d["road"], "blocked": d["blocked"],
                "coords": [[w["nodes"][u]["lat"], w["nodes"][u]["lon"]], [w["nodes"][v]["lat"], w["nodes"][v]["lon"]]],
            }
            for u, v, d in G.edges(data=True)
        ]
        return {
            "nodes": w["nodes"], "edges": edges, "zones": self.zones,
            "warehouses": w["warehouses"], "shelters": w["shelters"],
            "vehicles": w["vehicles"], "orders": self.orders,
            "scenarios": list(WORLD["scenarios"]),
        }


S = State()
