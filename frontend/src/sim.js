import WORLD from "./world.json";

function hav(lat1, lon1, lat2, lon2) {
  const r = 6371.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function edgeBlocked(n1, n2, zones) {
  for (const z of zones) {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const lat = n1.lat + (n2.lat - n1.lat) * t;
      const lon = n1.lon + (n2.lon - n1.lon) * t;
      if (hav(lat, lon, z.lat, z.lon) <= z.radius_km) return true;
    }
  }
  return false;
}

export function buildClientSnapshot(zones = [], orders = []) {
  const edges = WORLD.edges.map((e) => {
    const n1 = WORLD.nodes[e.a];
    const n2 = WORLD.nodes[e.b];
    return {
      road: e.road,
      a: e.a,
      b: e.b,
      blocked: edgeBlocked(n1, n2, zones),
      coords: [
        [n1.lat, n1.lon],
        [n2.lat, n2.lon],
      ],
    };
  });

  return {
    nodes: WORLD.nodes,
    edges,
    zones,
    orders,
    warehouses: WORLD.warehouses,
    shelters: WORLD.shelters,
    scenarios: Object.keys(WORLD.scenarios || {}),
  };
}

export function clientSafeRoute(src, dst, zones) {
  const dist = {}, prev = {};
  const Q = new Set(Object.keys(WORLD.nodes));
  for (const n in WORLD.nodes) dist[n] = Infinity;
  dist[src] = 0;

  while (Q.size > 0) {
    let u = null;
    for (const n of Q) if (u === null || dist[n] < dist[u]) u = n;
    if (dist[u] === Infinity || u === dst) break;
    Q.delete(u);

    for (const e of WORLD.edges) {
      if (e.a === u || e.b === u) {
        const v = e.a === u ? e.b : e.a;
        if (!Q.has(v)) continue;
        const n1 = WORLD.nodes[u], n2 = WORLD.nodes[v];
        if (edgeBlocked(n1, n2, zones)) continue;
        const d = hav(n1.lat, n1.lon, n2.lat, n2.lon);
        if (dist[u] + d < dist[v]) {
          dist[v] = dist[u] + d;
          prev[v] = u;
        }
      }
    }
  }

  if (dist[dst] === Infinity) return { reachable: false };

  const path = [];
  let curr = dst;
  while (curr !== src) {
    path.unshift(curr);
    curr = prev[curr];
  }
  path.unshift(src);

  // Compare with unblocked distance
  const baseD = getBaseDistance(src, dst);
  const isRerouted = Math.abs(dist[dst] - baseD) > 0.5;

  return {
    reachable: true,
    path,
    distance_km: Math.round(dist[dst] * 10) / 10,
    rerouted: isRerouted,
    detour_km: isRerouted ? Math.round((dist[dst] - baseD) * 10) / 10 : 0,
    coords: path.map((n) => [WORLD.nodes[n].lat, WORLD.nodes[n].lon]),
  };
}

function getBaseDistance(src, dst) {
  const dist = {};
  const Q = new Set(Object.keys(WORLD.nodes));
  for (const n in WORLD.nodes) dist[n] = Infinity;
  dist[src] = 0;
  while (Q.size > 0) {
    let u = null;
    for (const n of Q) if (u === null || dist[n] < dist[u]) u = n;
    if (dist[u] === Infinity || u === dst) break;
    Q.delete(u);
    for (const e of WORLD.edges) {
      if (e.a === u || e.b === u) {
        const v = e.a === u ? e.b : e.a;
        if (!Q.has(v)) continue;
        const d = hav(WORLD.nodes[u].lat, WORLD.nodes[u].lon, WORLD.nodes[v].lat, WORLD.nodes[v].lon);
        if (dist[u] + d < dist[v]) dist[v] = dist[u] + d;
      }
    }
  }
  return dist[dst];
}

export function clientDispatch(zones) {
  const usedVehicles = new Set();
  const currentStock = JSON.parse(JSON.stringify(WORLD.warehouses));
  const shelterNeeds = JSON.parse(JSON.stringify(WORLD.shelters));
  const trace = [{ type: "thought", text: "Autonomous coordinator active: prioritizing medical triage, safe routes and capacity constraints." }];
  const orders = [];

  const shelterOrder = Object.keys(WORLD.shelters).sort((a, b) => WORLD.shelters[b].priority - WORLD.shelters[a].priority);

  let progress = true;
  while (progress) {
    progress = false;
    for (const sid of shelterOrder) {
      const s = shelterNeeds[sid];
      const totalNeed = s.needs.medicine + s.needs.water + s.needs.food;
      if (totalNeed <= 0) continue;

      let bestMatch = null;
      for (const v of WORLD.vehicles) {
        if (usedVehicles.has(v.id)) continue;
        for (const wid in currentStock) {
          const wh = currentStock[wid];
          const hasStock = (wh.stock.medicine > 0 && s.needs.medicine > 0) ||
                           (wh.stock.water > 0 && s.needs.water > 0) ||
                           (wh.stock.food > 0 && s.needs.food > 0);
          if (!hasStock) continue;

          const route = clientSafeRoute(wid, sid, zones);
          if (!route.reachable) continue;

          trace.push({
            type: "tool",
            name: "get_safe_route",
            input: { from_id: wid, to_id: sid },
            output: { reachable: true, distance_km: route.distance_km, rerouted: route.rerouted, detour_km: route.detour_km },
          });

          if (!bestMatch || route.distance_km < bestMatch.dist) {
            bestMatch = { dist: route.distance_km, vehicle: v, wid, route };
          }
        }
      }

      if (!bestMatch) continue;

      const { vehicle: v, wid, route } = bestMatch;
      let cap = v.capacity;
      const assigned = {};

      for (const item of ["medicine", "water", "food"]) {
        const need = s.needs[item];
        const stock = currentStock[wid].stock[item];
        const q = Math.min(need, stock, cap);
        if (q > 0) {
          assigned[item] = q;
          cap -= q;
          s.needs[item] -= q;
          currentStock[wid].stock[item] -= q;
        }
      }

      if (Object.keys(assigned).length > 0) {
        usedVehicles.add(v.id);
        const reason = `Priority-${WORLD.shelters[sid].priority} camp served from ${WORLD.nodes[wid].name}` +
          (route.rerouted ? ` · REROUTED +${route.detour_km} km to bypass flood` : ` · Direct route.`);

        trace.push({
          type: "tool",
          name: "assign_vehicle",
          input: { vehicle_id: v.id, shelter_id: sid, items: assigned },
          output: { ok: true, reason },
        });

        orders.push({
          id: "ORD-" + (orders.length + 1),
          vehicle: v.id,
          warehouse: wid,
          shelter: sid,
          items: assigned,
          distance_km: route.distance_km,
          rerouted: route.rerouted,
          detour_km: route.detour_km,
          coords: route.coords,
          reason,
        });
        progress = true;
      }
    }
  }

  trace.push({
    type: "thought",
    text: `Completed dispatch cycle. Dispatched ${orders.length} convoys around active flood zones.`,
  });

  return { mode: "rule-based fallback", trace, orders, state: buildClientSnapshot(zones, orders) };
}

export { WORLD };
