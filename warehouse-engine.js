export const FAMILIES = Object.freeze({ zhang: "张家", li: "李家" });
const families = Object.keys(FAMILIES);
const relations = ["actor", "other", ...families];
const subjects = ["any", ...relations];
const moments = ["day", "night"];
const roles = {
  cover: { title: "防雨遮盖", fits: props => props.rainproof && props.tied && props.cover > 0 },
  ground: { title: "干燥空地", fits: props => props.dry && props.area > 0 },
  anchor: { title: "可系绳的挂点", fits: props => props.tiePoint },
};
const capabilities = {
  shelter: { title: "临时住处", roles: ["cover", "ground", "anchor"] },
  object: { title: "非住宿物件", roles: [] },
};
const warehouse = { id: "warehouse", name: "仓房", type: "已有仓房", capacity: 1, access: "any", createdBy: null };
const defaultAssets = [
  { id: "tarp", name: "防雨旧篷布", names: ["篷布"], props: { rainproof: true, tied: true, cover: 1 } },
  { id: "ground", name: "仓边干地", names: ["干地", "空地"], props: { dry: true, area: 1 } },
  { id: "wall", name: "仓边挂点", names: ["挂点"], props: { tiePoint: true } },
  { id: "wood", name: "木料堆", names: ["木料"], props: { portable: true } },
];
const propsText = {
  rainproof: "防雨", tied: "自带系绳", cover: "可遮住", dry: "干燥", area: "可容纳",
  tiePoint: "可固定系绳", portable: "可搬运",
};
const check = (condition, text) => { if (!condition) throw new Error(text); };
const own = (object, key) => Object.hasOwn(object, key);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const named = { any: "任一家", actor: "行动者", other: "另一家", ...FAMILIES };
const resolve = (value, actor) => value === "actor" ? actor : value === "other" ? opposite(actor) : value;
const opposite = actor => actor === "zhang" ? "li" : "zhang";
const displayDay = moment => moment === "day" ? "白天" : "夜间";
const enumOf = values => ({ type: "string", enum: values });
const struct = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const arrayOf = (items, maxItems) => ({ type: "array", items, maxItems });
const str = { type: "string" };
const bool = { type: "boolean" };
const conditionsSchema = arrayOf(struct({
  subject: enumOf(relations), worked: bool,
}), 2);
const accessValues = ["any", "actor", "other", ...families, "worked", "unworked", "right"];

export const ruleSchema = struct({
  title: str,
  issue: { type: "string", description: "需澄清或无法做到的具体要求。可完整表达时填空字符串。" },
  question: struct({ to: enumOf(["player", "npc"]), text: str }),
  warehouseAccess: enumOf(accessValues.filter(value => !["actor", "other"].includes(value))),
  workGrant: struct({
    actor: enumOf(["any", ...families]), to: enumOf([...relations, "any"]), transferable: bool,
  }),
  actions: arrayOf(struct({
    name: str, actor: enumOf(["any", ...families]), phase: enumOf(moments), conditions: conditionsSchema,
    create: struct({
      name: str, type: str, capability: enumOf(Object.keys(capabilities)), access: enumOf(accessValues.filter(value => value !== "right")),
      bindings: arrayOf(struct({ role: enumOf(Object.keys(roles)), asset: str }), 3),
    }),
  }, ["name", "actor", "phase", "create"]), 3),
}, ["title", "issue"]);

