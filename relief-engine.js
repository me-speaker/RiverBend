export const RELIEF_SAVE = "riverbend-relief-v1";
export const LAST_DAY = 7;
export const BED_LIMIT = 6;
export const SHIP_LIMIT = 8;
export const FARE = 4;
export const CREW_COST = 2;
export const places = { shelter: "收容所", dock: "码头", village: "村庄", warehouse: "商会仓房", outside: "露宿" };
export const parties = { guild: "商会", boat: "船主", crew: "工班", households: "受灾家庭", keeper: "收容所管事" };
export const triggers = { work: "完成帮工", arrival: "核验到家" };
export const resources = { bed: "仓房床位", seat: "船位" };
export const verifiers = { crew: "工班", guard: "治安队", village: "村里签收人" };
const names = ["赵", "钱", "孙", "周", "吴", "郑", "王", "冯", "张", "陈", "褚", "卫", "蒋", "沈", "韩", "杨", "李", "朱", "秦", "尤", "许", "何"];
const copy = value => structuredClone(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const active = (rule, day) => rule.start <= day && day <= rule.end && (!rule.retired || day < rule.retired);

export function newRelief() {
  return {
    version: 1, gameId: Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(36)).join("-"),
    revision: 0, day: 1, finished: false, silver: 18, trips: 0, crewDays: 0,
    households: names.map((surname, index) => ({
      id: "h" + (index + 1), name: surname + "家", home: index < 8 ? "ready" : index < 16 ? "damaged" : "lost",
      location: "shelter", stable: false, skilled: [8, 11, 14, 18, 20].includes(index), left: false,
    })),
    credit: { guild: 60, boat: 60, crew: 65, households: 55, keeper: 65 },
    rules: [], rights: [], obligations: [], disputes: [], nights: [], history: [],
  };
}

function readRelief() {
  try {
    const value = JSON.parse(localStorage.getItem(RELIEF_SAVE));
    if (value?.version === 1 && typeof value.gameId === "string" && integer(value.day, 1, LAST_DAY) &&
        value.households?.length === 22 && ["nights","rules","rights","obligations","disputes","history"].every(key => Array.isArray(value[key]))) return value;
  } catch { /* Storage may be unavailable in private browsing. */ }
  return null;
}

export function openRelief() {
  const prior = readRelief();
  if (prior) return prior;
  const created = newRelief();
  persistRelief(created);
  return created;
}

export function persistRelief(state) {
  try { localStorage.setItem(RELIEF_SAVE, JSON.stringify(state)); } catch { /* Continue in memory. */ }
}

export function commitRelief(previous, next) {
  const saved = readRelief();
  if (saved && (saved.gameId !== previous.gameId || saved.revision !== previous.revision)) {
    const error = new Error("另一标签页已更新安置账本，已载入最新一天。");
    error.latest = saved;
    throw error;
  }
  persistRelief(next);
  return next;
}

export function newPlan() {
  return { repairs: [], helpers: [], passengers: [], guard: "idle", warehouse: "none",
    temporary: [], permanent: [], clear: [], transfers: [], claims: [], payments: [], extensions: [], split: false, market: false, keepShelter: false };
}

export function summarize(state) {
  const total = { grain: 30, departed: 8, returned: 8, home: 0, stable: 0, temporary: 0, exposed: 0, shelter: 0 };
  for (const household of state.households) {
    if (household.left) total.departed++;
    if (household.location === "village") { total.home++; total.returned++; }
    else if (household.stable) total.stable++;
    else if (household.location === "warehouse" || household.location === "shelter") total.temporary++;
    else total.exposed++;
    if (household.location === "shelter") total.shelter++;
  }
  return total;
}

export function situation(household) {
  if (household.location === "village") return "已到家";
  if (household.stable) return "已取得长期住所";
  if (household.home === "lost") return "原屋冲毁，等待长期住处";
  return household.home === "damaged" ? "愿意返乡，屋顶待修" : "屋顶可住，等待船位";
}

