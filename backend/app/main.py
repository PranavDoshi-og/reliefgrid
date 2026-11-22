from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .state import S, WORLD
from .agent import dispatch

app = FastAPI(title="ReliefGrid")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Zone(BaseModel):
    name: str = "Flood zone"
    lat: float
    lon: float
    radius_km: float = 5


@app.get("/api/state")
def state():
    return S.snapshot()


@app.post("/api/zones")
def add_zone(z: Zone):
    S.add_zone(z.name, z.lat, z.lon, z.radius_km)
    S.orders = []
    return S.snapshot()


@app.post("/api/scenarios/{name}")
def scenario(name: str):
    S.reset()
    for z in WORLD["scenarios"].get(name, []):
        S.add_zone(**z)
    return S.snapshot()


@app.post("/api/reset")
def reset():
    S.reset()
    return S.snapshot()


@app.post("/api/dispatch")
def run_dispatch():
    result = dispatch(S)
    return {**result, "state": S.snapshot()}