export const compilePrompt = `你是小游戏的结构化规则编译器。只编译玩家 text，不能执行动作。输入的 world 提供实际可用户、材料、面积、位置、挂点与阶段。
world.availableBindings 由引擎根据物件属性和占用状态计算，每个用途只列实际可用的 asset ID。必须从对应用途中选依据。不要拿出工所搬的材料自动当作另一项行动的材料。现场事实已经能回答的问题无需追问玩家。
每户白天至多发动一次用体力的行动，原动作搬木料会记录 worked=true。所有新建动作也是白天体力行动，各花一次。夜间住处由引擎统一结算，每户可选择一个有空位的合法住处。
需要新增建造或组装方法时，返回 actions，玩家自定义动作名 name 与产物 name、type。actor 是任一家 any 或 zhang、li。conditions 可限制 actor/other/zhang/li 的 worked；「尚未出工」用 actor worked=false。phase 必为 day。create 的 capability=shelter 使产物可住宿，必须用 bindings 绑定具体可用物资：cover 需自带系绳且防雨且有遮盖面积、ground 需有干地面积、anchor 需能固定系绳，引擎占用三者并计算面积小的一方容量。capability=object 可用同一组真实绑定声明其它无住宿效果的物件，不能额外发明属性或效果。
create.access 可为 any、actor（建造者）、other（另一户）、zhang、li、worked、unworked。没有说谁能住时按文字自然含义决定；说本户搭成后自己住就用 actor。不提供 actions 时省略该字段。
若想出工后获得仓房权利，使用 workGrant= { actor:any/zhang/li, to:actor/other/zhang/li/any, transferable:true/false }，同时 warehouseAccess=right。资格仅在玩家实际搬木料后产生；可转赠时，引擎提供移交按钮。单独限制仓房可用 warehouseAccess=any/zhang/li/worked/unworked。
找不到材料或角色、需要凭空增加物资、无依据地改属性、安排夜间建造、容量超出物理条件或其它要求无法表达时，在 issue 明确指出词句与缺口。若有办法澄清或缩小方案，用 question 只问一个具体问题：玩家的选择问 player，NPC 原话或居民意愿可以问 npc。把输入 answers 的逐轮答复同原提案一起理解；归纳真实回答，不能代替对方决定。如果条件已足够，就省略 question，issue 填空，返回可执行计划。不添加原话没有的限制。允许省略不用的 actions/workGrant/warehouseAccess；可执行计划至少提供一项措施。`;

export function newWarehouse(assets = defaultAssets) {
  return {
    phase: "day", households: Object.fromEntries(families.map(id => [id, {
      id, label: FAMILIES[id], action: 1, worked: false, lodging: null, canTie: true,
    }])),
    assets: structuredClone(assets), locks: {}, places: [{ ...warehouse }], rights: [], plan: null, source: "",
    ledger: [], last: "",
  };
}

export function assetText(asset) {
  return Object.entries(asset.props).flatMap(([property, value]) =>
    typeof value === "number" ? [propsText[property] + value + "户"] : value ? [propsText[property]] : []
  ).filter(Boolean).join(" · ");
}

export function snapshot(state) {
  return {
    phase: state.phase, households: Object.values(state.households), places: state.places,
    assets: state.assets.map(asset => ({ ...asset, occupied: own(state.locks, asset.id) })),
    availableBindings: Object.fromEntries(Object.keys(roles).map(role => [
      role, availableAssets(state, role).map(({ id, name }) => ({ id, name })),
    ])),
  };
}

function availableAssets(state, role) {
  return state.assets.filter(asset => roles[role].fits(asset.props) && !own(state.locks, asset.id));
}

export class BindingProblem extends Error {
  constructor(state, role, message) {
    super(message);
    this.role = roles[role].title;
    this.candidates = availableAssets(state, role).map(asset => asset.name);
  }
}

function positivelyNamed(asset, text) {
  const names = [asset.name, ...(asset.names ?? [])];
  const clauses = text.split(/[，。；？！\n,;?!]+/);
  const mentions = clauses.filter(clause => names.some(name => clause.includes(name)));
  return mentions.length > 0 && mentions.every(clause => !/别用|不用|不使用|不要用|不得用|禁止用|没有|缺少|避开|拿走/.test(clause));
}

// Repair an unfit reference only when the proposal already names a single fitting material.
// Adopt and execute still validate the chosen asset's exact ID and occupancy.
export function groundProposal(value, state, proposalText) {
  if (!Array.isArray(value?.actions)) return { value, repairs: [] };
  const grounded = structuredClone(value), repairs = [];
  for (const action of grounded.actions) {
    const bindings = action?.create?.bindings;
    if (!Array.isArray(bindings)) continue;
    for (const binding of bindings) {
      if (!record(binding) || !own(roles, binding.role)) continue;
      const given = state.assets.find(asset => asset.id === binding.asset);
      if (!given || roles[binding.role].fits(given.props)) continue;
      // Keep explicitly competing material choices for discussion.
      if (positivelyNamed(given, proposalText)) continue;
      const candidates = availableAssets(state, binding.role).filter(asset => positivelyNamed(asset, proposalText) &&
        !bindings.some(item => item !== binding && item?.asset === asset.id));
      if (candidates.length !== 1) continue;
      const chosen = candidates[0];
      binding.asset = chosen.id;
      repairs.push(roles[binding.role].title + "按提案改用" + chosen.name + "。");
    }
  }
  return { value: grounded, repairs };
}

