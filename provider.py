"""Bounded Anthropic Messages / OpenAI Chat Completions transports."""
from __future__ import annotations
import json
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from model_config import ROOT, ConfigError, load_config as _load_config, normalize_config, validate_config, MINIMAX_ENDPOINTS

ALLOWED_ENDPOINTS = MINIMAX_ENDPOINTS

class ProviderError(Exception):
    pass

def safe_error(exc: Exception) -> str:
    message = str(exc)
    if re.fullmatch(r"(?:MiniMax|Provider) HTTP [0-9]{3}", message): return message
    allowed = {f"{name} {reason}" for name in ("MiniMax", "Provider") for reason in
               ("request failed or timed out.", "returned no usable text.", "output was truncated.")}
    allowed.update({"Provider response exceeds size limit.", "Provider redirect rejected.", "Provider configuration is invalid."})
    return message if message in allowed else "Provider processing failed."

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProviderError("Provider redirect rejected.")

def load_config() -> dict:
    try: return _load_config()
    except ConfigError: raise ProviderError("Provider configuration is invalid.") from None

def _payload(config, system, messages, max_tokens, output_schema):
    tool = {"name": "submit_strategy", "description": "Submit the complete executable strategy and concise explanation."}
    use_tools = output_schema is not None and config["output_mode"] == "tools"
    if output_schema is not None and not use_tools:
        system += "\nNo tool is available. Return ONLY one JSON object matching this schema, without Markdown:\n" + json.dumps(output_schema, ensure_ascii=False)
    if config["protocol"] == "anthropic":
        body = {"model": config["model"], "system": system, "messages": messages, "max_tokens": max_tokens}
        if config["thinking"]: body["thinking"] = {"type": "adaptive"}
        if use_tools:
            body["tools"] = [{**tool, "input_schema": output_schema}]
            body["tool_choice"] = {"type": "auto"}
    else:
        body = {"model": config["model"], "messages": [{"role": config["system_role"], "content": system}, *messages],
                config["token_parameter"]: max_tokens, "stream": False}
        if use_tools:
            body["tools"] = [{"type": "function", "function": {**tool, "parameters": output_schema}}]
            body["tool_choice"] = "auto"
    return body

def _text(content):
    if isinstance(content, str): return content
    if isinstance(content, list):
        return "".join(part["text"] for part in content if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str))
    return ""

def _extract(config, data, output_schema, label):
    if not isinstance(data, dict): raise ProviderError(f"{label} returned no usable text.")
    if config["protocol"] == "anthropic":
        if data.get("stop_reason") == "max_tokens": raise ProviderError(f"{label} output was truncated.")
        content = data.get("content", [])
        if not isinstance(content, list): raise ProviderError(f"{label} returned no usable text.")
        text = _text(content)
        if output_schema is not None:
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "submit_strategy" and isinstance(block.get("input"), dict):
                    text = json.dumps(block["input"], ensure_ascii=False)
                    break
        raw_usage = data.get("usage") or {}
        usage = {key: raw_usage[key] for key in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens") if isinstance(raw_usage, dict) and key in raw_usage}
    else:
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict): raise ProviderError(f"{label} returned no usable text.")
        choice = choices[0]
        if choice.get("finish_reason") == "length": raise ProviderError(f"{label} output was truncated.")
        message = choice.get("message") or {}
        if not isinstance(message, dict): raise ProviderError(f"{label} returned no usable text.")
        text = _text(message.get("content"))
        if output_schema is not None:
            calls = message.get("tool_calls") or []
            for call in calls if isinstance(calls, list) else []:
                function = call.get("function", {}) if isinstance(call, dict) else {}
                if isinstance(function, dict) and function.get("name") == "submit_strategy":
                    arguments = function.get("arguments")
                    text = json.dumps(arguments, ensure_ascii=False) if isinstance(arguments, dict) else arguments if isinstance(arguments, str) else ""
                    break
        raw_usage = data.get("usage") or {}
        usage = {target: raw_usage[source] for source, target in (("prompt_tokens", "input_tokens"), ("completion_tokens", "output_tokens")) if isinstance(raw_usage, dict) and source in raw_usage}
        cached = raw_usage.get("prompt_tokens_details") if isinstance(raw_usage, dict) else None
        if isinstance(cached, dict) and "cached_tokens" in cached: usage["cache_read_input_tokens"] = cached["cached_tokens"]
    if not text.strip(): raise ProviderError(f"{label} returned no usable text.")
    # Thinking/reasoning blocks and arbitrary provider metadata never leave the adapter.
    return text, usage

def complete(system: str, messages: list, timeout: float = 25, max_tokens: int = 4096, output_schema=None, *, config=None) -> dict:
    try: config = load_config() if config is None else validate_config(normalize_config(config))
    except (ConfigError, TypeError, KeyError): raise ProviderError("Provider configuration is invalid.") from None
    label = "MiniMax" if config["provider_id"] == "minimax" else "Provider"
    body = _payload(config, system, messages, max_tokens, output_schema)
    headers = {"Content-Type": "application/json"}
    if config["auth_type"] == "bearer": headers["Authorization"] = "Bearer " + config["api_key"]
    elif config["auth_type"] == "x-api-key": headers["x-api-key"] = config["api_key"]
    if config["protocol"] == "anthropic": headers["anthropic-version"] = "2023-06-01"
    req = urllib.request.Request(config["endpoint"], json.dumps(body).encode(), headers, method="POST")
    start = time.monotonic()
    try:
        handlers = [NoRedirect]
        if urlsplit(config["endpoint"]).hostname in ("localhost", "127.0.0.1", "::1"):
            handlers.append(urllib.request.ProxyHandler({}))
        with urllib.request.build_opener(*handlers).open(req, timeout=timeout) as response:
            raw = response.read(1_048_577)
        if len(raw) > 1_048_576: raise ProviderError("Provider response exceeds size limit.")
        data = json.loads(raw)
    except urllib.error.HTTPError as exc:
        raise ProviderError(f"{label} HTTP {exc.code}") from None
    except (TimeoutError, OSError, ValueError):
        raise ProviderError(f"{label} request failed or timed out.") from None
    text, usage = _extract(config, data, output_schema, label)
    reported_model = data.get("model")
    return {"text": text, "model": reported_model if isinstance(reported_model, str) else config["model"],
            "usage": usage, "seconds": round(time.monotonic() - start, 3)}

if __name__ == "__main__":
    try:
        result = complete("Reply with the single word OK.", [{"role": "user", "content": "Connection test."}], 30, 256)
        print(json.dumps({"ok": True, "model": result["model"], "seconds": result["seconds"], "usage": result["usage"], "answered": "OK" in result["text"]}))
    except ProviderError as exc:
        print(json.dumps({"ok": False, "error": safe_error(exc)}))
        raise SystemExit(1)