export function morningProposals(state) {
  if (state.finished) return [];
  const people = state.households;
  const cards = [];
  if (state.nights.at(-1)?.logs.some(line => line.includes("共用仓位已满"))) cards.push({
    party: "guild", text: "昨晚有凭证未能兑付。请延长有效期或压低每日登记数。改令时，已经发出的凭证仍按原期限处理。",
  });
  if (people.some(house => house.home === "damaged")) cards.push({
    party: "crew", text: "张家等五户登记过木工手艺，可以帮工。我们每天实际带两户，完工后由工班签字。",
    draft: "受灾户每帮工班修一天屋顶，就挣一晚仓房住宿；自家用不上，可以转给别家。",
  });
  if (!cards.some(card => card.party === "guild") && people.some(house => house.home === "lost" && !house.stable)) cards.push({
    party: "guild",
    text: state.credit.guild < 45 ? "我们要先见补偿到账，再谈借仓。"
      : "卸货至少留三处。若县里批复仓房长期改用，我们要集市复业的优先摊位。",
  });
  if (cards.length < 2 && people.some(house => !house.left && house.home === "ready")) cards.push({
    party: "boat", text: "今日还可租一趟。要分期，得先付一半，尾款按到家凭证收；无人签收就按全款办。",
    draft: "船先付一半运费，确认到家再付尾款。",
  });
  if (cards.length < 2) cards.push({ party: "keeper", text: "七天后临时经费停拨。名册上的离所，要对得上每户实际的夜间住处。" });
  return cards.slice(0, 2);
}

const fail = message => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };
const inTown = house => house && house.location !== "village" && !house.stable;
const partyCredit = (state, party, delta) => { state.credit[party] = Math.max(0, Math.min(100, state.credit[party] + delta)); };
const effects = ["grant", "payment"];

export function defaultDraft(state) {
  return { effect: "grant", trigger: "work", resource: "bed", verifier: "crew",
    quantity: 1, limit: 2, ends: LAST_DAY, days: Math.min(2, LAST_DAY - state.day + 1),
    transferable: false, advance: 50, reason: "", unsupported: "" };
}

export function draftLocally(state, text) {
  const initial = defaultDraft(state);
  if (/除非|仅限|除了|只有|罚款|征收|扣粮|继承|累积|连带|按户口|按年龄/.test(text)) {
    return { ...initial, unsupported: "草案包含当前引擎无法表达的资格例外或附加责任。请改写为明确的触发、资源和有效期。" };
  }
  const amount = Number(text.match(/([1-9]\d*)\s*(?:晚|个船位|个床位)/)?.[1] ?? (/两晚|二晚|两个床位/.test(text) ? 2 : 1));
  if (/船|运费/.test(text) && /尾款|后付|分期/.test(text)) {
    const percent = Number(text.match(/(\d+)%/)?.[1] || 50);
    return { ...initial, effect: "payment", trigger: "arrival",
      verifier: /村|家属/.test(text) ? "village" : "guard", advance: percent,
      reason: "先付部分租金，等约定的签收人确认到家，再结船主尾款。" };
  }
  const bed = /住|仓|床/.test(text), seat = /船位|船票/.test(text);
  if ((bed || seat) && /帮工|出工|修屋|屋顶|到家|抵达/.test(text)) {
    const arrival = /到家|抵达/.test(text) && !/帮工|出工|修屋|屋顶/.test(text);
    return { ...initial, resource: bed ? "bed" : "seat", trigger: arrival ? "arrival" : "work",
      verifier: arrival ? (/治安/.test(text) ? "guard" : "village") : "crew",
      quantity: amount, limit: Number(text.match(/每[日天](?:至多|最多|限)?\s*(\d+)/)?.[1] || 2),
      transferable: /转(给|让|赠)|互换/.test(text) && !/不得转|不能转|不可转|禁止转/.test(text),
      reason: "由实际发生的事件登记权利，持有人可按授权范围提出兑付。" };
  }
  return { ...initial, unsupported: "请补充明确事件（实际出工或核验到家）以及发放的床位、船位或应付尾款。" };
}