function checkKeys(value, allowed, message) {
  check(record(value) && Object.keys(value).every(key => allowed.includes(key)), message);
}

function text(value, length, message) {
  check(typeof value === "string" && value.trim().length > 0 && value.length <= length, message);
  return value.trim();
}

function explainCondition(condition) {
  return named[condition.subject] + (condition.worked ? "已出工" : "尚未出工");
}

export function accessLabel(access) {
  return ({ any: "任一家可住", actor: "仅建造者可住", other: "仅另一家可住", worked: "须已出工",
    unworked: "须未出工", right: "须持有仓房资格", zhang: "仅张家可住", li: "仅李家可住" })[access];
}

function bindingEvidence(state, structure, checkOccupancy = true) {
  const required = capabilities[structure.capability].roles;
  check(structure.bindings.length || required.length, "请列出支持这件物品的现场材料或地点。");
  check(required.every(role => structure.bindings.some(binding => binding.role === role)),
    "缺少" + required.filter(role => !structure.bindings.some(binding => binding.role === role)).map(role => roles[role].title).join("、") + "，无法提供「" + structure.name + "」。");
  const references = new Set(), usedRoles = new Set();
  return structure.bindings.map(binding => {
    const role = roles[binding.role];
    check(!references.has(binding.asset) && !usedRoles.has(binding.role), "同一个物件或用途不能重复计入建造条件。");
    references.add(binding.asset); usedRoles.add(binding.role);
    const asset = state.assets.find(item => item.id === binding.asset);
    if (!asset) throw new BindingProblem(state, binding.role, "草案引用的物件不存在，无法用作" + role.title + "（" + binding.asset + "）。");
    if (!role.fits(asset.props)) throw new BindingProblem(state, binding.role, asset.name + "不具备「" + role.title + "」所需属性。");
    if (checkOccupancy && own(state.locks, asset.id)) {
      throw new BindingProblem(state, binding.role, asset.name + "已被占用，不能再次用于建造。");
    }
    return { role: binding.role, asset };
  });
}

const space = (structure, evidence) => structure.capability === "shelter" ?
  Math.floor(Math.min(evidence.find(item => item.role === "cover").asset.props.cover,
    evidence.find(item => item.role === "ground").asset.props.area)) : 0;

