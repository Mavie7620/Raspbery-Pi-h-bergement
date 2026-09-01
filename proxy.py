"""Reverse proxy public de Pi PaaS.

C'est un processus totalement SÉPARÉ de l'API d'admin (app.main). Il écoute sur
PROXY_PORT (80 par défaut — le port que tu donnes à ngrok) et relaie chaque
connexion TCP brute vers 127.0.0.1:<port> du projet actuellement marqué comme
"exposé" en base. C'est un passthrough au niveau TCP (pas un vrai reverse proxy
HTTP) : aucun parsing HTTP, aucune réécriture de headers/Host, donc ça marche
avec n'importe quel protocole applicatif tant qu'un seul projet est exposé à la
fois.

L'API d'admin (port 8000) ne tourne PAS ici et n'est jamais servie sur ce port :
c'est ce qui garde le dashboard/l'API invisibles pour les visiteurs qui arrivent
via ngrok -> port 80.

Lancement :
    python3 -m app.proxy

Le port 80 nécessite les droits root (ou CAP_NET_BIND_SERVICE) sur Linux — voir
le README pour le service systemd dédié (pi-paas-proxy.service).
"""

import asyncio
import logging

from app.config import PROXY_PORT
from app.database import get_exposed_target

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pi-paas.proxy")

BUFFER_SIZE = 65536


def _http_response(status: str, body: str) -> bytes:
    body_bytes = body.encode("utf-8")
    headers = (
        f"HTTP/1.1 {status}\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        f"Content-Length: {len(body_bytes)}\r\n"
        "Connection: close\r\n\r\n"
    )
    return headers.encode("utf-8") + body_bytes


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(BUFFER_SIZE)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError):
        pass
    finally:
        try:
            writer.close()
        except OSError:
            pass


async def handle_client(
    client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter
) -> None:
    peer = client_writer.get_extra_info("peername")

    # get_exposed_target() fait une petite requête SQLite synchrone — c'est
    # volontairement simple pour une v1 sur Pi ; à déplacer dans un executor
    # si le volume de connexions devient significatif.
    target = get_exposed_target()

    if target is None:
        client_writer.write(
            _http_response("503 Service Unavailable", "Aucun projet n'est actuellement exposé sur ce Pi.")
        )
        await client_writer.drain()
        client_writer.close()
        return

    host, port = target
    try:
        remote_reader, remote_writer = await asyncio.open_connection(host, port)
    except OSError:
        logger.warning("Projet exposé injoignable sur %s:%s", host, port)
        client_writer.write(
            _http_response("502 Bad Gateway", "Le projet exposé ne répond pas actuellement.")
        )
        await client_writer.drain()
        client_writer.close()
        return

    logger.info("Connexion %s relayée vers %s:%s", peer, host, port)

    await asyncio.gather(
        _pipe(client_reader, remote_writer),
        _pipe(remote_reader, client_writer),
        return_exceptions=True,
    )


async def main() -> None:
    server = await asyncio.start_server(handle_client, "0.0.0.0", PROXY_PORT)
    logger.info("Proxy public Pi PaaS en écoute sur le port %s", PROXY_PORT)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
