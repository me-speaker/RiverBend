import {
  LAST_DAY, BED_LIMIT, SHIP_LIMIT, FARE, CREW_COST, places, parties, triggers, resources, verifiers,
  newRelief, openRelief, persistRelief, commitRelief, newPlan, summarize, situation, morningProposals, defaultDraft,
  draftLocally, reviewRule, signRule, ruleText, settleRelief, canExtend,
} from "./relief-engine.js";
import { readModelSettings, requestStructuredModel } from "./browser-model.js";
import { createRiverMap } from "./river-map.js";

const labels = {
  shelter: ["hall", "hall", "今晚留宿与离所名册"],
  dock: ["old_quay", "river", "一条船，每趟最多八户"],
  village: ["old_field", "food", "验房、修屋与到家核验"],
  warehouse: ["new_quay", "wood", "六户空间，分配给集市或安置"],
};
const terrain = [
  ["hall",0,0,"town",1],["old_field",-1,0,"farm",1],["old_woods",1,-1,"wood",1],
  ["old_quay",0,1,"trade",1],["north_field",0,-1,"farm"],["east_forest",1,0,"wood"],
  ["west_quay",-1,1,"trade"],["upper_river",-1,-1,"river"],["north_woods",1,-2,"wood"],
  ["north_ridge",2,-2,"hill"],["upland",0,-2,"farm"],["backwoods",2,0,"wood"],
  ["west_ridge",-2,0,"hill"],["east_river",2,-1,"river"],["west_meadow",-2,1,"farm"],
  ["new_quay",1,1,"trade",1],["south_river",-1,2,"river"],["south_quay",-2,2,"trade"],["south_ridge",0,2,"hill"],
].map(([id,q,r,kind,improved]) => ({
  id, q, r, kind, improved: Boolean(improved),
  name: places[Object.keys(labels).find(key => labels[key][0] === id)] ?? "河湾河滩",
}));

const shell = `
<div class="relief-board"><div id="reliefMap" aria-label="河湾镇六角地图"></div></div>
<header class="relief-header">
 <div class="relief-brand" aria-label="河湾议会，灾后七日"><svg class="art-icon" aria-hidden="true"><use href="#ico-brand"/></svg><span>河湾议会<small>灾后七日 · 领了米的人为什么没走</small></span></div>
 <div class="relief-calendar" id="reliefCalendar"></div>
 <div id="reliefStats" class="relief-stats" aria-label="安置总览"></div>
 <nav aria-label="关卡与设置">
  <button type="button" class="soft-button" data-command="ledger">安置账本</button>
  <button type="button" class="soft-button" data-command="settings">模型设置</button>
  <a class="soft-button" href="#seasons">八季经营</a>
 </nav>
</header>
<div class="relief-frame">
  <div id="reliefMapFit" aria-hidden="true"></div>
  <div class="relief-map-tools">
   <button type="button" data-command="zoom-in" title="放大地图" aria-label="放大地图"><svg class="ui-icon" aria-hidden="true"><use href="#ui-plus"/></svg></button>
   <button type="button" data-command="zoom-out" title="缩小地图" aria-label="缩小地图"><svg class="ui-icon" aria-hidden="true"><use href="#ui-minus"/></svg></button>
   <button type="button" data-command="rotate" title="旋转地图" aria-label="旋转地图"><svg class="ui-icon" aria-hidden="true"><use href="#ui-rotate"/></svg></button>
   <button type="button" data-command="fit" title="还原视角" aria-label="还原视角"><svg class="ui-icon" aria-hidden="true"><use href="#ui-fit"/></svg></button>
  </div>
  <section class="relief-panel relief-register" id="reliefRegister" aria-label="查阅家庭" hidden></section>
  <section class="relief-controls relief-panel" id="reliefControls" aria-labelledby="reliefPanelTitle" hidden>
   <div class="relief-panel-head"><div><h2 id="reliefPanelTitle">今日调度</h2><small id="reliefDue"></small></div><button type="button" class="icon-button" data-command="close-panel" aria-label="收起政务面板"><svg class="ui-icon" aria-hidden="true"><use href="#ui-close"/></svg></button></div>
   <div id="reliefSchedule" class="relief-tab"></div>
   <div id="reliefCouncil" class="relief-tab" hidden>
    <div id="reliefVoices"></div>
    <section class="relief-block">
     <h3>拟写政令</h3>
     <label for="reliefDraft">想让哪件事发生后，给谁什么资格或付款？</label>
     <textarea id="reliefDraft" rows="3" maxlength="500" placeholder="受灾户每帮工班修一天屋顶，就挣一晚仓房住宿；自家用不上，可以转给别家。"></textarea>
     <div class="relief-actions">
      <select id="reliefSource" aria-label="草案解读方式"><option value="local">本地规则代表</option><option value="model">大模型议会</option></select>
      <button type="button" class="soft-button" data-command="parse">审议草案</button>
     </div>
     <p id="reliefDraftStatus" class="relief-message" role="status"></p>
     <div id="reliefEditor"></div>
    </section>
    <section id="reliefRules" class="relief-block"></section>
   </div>
   <div id="reliefRights" class="relief-tab" hidden></div>
   <div id="reliefPreview" class="relief-preview" aria-live="polite"></div>
  </section>
</div>
<footer class="relief-dock">
 <nav class="relief-sites" id="reliefSites" aria-label="查看地点"></nav>
 <div class="relief-dock-actions">
  <p class="relief-status" id="reliefDockStatus" role="status" hidden></p>
  <nav class="relief-tabs" aria-label="政务与结算">
   <button type="button" data-tab="schedule" aria-controls="reliefControls" aria-expanded="false">调度</button>
   <button type="button" data-tab="council" aria-controls="reliefControls" aria-expanded="false">议会与政令</button>
   <button type="button" data-tab="rights" aria-controls="reliefControls" aria-expanded="false">凭证与承诺</button>
   <button type="button" class="primary" id="reliefEnd" data-command="settle">结算今晚 <span aria-hidden="true">→</span></button>
   <button type="button" class="primary" id="reliefClosing" data-command="ledger" hidden>核对两份结案账</button>
  </nav>
 </div>
</footer>
<dialog class="relief-dialog" id="reliefLedger" aria-labelledby="reliefLedgerTitle">
 <div class="dialog-head"><h2 id="reliefLedgerTitle">安置账本</h2><button class="icon-button close-dialog" data-command="close-ledger" type="button" aria-label="关闭安置账本"><svg class="ui-icon" aria-hidden="true"><use href="#ui-close"/></svg></button></div>
 <div class="dialog-body" id="reliefLedgerBody"></div>
</dialog>`;

