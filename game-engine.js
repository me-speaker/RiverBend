const SEASONS = [
  ["初春", "春水回暖", 3], ["盛夏", "河水丰沛", 4],
  ["金秋", "谷物成熟", 5], ["严冬", "霜冻封田", 1],
  ["初春", "融雪开河", 3], ["盛夏", "旱风过境", 3],
  ["金秋", "丰收在望", 5], ["严冬", "寒潮封河", 1],
];
const GOAL = "第 8 季结算后，拥有至少 3 处新设施、8 粮食和 4 民望。断粮或民望归零即告失败。";
const RESOURCES = { food: "粮食", wood: "木材", coin: "钱币", trust: "民望" };
export const TRADE_TRUST = Object.freeze({ bonusAt: 5, penaltyAt: 2 });
const JOBS = ["farm", "wood", "trade"];
const IMPROVEMENTS = {
  farm: ["灌渠", { wood: 5, coin: 3 }, "每名农户每季多产 1 粮。"],
  wood: ["木场", { wood: 3, coin: 4 }, "每名伐木工每季多产 1 木。"],
  trade: ["货栈", { wood: 6, coin: 2 }, "每名商贩每季多得 1 币。"],
};
// Axial coordinates. The first four sites are already developed at the start.
const SITES = [
  ["hall", 0, 0, "议事厅", "town", true],
  ["old_field", -1, 0, "河畔田", "farm", true],
  ["old_woods", 1, -1, "老林场", "wood", true],
  ["old_quay", 0, 1, "渡口集", "trade", true],
  ["north_field", 0, -1, "桑树坪", "farm", false],
  ["east_forest", 1, 0, "东杉林", "wood", false],
  ["west_quay", -1, 1, "苇湾", "trade", false],
  ["upper_river", -1, -1, "青溪", "river", false],
  ["north_woods", 1, -2, "雾松坡", "wood", false],
  ["north_ridge", 2, -2, "鹰岭", "hill", false],
  ["upland", 0, -2, "梯田坡", "farm", false],
  ["backwoods", 2, 0, "白桦谷", "wood", false],
  ["west_ridge", -2, 0, "西岗", "hill", false],
  ["east_river", 2, -1, "分水口", "river", false],
  ["west_meadow", -2, 1, "芦草地", "farm", false],
  ["new_quay", 1, 1, "东河滩", "trade", false],
  ["south_river", -1, 2, "曲水", "river", false],
  ["south_quay", -2, 2, "下游湾", "trade", false],
  ["south_ridge", 0, 2, "石屏山", "hill", false],
];
const FRONTIER_COSTS = {
  upland: { wood: 3, coin: 2 },
  backwoods: { wood: 2, coin: 2 },
  south_quay: { wood: 3, coin: 1 },
};
const AGREEMENTS = [
  ["grain_loan_small", "周转三袋粮", "粮商", { food: 3 }, { coin: 2 }],
  ["grain_loan", "借粮过季", "粮商", { food: 7 }, { coin: 5 }],
  ["grain_loan_large", "预借整船粮", "粮商", { food: 12 }, { coin: 9 }],
  ["timber_credit", "赊木筑城", "林户", { wood: 5 }, { food: 6 }],
  ["timber_credit_large", "赊运整批杉木", "林户", { wood: 8 }, { food: 11 }],
  ["market_delivery", "预售木料", "船主", { coin: 5 }, { wood: 4 }],
  ["public_meal", "开仓设粥", "乡老", { food: -4, trust: 1 }, {}],
  ["work_party", "征召木工", "工头", { wood: 2, trust: -1 }, {}],
  ["barter_day", "开一日市", "摊贩", { coin: 1 }, {}],
];

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function newState() {
  return {
    turn: 1, population: 4, resources: { food: 11, wood: 5, coin: 4, trust: 4 },
    workers: { farm: 2, wood: 1, trade: 1 }, built_ids: [],
    obligations: [], history: [], status: "playing", result: "",
  };
}

function describe(amounts, signed = false) {
  return Object.entries(amounts).map(([key, amount]) =>
    `${signed && amount >= 0 ? "+" : ""}${amount} ${RESOURCES[key]}`).join("、");
}

