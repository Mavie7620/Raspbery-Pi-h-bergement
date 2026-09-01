from typing import Optional

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(..., description="Nom unique du projet, ex: mon-site")
    repo_url: str = Field(..., description="URL du repo GitHub, ex: https://github.com/user/repo.git")
    branch: str = Field("main", description="Branche à déployer")
    start_command: str = Field(..., description="Commande pour lancer le projet, ex: 'python3 main.py' ou 'npm start'")
    port: int = Field(..., description="Port sur lequel le projet doit écouter")
    autoupdate: bool = Field(True, description="Activer la mise à jour automatique via polling")
    env_vars: dict[str, str] = Field(default_factory=dict, description="Variables d'environnement initiales")


class EnvVarsUpdate(BaseModel):
    env_vars: dict[str, str]


class ProjectOut(BaseModel):
    id: int
    name: str
    repo_url: str
    branch: str
    start_command: str
    port: int
    path: str
    pid: Optional[int]
    status: str
    last_commit: Optional[str]
    autoupdate: bool
    env_vars: dict[str, str]