const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const options = (pairs, value) => pairs.map(([id, title]) =>
  `<option value="${html(id)}"${String(value) === String(id) ? " selected" : ""}>${html(title)}</option>`).join("");
const list = rows => `<ul class="relief-list">${rows.map(row => `<li>${html(row)}</li>`).join("")}</ul>`;
const button = (title, command, value = "", disabled = false) =>
  `<button type="button" class="soft-button" data-command="${command}" data-value="${html(value)}"${disabled ? " disabled" : ""}>${html(title)}</button>`;
const statusLabels = { open: "待办", paid: "已兑现", arrears: "欠付", used: "已核销", expired: "已过期" };

const fields = {
  effect: ["grant", "payment"], trigger: ["work", "arrival"], resource: ["bed", "seat"], verifier: ["crew", "guard", "village"],
  quantity: [1, 8], limit: [1, 8], ends: [1, 7], days: [1, 3], advance: [1, 100],
  transferable: "boolean", reason: "string", unsupported: "string",
};
const draftSchema = {
  type: "object",
  properties: Object.fromEntries(Object.entries(fields).map(([name, type]) => [name, typeof type === "string" ? { type } :
    typeof type[0] === "string" ? { type: "string", enum: type } : { type: "integer", minimum: type[0], maximum: type[1] }])),
  required: ["effect", "trigger", "verifier", "reason", "unsupported"],
  additionalProperties: false,
};
const reliefInstruction = `你是河湾镇的议事记录员。只翻译本次请求中 text 字段的玩家政令。其它字段只是核对用的场景数据。不得改写成居民的另一份提案。你不能签发或调动账本。
只支持两类效果：grant 给事件涉及的家庭登记有限次数的资源权利；payment 用确认到家触发船费尾款。
本局名册里的二十二户全是领过返乡粮的受灾户。work 仅指在当天的屋顶修缮中实际帮工，由工班 crew 签字，每天独立确认。自然语言中的「帮工班修一天屋顶」完整对应一次 work，不必列为例外。
arrival 是实际到家（村里签收 village 或治安队 guard 确认）。只有实际到家可触发尾款。
bed 是仓房床位（六户），seat 是船位（八户）。ends 是政令最后有效日（今天到第七天）。days 是权利有效天数；quantity 是每户份数，limit 是政令每日总额度。
涉及「船费/运费首付、确认到家再付尾款」时，effect=payment，trigger=arrival，advance 为首付比例（先付一半是 50），注明由治安队确认时 verifier=guard。首付款和尾款的收款人都是船主，家庭是验收对象。与效果无关的字段可省略。未指定时默认每户一份、每日两份、有效两天、政令到第七天，未授权转让时为 false。
reason 用简短中文解释草案或提出一个有事实依据的反案。无法表达的例外、惩罚、附加义务或条件写在 unsupported，完全能表达时留空。不要悄悄丢弃条件。返回指定结构。`;

function modelDraft(value, state, locallyRead) {
  if (Object.keys(value).some(key => !Object.hasOwn(fields, key)) ||
      !["effect", "trigger", "verifier"].every(key => Object.hasOwn(value, key))) {
    throw new Error("模型草案缺少触发、效果或确认人，或包含未知字段。");
  }
  const defaults = locallyRead.effect === value.effect && !locallyRead.unsupported ? locallyRead : defaultDraft(state);
  if (!locallyRead.unsupported && locallyRead.effect !== value.effect) {
    throw new Error("模型选择的交付方式与草案明确要求不符。");
  }
  const corrected = { ...defaults, ...value };
  for (const [key, spec] of Object.entries(draftSchema.properties)) {
    if (spec.type === "integer" && typeof corrected[key] === "string" && /^[0-9]+$/.test(corrected[key])) {
      corrected[key] = Number(corrected[key]);
    }
  }
  if (["true", "false"].includes(corrected.transferable)) corrected.transferable = corrected.transferable === "true";
  if (!Object.keys(fields).every(key => {
    const spec = draftSchema.properties[key], datum = corrected[key];
    if (spec.enum) return spec.enum.includes(datum);
    if (spec.type === "integer") return Number.isInteger(datum) && datum >= spec.minimum && datum <= spec.maximum;
    return typeof datum === spec.type && (typeof datum !== "string" || [...datum].length <= 280);
  })) throw new Error("大模型返回的字段未通过草案校验。");
  return corrected;
}