function councilOptions(state) {
  if (state.status !== "playing") return [];
  const offers = [];
  for (const [id, title, speaker, now, due] of AGREEMENTS) {
    const hasDebt = Object.keys(due).length > 0;
    if (hasDebt && state.turn === SEASONS.length) continue;
    if (Object.entries(now).some(([key, value]) => state.resources[key] + value < (key === "trust" ? 1 : 0))) continue;
    let terms = `当季${describe(now, true)}。`;
    if (hasDebt) terms += `下季口粮结清后交付${describe(due)}；履约得 1 民望，欠付失 2 民望。`;
    const suffix = id.match(/_(large|small)$/);
    offers.push({
      id, family: suffix ? id.slice(0, suffix.index) : id, scale: suffix?.[1] ?? "standard",
      title, speaker, now: { ...now }, next_cost: { ...due }, terms,
    });
  }
  return offers;
}

function tilesFor(state) {
  const built = new Set(state.built_ids);
  const developed = SITES.filter(([id, , , , , old]) => old || built.has(id));
  const established = {
    farm: "基础农田，收成随季节变化。", wood: "每名伐木工基础产出 2 木。", trade: "每名商贩基础收入 2 币。",
  };
  return SITES.map(([id, q, r, name, kind, old]) => {
    const improved = old || built.has(id);
    const adjacent = developed.some(([, aq, ar]) => Math.max(Math.abs(q - aq), Math.abs(r - ar), Math.abs(q + r - aq - ar)) === 1);
    const [label, standardCost, benefit] = IMPROVEMENTS[kind] ?? ["", {}, ""];
    const cost = FRONTIER_COSTS[id] ?? standardCost;
    const buildable = Boolean(label && !improved && adjacent);
    let detail;
    if (kind === "town") detail = "聚落中心，居民在此议事。";
    else if (old) detail = established[kind];
    else if (improved) detail = `已建${label}。${benefit}`;
    else if (!label) detail = kind === "river" ? "此处是天然水道。" : "山地陡峭，无法施工。";
    else detail = `${adjacent ? "" : "须先开发相邻土地。"}${label}需${describe(cost)}。${benefit}`;
    return { id, q, r, name, kind, improved, buildable, build_name: label, build_cost: { ...cost }, detail };
  });
}

function tradeTrustBonus(trust) {
  if (trust >= TRADE_TRUST.bonusAt) return 1;
  if (trust <= TRADE_TRUST.penaltyAt) return -1;
  return 0;
}

function currentYield(state, openingTrust = state.resources.trust) {
  const [season, weather, farmRate] = SEASONS[state.turn - 1];
  const trade_trust_bonus = tradeTrustBonus(openingTrust);
  const rates = { farm: farmRate, wood: 2, trade: 2 + trade_trust_bonus };
  for (const [id, , , , kind] of SITES) {
    if (state.built_ids.includes(id)) rates[kind]++;
  }
  return { season, weather, rates, trade_trust_bonus, consumption: state.population * 2 + Number(season === "严冬") };
}

function publicState(save) {
  const { built_ids: built, ...state } = structuredClone(save.state);
  return {
    ...state, ...currentYield(save.state), max_turns: SEASONS.length, goal: GOAL,
    tiles: tilesFor(save.state), built: built.length, game_id: save.gameId, revision: save.revision,
  };
}

function affordable(resources, cost) {
  return Object.entries(cost).every(([key, amount]) => resources[key] >= amount);
}

