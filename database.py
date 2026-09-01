import sqlite3
from contextlib import contextmanager

from app.config import DB_PATH


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
                env_vars TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        conn.commit()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