export function mountRelief(host, openSettings) {
  host.innerHTML = shell;
  const by = id => host.querySelector("#" + id);
  let state = openRelief(), plan = newPlan(), currentPlace = "shelter", selected = "h1", tab = null;
  let draft = null, replace = "", concession = false, preview, map, request = 0, waiting = false;
  let draftMessage = "", status = "";
  const openGroups = new Set(["ship"]);
  const history = by("reliefLedger");
  const resident = id => state.households.find(house => house.id === id);
  const toggle = (array, value) => array.includes(value) ? array.filter(entry => entry !== value) : [...array, value];
  const visibleRules = () => state.rules.filter(rule => rule.end >= state.day && !rule.retired);
  const unsettled = () => state.households.filter(house => house.location !== "village" && !house.stable);
  const smallIcon = icon => `<svg class="ui-icon" aria-hidden="true"><use href="#ico-${icon}"/></svg>`;
  const choice = (id, title, checked, disabled) => `<label class="relief-check"><input type="checkbox" data-plan="${id}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}> ${html(title)}</label>`;
  const note = content => `<p class="relief-note">${html(content)}</p>`;
  const capacity = type => type === "passengers" ? SHIP_LIMIT : ["permanent","temporary"].includes(type) ? BED_LIMIT : type === "clear" ? 22 : 2;
  function group(name, title, inner) {
    return `<details class="relief-block relief-group" data-group="${name}"${openGroups.has(name) ? " open" : ""}>
      <summary><strong>${title}</strong><svg class="ui-icon" aria-hidden="true"><use href="#ui-down"/></svg></summary>${inner}</details>`;
  }
  function chips(type, people) {
    if (!people.length) return note("眼下没有符合条件的家庭。");
    return `<div class="relief-chips">${people.map(house => {
      const checked = plan[type].includes(house.id);
      const disabled = state.finished || (!checked && plan[type].length >= capacity(type));
      const title = house.name + (type === "passengers" && house.home === "damaged" && !plan.repairs.includes(house.id) ? " · 待修" : "");
      return `<button type="button" aria-pressed="${checked}" data-pick="${type}" data-house="${house.id}"${disabled ? " disabled" : ""}>${html(title)}</button>`;
    }).join("")}</div>`;
  }

  function renderStats() {
    const total = summarize(state);
    by("reliefCalendar").innerHTML = `<b>${state.finished ? "七日结案" : "第 " + state.day + " / 7 天"}</b>
      <div aria-hidden="true">${Array.from({ length: LAST_DAY }, (_, i) => `<i class="${i + 1 <= state.day ? "passed" : ""}"></i>`).join("")}</div>`;
    by("reliefStats").innerHTML = [
      ["公款", state.silver + " 银", "coin"], ["实际返乡", total.home + " 户", "river"],
      ["长期安置", total.stable + " 户", "hall"], ["仍待住稳", total.temporary + total.exposed + " 户", "population"],
    ].map(([name, value, icon]) => `<div class="relief-stat">${smallIcon(icon)}<div><span>${name}</span><strong>${value}</strong></div></div>`).join("");
    by("reliefDue").textContent = state.obligations.some(item => item.status === "open" && item.due <= state.day)
      ? "有承诺今日到期" : "一艘船 · 一个工班 · 一支治安队";
  }
  function renderMap() {
    by("reliefSites").innerHTML = Object.entries(labels).map(([key, [,icon]]) =>
      `<button type="button" data-place="${key}" aria-controls="reliefRegister" aria-expanded="${tab === "register" && key === currentPlace}">
        ${smallIcon(icon)}<span><strong>${places[key]}</strong><small>${state.households.filter(house => house.location === key).length} 户在此</small></span></button>`).join("");
    map?.select(labels[currentPlace][0]);
  }
  function renderRegister() {
    const rows = state.households.filter(house => {
      if (currentPlace === "shelter") return ["shelter","outside"].includes(house.location);
      if (currentPlace === "dock") return house.location === "dock" || (house.home !== "lost" && !house.stable);
      if (currentPlace === "village") return house.home !== "lost";
      return house.home === "lost" || house.location === "warehouse";
    });
    const house = rows.find(entry => entry.id === selected) ?? rows[0];
    selected = house?.id;
    const planned = house && [["repairs","修缮"],["helpers","帮工"],["passengers","候船"],["temporary","短住"],
      ["permanent","长住"],["clear","离所"]].filter(([key]) => plan[key].includes(house.id)).map(([, title]) => title).join("、");
    by("reliefRegister").innerHTML = `<div class="relief-panel-head">
      <div><h2>${places[currentPlace]}</h2><small>${labels[currentPlace][2]}</small></div>
      <button type="button" class="icon-button" aria-label="收起家庭名册" data-command="close-panel"><svg class="ui-icon" aria-hidden="true"><use href="#ui-close"/></svg></button></div>
      <div class="relief-register-body">${house ? `<label for="reliefHouse">查户</label>
      <select id="reliefHouse">${options(rows.map(row => [row.id, row.name + " · " + situation(row)]), selected)}</select>
      <p><strong>${house.name}</strong> · 今早在${places[house.location]} · ${situation(house)}</p>
      ${house.skilled ? note("会木工，可随工班帮工。") : ""}
      ${planned ? note("今日安排：" + planned) : ""}` : note("此处暂无相关住户。")}</div>`;
  }

  function renderSchedule() {
    for (const section of by("reliefSchedule").querySelectorAll("details[data-group]")) {
      if (section.open) openGroups.add(section.dataset.group);
      else openGroups.delete(section.dataset.group);
    }
    const people = unsettled();
    const returnees = people.filter(house => house.home !== "lost");
    const broken = people.filter(house => house.home === "damaged");
    const warehouseMode = ["market","buy"].includes(plan.warehouse) ? "permanent" : "temporary";
    const ended = state.finished;
    by("reliefSchedule").innerHTML = `
     ${group("ship", "码头 · " + plan.passengers.length + " / 8 户", `
       ${note("常规一趟 " + FARE + " 银。可以安排当日修好屋顶的家庭同日登船。")}
       ${chips("passengers", returnees)}
       <div class="relief-actions">${button("安排可返乡家庭", "fill-ship", "", ended || !returnees.length)}
         ${visibleRules().some(rule => rule.effect === "payment") ? choice("split", "按政令分期付船费", plan.split, ended) : ""}</div>`)}
     ${group("repair", "村庄 · " + plan.repairs.length + " / 2 户修缮", `
       ${note("一个工班，一天最多修两户，工料 " + CREW_COST + " 银。")}
       ${chips("repairs", broken)}
       <div class="relief-actions">${button("安排两户待修", "fill-repair", "", ended || !broken.length)}</div>
       <h4>帮工名单</h4>${chips("helpers", people.filter(house => house.skilled))}`)}
     ${group("warehouse", "商会仓房 · 使用授权", `
       <label for="reliefWarehouse">给今天的仓房安排</label>
       <select id="reliefWarehouse" data-plan="warehouse"${ended ? " disabled" : ""}>${options([
         ["none","按既有政令与凭证开放"], ["borrow","协商短借 · 3 户"], ["borrowAll","协商短借 · 6 户，承诺复市摊位"],
         ["market","长期改用 · 以复市摊位交换"], ["buy","买断长期使用权 · 每户 1 银"], ["take","派队征用 · 当晚最多 6 户，承诺补偿"],
       ], plan.warehouse)}</select>
       ${plan.warehouse === "none" ? note("凭证可在「凭证与承诺」里安排兑付。") :
          `<h4>${warehouseMode === "permanent" ? "长期入住" : "今晚短住"} · ${plan[warehouseMode].length} 户</h4>
             ${chips(warehouseMode, people)}
             <div class="relief-actions">${button("优先选无房家庭", "fill-bed", warehouseMode, ended)}</div>`}
       ${choice("market", "兑现承诺：登记复市优先摊位", plan.market, ended)}`)}
     ${group("guard", "治安队与收容所", `
       <label for="reliefGuard">治安队今日任务</label>
       <select id="reliefGuard" data-plan="guard"${ended ? " disabled" : ""}>${options([
         ["idle","待命"],["dock","协助码头并随船验收"],["order","维护发放秩序"],["take","接管商会仓房"],
       ], plan.guard)}</select>
       <h4>登记离所</h4>${note("离所者若还没到家或入住，今晚仍可能留在码头。")}${chips("clear", people.filter(house => house.location === "shelter"))}
       ${state.day === LAST_DAY ? choice("keepShelter", "留 2 银由管事续办临时收容", plan.keepShelter, ended) : ""}`)}
     `;
  }

  function renderCouncil() {
    const configured = readModelSettings().configured;
    by("reliefSource").querySelector('[value="model"]').disabled = !configured;
    if (!configured) by("reliefSource").value = "local";
    by("reliefVoices").innerHTML = `<div class="relief-morning"><h3>今早来议事的人</h3>
      ${morningProposals(state).map((item, index) => `<article>
        <strong>${parties[item.party]}</strong><p>${html(item.text)}</p>${item.draft ? button("用这份提案起草", "use-draft", index) : ""}</article>`).join("") ||
        note("本章已经结案。")}</div>`;
    by("reliefDraftStatus").textContent = waiting ? "代表正在审议，可以继续调度或结算当天。" : draftMessage;
    by("reliefDraft").disabled = state.finished;
    by("reliefCouncil").querySelector('[data-command="parse"]').disabled = state.finished || waiting;
    renderEditor();
    by("reliefRules").innerHTML = `<h3>已签发的政令</h3>${state.rules.length ? state.rules.map(rule =>
      `<article class="relief-rule"><strong>${html(rule.id)} · 第 ${rule.start}–${rule.end} 天${rule.retired ? " · 已修订" : ""}</strong>
      <p>${html(ruleText(rule))}</p>
      ${!state.finished && !rule.retired && rule.end >= state.day ? button("修订此令", "edit-rule", rule.id) : ""}</article>`).join("") :
      note("签发后的规则和更早的版本会记在这里。")}`;
  }

  function renderEditor() {
    if (!draft) { by("reliefEditor").replaceChildren(); return; }
    const review = reviewRule(state, draft, concession, replace);
    const select = (key, title, pairs) => `<label>${title}<select data-field="${key}">${options(pairs, draft[key])}</select></label>`;
    const number = (key, title, min, max) => `<label>${title}<input type="number" data-field="${key}" min="${min}" max="${max}" value="${html(draft[key])}"></label>`;
    by("reliefEditor").innerHTML = `<div class="relief-editor">
      <h4>${replace ? "修订 " + html(replace) : "拟签发条款"}</h4>
      ${draft.reason ? note(draft.reason) : ""}
      <div class="relief-fields">
       ${select("effect", "交付", [["grant","登记可核销的权利"],["payment","登记船费尾款"]])}
       ${select("trigger", "触发", Object.entries(triggers))}
       ${select("verifier", "确认人", Object.entries(verifiers))}
       ${number("ends", "生效至第几天", state.day, LAST_DAY)}
       ${draft.effect === "grant" ? select("resource", "占用资源", Object.entries(resources)) +
          number("quantity", "每户所得份数", 1, 8) + number("limit", "每日登记上限", 1, 8) + number("days", "凭证有效天数", 1, 3) :
          select("advance", "首付比例", [[25,"25%"],[50,"50%"],[75,"75%"]])}
      </div>
      ${draft.effect === "grant" ? `<label class="relief-check"><input type="checkbox" data-field="transferable"${draft.transferable ? " checked" : ""}>允许转让</label>` : ""}
      ${draft.effect === "grant" && draft.resource === "bed" ? `<label class="relief-check"><input type="checkbox" id="reliefConcession"${concession ? " checked" : ""}>接受商会条件：复市时给优先摊位</label>` : ""}
      <p>${html(ruleText(draft))}</p>
      ${replace ? note("修订从今天生效，已发凭证按原期限保留。") : ""}
      <div class="relief-objections">${review.responses.map(item => `<p><strong>${parties[item.party] ?? verifiers[item.party]}</strong> ${html(item.text)}</p>`).join("")}</div>
      ${review.issues.length ? `<div class="relief-problem">${list(review.issues)}</div>` : note("授权条件已满足。签发后，只有事件实际发生才登记。")}
      <div class="relief-actions">${button("试算条款", "trial", "", Boolean(review.issues.length))}${button("签发政令", "sign", "", Boolean(review.issues.length))}</div>
      <p id="reliefTrial" class="relief-note" role="status"></p>
    </div>`;
  }

  function renderRights() {
    const queued = new Map(plan.transfers.map(item => [item.id, item.to]));
    const earnedToday = (preview?.state.rights ?? []).filter(row => row.issued === state.day &&
      !state.rights.some(right => row.id === right.id));
    const cards = [...state.rights].reverse().concat(earnedToday).map(right => {
      const holder = resident(earnedToday.includes(right) ? right.earnedBy : right.holder);
      const newHolder = resident(queued.get(right.id));
      const eligible = unsettled().filter(house => house.id !== holder.id);
      const available = !state.finished && (right.status === "open" || earnedToday.includes(right));
      return `<article class="relief-rule"><strong>${right.id} · ${resources[right.resource]} · ${html(holder.name)}</strong>
       <p>${earnedToday.includes(right) ? "等待实际出工或到家后入账" : (statusLabels[right.status] ?? right.status)} · 第 ${right.expires} 天到期${newHolder ? " · 计划转给" + html(newHolder.name) : ""}</p>
       ${available ? `<div class="relief-actions">${right.transferable && eligible.length ?
          `<select aria-label="转交 ${right.id}" data-transfer="${right.id}">${options([["","选择受让家庭"], ...eligible.map(house => [house.id, house.name])], queued.get(right.id) ?? "")}</select>` : ""}
          ${button(plan.claims.includes(right.id) ? "撤销申请" : "安排本晚核销", "claim", right.id)}
       </div>` : ""}</article>`;
    });
    const debts = state.obligations.filter(row => ["open","arrears"].includes(row.status));
    by("reliefRights").innerHTML = `
     <section class="relief-block"><h3>权利凭证</h3>
       ${cards.join("") || note("签发的政令会在实际出工或验收后登记权利。可转让的凭证可以换持有人。")}
       ${plan.transfers.length || plan.claims.length ? button("清空本日转让与核销安排", "clear-rights") : ""}</section>
     <section class="relief-block"><h3>未结承诺</h3>${debts.length ? debts.map(item =>
       `<article class="relief-rule"><strong>${html(parties[item.party])} · ${html(item.label)}</strong><p>第 ${item.due} 天到期 · ${statusLabels[item.status]}${item.amount ? " · " + item.amount + " 银" : ""}</p>
       <div class="relief-actions">
         ${item.type === "silver" ? button(plan.payments.includes(item.id) ? "撤销付款" : "安排付款", "pay", item.id, state.finished) : ""}
         ${canExtend(state, item) ? button(plan.extensions.includes(item.id) ? "撤销延期" : "协商延期一天", "extend", item.id, state.finished) : ""}
       </div></article>`).join("") :
          note("暂无待兑付的承诺。")}</section>`;
  }

  function renderLedger(day = String(state.nights.at(-1)?.day ?? "now")) {
    const night = state.nights.find(item => String(item.day) === day);
    const people = night?.households ?? state.households;
    const count = night?.summary ?? summarize(state);
    const lines = (night?.obligations ?? state.obligations).map(item => parties[item.party] + " · " + item.label + "（第 " + item.due + " 天 · " + statusLabels[item.status] + "）");
    const disputes = (night?.disputes ?? state.disputes).map(item => "第 " + item.day + " 天 · " + parties[item.party] + " · " + item.text + (item.resolved ? " 第 " + item.resolved + " 天处理。" : ""));
    by("reliefLedgerBody").innerHTML = `
      ${!state.nights.length ? note("三十户已领返乡粮，八户已到家。县里给你七天，安置留在河湾的二十二户。") : ""}
      <label for="reliefLedgerDay">查看哪天的记录</label>
      <select id="reliefLedgerDay">${options([["now","当前账本"], ...state.nights.map(row => [row.day, "第 " + row.day + " 天晚报"])], day)}</select>
      <section class="relief-block"><h3>县里名册</h3>
       ${list(["领返乡粮 " + count.grain + " 户", "曾登记离所 " + count.departed + " 户", "实际返乡 " + count.returned + " 户（含接手前 8 户）"])}</section>
      <section class="relief-block"><h3>镇上逐户安置</h3>
       ${note("实际到家 " + count.home + " 户 · 长期住处 " + count.stable + " 户 · 临住 " + count.temporary + " 户 · 露宿 " + count.exposed + " 户")}
       <div class="relief-house-table">${people.map(house =>
          `<div><strong>${html(house.name)}</strong><span>${places[house.location]}</span><span>${situation(house)}</span></div>`).join("")}</div>
      </section>
      <section class="relief-block"><h3>账款与合作</h3>
       ${note("公款 " + (night?.silver ?? state.silver) + " 银 · 已租船 " + (night?.trips ?? state.trips) + " 趟 · 已用 " + (night?.crewDays ?? state.crewDays) + " 工班日")}
       ${list(Object.entries(night?.credit ?? state.credit).map(([party, credit]) => parties[party] + " · 履约信用 " + credit + " / 100"))}
       <h4>承诺流转</h4>${lines.length ? list(lines) : note("暂无承诺。")}
       <h4>实际负担与争议</h4>${disputes.length ? list(disputes) : note("没有登记的争议。")}
      </section>
      ${night?.logs.length ? `<section class="relief-block"><h3>当晚经过</h3>${list(night.logs)}</section>` : ""}
      ${button("重新接手七日安置", "restart")}`;
  }

  function renderPreview() {
    preview = null;
    let message = "";
    if (!state.finished) {
      try {
        preview = settleRelief(state, plan);
        const result = preview.night.summary;
        message = "预估 公款 " + preview.state.silver + " 银 · 到家 " + result.home + " 户 · 长住 " + result.stable + " 户";
      } catch (error) { message = error.message; }
    }
    const dockStatus = by("reliefDockStatus");
    dockStatus.textContent = !preview && message ? message : status;
    dockStatus.hidden = !dockStatus.textContent;
    by("reliefPreview").replaceChildren();
    if (message) by("reliefPreview").insertAdjacentHTML("beforeend",
      `<p class="${preview ? "relief-note" : "relief-problem"}">${html(message)}</p>`);
    if (preview?.night.logs.length) by("reliefPreview").insertAdjacentHTML("beforeend",
      `<details><summary>查看今晚的预计变化</summary>${list(preview.night.logs)}</details>`);
    by("reliefEnd").disabled = !preview;
    by("reliefEnd").hidden = state.finished;
    by("reliefClosing").hidden = !state.finished;
  }
  function showTab() {
    const tabs = {
      schedule: ["reliefSchedule", "今日调度"], council: ["reliefCouncil", "议会与政令"], rights: ["reliefRights", "凭证与承诺"],
    };
    for (const [key, [id]] of Object.entries(tabs)) by(id).hidden = tab !== key;
    by("reliefControls").hidden = !Object.hasOwn(tabs, tab);
    by("reliefRegister").hidden = tab !== "register";
    by("reliefPanelTitle").textContent = tabs[tab]?.[1] ?? "";
    host.dataset.panelOpen = String(tab !== null);
    for (const button of host.querySelectorAll("[data-tab]")) button.setAttribute("aria-expanded", String(button.dataset.tab === tab));
    for (const button of by("reliefSites").querySelectorAll("[data-place]")) {
      button.setAttribute("aria-expanded", String(tab === "register" && currentPlace === button.dataset.place));
    }
  }
  function render() {
    renderStats(); renderMap(); renderRegister(); renderPreview(); renderSchedule(); renderCouncil(); renderRights(); showTab();
  }
  function changePlace(place) {
    currentPlace = place;
    tab = "register";
    map?.select(labels[place][0]);
    renderRegister(); showTab();
  }
  function closePanel() {
    const trigger = tab === "register" ? by("reliefSites").querySelector(`[data-place="${currentPlace}"]`) :
      host.querySelector(`[data-tab="${tab}"]`);
    tab = null;
    showTab();
    trigger?.focus({ preventScroll: true });
  }
  function invalidate() {
    request++;
    waiting = false;
  }

  async function parseDraft() {
    const text = by("reliefDraft").value.trim();
    if (!text) {
      draftMessage = "先写一份草案，或从居民提案开始。";
      renderCouncil();
      return;
    }
    draft = null; replace = ""; concession = false;
    const ticket = ++request, revision = state.revision;
    const useModel = by("reliefSource").value === "model";
    waiting = useModel;
    draftMessage = "";
    renderCouncil();
    let result = draftLocally(state, text);
    let message = "本地规则代表 · 已整理草案";
    if (useModel) {
      try {
        const reply = await requestStructuredModel(reliefInstruction, {
          text, day: state.day, silver: state.silver, credit: state.credit,
          overnight: summarize(state), limits: { warehouse: BED_LIMIT, ship: SHIP_LIMIT, crew: 2 },
          plan: { guard: plan.guard, villageWitness: state.households.some(house => house.location === "village") },
        }, draftSchema);
        result = modelDraft(reply.value, state, result);
        message = "大模型 · " + reply.model + " · " + reply.seconds.toFixed(1) + " 秒";
      } catch (error) { message = "本地规则代表 · " + error.message; }
    }
    if (ticket !== request || state.revision !== revision) return;
    waiting = false;
    draft = result;
    draftMessage = message;
    renderCouncil();
  }

  function trial() {
    const output = by("reliefTrial");
    try {
      const example = signRule(state, draft, concession, replace);
      const today = newPlan();
      const households = unsettled();
      if (draft.trigger === "work") {
        const helper = households.find(house => house.skilled);
        const damaged = households.find(house => house.home === "damaged");
        if (!helper || !damaged) throw new Error("今天缺少出工家庭或待修屋顶，无法触发这条规则。");
        today.repairs = [damaged.id]; today.helpers = [helper.id];
      } else {
        const ready = households.find(house => house.home === "ready");
        if (!ready) throw new Error("今天没有可立即到家的家庭，无法触发这条规则。");
        today.passengers = [ready.id];
        today.guard = draft.verifier === "guard" ? "dock" : "idle";
        today.split = draft.effect === "payment";
      }
      const result = settleRelief(example, today);
      const right = result.state.rights.find(row => row.rule === example.rules.at(-1).id);
      if (right) {
        const other = households.find(house => house.id !== right.holder &&
          (right.resource === "bed" ? house.home === "lost" : house.home === "ready"));
        if (right.transferable && other) today.transfers = [{ id: right.id, to: other.id }];
        today.claims = [right.id];
      }
      const calculation = right ? settleRelief(example, today) : result;
      output.textContent = "试算 · " + calculation.night.logs.join(" ");
    } catch (error) { output.textContent = "试算 · " + error.message; }
  }

  function useCommand(command, value, event) {
    status = "";
    if (command === "settings") { openSettings(); return; }
    if (command === "ledger") { renderLedger(); if (!history.open) history.showModal(); return; }
    if (command === "close-ledger") { history.close(); return; }
    if (command === "close-panel") { closePanel(); return; }
    if (command === "zoom-in" || command === "zoom-out") { map?.zoomBy(command === "zoom-in" ? 1.15 : 1 / 1.15); return; }
    if (command === "rotate") { map?.rotateBy(Math.PI / 3); return; }
    if (command === "fit") { map?.resetView(); return; }
    if (command === "restart") {
      if (!confirm("从第一天重新开始七日安置？")) return;
      invalidate();
      state = newRelief(); plan = newPlan(); draft = null; draftMessage = ""; replace = ""; concession = false;
      by("reliefDraft").value = ""; tab = null; currentPlace = "shelter"; selected = "h1";
      if (history.open) history.close();
      persistRelief(state); render(); window.scrollTo(0, 0);
      return;
    }
    if (state.finished) return;
    if (command === "parse") { void parseDraft(); return; }
    if (command === "trial") { trial(); return; }
    if (command === "use-draft") {
      by("reliefDraft").value = morningProposals(state)[Number(value)].draft;
      invalidate();
      draft = null; draftMessage = ""; renderCouncil(); by("reliefDraft").focus();
      return;
    }
    if (command === "edit-rule") {
      invalidate();
      const original = state.rules.find(rule => rule.id === value);
      draft = { ...original }; replace = value; concession = original.concession;
      draftMessage = ""; renderCouncil();
      by("reliefEditor").scrollIntoView({ block: "nearest" });
      return;
    }
    if (command === "sign") {
      try {
        state = commitRelief(state, signRule(state, draft, concession, replace));
        invalidate();
        draft = null; replace = ""; concession = false;
        draftMessage = "已签发。可到调度安排触发事项，在凭证账本核对兑现。";
      } catch (error) {
        if (error.latest) { state = error.latest; plan = newPlan(); draft = null; invalidate(); }
        draftMessage = error.message;
      }
    }
    if (command === "fill-repair") plan.repairs = unsettled().filter(house => house.home === "damaged").slice(0, 2).map(house => house.id);
    if (command === "fill-ship") plan.passengers = unsettled().filter(house =>
      house.home === "ready" || plan.repairs.includes(house.id)).slice(0, SHIP_LIMIT).map(house => house.id);
    if (command === "fill-bed") {
      const freeBeds = BED_LIMIT - state.households.filter(house => house.location === "warehouse" && house.stable).length;
      const limit = plan.warehouse === "borrow" ? Math.min(3, freeBeds) : freeBeds;
      plan[value] = unsettled().filter(house => house.home === "lost").slice(0, limit).map(house => house.id);
    }
    if (command === "claim") plan.claims = toggle(plan.claims, value);
    if (command === "pay") {
      plan.payments = toggle(plan.payments, value);
      plan.extensions = plan.extensions.filter(id => id !== value);
    }
    if (command === "extend") {
      plan.extensions = toggle(plan.extensions, value);
      plan.payments = plan.payments.filter(id => id !== value);
    }
    if (command === "clear-rights") { plan.claims = []; plan.transfers = []; }
    if (command === "settle" && event.detail <= 1) {
      try {
        const result = settleRelief(state, plan, state.revision);
        state = commitRelief(state, result.state);
        plan = newPlan(); draft = null; replace = ""; concession = false;
        draftMessage = waiting ? "前一日的草案未采用，可按今日局势重新审议。" : "";
        invalidate();
        status = "第 " + result.night.day + " 天已入账。";
      } catch (error) {
        if (error.latest) { state = error.latest; plan = newPlan(); draft = null; invalidate(); }
        status = error.message;
      }
      render();
      if (state.finished) closePanel();
      return;
    }
    render();
  }

  host.addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.command) useCommand(target.dataset.command, target.dataset.value, event);
    else if (target.dataset.place) {
      if (tab === "register" && target.dataset.place === currentPlace) closePanel();
      else changePlace(target.dataset.place);
    }
    else if (target.dataset.tab) {
      if (tab === target.dataset.tab) { closePanel(); return; }
      tab = target.dataset.tab;
      if (tab === "council") renderCouncil();
      showTab();
      by("reliefControls").scrollTop = 0;
    } else if (target.dataset.pick && !state.finished) {
      plan[target.dataset.pick] = toggle(plan[target.dataset.pick], target.dataset.house);
      render();
      host.querySelector(`[data-pick="${target.dataset.pick}"][data-house="${target.dataset.house}"]`)?.focus({ preventScroll: true });
    }
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !host.hidden && tab !== null && !document.querySelector("dialog[open]")) {
      closePanel();
    }
  });
  host.addEventListener("input", event => {
    if (event.target.id !== "reliefDraft") return;
    invalidate(); draft = null; replace = ""; concession = false; draftMessage = "";
    renderCouncil();
  });
  host.addEventListener("change", event => {
    const target = event.target;
    if (target.id === "reliefHouse") { selected = target.value; renderRegister(); return; }
    if (target.id === "reliefLedgerDay") { renderLedger(target.value); return; }
    if (state.finished) return;
    if (target.dataset.plan) {
      const key = target.dataset.plan;
      plan[key] = target.type === "checkbox" ? target.checked : target.value;
      if (key === "warehouse") {
        if (target.value === "take") plan.guard = "take";
        if (target.value !== "take" && plan.guard === "take") plan.guard = "idle";
        if (["market", "buy"].includes(target.value)) plan.temporary = [];
        else plan.permanent = [];
        if (target.value === "none") plan.temporary = [];
      }
      if (key === "guard" && target.value === "take") { plan.warehouse = "take"; plan.permanent = []; }
      if (key === "guard" && target.value !== "take" && plan.warehouse === "take") { plan.warehouse = "none"; plan.temporary = []; }
      render();
    }
    if (target.dataset.transfer) {
      const id = target.dataset.transfer;
      plan.transfers = plan.transfers.filter(item => item.id !== id);
      if (target.value) plan.transfers.push({ id, to: target.value });
      render();
    }
    if (target.id === "reliefConcession") { concession = target.checked; renderEditor(); }
    if (target.dataset.field && draft) {
      const key = target.dataset.field;
      draft[key] = key === "transferable" ? target.checked : ["quantity","limit","days","ends","advance"].includes(key) ? Number(target.value) : target.value;
      renderEditor();
    }
  });
  render();
  return {
    open() {
      renderCouncil();
      if (map || by("reliefMap").classList.contains("relief-map-flat")) return;
      try {
        map = createRiverMap(by("reliefMap"), {
          frame: by("reliefMapFit"),
          onSelect: tile => {
            const place = Object.keys(labels).find(key => labels[key][0] === tile);
            if (place) changePlace(place);
            else map.select(labels[currentPlace][0]);
          },
        });
        map.update(terrain, { season: "初春", selectedId: labels[currentPlace][0] });
      } catch {
        by("reliefMap").classList.add("relief-map-flat");
        by("reliefMap").innerHTML = `<div class="relief-river"></div><div class="relief-flat-places">${Object.entries(labels).map(([key, [,icon]]) =>
          `<button type="button" class="soft-button" data-place="${key}">${smallIcon(icon)}${places[key]}</button>`).join("")}</div>`;
        host.querySelector(".relief-map-tools").hidden = true;
      }
    },
    syncModel() { renderCouncil(); },
  };
}