function settle(state, { workers, build, offer }) {
  if (state.status !== "playing") throw new GameError("本局已经结束。");
  const updated = structuredClone(state);
  const { resources, obligations: debts, turn } = updated;
  updated.obligations = [];
  const events = [];

  if (offer !== null) {
    const agreement = councilOptions(state).find(item => item.id === offer);
    if (!agreement) throw new GameError("这项议案本季无法签订。");
    for (const [key, amount] of Object.entries(agreement.now)) resources[key] += amount;
    events.push(`签订「${agreement.title}」：${describe(agreement.now, true)}。`);
    const cost = agreement.next_cost;
    if (Object.keys(cost).length) {
      updated.obligations.push({
        due: turn + 1, cost, title: agreement.title,
        terms: `第 ${turn + 1} 季交付${describe(cost)}（${agreement.title}）。`,
      });
    }
  }

  if (build !== null) {
    const tile = tilesFor(state).find(item => item.id === build && item.buildable);
    if (!tile) throw new GameError("此地块当前无法施工。");
    const { build_cost: cost, build_name: name } = tile;
    if (!affordable(resources, cost)) throw new GameError(`建${name}需要${describe(cost)}，开工款不足。`);
    for (const [key, amount] of Object.entries(cost)) resources[key] -= amount;
    updated.built_ids.push(build);
    events.push(`在${tile.name}建成${name}，支出${describe(cost)}，本季投产。`);
  }

  const { rates, consumption, trade_trust_bonus } = currentYield(updated, state.resources.trust);
  const production = { food: workers.farm * rates.farm, wood: workers.wood * rates.wood, coin: workers.trade * rates.trade };
  for (const [key, amount] of Object.entries(production)) resources[key] += amount;
  resources.food -= consumption;
  events.push(`产出${describe(production)}；口粮消耗 ${consumption}。`);
  const trustIncome = workers.trade * trade_trust_bonus;
  if (trustIncome !== 0) {
    const sign = trustIncome > 0 ? "+" : "−";
    events.push(`贸易产出已计入民望影响 ${sign}${Math.abs(trustIncome)} 钱币。`);
  }
  for (const debt of debts) {
    if (affordable(resources, debt.cost)) {
      for (const [key, amount] of Object.entries(debt.cost)) resources[key] -= amount;
      resources.trust++;
      events.push(`履行「${debt.title}」，交付${describe(debt.cost)}，民望 +1。`);
    } else {
      resources.trust = Math.max(0, resources.trust - 2);
      events.push(`「${debt.title}」欠付，契约终止，民望 −2。`);
    }
  }

  if (resources.food < 0 || resources.trust <= 0) {
    updated.status = "lost";
    updated.result = resources.food < 0 ? `口粮短缺 ${-resources.food}，居民离散。` : "民望归零，议会失去居民支持。";
    resources.food = Math.max(0, resources.food);
  } else if (turn === SEASONS.length) {
    const won = updated.built_ids.length >= 3 && resources.food >= 8 && resources.trust >= 4;
    updated.status = won ? "won" : "lost";
    updated.result = won ? "聚落熬过两个冬季，获准建镇。" : "聚落熬过严冬，未达到建镇目标。";
  } else if (turn === 3 && resources.food >= 15 && resources.trust >= 4) {
    updated.population++;
    events.push("秋粮充裕，民望安稳，新居民 1 人来投，下季可分配。");
  }
  if (updated.result) events.push(updated.result);
  updated.workers = { ...workers };
  updated.history.push(...events.map(event => `第${turn}季 · ${event}`));
  if (updated.status === "playing") updated.turn++;
  return { updated, events };
}

function forecast(state, draft) {
  const { updated, events } = settle(state, draft);
  const { resources, population, status, result } = updated;
  const delta = Object.fromEntries(Object.keys(RESOURCES).map(key => [key, resources[key] - state.resources[key]]));
  const next_trade_trust_bonus = status === "playing" ? tradeTrustBonus(resources.trust) : null;
  return { resources, delta, events, population, built: updated.built_ids.length, status, result, next_trade_trust_bonus };
}

export const SAVE_KEY = "river-council-save";
const SAVE_VERSION = 1;
let storageAvailable = true;
let memorySave = null;
let offerGameId;
let offerRevision;
const offered = new Set();

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validWorkers(workers) {
  return isRecord(workers) && Object.keys(workers).length === JOBS.length &&
    JOBS.every(job => Object.hasOwn(workers, job) && isCount(workers[job]));
}