export function validatePlan(value, state) {
  check(record(value), "草案未返回可读的规则。");
  check(typeof value.issue === "string" && value.issue.length <= 420, "草案缺少资源或权限说明。");
  check(!value.issue.trim(), value.issue.trim());
  check(!value.question?.text, "请先回答草案的澄清问题。");
  checkKeys(value, ["title", "issue", "question", "warehouseAccess", "workGrant", "actions"], "草案包含未知的操作。");
  const title = text(value.title, 35, "请给方案一个简短名称。");
  const entry = value.warehouseAccess ?? (value.workGrant ? "right" : "any");
  check(accessValues.filter(access => !["actor", "other"].includes(access)).includes(entry), "仓房入住条件无效。");
  let grant = null;
  if (value.workGrant != null) {
    checkKeys(value.workGrant, ["actor", "to", "transferable"], "出工资格含有未知字段。");
    check(["any", ...families].includes(value.workGrant.actor) && subjects.includes(value.workGrant.to) &&
      typeof value.workGrant.transferable === "boolean", "出工资格必须明确出工方、受领者和转赠条款。");
    check(entry === "right", "出工发放入仓权时，仓房应按资格办理入住。");
    grant = { ...value.workGrant };
  }
  check(entry !== "right" || grant, "仓房要求资格，但方案未说明怎样获得资格。");
  const actions = value.actions ?? [];
  check(Array.isArray(actions) && actions.length <= 3, "一套办法最多声明三种建造行动。");
  const names = new Set();
  const normalized = actions.map((action, index) => {
    checkKeys(action, ["name", "actor", "phase", "conditions", "create"], "新行动包含未知的条件或效果。");
    const name = text(action.name, 18, "请给新行动一个简短名称。");
    check(!names.has(name) && name !== "搬木料", "新行动名称不得与已有动作重复。");
    names.add(name);
    check(["any", ...families].includes(action.actor), "请指明哪一家能做「" + name + "」。");
    check(moments.includes(action.phase) && action.phase === "day", "搭建需在白天进行，夜间没有体力行动。");
    const clauses = action.conditions ?? [];
    check(Array.isArray(clauses) && clauses.length <= 2 && clauses.every(condition =>
      record(condition) && Object.keys(condition).length === 2 && relations.includes(condition.subject) &&
      typeof condition.worked === "boolean"), "「" + name + "」含无法核验的出工条件。");
    const create = action.create;
    checkKeys(create, ["name", "type", "capability", "access", "bindings"], "新物件要求修改场景没有的属性。");
    const type = text(create.type, 16, "请声明新物件的类别。");
    const label = text(create.name, 18, "请声明新物件的名称。");
    check(own(capabilities, create.capability), "现场无法提供所声明的物件能力。");
    check((accessValues.filter(access => access !== "right")).includes(create.access), "请明确新物件的使用者。");
    check(Array.isArray(create.bindings) && create.bindings.length <= 3 && create.bindings.every(binding =>
      record(binding) && Object.keys(binding).length === 2 && own(roles, binding.role) && typeof binding.asset === "string" &&
      /^[a-z][a-z0-9_-]{0,30}$/.test(binding.asset)), "材料、地点或挂点引用无效。");
    const structure = {
      name: label, type, capability: create.capability, access: create.access, bindings: create.bindings.map(binding => ({ ...binding })),
    };
    const evidence = bindingEvidence(state, structure);
    check(create.capability !== "shelter" || space(structure, evidence) >= 1, "遮盖与干地共同可用的面积不足一户。");
    return { id: "make-" + (index + 1), name, actor: action.actor, phase: action.phase,
      conditions: clauses.map(clause => ({ ...clause })), structure };
  });
  check(entry !== "any" || grant || normalized.length, "草案还没有产生可执行的变化。");
  return { title, warehouseAccess: entry, workGrant: grant, actions: normalized };
}

export function summary(state, plan) {
  return [
    "仓房 · " + accessLabel(plan.warehouseAccess),
    ...(plan.workGrant ? ["搬木料后给" + named[plan.workGrant.to] + "仓房资格 · " + (plan.workGrant.transferable ? "可转赠" : "限持有人使用")] : []),
    ...plan.actions.map(action => {
      const evidence = bindingEvidence(state, action.structure, false);
      const eligibility = [named[action.actor], ...action.conditions.map(explainCondition)].join(" · ");
      const place = action.structure;
      const mayAct = families.filter(family => action.actor === "any" || action.actor === family)
        .map(family => ({ family, issue: status(() => actionCheck(state, action, family)) }));
      const readiness = state.phase === "day" ? "。现在：" + mayAct.map(row => FAMILIES[row.family] + " " +
        (row.issue || "可执行")).join("；") : "";
      return "白天「" + action.name + "」 · " + eligibility + " · 花 1 次行动，占用 " +
        evidence.map(({asset}) => asset.name + "（" + assetText(asset) + "）").join("、") + "，完成后出现「" +
        place.name + "」，" + (place.capability === "shelter" ? "最多 " + space(place, evidence) + " 户 · " + accessLabel(place.access) : "新物件") + readiness;
    }),
  ];
}

