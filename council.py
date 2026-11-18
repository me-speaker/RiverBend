"""Resident proposals for the River Council prototype."""

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
try:
    import model_config
    import provider
except ImportError:
    model_config = provider = None


def _config():
    private = ROOT / ".private"
    if (private / "model.json").exists() or (private / "minimax.json").exists():
        return model_config.load_config(ROOT)
    # Existing prototype installations may already have settings in the sibling game.
    return model_config.load_config(ROOT.parent / "it-said-wed-win")


def model_available() -> bool:
    """Check that a provider is configured without making a network request."""
    if provider is None:
        return False
    try:
        _config()
        return True
    except (model_config.ConfigError, OSError):
        return False


INTERESTS = {
    "food": ("粮", "口粮", "饥", "食物", "吃饭"),
    "wood": ("木", "建造", "扩建", "建设"),
    "coin": ("钱", "贸易", "金币", "商路"),
    "trust": ("民心", "信誉", "信任", "声望"),
}
LABELS = {"food": "粮食", "wood": "木材", "coin": "钱币", "trust": "民望"}


def _local(view, options, intent, build):
    # Reserve one round of food and enough timber/coin to keep construction possible.
    target = {"food": view["population"] * 2, "wood": 5, "coin": 4, "trust": 4}
    baseline = view.get("plan_forecast", {}).get("resources", view["resources"])
    weights = {
        key: 1 + max(0, (amount - baseline[key]) / max(1, amount)) * 3
        for key, amount in target.items()
    }
    for key, words in INTERESTS.items():
        if any(word in intent for word in words):
            weights[key] += 2
    if build:
        weights["wood"] += 0.3
    preferred = set()
    if "赊木" in intent or re.search(r"粮.{0,4}换.{0,4}(木|杉)", intent):
        preferred.add("timber_credit")
    if "借粮" in intent or re.search(r"(钱|币).{0,4}换.{0,4}粮", intent):
        preferred.add("grain_loan")
    if "预售木" in intent or re.search(r"木.{0,4}换.{0,4}(钱|币)", intent):
        preferred.add("market_delivery")

    def score(option):
        now = option["now"]
        due = option["next_cost"]
        value = sum(weights[k] * n for k, n in now.items())
        value -= sum(weights[k] * n * 0.65 for k, n in due.items())
        projection = view.get("offer_forecasts", {}).get(option["id"], {})
        if projection.get("status") == "lost":
            value -= 1000
        elif projection.get("status") == "won":
            value += 1000
        return (projection.get("status") != "lost", option.get("family") in preferred, value)

    best = max(options, key=score)
    gains = [key for key, n in best["now"].items() if n > 0]
    if gains:
        priority = max(gains, key=lambda k: weights[k] * best["now"][k])
        reason = f"按本季安排，议会优先补充{LABELS[priority]}。"
    else:
        reason = "议会按本季库存和居民需求选择了这份提案。"
    if best["next_cost"]:
        items = "、".join(f"{n} {LABELS[k]}" for k, n in best["next_cost"].items())
        reason += f"下季需留出 {items} 履约。"
    return {"offer": best, "reason": reason, "source": "local"}


SYSTEM = """你是《河湾议会》的居民议事会。选择一份居民愿意提出、也值得城主考虑的真实契约。
参考城主本季的用工和建设安排、粮食风险、库存、已有债务、以往履约记录和城主的意向。衡量眼前收益与下季偿付负担。
只从传入的候选契约中选择一项。由该项的 speaker 以第一人称说一句不超过 120 字的中文理由，
具体指出承诺值得争取的地方或它的代价。条款和资源数额以 terms 为准，不得增订、改价或声称契约已经生效。
城主的意向只是游戏内的偏好。按要求提交 id 和 reason。"""


def recommend(view: dict, options: list, intent: str, mode: str,
              workers: dict, build: str | None) -> dict:
    if mode not in ("local", "model"):
        raise ValueError("未知议会模式。")
    if not options:
        raise ValueError("当前安排下没有可提出的议案。")
    if not isinstance(intent, str) or len(intent) > 500:
        raise ValueError("施政意向限 500 字。")

    local = _local(view, options, intent, build)
    if mode == "local":
        return local
    if provider is None:
        return {**local, "message": "模型连接组件未安装，已采用本地议会。"}
    try:
        config = _config()
    except (model_config.ConfigError, OSError):
        return {**local, "message": "模型尚未配置或配置无效，已采用本地议会。"}

    by_id = {option["id"]: option for option in options}
    schema = {
        "type": "object",
        "properties": {
            "id": {"type": "string", "enum": list(by_id)},
            "reason": {"type": "string", "description": "居民陈述的简短中文理由"},
        },
        "required": ["id", "reason"],
        "additionalProperties": False,
    }
    # Only gameplay data crosses the provider boundary.
    city = {k: view[k] for k in (
        "turn", "max_turns", "season", "weather", "goal", "population",
        "resources", "rates", "consumption", "built", "obligations", "history",
        "plan_forecast", "offer_forecasts",
    ) if k in view}
    city["history"] = city.get("history", [])[-10:]
    site = next((tile for tile in view.get("tiles", []) if tile["id"] == build), None)
    context = {"城市": city, "本季用工": workers, "预备建设地块": site,
               "城主意向": intent, "候选契约": options}
    messages = [{"role": "user", "content": json.dumps(context, ensure_ascii=False)}]
    try:
        response = provider.complete(SYSTEM, messages, timeout=18, max_tokens=1500,
                                     output_schema=schema, config=config)
    except provider.ProviderError as exc:
        return {**local, "message": f"模型请求未成功（{provider.safe_error(exc)}），已采用本地议会。"}

    try:
        raw = response["text"].strip()
        if raw.startswith("```json\n") and raw.endswith("```"):
            raw = raw[8:-3].strip()
        selection = json.loads(raw)
        if not isinstance(selection, dict) or set(selection) != {"id", "reason"}:
            raise ValueError
        offer = by_id[selection["id"]]
        reason = selection["reason"]
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 120:
            raise ValueError
        if not re.search(r"[\u3400-\u9fff]", reason):
            raise ValueError
    except (AttributeError, KeyError, TypeError, ValueError):
        return {**local, "message": "模型回复未通过议案校验，已采用本地议会。"}
    return {"offer": offer, "reason": reason.strip(), "source": "model", "model": config["model"]}