function validSave(save) {
  const state = save?.state;
  return save?.version === SAVE_VERSION && typeof save.gameId === "string" && isCount(save.revision) &&
    isRecord(state) && isCount(state.turn) && state.turn >= 1 && state.turn <= SEASONS.length &&
    isCount(state.population) && validWorkers(state.workers) && isRecord(state.resources) &&
    Object.keys(RESOURCES).every(key => isCount(state.resources[key])) &&
    Array.isArray(state.built_ids) && state.built_ids.every(id =>
      SITES.some(([site, , , , kind, old]) => site === id && !old && Object.hasOwn(IMPROVEMENTS, kind))) &&
    Array.isArray(state.obligations) && state.obligations.every(debt =>
      isRecord(debt) && isCount(debt.due) && typeof debt.title === "string" && typeof debt.terms === "string" &&
      isRecord(debt.cost) && Object.entries(debt.cost).every(([key, cost]) => Object.hasOwn(RESOURCES, key) && isCount(cost))) &&
    Array.isArray(state.history) && state.history.every(row => typeof row === "string") &&
    ["playing", "won", "lost"].includes(state.status) && typeof state.result === "string";
}

function readSave() {
  if (!storageAvailable) return memorySave;
  let raw;
  try {
    raw = globalThis.localStorage.getItem(SAVE_KEY);
  } catch {
    storageAvailable = false;
    return memorySave;
  }
  try {
    const save = JSON.parse(raw);
    return validSave(save) ? save : null;
  } catch {
    return null;
  }
}

function writeSave(save) {
  memorySave = save;
  if (!storageAvailable) return;
  try {
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    storageAvailable = false;
  }
}

function lookup(gameId, revision) {
  const save = readSave();
  if (!save || (gameId != null && gameId !== save.gameId)) {
    throw new GameError("找不到这局游戏，请刷新页面或重新开局。", 404);
  }
  if (revision !== undefined && save.revision !== revision) {
    throw new GameError("这份计划属于此前的回合，请刷新当前城市。", 409);
  }
  return save;
}

function submittedOffers(save) {
  if (offerGameId !== save.gameId || offerRevision !== save.revision) {
    offered.clear();
    offerGameId = save.gameId;
    offerRevision = save.revision;
  }
  return offered;
}

function checkDraft(draft) {
  if (!isCount(draft.revision)) throw new GameError("缺少有效的回合版本。");
  if (!validWorkers(draft.workers)) throw new GameError("请检查三个行业的劳力人数。");
  if ([draft.build, draft.offer].some(value => value !== null && typeof value !== "string")) {
    throw new GameError("无法识别工地或议案。");
  }
  if (typeof draft.game_id !== "string") throw new GameError("缺少有效的游戏编号。");
  const save = lookup(draft.game_id, draft.revision);
  if (draft.offer !== null && !submittedOffers(save).has(draft.offer)) {
    throw new GameError("请先向议会征询本季议案。");
  }
  if (Object.values(draft.workers).reduce((sum, count) => sum + count, 0) > save.state.population) {
    throw new GameError("分配的人手超过本季人口。");
  }
  return save;
}

export function createGame() {
  const gameId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  const save = { version: SAVE_VERSION, gameId, revision: 0, state: newState() };
  writeSave(save);
  return { state: publicState(save) };
}

export function getGame(gameId = null) {
  return { state: publicState(lookup(gameId)) };
}

export function forecastPlan(draft) {
  return { forecast: forecast(checkDraft(draft).state, draft) };
}

export function advanceGame(draft) {
  const save = checkDraft(draft);
  const { updated } = settle(save.state, draft);
  const committed = { ...save, revision: save.revision + 1, state: updated };
  writeSave(committed);
  return { state: publicState(committed) };
}

