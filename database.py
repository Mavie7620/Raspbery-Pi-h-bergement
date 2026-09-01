import sqlite3
from contextlib import contextmanager

from app.config import DB_PATH


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row["name"] == column for row in rows)


def init_db():
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                repo_url TEXT NOT NULL,
                branch TEXT NOT NULL DEFAULT 'main',
                start_command TEXT NOT NULL,
                port INTEGER NOT NULL,
                path TEXT NOT NULL,
                pid INTEGER,
                status TEXT NOT NULL DEFAULT 'stopped',
                last_commit TEXT,
                autoupdate INTEGER NOT NULL DEFAULT 1,
                env_vars TEXT NOT NULL DEFAULT '{}',
                exposed INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        # Migration pour les bases créées avant l'ajout du reverse proxy.
        if not _column_exists(conn, "projects", "exposed"):
            conn.execute("ALTER TABLE projects ADD COLUMN exposed INTEGER NOT NULL DEFAULT 0")
        conn.commit()


def get_exposed_target() -> tuple[str, int] | None:
    """Retourne (host, port) du projet actuellement exposé publiquement, ou None.

    Un projet n'est un candidat valide que s'il est à la fois marqué `exposed`
    ET réellement en cours d'exécution (`status = 'running'`) — s'il a planté ou
    a été arrêté, le proxy ne doit pas router vers un port mort silencieusement.
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT port FROM projects WHERE exposed = 1 AND status = 'running' LIMIT 1"
        ).fetchone()
    if not row:
        return None
    return ("127.0.0.1", row["port"])


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
