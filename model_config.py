"""Private model configuration shared by the local launcher and transports."""
from __future__ import annotations
import json
import hashlib
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC_FIELDS = ("provider_id", "protocol", "endpoint", "model", "auth_type", "token_parameter", "thinking", "system_role", "output_mode", "revision")
MINIMAX_ENDPOINTS = {
    "https://api.minimaxi.com/anthropic/v1/messages",
    "https://api.minimax.cn/anthropic/v1/messages",
    "https://api.minimax.io/anthropic/v1/messages",
}

class ConfigError(ValueError):
    pass

def normalize_config(value: dict) -> dict:
    presets = json.loads((ROOT / "config/model_presets.json").read_text(encoding="utf-8"))
    if not isinstance(value, dict): raise ConfigError("Invalid model configuration.")
    identifier = value.get("provider_id", "minimax")
    if not isinstance(identifier, str) or identifier not in presets: raise ConfigError("Unsupported provider configuration.")
    defaults = presets[identifier]
    return {"provider_id": identifier, "revision": value.get("revision", "legacy"), "api_key": value.get("api_key", ""),
            **{key: value.get(key, defaults.get(key, "system" if key == "system_role" else "tools" if key == "output_mode" else ""))
               for key in ("protocol", "endpoint", "model", "auth_type", "token_parameter", "thinking", "system_role", "output_mode")}}

def validate_config(config: dict, require_key: bool = True) -> dict:
    if config["protocol"] not in ("openai", "anthropic"): raise ConfigError("Unsupported API protocol.")
    if not isinstance(config["endpoint"], str): raise ConfigError("Invalid provider endpoint.")
    url = urlsplit(config["endpoint"])
    try: url.port
    except ValueError: raise ConfigError("Invalid provider port.") from None
    local = url.hostname in ("localhost", "127.0.0.1", "::1")
    if (url.scheme not in ("http", "https") or not url.hostname or not url.path or url.path == "/"
        or url.username or url.password or url.query or url.fragment or any(c.isspace() for c in config["endpoint"])):
        raise ConfigError("Invalid provider endpoint.")
    if url.scheme != "https" and not local: raise ConfigError("Remote providers require HTTPS.")
    if config["provider_id"] == "minimax" and config["endpoint"] not in MINIMAX_ENDPOINTS:
        raise ConfigError("MiniMax preset requires an official endpoint.")
    if not isinstance(config["model"], str) or not config["model"].strip() or len(config["model"]) > 128 or any(c in config["model"] for c in "\r\n"):
        raise ConfigError("Model ID is missing or invalid.")
    if config["auth_type"] not in ("bearer", "x-api-key", "none") or config["token_parameter"] not in ("max_tokens", "max_completion_tokens"):
        raise ConfigError("Unsupported provider parameters.")
    if config["auth_type"] == "none" and not local: raise ConfigError("Anonymous providers must use loopback.")
    if config["protocol"] == "anthropic" and config["token_parameter"] != "max_tokens": raise ConfigError("Messages API requires max_tokens.")
    if not isinstance(config["thinking"], bool) or config["system_role"] not in ("system", "developer") or config["output_mode"] not in ("tools", "json"):
        raise ConfigError("Invalid provider options.")
    key = config["api_key"]
    if not isinstance(key, str) or any(c in key for c in "\r\n"): raise ConfigError("Invalid provider credential.")
    if require_key and config["auth_type"] != "none" and not key.strip(): raise ConfigError("Provider credential is missing.")
    if not isinstance(config["revision"], str): raise ConfigError("Invalid configuration revision.")
    return config

def load_config(root: Path | None = None) -> dict:
    base = ROOT if root is None else root
    path = base / ".private/model.json"
    if not path.exists(): path = base / ".private/minimax.json"
    try: return validate_config(normalize_config(json.loads(path.read_text(encoding="utf-8"))))
    except (OSError, ValueError, TypeError, KeyError):
        raise ConfigError("Model configuration is unavailable or invalid.") from None

def public_config(config: dict) -> dict:
    result = {field: config[field] for field in PUBLIC_FIELDS}
    result["revision"] = hashlib.sha256((config["revision"] + "\n" + config["api_key"]).encode("utf-8")).hexdigest()
    return result
