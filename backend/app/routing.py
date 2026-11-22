import math
import networkx as nx


def hav(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _pts(n1, n2, k=24):
    for i in range(k + 1):
        t = i / k
        yield n1["lat"] + (n2["lat"] - n1["lat"]) * t, n1["lon"] + (n2["lon"] - n1["lon"]) * t


def edge_blocked(n1, n2, zones):
    return any(
        hav(la, lo, z["lat"], z["lon"]) <= z["radius_km"]
        for la, lo in _pts(n1, n2)
        for z in zones
    )


def build_graph(world, zones):
    G = nx.Graph()
    G.add_nodes_from(world["nodes"])
    for e in world["edges"]:
        n1, n2 = world["nodes"][e["a"]], world["nodes"][e["b"]]
        km = hav(n1["lat"], n1["lon"], n2["lat"], n2["lon"])
        G.add_edge(e["a"], e["b"], km=km, road=e["road"], blocked=edge_blocked(n1, n2, zones))
    return G


def _walk(G, path):
    roads = [G[u][v]["road"] for u, v in zip(path, path[1:])]
    km = sum(G[u][v]["km"] for u, v in zip(path, path[1:]))
    return roads, km


def safe_route(world, zones, src, dst):
    """Shortest route avoiding flooded edges. Also reports detour vs. the no-flood route."""
    G = build_graph(world, zones)
    free = nx.Graph()
    free.add_nodes_from(G.nodes)
    free.add_edges_from((u, v, d) for u, v, d in G.edges(data=True) if not d["blocked"])
    base = nx.shortest_path(G, src, dst, weight="km")
    base_km = _walk(G, base)[1]
    try:
        path = nx.shortest_path(free, src, dst, weight="km")
    except nx.NetworkXNoPath:
        return {"reachable": False, "reason": "all routes cut off by flooding"}
    roads, km = _walk(G, path)
    return {
        "reachable": True,
        "path": path,
        "roads": roads,
        "distance_km": round(km, 1),
        "rerouted": path != base,
        "detour_km": round(km - base_km, 1),
        "coords": [[world["nodes"][n]["lat"], world["nodes"][n]["lon"]] for n in path],
    }
