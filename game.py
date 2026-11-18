"""Deterministic eight-season settlement. The council can offer contracts; only this module settles them."""

from copy import deepcopy


SEASONS = (
    ("初春", "春水回暖", 3), ("盛夏", "河水丰沛", 4),
    ("金秋", "谷物成熟", 5), ("严冬", "霜冻封田", 1),
    ("初春", "融雪开河", 3), ("盛夏", "旱风过境", 3),
    ("金秋", "丰收在望", 5), ("严冬", "寒潮封河", 1),
)
GOAL = "第 8 季结算后，拥有至少 3 处新设施、8 粮食和 4 民望。断粮或民望归零即告失败。"
RESOURCES = {"food": "粮食", "wood": "木材", "coin": "钱币", "trust": "民望"}
JOBS = ("farm", "wood", "trade")
IMPROVEMENTS = {
    "farm": ("灌渠", {"wood": 5, "coin": 3}, "每名农户每季多产 1 粮。"),
    "wood": ("木场", {"wood": 3, "coin": 4}, "每名伐木工每季多产 1 木。"),
    "trade": ("货栈", {"wood": 6, "coin": 2}, "每名商贩每季多得 1 币。"),
}
# Axial coordinates. The first four sites are established when play begins.
SITES = (
    ("hall", 0, 0, "议事厅", "town", True),
    ("old_field", -1, 0, "河畔田", "farm", True),
    ("old_woods", 1, -1, "老林场", "wood", True),
    ("old_quay", 0, 1, "渡口集", "trade", True),
    ("north_field", 0, -1, "桑树坪", "farm", False),
    ("east_forest", 1, 0, "东杉林", "wood", False),
    ("west_quay", -1, 1, "苇湾", "trade", False),
    ("upper_river", -1, -1, "青溪", "river", False),
    ("north_woods", 1, -2, "雾松坡", "wood", False),
    ("north_ridge", 2, -2, "鹰岭", "hill", False),
    ("upland", 0, -2, "梯田坡", "farm", False),
    ("backwoods", 2, 0, "白桦谷", "wood", False),
    ("west_ridge", -2, 0, "西岗", "hill", False),
    ("east_river", 2, -1, "分水口", "river", False),
    ("west_meadow", -2, 1, "芦草地", "farm", False),
    ("new_quay", 1, 1, "东河滩", "trade", False),
    ("south_river", -1, 2, "曲水", "river", False),
    ("south_quay", -2, 2, "下游湾", "trade", False),
    ("south_ridge", 0, 2, "石屏山", "hill", False),
)
# The three frontier sites cost less once adjoining infrastructure reaches them.
FRONTIER_COSTS = {
    "upland": {"wood": 3, "coin": 2},
    "backwoods": {"wood": 2, "coin": 2},
    "south_quay": {"wood": 3, "coin": 1},
}
AGREEMENTS = (
    ("grain_loan_small", "周转三袋粮", "粮商", {"food": 3}, {"coin": 2}),
    ("grain_loan", "借粮过季", "粮商", {"food": 7}, {"coin": 5}),
    ("grain_loan_large", "预借整船粮", "粮商", {"food": 12}, {"coin": 9}),
    ("timber_credit", "赊木筑城", "林户", {"wood": 5}, {"food": 6}),
    ("timber_credit_large", "赊运整批杉木", "林户", {"wood": 8}, {"food": 11}),
    ("market_delivery", "预售木料", "船主", {"coin": 5}, {"wood": 4}),
    ("public_meal", "开仓设粥", "乡老", {"food": -4, "trust": 1}, {}),
    ("work_party", "征召木工", "工头", {"wood": 2, "trust": -1}, {}),
    ("barter_day", "开一日市", "摊贩", {"coin": 1}, {}),
)