export function prepareCouncil(draft) {
  const save = checkDraft(draft);
  const city = publicState(save);
  if (city.status !== "playing") throw new GameError("本局已经结束。");
  if (draft.build !== null && !city.tiles.some(tile => tile.id === draft.build)) {
    throw new GameError("无法识别选定的工地。");
  }
  const options = [];
  city.offer_forecasts = {};
  for (const option of [null, ...councilOptions(save.state)]) {
    let outcome;
    try {
      const { resources, delta, status, next_trade_trust_bonus } = forecast(save.state, { ...draft, offer: option?.id ?? null });
      outcome = { resources, delta, status, next_trade_trust_bonus };
    } catch (error) {
      if (!(error instanceof GameError)) throw error;
      continue;
    }
    if (!option) city.plan_forecast = outcome;
    else {
      options.push(option);
      city.offer_forecasts[option.id] = outcome;
    }
  }
  if (!options.length) throw new GameError("没有能与当前建设计划同时执行的议案。请调整工地后再征询。");
  return { city, options };
}

export function recordOffer(draft, reply) {
  const save = checkDraft(draft);
  const offer = councilOptions(save.state).find(item => item.id === reply?.offer?.id);
  if (!offer) throw new GameError("议会回复的条款已经失效。");
  settle(save.state, { ...draft, offer: offer.id });
  submittedOffers(save).add(offer.id);
  return { ...reply, offer };
}

const INTERESTS = {
  food: ["粮", "口粮", "饥", "食物", "吃饭"], wood: ["木", "建造", "扩建", "建设"],
  coin: ["钱", "贸易", "金币", "商路"], trust: ["民望", "民心", "信誉", "信任", "声望"],
};

export function recommendLocal(city, options, intent, build) {
  if (!options.length) throw new GameError("当前安排下没有可提出的议案。");
  if (typeof intent !== "string" || [...intent].length > 500) throw new GameError("施政意向限 500 字。");
  const target = { food: city.population * 2, wood: 5, coin: 4, trust: 4 };
  const baseline = city.plan_forecast?.resources ?? city.resources;
  const weights = Object.fromEntries(Object.entries(target).map(([key, amount]) => [
    key, 1 + Math.max(0, (amount - baseline[key]) / Math.max(1, amount)) * 3,
  ]));
  for (const [key, words] of Object.entries(INTERESTS)) {
    if (words.some(word => intent.includes(word))) weights[key] += 2;
  }
  if (build) weights.wood += 0.3;
  const preferred = new Set();
  if (intent.includes("赊木") || /粮.{0,4}换.{0,4}(木|杉)/u.test(intent)) preferred.add("timber_credit");
  if (intent.includes("借粮") || /(钱|币).{0,4}换.{0,4}粮/u.test(intent)) preferred.add("grain_loan");
  if (intent.includes("预售木") || /木.{0,4}换.{0,4}(钱|币)/u.test(intent)) preferred.add("market_delivery");
  if (/开仓设粥|(?:提高|提升|增加|恢复|挽回).{0,2}(民望|民心|声望|信誉)/u.test(intent)) preferred.add("public_meal");

  function score(option) {
    const gain = Object.entries(option.now).reduce((sum, [key, amount]) => sum + weights[key] * amount, 0);
    const debt = Object.entries(option.next_cost).reduce((sum, [key, amount]) => sum + weights[key] * amount * 0.65, 0);
    const status = city.offer_forecasts?.[option.id]?.status;
    return [Number(status !== "lost"), Number(preferred.has(option.family)), gain - debt + (status === "won" ? 1000 : status === "lost" ? -1000 : 0)];
  }

  // Sort scores by survival, preferred contract type, then value. Ties keep candidate order.
  const [{ option: best }] = options.map(option => ({ option, score: score(option) })).sort((left, right) =>
    right.score[0] - left.score[0] || right.score[1] - left.score[1] || right.score[2] - left.score[2]);
  const [priority] = Object.keys(best.now).filter(key => best.now[key] > 0).sort((left, right) =>
    weights[right] * best.now[right] - weights[left] * best.now[left]);
  let reason = priority ? `按本季安排，议会优先补充${RESOURCES[priority]}。` : "议会按本季库存和居民需求选择了这份提案。";
  if (best.id === "public_meal") reason = "居民愿意开仓设粥，用存粮换取民望。";
  if (Object.keys(best.next_cost).length) reason += `下季需留出 ${describe(best.next_cost)} 履约。`;
  return { offer: best, reason, source: "local" };
}