export function reviewRule(state, draft, concession = false, replaces = "") {
  const issues = [], responses = [];
  const issue = sentence => issues.push(sentence);
  if (!effects.includes(draft.effect) || !Object.hasOwn(triggers, draft.trigger) ||
      !Object.hasOwn(verifiers, draft.verifier)) issue("触发、交付和确认人必须在可执行范围内。");
  if (draft.unsupported) issue(draft.unsupported);
  if (!integer(draft.ends, state.day, LAST_DAY)) issue("最后生效日须在今日至第七天之间。");
  const old = state.rules.find(rule => rule.id === replaces && active(rule, state.day));
  if (replaces && !old) issue("待修订的政令已经失效。");
  if (state.finished) issue("七日结案已经完成。");
  if (draft.trigger === "work" && draft.verifier !== "crew") issue("实际出工须由工班确认。");
  if (draft.trigger === "arrival" && !["village", "guard"].includes(draft.verifier)) issue("到家须由村里签收人或随船治安队核验。");
  if (draft.effect === "grant") {
    const bed = draft.resource === "bed";
    if (!Object.hasOwn(resources, draft.resource)) issue("请选择可登记的实物资源。");
    if (!integer(draft.quantity, 1, bed ? BED_LIMIT : SHIP_LIMIT) ||
        !integer(draft.limit, 1, bed ? BED_LIMIT : SHIP_LIMIT) || !integer(draft.days, 1, 3)) issue("单次额度、每日上限和有效天数必须在资源范围内（有效期 1–3 天）。");
    if (draft.quantity > draft.limit) issue("每户所得数量超过每日上限。");
    const owner = bed ? "guild" : "boat";
    const permitted = bed ? (concession ? BED_LIMIT : 3) : 2;
    if (state.credit[owner] < 45) issue(parties[owner] + "要求先结清争议与欠款，暂不同意新授权。");
    if (draft.limit > permitted) issue(parties[owner] + "只同意每日预留 " + permitted + " 户份；请调低上限" + (bed ? "或协商集市优先权。" : "。"));
    responses.push({ party: owner, text: bed ? "要求明确同晚容量。保留卸货空间时每天最多预留三户；接受集市优先可授权六户。" : "预留不超过两个船位，仍须当天有实际航次。" });
    responses.push({ party: draft.verifier, text: draft.verifier === "crew" ? "同意在完工后签字，最多确认两户参加帮工。" :
      "只有具备签收条件的实际到家才核验。" });
  } else {
    if (draft.trigger !== "arrival" || ![50, 75].includes(draft.advance)) issue("分期须绑定核验到家，并先收 50% 或 75%。");
    if (state.credit.boat < 55) issue("船主对履约没有把握，要求常规全款租船。");
    responses.push({ party: "boat", text: "至少预付一半。尾款在具名验收后产生；村里无人签收时请改由治安队随船，或按全价租船。" });
  }
  return { issues, responses, old };
}

function commitment(state, entry) {
  const id = "o" + (state.obligations.length + 1);
  state.obligations.push({ id, status: "open", ...entry });
  return id;
}

function promiseMarket(state) {
  if (!state.obligations.some(item => item.type === "market")) {
    commitment(state, { party: "guild", type: "market", amount: 0, due: LAST_DAY, label: "集市复业优先摊位" });
  }
}

export function signRule(state, draft, concession = false, replaces = "") {
  const review = reviewRule(state, draft, concession, replaces);
  check(!review.issues.length, review.issues.join(" "));
  const next = copy(state);
  if (replaces) next.rules.find(item => item.id === replaces).retired = state.day;
  if (concession && draft.effect === "grant" && draft.resource === "bed") promiseMarket(next);
  const id = "政令 " + (next.rules.length + 1);
  next.rules.push({ ...draft, id, replaces, concession, start: next.day, end: draft.ends });
  next.history.push("第 " + next.day + " 天 · 签发 " + id + (replaces ? "，替代" + replaces + "。已发资格按原定期限保留。" : "。"));
  next.revision++;
  return next;
}