def new_game():
    return {
        "turn": 1, "population": 4, "resources": {"food": 11, "wood": 5, "coin": 4, "trust": 4},
        "workers": {"farm": 2, "wood": 1, "trade": 1}, "built_ids": [],
        "obligations": [], "history": [], "status": "playing", "result": "",
    }


def _describe(amounts, signed=False):
    return "、".join(f"{amount:+d} {RESOURCES[key]}" if signed else f"{amount} {RESOURCES[key]}"
                    for key, amount in amounts.items())


def council_options(state):
    if state["status"] != "playing":
        return []
    offers = []
    for identifier, title, speaker, now, due in AGREEMENTS:
        if due and state["turn"] == len(SEASONS):
            continue
        if any(state["resources"][key] + value < (1 if key == "trust" else 0)
               for key, value in now.items()):
            continue
        terms = f"当季{_describe(now, signed=True)}。"
        if due:
            terms += f"下季口粮结清后交付{_describe(due)}；履约得 1 民望，欠付失 2 民望。"
        family, _, suffix = identifier.rpartition("_")
        scale = suffix if suffix in {"large", "small"} else "standard"
        offers.append({"id": identifier, "family": family if scale != "standard" else identifier,
                       "scale": scale, "title": title, "speaker": speaker, "now": dict(now),
                       "next_cost": dict(due), "terms": terms})
    return offers


def _tiles(state):
    built = set(state["built_ids"])
    developed = [(q, r) for ident, q, r, _, _, old in SITES if old or ident in built]
    tiles = []
    for ident, q, r, name, kind, old in SITES:
        improved = old or ident in built
        adjacent = any(max(abs(q - aq), abs(r - ar), abs(q + r - aq - ar)) == 1
                       for aq, ar in developed)
        label, cost, benefit = IMPROVEMENTS.get(kind, ("", {}, ""))
        cost = FRONTIER_COSTS.get(ident, cost)
        buildable = bool(label and not improved and adjacent)
        if kind == "town":
            detail = "聚落中心，居民在此议事。"
        elif old:
            detail = {"farm": "基础农田，收成随季节变化。", "wood": "每名伐木工基础产出 2 木。",
                      "trade": "每名商贩基础收入 2 币。"}[kind]
        elif ident in built:
            detail = f"已建{label}。{benefit}"
        elif not label:
            detail = "此处是天然水道。" if kind == "river" else "山地陡峭，无法施工。"
        else:
            restriction = "" if adjacent else "须先开发相邻土地。"
            detail = f"{restriction}{label}需{_describe(cost)}。{benefit}"
        tiles.append({"id": ident, "q": q, "r": r, "name": name, "kind": kind, "improved": improved,
                      "buildable": buildable, "build_name": label, "build_cost": dict(cost), "detail": detail})
    return tiles


def view(state):
    season, weather, farm_rate = SEASONS[state["turn"] - 1]
    info = deepcopy({key: state[key] for key in
                     ("turn", "population", "resources", "workers", "history", "status", "result", "obligations")})
    tiles = _tiles(state)
    rates = {"farm": farm_rate, "wood": 2, "trade": 2}
    for tile in tiles:
        if tile["id"] in state["built_ids"]:
            rates[tile["kind"]] += 1
    return {**info, "max_turns": len(SEASONS), "goal": GOAL, "season": season, "weather": weather,
            "tiles": tiles, "built": len(state["built_ids"]), "rates": rates,
            "consumption": 2 * state["population"] + int(season == "严冬")}


def _validate_workers(state, workers):
    if (not isinstance(workers, dict) or set(workers) != set(JOBS)
            or any(type(number) is not int or number < 0 for number in workers.values())):
        raise ValueError("请为三项工种指定非负整数人数。")
    if sum(workers.values()) > state["population"]:
        raise ValueError("分配的人手超过本季人口。")


def _affordable(resources, cost):
    return all(resources[key] >= amount for key, amount in cost.items())


