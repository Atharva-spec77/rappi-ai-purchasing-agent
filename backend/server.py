# FastAPI thin proxy for the preview environment.
# The real backend for the Rappi assignment is a Node.js + Express app under
# /app/backend/node-app. Emergent's supervisor is pinned to launch uvicorn on
# port 8001, so this process:
#   1. Boots the Node.js backend as a subprocess on 127.0.0.1:$NODE_PORT.
#   2. Proxies every /api/* request to it.
#   3. Streams Node.js stdout/stderr to this process so logs are visible via
#      supervisor's backend log files.
# Business logic, routes, models, agent and tools all live in the Node.js app.
import asyncio
import os
import signal
import subprocess
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

NODE_APP_DIR = ROOT_DIR / "node-app"
NODE_PORT = int(os.environ.get("NODE_PORT", "5001"))
NODE_URL = f"http://127.0.0.1:{NODE_PORT}"

app = FastAPI(title="Rappi AI Purchasing Agent (proxy)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_node_process: subprocess.Popen | None = None
_http_client: httpx.AsyncClient | None = None


def _start_node() -> subprocess.Popen:
    env = os.environ.copy()
    env["NODE_PORT"] = str(NODE_PORT)
    env.setdefault("MONGO_URL", os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    env.setdefault("DB_NAME", os.environ.get("DB_NAME", "rappi_purchasing_agent"))
    # Expose Emergent LLM credentials to Node.
    for k in ("EMERGENT_LLM_KEY", "INTEGRATION_PROXY_URL", "LLM_MODEL", "LLM_PROVIDER", "AGENT_FORCE_FALLBACK"):
        if k in os.environ:
            env[k] = os.environ[k]
    return subprocess.Popen(
        ["node", "src/index.js"],
        cwd=str(NODE_APP_DIR),
        env=env,
        stdout=None,  # inherit — go to supervisor log
        stderr=None,
        preexec_fn=os.setsid,
    )


async def _wait_for_node(timeout: float = 25.0) -> None:
    assert _http_client is not None
    deadline = asyncio.get_event_loop().time() + timeout
    last_err: Exception | None = None
    while asyncio.get_event_loop().time() < deadline:
        try:
            r = await _http_client.get(f"{NODE_URL}/api/health", timeout=1.5)
            if r.status_code == 200:
                return
        except Exception as e:  # noqa: BLE001
            last_err = e
        await asyncio.sleep(0.4)
    raise RuntimeError(f"Node backend did not become ready: {last_err}")


async def _seed_if_empty() -> None:
    assert _http_client is not None
    try:
        r = await _http_client.get(f"{NODE_URL}/api/products", timeout=5.0)
        if r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) == 0:
            proc = await asyncio.create_subprocess_exec(
                "node", "seed/seed.js",
                cwd=str(NODE_APP_DIR),
                env=os.environ.copy(),
            )
            await proc.wait()
    except Exception as e:  # noqa: BLE001
        print(f"[proxy] seed check failed: {e}")


@app.on_event("startup")
async def _startup() -> None:
    global _node_process, _http_client
    _http_client = httpx.AsyncClient(timeout=60.0)
    _node_process = _start_node()
    await _wait_for_node()
    await _seed_if_empty()


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _node_process, _http_client
    if _http_client is not None:
        await _http_client.aclose()
    if _node_process is not None and _node_process.poll() is None:
        try:
            os.killpg(os.getpgid(_node_process.pid), signal.SIGTERM)
        except Exception:  # noqa: BLE001
            pass


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "node_url": NODE_URL}


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(path: str, request: Request) -> Response:
    assert _http_client is not None
    url = f"{NODE_URL}/api/{path}"
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
    try:
        r = await _http_client.request(
            request.method, url, content=body, headers=headers,
            params=request.query_params, timeout=60.0,
        )
    except httpx.RequestError as e:
        return Response(content=f'{{"error":"upstream_unreachable","message":"{e}"}}', status_code=502, media_type="application/json")
    excluded = {"content-encoding", "transfer-encoding", "connection"}
    out_headers = {k: v for k, v in r.headers.items() if k.lower() not in excluded}
    return Response(content=r.content, status_code=r.status_code, headers=out_headers, media_type=r.headers.get("content-type"))
