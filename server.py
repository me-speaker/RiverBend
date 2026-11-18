"""Local city simulation server. Run python server.py --open to play."""

import argparse
import json
import mimetypes
import threading
import uuid
import webbrowser
from collections import OrderedDict
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import council
import game
import model_settings


@dataclass
class Session:
    state: dict = field(default_factory=game.new_game)
    revision: int = 0
    offered: set = field(default_factory=set)


class RequestError(ValueError):
    def __init__(self, message, status=HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


sessions = OrderedDict()
lock = threading.RLock()
ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {"index.html", "style.css", "app.js", "river-map.js",
                "vendor/three.module.min.js", "vendor/three.LICENSE"}


def static_file(url_path):
    name = unquote(url_path).removeprefix("/") or "index.html"
    if name not in PUBLIC_FILES and not name.startswith("assets/"):
        return None
    # Restrict asset lookup to the artwork folder, including on Windows.
    if any(part in {"", ".", ".."} for part in name.split("/")) or any(c in name for c in "\\:\x00"):
        return None
    path = (ROOT / name).resolve()
    boundary = ROOT / "assets" if name.startswith("assets/") else ROOT
    if path.is_relative_to(boundary) and path.is_file():
        return path
    return None


def public_state(game_id, session):
    return {**game.view(session.state), "game_id": game_id, "revision": session.revision}


def lookup(game_id, revision=None):
    if not isinstance(game_id, str) or game_id not in sessions:
        raise RequestError("这局游戏已过期，请重新开局。", HTTPStatus.NOT_FOUND)
    session = sessions[game_id]
    sessions.move_to_end(game_id)
    if revision is not None and session.revision != revision:
        raise RequestError("这份计划属于此前的回合，请刷新当前城市。", HTTPStatus.CONFLICT)
    return session


def dispatch(path, data):
    if path == "/api/model-config":
        return model_settings.save(data)
    if path == "/api/model-config/test":
        return model_settings.test(data)
    if path == "/api/new":
        with lock:
            if len(sessions) >= 128:
                sessions.popitem(last=False)
            game_id = uuid.uuid4().hex
            session = sessions[game_id] = Session()
            return {"state": public_state(game_id, session), "model_available": council.model_available()}

    if path not in ("/api/forecast", "/api/advance", "/api/council"):
        raise RequestError("没有这个接口。", HTTPStatus.NOT_FOUND)
    game_id = data.get("game_id")
    revision = data.get("revision")
    if type(revision) is not int:
        raise RequestError("缺少有效的回合版本。")
    workers, build, offer = (data.get(key) for key in ("workers", "build", "offer"))
    if (not isinstance(workers, dict) or set(workers) != {"farm", "wood", "trade"}
            or any(type(count) is not int or count < 0 for count in workers.values())):
        raise RequestError("请检查三个行业的劳力人数。")
    if any(value is not None and not isinstance(value, str) for value in (build, offer)):
        raise RequestError("无法识别工地或议案。")
    with lock:
        session = lookup(game_id, revision)
        if offer is not None and offer not in session.offered:
            raise RequestError("请先向议会征询本季议案。")
        if path == "/api/forecast":
            return {"forecast": game.forecast(session.state, workers, build, offer)}
        if path == "/api/advance":
            session.state = game.advance(session.state, workers, build, offer)
            session.revision += 1
            session.offered.clear()
            return {"state": public_state(game_id, session)}
        intent, mode = data.get("intent", ""), data.get("mode", "local")
        if not isinstance(intent, str) or len(intent) > 500 or mode not in ("model", "local"):
            raise RequestError("请使用有效议会模式，并把施政意图控制在 500 字以内。")
        city = public_state(game_id, session)
        if city["status"] != "playing":
            raise RequestError("本局已经结束。")
        # A proposal can fund the planned build, so validate staffing separately.
        if sum(workers.values()) > city["population"]:
            raise RequestError("分配人数超过当前人口。")
        if build is not None and not any(t["id"] == build for t in city["tiles"]):
            raise RequestError("无法识别选定的工地。")
        options = []
        city["offer_forecasts"] = {}
        for option in [None, *game.council_options(session.state)]:
            option_id = option["id"] if option else None
            try:
                projection = game.forecast(session.state, workers, build, option_id)
            except ValueError:
                continue
            outcome = {k: projection[k] for k in ("resources", "delta", "status")}
            if option is None:
                city["plan_forecast"] = outcome
            else:
                options.append(option)
                city["offer_forecasts"][option_id] = outcome
    if not options:
        raise RequestError("没有能与当前建设计划同时执行的议案。请调整工地后再征询。")
    # A model call must never hold the turn lock or prevent play in another tab.
    reply = council.recommend(city, options, intent.strip(), mode, workers, build)
    with lock:
        session = lookup(game_id, revision)
        session.offered.add(reply["offer"]["id"])
    return reply


class Handler(BaseHTTPRequestHandler):
    def local_origin(self):
        port = self.server.server_port
        hosts = {"localhost", "127.0.0.1", "[::1]"}
        allowed = {f"{host}:{port}" for host in hosts}
        if port == 80:
            allowed.update(hosts)
        host = self.headers.get("Host", "").lower()
        if host not in allowed:
            raise RequestError("请通过本机游戏地址访问。", HTTPStatus.FORBIDDEN)
        origin = self.headers.get("Origin")
        if origin is not None and origin.lower() != "http://" + host:
            raise RequestError("请求来源与游戏地址不同。", HTTPStatus.FORBIDDEN)

    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_GET(self):
        try:
            self.local_origin()
        except RequestError as error:
            self.respond(error.status, {"error": str(error)})
            return
        url = urlsplit(self.path)
        if url.path == "/api/model-config":
            try:
                self.respond(200, model_settings.read())
            except model_settings.SettingsError as error:
                self.respond(error.status, {"error": str(error)})
        elif url.path == "/api/state":
            try:
                game_id = parse_qs(url.query).get("game_id", [None])[0]
                with lock:
                    state = public_state(game_id, lookup(game_id))
                self.respond(200, {"state": state, "model_available": council.model_available()})
            except RequestError as error:
                self.respond(error.status, {"error": str(error)})
        else:
            path = static_file(url.path)
            if path is None:
                self.respond(404, {"error": "页面不存在。"})
                return
            content_type = {".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                            ".LICENSE": "text/plain"}.get(path.suffix)
            if content_type:
                content_type += "; charset=utf-8"
            else:
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.respond(200, path.read_bytes(), content_type)

    def do_POST(self):
        try:
            self.local_origin()
            if self.headers.get_content_type() != "application/json":
                raise RequestError("请求应使用 JSON。", HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8192:
                raise RequestError("请求长度无效。")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise RequestError("请求格式无效。")
            self.respond(200, dispatch(urlsplit(self.path).path, data))
        except (RequestError, model_settings.SettingsError) as error:
            self.respond(error.status, {"error": str(error)})
        except ValueError as error:
            self.respond(400, {"error": str(error)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(url, flush=True)
        if args.open:
            webbrowser.open(url)
        server.serve_forever()


if __name__ == "__main__":
    main()