def _settle(state, workers, build, offer):
    if state["status"] != "playing":
        raise ValueError("本局已经结束。")
    _validate_workers(state, workers)
    updated = deepcopy(state)
    resources = updated["resources"]
    previous_debts = updated["obligations"]
    updated["obligations"] = []
    turn = state["turn"]
    events = []

    if offer is not None:
        agreement = next((item for item in council_options(state) if item["id"] == offer), None)
        if not agreement:
            raise ValueError("这项议案本季无法签订。")
        for key, amount in agreement["now"].items():
            resources[key] += amount
        events.append(f'签订「{agreement["title"]}」：{_describe(agreement["now"], True)}。')
        if agreement["next_cost"]:
            cost = agreement["next_cost"]
            updated["obligations"].append({"due": turn + 1, "cost": cost, "title": agreement["title"],
                                           "terms": f'第 {turn + 1} 季交付{_describe(cost)}（{agreement["title"]}）。'})

    if build is not None:
        tile = next((item for item in _tiles(state) if item["id"] == build and item["buildable"]), None)
        if not tile:
            raise ValueError("此地块当前无法施工。")
        if not _affordable(resources, tile["build_cost"]):
            raise ValueError(f'建{tile["build_name"]}需要{_describe(tile["build_cost"])}，开工款不足。')
        for key, amount in tile["build_cost"].items():
            resources[key] -= amount
        updated["built_ids"].append(build)
        events.append(f'在{tile["name"]}建成{tile["build_name"]}，支出{_describe(tile["build_cost"])}，本季投产。')

    plan = view(updated)
    production = {key: workers[job] * plan["rates"][job] for key, job in
                  (("food", "farm"), ("wood", "wood"), ("coin", "trade"))}
    for key, amount in production.items():
        resources[key] += amount
    resources["food"] -= plan["consumption"]
    events.append(f'产出{_describe(production)}；口粮消耗 {plan["consumption"]}。')
    for debt in previous_debts:
        if _affordable(resources, debt["cost"]):
            for key, amount in debt["cost"].items():
                resources[key] -= amount
            resources["trust"] += 1
            events.append(f'履行「{debt["title"]}」，交付{_describe(debt["cost"])}，民望 +1。')
        else:
            resources["trust"] = max(0, resources["trust"] - 2)
            events.append(f'「{debt["title"]}」欠付，契约终止，民望 −2。')

    if resources["food"] < 0 or resources["trust"] <= 0:
        if resources["food"] < 0:
            reason = f'口粮短缺 {-resources["food"]}，居民离散。'
            resources["food"] = 0
        else:
            reason = "民望归零，议会失去居民支持。"
        updated.update(status="lost", result=reason)
    elif turn == len(SEASONS):
        passed = len(updated["built_ids"]) >= 3 and resources["food"] >= 8 and resources["trust"] >= 4
        reason = "聚落熬过两个冬季，获准建镇。" if passed else "聚落熬过严冬，未达到建镇目标。"
        updated.update(status="won" if passed else "lost", result=reason)
    elif turn == 3 and resources["food"] >= 15 and resources["trust"] >= 4:
        updated["population"] += 1
        events.append("秋粮充裕，民望安稳，新居民 1 人来投，下季可分配。")
    if updated["result"]:
        events.append(updated["result"])
    updated["workers"] = dict(workers)
    updated["history"].extend(f"第{turn}季 · {event}" for event in events)
    if updated["status"] == "playing":
        updated["turn"] += 1
    return updated, events


def forecast(state, workers, build=None, offer=None):
    updated, events = _settle(state, workers, build, offer)
    resources = updated["resources"]
    return {"resources": resources, "delta": {key: resources[key] - state["resources"][key] for key in resources},
            "events": events, "population": updated["population"], "built": len(updated["built_ids"]),
            "status": updated["status"], "result": updated["result"]}


def advance(state, workers, build=None, offer=None):
    return _settle(state, workers, build, offer)[0]