export function ruleText(rule) {
  const title = triggers[rule.trigger] ?? "待定事件";
  const verifier = verifiers[rule.verifier] ?? "待定";
  if (rule.effect === "payment") return "开船先付 " + rule.advance + "%。由" + verifier + title + "后向船主支付余款。";
  return title + "后由" + verifier + "确认，向该户登记 " + rule.quantity + " 户份" + resources[rule.resource] +
    "。每日最多 " + rule.limit + " 份，有效 " + rule.days + " 天，" + (rule.transferable ? "可以转让。" : "由登记家庭使用。");
}

export function canExtend(state, item) {
  return item.type === "silver" && item.status === "open" && !item.extended &&
    item.due < LAST_DAY && state.credit[item.party] >= 55;
}

export function settleRelief(state, plan, expected = state.revision) {
  check(!state.finished && state.revision === expected, "当天已经结算或草案版本已变。");
  const next = copy(state);
  const day = next.day;
  const logs = [];
  const tag = (text) => logs.push(text);
  const people = new Map(next.households.map(house => [house.id, house]));
  const move = (house, where, stable = false) => {
    house.location = where;
    house.stable = stable;
    if (where !== "shelter") house.left = true;
  };
  const take = (amount, description) => {
    check(next.silver >= amount, description + "需要 " + amount + " 银，当前只有 " + next.silver + " 银。");
    next.silver -= amount;
    if (amount) tag(description + "，支出 " + amount + " 银。");
  };
  function households(ids, maximum, eligible, label) {
    check(Array.isArray(ids) && ids.length <= maximum && new Set(ids).size === ids.length, label + "人数或容量超出上限。");
    const list = ids.map(id => people.get(id));
    check(list.every(house => house && eligible(house)), label + "含不符合条件的家庭。");
    return list;
  }

  check(["idle", "dock", "order", "take"].includes(plan.guard), "治安队一天只能承担一项任务。");
  check(["none", "borrow", "borrowAll", "market", "buy", "take"].includes(plan.warehouse), "请选一种仓房授权。");
  check(plan.warehouse !== "take" || plan.guard === "take", "征用须由治安队执行，不能同时协助码头。");
  check(plan.guard !== "take" || plan.warehouse === "take", "派队接管须同时安排仓房征用。");
  if (plan.guard === "dock") tag("治安队协助码头，随船核验返乡家庭。");
  if (plan.guard === "order") {
    tag("治安队维持发放秩序，管事核对了当日领粮名单。");
    partyCredit(next, "keeper", 1);
  }

  for (const item of next.obligations) {
    if (item.status !== "open" && item.status !== "arrears") continue;
    if (item.type === "return" && item.due <= day) {
      item.status = "paid";
      item.settled = day;
      partyCredit(next, "guild", 3);
      tag("已交还昨晚占用的仓区，商会确认收回。");
    }
    if (item.type === "silver" && plan.payments.includes(item.id)) {
      take(item.amount, "向" + parties[item.party] + "支付" + item.label);
      const delayed = item.status === "arrears";
      item.status = "paid";
      item.settled = day;
      partyCredit(next, item.party, delayed ? 3 : 7);
      for (const row of next.disputes.filter(row => row.obligation === item.id)) row.resolved = day;
    } else if (plan.extensions.includes(item.id)) {
      check(canExtend(next, item), parties[item.party] + "不同意再次延期，或调整后的到期日超出结案日。");
      item.due++;
      item.extended = day;
      partyCredit(next, item.party, -2);
      tag(parties[item.party] + "同意" + item.label + "延期至第 " + item.due + " 天。");
    }
    if (item.type === "market" && plan.market) {
      item.status = "paid";
      item.settled = day;
      tag("登记商会复市优先摊位，兑现长期用房承诺。");
      partyCredit(next, "guild", 7);
    }
  }

  // Previous overnight occupancy ends before today's claims use the shared capacity.
  for (const house of next.households) {
    if (house.location === "warehouse" && !house.stable) house.location = "shelter";
  }
  const employed = households(plan.repairs, 2, house => house.home === "damaged", "屋顶工程");
  const helpers = households(plan.helpers, 2, house => inTown(house) && house.skilled, "帮工名单");
  check(!helpers.length || employed.length, "须先安排一项修缮，工班才有出工可以确认。");
  const workersToday = new Set(helpers.map(house => house.id));
  if (employed.length) {
    take(CREW_COST, "雇工班");
    next.crewDays++;
    for (const house of employed) house.home = "ready";
    tag("工班修好 " + employed.map(house => house.name).join("、") + " 的屋顶。");
    if (helpers.length) tag("工班确认 " + helpers.map(house => house.name).join("、") + " 实际参与施工。");
  }

  const applyingRules = next.rules.filter(rule => active(rule, day));
  const daily = new Map();
  function grant(event, verifier, houses) {
    for (const rule of applyingRules.filter(rule => rule.effect === "grant" && rule.trigger === event && rule.verifier === verifier)) {
      for (const house of houses) {
        const available = rule.limit - (daily.get(rule.id) ?? 0);
        const count = Math.min(available, rule.quantity);
        if (!count) { tag(house.name + "符合" + rule.id + "，但该令今日额度已满。"); continue; }
        daily.set(rule.id, (daily.get(rule.id) ?? 0) + count);
        for (let unit = 0; unit < count; unit++) next.rights.push({
          id: "Q" + rule.id.split(" ").at(-1) + "-" + day + "-" + house.id.slice(1) + "-" + (unit + 1),
          rule: rule.id, resource: rule.resource, holder: house.id, earnedBy: house.id,
          issued: day, expires: Math.min(LAST_DAY, day + rule.days - 1), transferable: rule.transferable, status: "open",
          owner: rule.resource === "bed" ? "guild" : "boat", capacity: rule.concession ? BED_LIMIT : 3,
        });
        tag(house.name + "按" + rule.id + "取得 " + count + " 份" + resources[rule.resource] + "资格。");
      }
    }
  }
  grant("work", "crew", helpers);

  const laterTransfers = [];
  function transfer(action, right) {
    const recipient = people.get(action.to);
    check(right?.status === "open" && right.expires >= day && right.transferable && inTown(recipient) &&
      recipient.id !== right.holder, "资格转让条件已变化，请检查持有人、受让户和有效期。");
    tag(people.get(right.holder).name + "把 " + right.id + " 转给" + recipient.name + "。");
    right.holder = recipient.id;
  }
  for (const action of plan.transfers) {
    const right = next.rights.find(item => item.id === action.id);
    if (right) transfer(action, right);
    else laterTransfers.push(action);
  }

  const queuedClaims = [...new Set(plan.claims)];
  const booked = households(plan.passengers, SHIP_LIMIT, house => inTown(house) && house.home !== "lost", "登船名单");
  const reserved = booked.length ? [...new Set(queuedClaims.map(id => next.rights.find(right =>
    right.id === id && right.status === "open" && right.expires >= day && right.resource === "seat")?.holder))]
    .map(id => people.get(id)).filter(house => inTown(house) && house.home === "ready") : [];
  const passengers = [...new Set([...reserved, ...booked])].slice(0, SHIP_LIMIT);
  for (const house of booked.filter(entry => !passengers.includes(entry))) {
    tag(house.name + "本次未登船，船位优先兑付已授权的凭证。");
  }
  const passengersToday = new Set(passengers.map(house => house.id));
  const villageWitness = next.households.some(house => house.location === "village");
  const canConfirm = verifier => verifier === "guard" ? plan.guard === "dock" : verifier === "village" && villageWitness;
  if (passengers.length) {
    const splitRule = [...applyingRules].reverse().find(rule => rule.effect === "payment");
    check(!plan.split || splitRule, "没有有效的船费分期政令。");
    check(!plan.split || canConfirm(splitRule.verifier), "无人能按政令签收。请换验收人、派治安队随船，或改用全款。");
    check(!plan.split || next.credit.boat >= 55, "船主有未解决的欠账或损失，今日要求全款。");
    const deposit = plan.split ? FARE * splitRule.advance / 100 : FARE;
    take(deposit, plan.split ? "向船主支付首款" : "租船一趟");
    next.trips++;
    const arrived = passengers.filter(house => house.home === "ready");
    for (const house of arrived) move(house, "village", true);
    const delayed = passengers.filter(house => house.home === "damaged");
    for (const house of delayed) move(house, "dock");
    tag("计划返乡 " + passengers.length + " 户，实际到家 " + arrived.length + " 户" +
      (delayed.length ? "；" + delayed.map(house => house.name).join("、") + "屋顶未修，留在码头。" : "。"));
    for (const verifier of ["guard", "village"].filter(canConfirm)) grant("arrival", verifier, arrived);
    if (plan.split && arrived.length) {
      const amount = FARE - deposit;
      const id = commitment(next, { party: "boat", type: "silver", amount, due: day, label: "返乡到家尾款" });
      const item = next.obligations.find(row => row.id === id);
      if (next.silver >= amount) {
        take(amount, verifiers[splitRule.verifier] + "核验后支付船主尾款");
        item.status = "paid"; item.settled = day;
        partyCredit(next, "boat", 7);
      }
    } else if (plan.split) {
      partyCredit(next, "boat", -4);
      next.disputes.push({ day, party: "boat", text: "空航，未触发尾款，船主承担返航成本。" });
      tag("未有人到家，未触发尾款；船主登记空航损失。");
    }
  }
  for (const action of laterTransfers) transfer(action, next.rights.find(item => item.id === action.id));

  const availableBeds = BED_LIMIT - next.households.filter(house => house.stable && house.location === "warehouse").length;
  let beds = 0;
  if (plan.warehouse === "borrow" || plan.warehouse === "borrowAll") {
    check(next.credit.guild >= 45, "商会要求先解决欠款，暂不借仓。");
    const whole = plan.warehouse === "borrowAll";
    beds = Math.min(whole ? BED_LIMIT : 3, availableBeds);
    commitment(next, { party: "guild", type: "return", amount: 0, due: day + 1, label: "次晨归还短借仓位" });
    if (whole) {
      promiseMarket(next);
      next.disputes.push({ day, party: "guild", text: "协商借用全部可用仓位，商会另寻当晚卸货处。" });
    }
    tag("商会同意短借 " + beds + " 户位，" + (whole ? "以复市摊位承诺交换。" : "卸货区继续保留。"));
  }
  if (plan.warehouse === "take") {
    beds = availableBeds;
    const id = commitment(next, { party: "guild", type: "silver", amount: 2, due: Math.min(day + 1, LAST_DAY), label: "征用仓房补偿" });
    commitment(next, { party: "guild", type: "return", amount: 0, due: day + 1, label: "次晨交还征用仓区" });
    partyCredit(next, "guild", -15);
    next.disputes.push({ day, party: "guild", obligation: id, text: "征用压缩卸货空间，商会提出两银补偿。" });
    tag("治安队接管仓房，当晚可调配 " + beds + " 户位。商会登记停业损失及 2 银补偿。");
  }
  if (plan.warehouse === "market" || plan.warehouse === "buy") {
    check(next.credit.guild >= 45, "商会拒绝长期改用，须先处理欠款与争议。");
    const permanent = households(plan.permanent, availableBeds, inTown, "长期入住名单");
    check(permanent.length, "请先选择要安置到仓房的家庭。");
    if (plan.warehouse === "buy") take(permanent.length, "买断仓位使用权，每户一银");
    else {
      promiseMarket(next);
      next.disputes.push({ day, party: "guild", text: "为长期安置让出 " + permanent.length + " 户空间，商会须另行安排集市。" });
    }
    for (const house of permanent) move(house, "warehouse", true);
    tag(permanent.map(house => house.name).join("、") + "取得仓房长期住处。");
  }

  for (const house of households(plan.clear, 22, house => state.households.find(row => row.id === house.id)?.location === "shelter", "离所名单")) {
    if (house.location === "warehouse" || house.location === "village") continue;
    move(house, "dock");
    partyCredit(next, "households", -2);
    tag(house.name + "已登记离所，今晚仍在码头候安置。");
  }

  const space = () => BED_LIMIT - next.households.filter(house => house.location === "warehouse").length;
  let arranged = 0;
  for (const house of households(plan.temporary, BED_LIMIT, inTown, "短住名单")) {
    if (arranged >= beds || space() <= 0) { tag(house.name + "短住申请未排上，当晚授权或容量不足。"); continue; }
    move(house, "warehouse");
    arranged++;
    tag(house.name + "入住临时仓位一晚。");
  }

  const usedSeats = new Set();
  for (const id of queuedClaims) {
    const right = next.rights.find(item => item.id === id);
    if (!right || right.status !== "open" || right.expires < day) { tag(id + " 无有效资格，未核销。"); continue; }
    const house = people.get(right.holder);
    if (right.resource === "seat") {
      const earnedAfterSailing = right.issued === day && applyingRules.find(rule => rule.id === right.rule)?.trigger === "arrival";
      if (!earnedAfterSailing && passengersToday.has(house.id) && house.location === "village" && !usedSeats.has(house.id)) {
        right.status = "used"; right.used = day;
        usedSeats.add(house.id);
        tag(house.name + "使用 " + id + " 登船到家，船位资格已核销。");
      } else tag(house.name + "没有实际到家，本次未核销 " + id + "。");
      continue;
    }
    if (!inTown(house) || house.location === "warehouse") {
      tag(house.name + "已另有住处，" + id + " 未重复占床。"); continue;
    }
    const authorized = Math.max(beds, Math.min(right.capacity, availableBeds));
    if (arranged >= authorized || space() <= 0) {
      tag(house.name + "申请核销 " + id + "：当晚共用仓位已满，可在有效期内再申请。"); continue;
    }
    move(house, "warehouse");
    arranged++;
    right.status = "used"; right.used = day;
    tag(house.name + "凭 " + id + " 入住仓房，扣 1 户位并核销。");
  }
  for (const right of next.rights.filter(item => item.status === "open" && item.expires <= day)) {
    right.status = "expired";
    tag(right.id + " 到期未用。");
  }
  for (const item of next.obligations) {
    if (item.type === "market" && plan.market && item.status === "open") {
      item.status = "paid"; item.settled = day;
      partyCredit(next, "guild", 7);
      tag("登记商会复市优先摊位，兑现仓房承诺。");
    }
    if (item.status === "open" && item.due <= day) {
      item.status = "arrears";
      partyCredit(next, item.party, -12);
      next.disputes.push({ day, party: item.party, obligation: item.id, text: item.label + "到期未兑现。" });
      tag(parties[item.party] + "记录欠付：" + item.label + "。");
    }
  }

  if (day === LAST_DAY) {
    const remaining = next.households.filter(house => house.location === "shelter");
    if (remaining.length && plan.keepShelter) {
      take(2, "留两银由管事续办临时收容");
      tag(remaining.length + " 户继续临住，后续由管事安排，仍待长期安置。");
    } else if (remaining.length) {
      for (const house of remaining) move(house, "outside");
      tag("县里停拨临时经费，收容所关闭。原留住的 " + remaining.length + " 户当晚露宿。");
    }
    next.finished = true;
  } else next.day++;
  next.revision++;
  const summary = summarize(next);
  const night = {
    day, logs, summary, silver: next.silver, trips: next.trips, crewDays: next.crewDays,
    credit: copy(next.credit), obligations: copy(next.obligations), disputes: copy(next.disputes),
    households: next.households.map(({ id, name, location, stable, home, left }) => ({ id, name, location, stable, home, left })),
  };
  next.nights.push(night);
  next.history.push(...logs.map(line => "第 " + day + " 天 · " + line));
  return { state: next, night };
}