export function compileLocally(input) {
  const compact = input.replace(/\s/g, "").replace(/[。！？!?]$/, "");
  const pieces = compact.split(/[。；;，,]/).filter(Boolean);
  const permissions = [];
  const core = pieces.filter(clause => {
    if (/^(?:这个|该|住宿)?资格(?:可以|允许|可)(?:转赠|转让|送给另一家)$/.test(clause)) { permissions.push(true); return false; }
    if (/^(?:这个|该|住宿)?资格(?:不得|不可|不能)(?:转赠|转让)$/.test(clause)) { permissions.push(false); return false; }
    if (clause === "自家用不上") return false;
    return true;
  }).join("");
  const implicitTransfer = /^出工者可以把(?:入住|住宿)资格送人$/.test(core);
  check(implicitTransfer || /^(?:出工者(?:可以|可|能)入住|谁出工谁就(?:可以入住|得到今晚的住宿资格|获得住宿资格))$/.test(core),
    "本地编译无法把「" + core.slice(0, 100) + "」编成新物件或行动。可连接模型后重新提交。");
  check(new Set(implicitTransfer ? [true, ...permissions] : permissions).size <= 1, "转赠条款相互矛盾。");
  return { title: "出工换入仓资格", issue: "", warehouseAccess: "right",
    workGrant: { actor: "any", to: "actor", transferable: implicitTransfer || permissions.includes(true) },
  };
}

function actionCheck(state, action, id) {
  const household = state.households[id];
  check(state.phase === action.phase, "「" + action.name + "」只能在" + displayDay(action.phase) + "进行。");
  check(action.actor === "any" || action.actor === id, FAMILIES[id] + "没有发动这项行动的权限。");
  check(household.action > 0, FAMILIES[id] + "今天的行动次数已用完。");
  check(household.canTie, FAMILIES[id] + "不会系绳，不能完成这项搭建。");
  for (const clause of action.conditions) {
    check(state.households[resolve(clause.subject, id)].worked === clause.worked, "条件不满足：" + explainCondition(clause) + "。");
  }
  const evidence = bindingEvidence(state, action.structure);
  const capacity = space(action.structure, evidence);
  check(action.structure.capability !== "shelter" || capacity > 0, "遮盖和空地的交集不足一户。");
  return { evidence, capacity };
}

const rightFor = (state, family) => state.rights.find(right => right.holder === family && !right.used);

function checkEntry(state, place, family) {
  const household = state.households[family];
  check(state.phase === "night", "要到入夜后才能选择住处。");
  check(!household.lodging, FAMILIES[family] + "已经选定今晚的住处。");
  check(place?.capacity > 0, "这个地点尚不能提供住宿。");
  const access = place.id === "warehouse" ? state.plan?.warehouseAccess ?? "any" : place.access;
  let authorized = false;
  if (access === "any") authorized = true;
  else if (access === "right") authorized = Boolean(rightFor(state, family));
  else if (access === "worked" || access === "unworked") authorized = household.worked === (access === "worked");
  else authorized = resolve(access, place.createdBy) === family;
  check(authorized, FAMILIES[family] + "不满足「" + place.name + "」的入住条件。");
  const occupied = Object.values(state.households).filter(other => other.lodging === place.id).length;
  check(occupied < place.capacity, "「" + place.name + "」已满。");
}

function checkGive(state, family) {
  check(state.phase !== "closed", "今晚已经结算。");
  const right = rightFor(state, family);
  check(right?.transferable, FAMILIES[family] + "没有可转赠的仓房资格。");
  const to = opposite(family);
  check(!rightFor(state, to) && !state.households[to].lodging, FAMILIES[to] + "已经有资格或住处。");
  return { right, to };
}

function checkWork(state, family) {
  check(state.phase === "day", "搬木料须在白天进行。");
  check(state.households[family].action > 0, FAMILIES[family] + "今天的行动次数已用完。");
  check(state.assets.some(asset => asset.props.portable && !own(state.locks, asset.id)), "现场没有可搬运的木料。");
}

function status(checkAction) {
  try { checkAction(); return ""; } catch (error) { return error.message; }
}

