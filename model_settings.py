"""Local-only model settings for the council's existing provider adapter."""

import json
import os
import threading
import uuid
from http import HTTPStatus
from tempfile import NamedTemporaryFile

import council


PUBLIC_FIELDS = ("provider_id", "protocol", "endpoint", "model", "auth_type", "output_mode",
                 "system_role", "token_parameter", "thinking")
FORM_FIELDS = ("provider_id", "endpoint", "model", "auth_type", "output_mode", "api_key")
settings_lock = threading.Lock()


class SettingsError(ValueError):
    def __init__(self, message, status=HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


def _adapter():
    if council.model_config is None or council.provider is None:
        raise SettingsError("找不到模型连接组件，请检查游戏目录中的 model_config.py 和 provider.py。",
                            HTTPStatus.SERVICE_UNAVAILABLE)
    return council.model_config


def _current():
    adapter = _adapter()
    try:
        return council._config()
    except adapter.ConfigError:
        return None


def _public(config):
    return {key: config[key] for key in PUBLIC_FIELDS}


def _summary(config):
    adapter = _adapter()
    try:
        catalog = json.loads((adapter.ROOT / "config/model_presets.json").read_text(encoding="utf-8"))
        presets = {name: {**_public(adapter.normalize_config({"provider_id": name})), "label": item["label"]}
                   for name, item in catalog.items()}
    except (OSError, KeyError, ValueError) as error:
        raise SettingsError("无法读取模型服务预设。", HTTPStatus.SERVICE_UNAVAILABLE) from error
    return {"configured": config is not None, "has_api_key": bool(config and config["api_key"]),
            "config": _public(config) if config else _public(presets["openai_compatible"]), "presets": presets}


def read():
    return _summary(_current())


def _draft(data):
    if set(data).difference(FORM_FIELDS) or any(not isinstance(value, str) for value in data.values()):
        raise SettingsError("请检查模型配置字段。")
    fields = {key: value.strip() for key, value in data.items()}
    provider_id = fields.get("provider_id")
    if not provider_id or not fields.get("endpoint") or not fields.get("model"):
        raise SettingsError("请填写服务商、完整接口地址和模型名称。")
    adapter = _adapter()
    current = _current()
    same_provider = current is not None and current["provider_id"] == provider_id
    try:
        config = adapter.normalize_config({**(current if same_provider else {}), **fields})
        reuse_key = (same_provider and current["endpoint"] == config["endpoint"]
                     and current["auth_type"] == config["auth_type"])
        config["api_key"] = fields.get("api_key") or (current["api_key"] if reuse_key else "")
        if config["auth_type"] == "none":
            config["api_key"] = ""
        elif not config["api_key"]:
            raise SettingsError("请输入此接口的 API 密钥。更换服务商、地址或认证方式后需重新填写。")
        adapter.validate_config(config)
    except SettingsError:
        raise
    except adapter.ConfigError as error:
        messages = {
            "Unsupported provider configuration.": "请选择可用的服务商。",
            "Invalid provider endpoint.": "请填写完整的模型请求地址，包括接口路径。",
            "Invalid provider port.": "模型服务端口无效。",
            "MiniMax preset requires an official endpoint.": "MiniMax 预设需要使用官方接口地址。",
            "Remote providers require HTTPS.": "远程模型服务需要使用 HTTPS 地址。",
            "Anonymous providers must use loopback.": "免密钥认证仅适用于本机模型服务。",
            "Model ID is missing or invalid.": "请检查模型名称，长度应在 1 到 128 个字符之间。",
            "Invalid provider credential.": "请检查 API 密钥，密钥须为单行文本。",
        }
        raise SettingsError(messages.get(str(error), "请检查接口协议、认证方式和模型选项。")) from None
    except ValueError:
        raise SettingsError("模型接口地址无效。") from None
    return config


def save(data):
    with settings_lock:
        config = _draft(data)
        config["revision"] = uuid.uuid4().hex
        path = council.ROOT / ".private" / "model.json"
        temporary = None
        try:
            path.parent.mkdir(mode=0o700, exist_ok=True)
            with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
                temporary = stream.name
                json.dump(config, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
            os.replace(temporary, path)
            temporary = None
        except OSError:
            raise SettingsError("无法写入游戏的本地模型配置，请检查 .private 目录权限。",
                                HTTPStatus.INTERNAL_SERVER_ERROR) from None
        finally:
            if temporary:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass
        return _summary(config)


def test(data):
    config = _draft(data)
    try:
        response = council.provider.complete("请回复 OK。", [{"role": "user", "content": "连接测试"}],
                                             timeout=18, max_tokens=256, config=config)
    except council.provider.ProviderError as error:
        reason = council.provider.safe_error(error)
        raise SettingsError(f"连接测试失败（{reason}）。请核对接口地址、模型名称和认证信息。",
                            HTTPStatus.BAD_GATEWAY) from None
    return {"ok": True, "model": config["model"], "seconds": response["seconds"]}
