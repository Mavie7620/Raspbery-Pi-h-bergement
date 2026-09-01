import os
import signal
import subprocess
import shlex

from app.config import APPS_DIR, LOGS_DIR


class DeployError(Exception):
    pass


def project_path(name: str) -> str:
    return os.path.join(APPS_DIR, name)


def log_path(name: str) -> str:
    return os.path.join(LOGS_DIR, f"{name}.log")


def run(cmd: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)

    if result.returncode != 0:
        raise DeployError(
            f"Commande échouée: {' '.join(cmd)}\n{result.stderr}"
        )

    return result


def clone_repo(repo_url: str, branch: str, name: str) -> str:
    path = project_path(name)

    if not os.path.exists(path):
        run(
            [
                "git",
                "clone",
                "--branch",
                branch,
                "--single-branch",
                repo_url,
                path,
            ]
        )

    return path


def pull_latest(path: str, branch: str):
    run(["git", "fetch", "origin", branch], cwd=path)
    run(["git", "reset", "--hard", f"origin/{branch}"], cwd=path)


def get_local_commit(path: str) -> str:
    result = run(["git", "rev-parse", "HEAD"], cwd=path)
    return result.stdout.strip()


def get_remote_commit(path: str, branch: str) -> str:
    result = run(["git", "ls-remote", "origin", branch], cwd=path)

    return result.stdout.split()[0] if result.stdout else ""


def install_dependencies(path: str):
    """Détection basique du type de projet et installation des dépendances."""

    if os.path.exists(os.path.join(path, "requirements.txt")):
        run(
            [
                "pip3",
                "install",
                "--break-system-packages",
                "-r",
                "requirements.txt",
            ],
            cwd=path,
        )

    elif os.path.exists(os.path.join(path, "package.json")):
        run(["npm", "install"], cwd=path)


def is_running(pid: int | None) -> bool:
    if not pid:
        return False

    try:
        os.kill(pid, 0)
        return True

    except (OSError, ProcessLookupError):
        return False


def stop_process(pid: int | None):
    """
    Arrête le processus et son groupe de processus.

    Comme les applications peuvent lancer plusieurs processus enfants,
    on utilise le groupe créé avec os.setsid().
    """

    if not pid or not is_running(pid):
        return

    try:
        # PID = leader du groupe grâce à os.setsid()
        os.killpg(os.getpgid(pid), signal.SIGTERM)

    except (ProcessLookupError, OSError):
        pass


def start_process(
    name: str,
    path: str,
    start_command: str,
    port: int,
    env_vars: dict[str, str] | None = None,
) -> int:
    """
    Lance le projet en arrière-plan.

    Le processus lancé devient le leader de son propre groupe.
    Le PID retourné correspond au processus lancé par Popen.
    """

    os.makedirs(LOGS_DIR, exist_ok=True)

    log_file = open(
        log_path(name),
        "a",
        buffering=1,
        encoding="utf-8",
    )

    env = os.environ.copy()
    env["PORT"] = str(port)

    if env_vars:
        env.update(env_vars)

    # On utilise bash pour conserver la possibilité d'avoir
    # des commandes complexes définies par l'utilisateur.
    command = start_command

    process = subprocess.Popen(
        command,
        shell=True,
        executable="/bin/bash",
        cwd=path,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )

    return process.pid