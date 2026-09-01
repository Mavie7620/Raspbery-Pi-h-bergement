import asyncio
import json
import logging

from app.config import POLL_INTERVAL_SECONDS
from app.database import get_conn
from app.deployer import (
    get_local_commit,
    get_remote_commit,
    install_dependencies,
    pull_latest,
    start_process,
    stop_process,
)

logger = logging.getLogger("pi-paas.poller")


async def poll_loop():
    while True:
        try:
            check_all_projects()
        except Exception as exc:  # noqa: BLE001
            logger.error("Erreur pendant le polling: %s", exc)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def check_all_projects():
    with get_conn() as conn:
        projects = conn.execute(
            "SELECT * FROM projects WHERE autoupdate = 1"
        ).fetchall()

    for project in projects:
        try:
            check_project(dict(project))
        except Exception as exc:  # noqa: BLE001
            logger.error("Erreur pour le projet %s: %s", project["name"], exc)


def check_project(project: dict):
    remote_commit = get_remote_commit(project["path"], project["branch"])
    if not remote_commit or remote_commit == project["last_commit"]:
        return  # rien de neuf

    logger.info("Nouvelle version détectée pour %s, redéploiement...", project["name"])

    stop_process(project["pid"])
    pull_latest(project["path"], project["branch"])
    install_dependencies(project["path"])
    env_vars = json.loads(project["env_vars"] or "{}")
    new_pid = start_process(
        project["name"], project["path"], project["start_command"], project["port"], env_vars
    )
    new_commit = get_local_commit(project["path"])

    with get_conn() as conn:
        conn.execute(
            "UPDATE projects SET pid = ?, status = 'running', last_commit = ? WHERE id = ?",
            (new_pid, new_commit, project["id"]),
        )
        conn.commit()
