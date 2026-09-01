import asyncio
import json
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from app.database import get_conn, init_db
from app.deployer import (
    DeployError,
    clone_repo,
    get_local_commit,
    install_dependencies,
    log_path,
    start_process,
    stop_process,
)
from app.models import EnvVarsUpdate, ProjectCreate, ProjectOut
from app.poller import poll_loop

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pi-paas")

app = FastAPI(title="Pi PaaS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    init_db()
    asyncio.create_task(poll_loop())
    logger.info("Pi PaaS démarré, polling activé.")


def row_to_project(row) -> ProjectOut:
    d = dict(row)
    d["autoupdate"] = bool(d["autoupdate"])
    d["env_vars"] = json.loads(d.get("env_vars") or "{}")
    return ProjectOut(**d)


@app.get("/projects", response_model=list[ProjectOut])
def list_projects():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM projects").fetchall()
    return [row_to_project(r) for r in rows]


@app.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Projet introuvable")
    return row_to_project(row)


@app.post("/projects", response_model=ProjectOut)
def create_project(payload: ProjectCreate):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM projects WHERE name = ?", (payload.name,)
        ).fetchone()
        if existing:
            raise HTTPException(400, "Un projet avec ce nom existe déjà")

    try:
        path = clone_repo(payload.repo_url, payload.branch, payload.name)
    except DeployError as exc:
        raise HTTPException(400, str(exc)) from exc

    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO projects (name, repo_url, branch, start_command, port, path, status, autoupdate, env_vars)
            VALUES (?, ?, ?, ?, ?, ?, 'stopped', ?, ?)
            """,
            (
                payload.name,
                payload.repo_url,
                payload.branch,
                payload.start_command,
                payload.port,
                path,
                int(payload.autoupdate),
                json.dumps(payload.env_vars),
            ),
        )
        conn.commit()
        project_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()

    return row_to_project(row)


@app.post("/projects/{project_id}/deploy", response_model=ProjectOut)
def deploy_project(project_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Projet introuvable")
    project = dict(row)

    try:
        stop_process(project["pid"])
        install_dependencies(project["path"])
        env_vars = json.loads(project["env_vars"] or "{}")
        pid = start_process(
            project["name"], project["path"], project["start_command"], project["port"], env_vars
        )
        commit = get_local_commit(project["path"])
    except DeployError as exc:
        with get_conn() as conn:
            conn.execute("UPDATE projects SET status = 'error' WHERE id = ?", (project_id,))
            conn.commit()
        raise HTTPException(500, str(exc)) from exc

    with get_conn() as conn:
        conn.execute(
            "UPDATE projects SET pid = ?, status = 'running', last_commit = ? WHERE id = ?",
            (pid, commit, project_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()

    return row_to_project(row)


@app.post("/projects/{project_id}/stop", response_model=ProjectOut)
def stop_project(project_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Projet introuvable")

    stop_process(row["pid"])

    with get_conn() as conn:
        conn.execute(
            "UPDATE projects SET pid = NULL, status = 'stopped' WHERE id = ?", (project_id,)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()

    return row_to_project(row)


@app.get("/projects/{project_id}/env")
def get_env_vars(project_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT env_vars FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Projet introuvable")
    return {"env_vars": json.loads(row["env_vars"] or "{}")}


@app.put("/projects/{project_id}/env", response_model=ProjectOut)
def update_env_vars(project_id: int, payload: EnvVarsUpdate):
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Projet introuvable")
        conn.execute(
            "UPDATE projects SET env_vars = ? WHERE id = ?",
            (json.dumps(payload.env_vars), project_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    return row_to_project(row)


@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Projet introuvable")
        stop_process(row["pid"])
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
    return {"deleted": True}


@app.get("/projects/{project_id}/logs", response_class=PlainTextResponse)
def get_logs(project_id: int, lines: int = 200):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Projet introuvable")

    path = log_path(row["name"])
    try:
        with open(path, "r") as f:
            content = f.readlines()
        return "".join(content[-lines:])
    except FileNotFoundError:
        return "Aucun log pour l'instant."