export function available(state, family) {
  const actions = [];
  if (state.phase === "day") {
    actions.push({ kind: "work", id: "work", title: "搬木料", issue: status(() => checkWork(state, family)) });
    for (const action of state.plan?.actions ?? []) {
      if (action.actor !== "any" && action.actor !== family) continue;
      actions.push({ kind: "make", id: action.id, title: action.name, issue: status(() => actionCheck(state, action, family)) });
    }
  }
  const right = rightFor(state, family);
  if (state.phase !== "closed" && right?.transferable) {
    actions.push({ kind: "give", id: "give", title: "转赠给" + FAMILIES[opposite(family)], issue: status(() => checkGive(state, family)) });
  }
  if (state.phase === "night" && !state.households[family].lodging) {
    for (const place of state.places.filter(place => place.capacity > 0)) {
      actions.push({ kind: "stay", id: place.id, title: "入住" + place.name, issue: status(() => checkEntry(state, place, family)) });
    }
  }
  return { actions, right };
}

function log(state, kind, line) {
  state.ledger.push({ kind, phase: state.phase, line });
  state.last = line;
}

export function adopt(state, value, source) {
  check(state.phase === "day" && !state.plan, "只能在白天启用一份方案。");
  const plan = validatePlan(value, state);
  const next = structuredClone(state);
  next.plan = plan;
  next.source = source;
  log(next, "plan", "已启用「" + plan.title + "」。新地点要等到有人实际搭建才出现。");
  return next;
}

export function act(state, kind, family, id) {
  check(families.includes(family), "找不到该家庭。");
  const next = structuredClone(state);
  const household = next.households[family];
  const name = FAMILIES[family];
  if (kind === "work") {
    checkWork(next, family);
    household.action--; household.worked = true;
    let entry = name + "搬了木料，已用今天的行动。";
    const grant = next.plan?.workGrant;
    if (grant && (grant.actor === "any" || grant.actor === family)) {
      const targets = grant.to === "any" ? families : [resolve(grant.to, family)];
      for (const target of targets) {
        if (rightFor(next, target)) continue;
        next.rights.push({ id: next.rights.length + 1, holder: target, earnedBy: family, used: false, transferable: grant.transferable });
      }
      entry += "按方案登记仓房资格给" + targets.map(key => FAMILIES[key]).join("、") + "。";
    }
    log(next, "action", entry);
  } else if (kind === "make") {
    const action = next.plan?.actions.find(item => item.id === id);
    check(action, "该行动尚未启用。");
    const { evidence, capacity } = actionCheck(next, action, family);
    const site = {
      id: "created-" + next.places.length, name: name + "的" + action.structure.name,
      type: action.structure.type, capacity, access: action.structure.access,
      location: evidence.find(entry => entry.role === "ground")?.asset.id ?? null,
      createdBy: family, dependencies: evidence.map(entry => entry.asset.id),
    };
    household.action--;
    for (const dependency of site.dependencies) next.locks[dependency] = site.id;
    next.places.push(site);
    log(next, "action", name + "执行「" + action.name + "」，占用" + evidence.map(entry => entry.asset.name).join("、") +
      "，现场出现「" + site.name + "」" + (capacity ? "，可住 " + capacity + " 户。" : "。"));
  } else if (kind === "give") {
    const { right, to } = checkGive(next, family);
    right.holder = to;
    log(next, "action", name + "将仓房资格转给" + FAMILIES[to] + "，原持有者失去该资格。");
  } else if (kind === "stay") {
    const place = next.places.find(item => item.id === id);
    checkEntry(next, place, family);
    household.lodging = place.id;
    if (place.id === "warehouse" && next.plan?.warehouseAccess === "right") rightFor(next, family).used = true;
    log(next, "action", name + "选定「" + place.name + "」过夜。");
  } else {
    throw new Error("无法执行未知操作。");
  }
  return next;
}

export function advance(state) {
  check(state.phase !== "closed", "今晚已经结算。");
  const next = structuredClone(state);
  if (next.phase === "day") {
    next.phase = "night";
    log(next, "phase", "天黑了。现在按实际存在的住处和空位安排过夜。");
  } else {
    next.phase = "closed";
    for (const household of Object.values(next.households)) {
      const place = next.places.find(item => item.id === household.lodging);
      log(next, "result", household.label + (place ? "在「" + place.name + "」过夜。" : "今晚在外露宿。"));
    }
    next.last = "夜间结算完成。";
  }
  return next;
}

export function currentPlaces(state) {
  return state.places.map(place => ({ ...place,
    residents: Object.values(state.households).filter(household => household.lodging === place.id).map(household => household.label),
  }));
}
