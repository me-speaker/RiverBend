import { mountRelief } from "./relief-ui.js";
import { mountWarehouse } from "./warehouse-ui.js";
import {
  advanceGame, createGame, forecastPlan, getGame, prepareCouncil, recommendLocal, recordOffer, SAVE_KEY, TRADE_TRUST,
} from "./game-engine.js";
import { readModelSettings, recommendModel, saveModelSettings, testModelSettings } from "./browser-model.js";

const el = (id) => document.getElementById(id);
const label = { food: "粮食", wood: "木材", coin: "钱币", trust: "民望", population: "人口" };
const jobs = { farm: ["务农", "food"], wood: ["伐木", "wood"], trade: ["经商", "coin"] };
const representativeKey = "river-council-representative";
let configuredModel = "";
let state,
  modelAvailable = false,
  workers = {},
  build = null,
  offer = null,
  appliedOffer = null,
  offerPlan = null;
let selected = null,
  pending = false,
  asking = false,
  forecastReady = false;
let councilSeq = 0;
function pageBusy(value) {
  pending = value;
  if (state) renderControls();
}
function playing() {
  return state && state.status === "playing";
}
function icon(name) {
  return '<svg class="inline-icon" aria-hidden="true"><use href="#ico-' + name + '"/></svg>';
}
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
function show(id, txt) {
  el(id).textContent = txt || "";
}
function list(id, strings) {
  el(id).replaceChildren(
    ...(strings || []).map((s) => {
      const li = document.createElement("li");
      li.textContent = s;
      return li;
    }),
  );
}
function draft() {
  return {
    game_id: state.game_id,
    revision: state.revision,
    workers: { ...workers },
    build,
    offer: appliedOffer?.id || null,
  };
}
function savedGame() {
  try {
    return getGame(null);
  } catch (error) {
    if (error.status !== 404) throw error;
    return null;
  }
}
function loadGame(data, newRun = false) {
  clearTimeout(receiptTimer);
  receipt.hidden = true;
  receipt.replaceChildren();
  state = data.state;
  if (newRun) {
    let preferred = "local";
    try { preferred = sessionStorage.getItem(representativeKey); } catch {}
    el("mode").value = modelAvailable && preferred === "model" ? "model" : "local";
  }
  workers = { ...state.workers };
  build = null;
  offer = null;
  appliedOffer = null;
  offerPlan = null;
  asking = false;
  councilSeq++;
  selected = newRun ? null : selected;
  selected = state.tiles.some((t) => t.id === selected)
    ? selected
    : state.tiles.find((t) => t.kind === "town")?.id || state.tiles[0]?.id;
  el("loading").hidden = true;
  el("game").hidden = false;
  el("proposal").hidden = true;
  show("councilStatus", "");
  el("intent").value = "";
  renderState();
  if (playing()) refreshForecast();
  else {
    clearForecast();
    const ending = el("ending");
    ending.tabIndex = -1;
    ending.focus({ preventScroll: true });
  }
}
const mapDefs =
  '<defs><pattern id="parchment" width="17" height="19" patternUnits="userSpaceOnUse"><circle cx="4" cy="8" r=".65" fill="#43523b" opacity=".18"/><path d="m11 15 2-1M2 4h2" stroke="#43523b" stroke-width=".55" opacity=".2"/></pattern><g id="pine" stroke="#325b4b" stroke-width=".9" stroke-linejoin="round"><path d="M0-13-5-4h2l-4 6h5l-5 5h6v4h2V7h6L3 2h4L3-4h2Z" fill="#498466"/><path d="M0-10v15m-3-6 3 2m0-5 3 2" fill="none"/></g><g id="house" stroke="#634f36" stroke-width="1" stroke-linejoin="round"><path d="m-7-3 9-5 9 5-9 5Z" fill="#cf8555"/><path d="m-6-2 8 5v8l-8-5Z" fill="#f4e5bd"/><path d="m2 3 9-5v8l-9 5Z" fill="#c5af82"/><path d="m5 6 3-1v3L5 9Z" fill="#6b6952"/></g><g id="mill" stroke="#665839" stroke-width="1" stroke-linejoin="round"><path d="m-4 10 2-18 6-1 4 19Z" fill="#dec796"/><path d="m-4-8 4-5 6 4Z" fill="#9a7049"/><path d="m2-5-7-6-2 2 7 6m2-2 6-7 2 2-6 7m-2-2 7 6-2 2-7-6m2-2-6 7-2-2 6-7" fill="#e8d4a5"/></g><g id="boat" stroke="#536c63" stroke-linejoin="round" stroke-width="1"><path d="m-8 3 15-3-3 5-8 2Z" fill="#8f7757"/><path d="M0 2v-13l-6 12Z" fill="#eee3bf"/><path d="M1-10 5-1l-4 1" fill="#d8c493"/></g></defs>';
function landDetail(t) {
  const use = (glyph, x, y, scale = 1) =>
    '<use href="#' + glyph + '" transform="translate(' + x + " " + y + ") scale(" + scale + ')"/>';
  const pat =
    '<path d="m-30 0 6-2m-9 5 5-1m51 1 5-1m-8 5 3-1" stroke="#7e875f" stroke-width="1" fill="none" opacity=".8"/>';
  if (t.kind === "wood")
    return (
      pat +
      use("pine", -10, -8, 1.1) +
      use("pine", 1, -15) +
      use("pine", 10, -7, 1.15) +
      use("pine", -1, -3, 0.9) +
      (t.improved ? use("house", 18, 1, 0.7) : "")
    );
  if (t.kind === "farm")
    return (
      pat +
      '<g transform="translate(-4 -8)" stroke-linejoin="round" stroke="#7a8050"><path d="m-19 5 22-12 18 8L0 14Z" fill="#dfb86c"/><path d="m-14 6 21-12m-16 14 21-12m-16 14L17-2M-4 12 16 1" fill="none" stroke-width="1.4"/><path d="m-17 3 21-11" stroke="#e6d49c"/></g>' +
      (t.improved ? use("mill", 10, -9) : "")
    );
  if (t.kind === "trade")
    return (
      pat +
      '<g transform="translate(0 -5)" stroke="#675c41" stroke-width="1.3"><path d="M-15-6v15m18-17V5m10-16V2" fill="none"/><path d="m-20-7 13-7 26 2-16 9Z" fill="#ab7d50"/><path d="m-20-7-1 4 24 5v-5Z" fill="#d4bf87"/><path d="m3-3 16-9v4L3 2Z" fill="#b5ac77"/><path d="m-14 6 13 3 11-6" fill="none"/></g>' +
      (t.improved ? use("house", 18, 1, 0.6) : "")
    );
  if (t.kind === "river")
    return (
      '<g stroke="#6e9791" stroke-width="1" fill="none"><path d="M-35-9q8-3 17-2m6 1q15-3 27-7M-39-4q12-3 18-2m25-1 26-8M-22 2q12-3 20-3m13-1q8-1 21-6M-13 8q10-4 18-3"/></g>' +
      use("boat", 0, -6, 1.1)
    );
  if (t.kind === "hill")
    return '<g transform="translate(0 -4)" stroke="#626b55" stroke-width="1" stroke-linejoin="round"><path d="m-24 5 13-19 13 17Z" fill="#aab094"/><path d="m-12-13 3 15 10 1Z" fill="#89977d"/><path d="M-11 6 6-17 23 3Z" fill="#b9baa0"/><path d="m6-16 3 18 13 1Z" fill="#939e84"/><path d="m-1-5 7-12 7 9-5-1-1 3-3-3Z" fill="#e0dfc7"/></g>';
  return (
    pat +
    use("house", -13, -6, 0.9) +
    use("house", 13, -8, 0.85) +
    '<g stroke="#66553c" stroke-width="1.1" stroke-linejoin="round"><path d="m-7-14 9-5 8 7-9 6Z" fill="#c9724b"/><path d="m-7-14 8 8V4l-8-4Z" fill="#e4cfa6"/><path d="m1-6 9-6v12L1 4Z" fill="#bcab81"/><path d="M0-18v-9l6 2-6 3" fill="#946442"/></g>' +
    use("house", -4, 1, 0.8)
  );
}

// The original illustrated board doubles as a playable map when WebGL is unavailable.
function createFlatMap(frame, { onSelect }) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-250 -175 500 350");
  svg.setAttribute("aria-label", "河湾地块图");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;";
  frame.prepend(svg);
  let tiles = [], activeId, plannedId, scale = 1, rotation = 0;
  const colors = { town: "#dacc98", farm: "#cbd890", wood: "#98bf89", trade: "#dfd49e", river: "#80c2c1", hill: "#afc69c" };
  const points = "0,-38 45,-19 45,19 0,38 -45,19 -45,-19";
  function paint() {
    frame.style.setProperty("--north-angle", Math.atan2(Math.sin(rotation), .7313 * Math.cos(rotation)) + "rad");
    const sites = tiles.map(tile => {
      const x = 90 * (tile.q + tile.r / 2), y = 90 * Math.sqrt(3) / 2 * tile.r;
      return { tile, x: x * Math.cos(rotation) - y * Math.sin(rotation),
        y: (x * Math.sin(rotation) + y * Math.cos(rotation)) * .7313 };
    }).sort((a, b) => a.y - b.y);
    const fields = sites.map(({ tile, x, y }) => {
      const focus = tile.id === activeId, plan = tile.id === plannedId;
      const edge = plan ? "#b56b2d" : focus ? "#faf2ab" : "#8aab85";
      return `<g transform="translate(${x},${y})" role="button" tabindex="0" aria-pressed="${focus}" data-tile="${escapeHtml(tile.id)}" aria-label="${escapeHtml(tile.name)}" style="cursor:pointer;pointer-events:auto">
        <title>${escapeHtml(tile.name + " · " + tile.detail)}</title>
        <polygon points="${points}" transform="translate(0,7)" fill="${tile.kind === "river" ? "#69a9a5" : "#a79a70"}"/>
        <polygon points="${points}" fill="${colors[tile.kind]}" stroke="${edge}" stroke-width="${focus || plan ? 3 : 1}"/>
        <polygon points="${points}" fill="url(#parchment)"/>${landDetail(tile)}
        <text x="0" y="22" text-anchor="middle" style="font:600 9px system-ui;fill:#405747;paint-order:stroke;stroke:#e9edd2;stroke-width:2.5px">${escapeHtml(tile.name)}</text>
      </g>`;
    });
    svg.innerHTML = mapDefs + `<g transform="scale(${scale})">${fields.join("")}</g>`;
  }
  function choose(event) {
    const id = event.target.closest("[data-tile]")?.dataset.tile;
    if (id) onSelect(id);
  }
  svg.addEventListener("click", choose);
  svg.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    choose(event);
    svg.querySelector('[aria-pressed="true"]')?.focus();
  });
  return {
    update(nextTiles, options) {
      tiles = nextTiles;
      activeId = options.selectedId;
      plannedId = options.plannedId;
      paint();
    },
    select(id) { activeId = id; paint(); },
    zoomBy(factor) { scale = Math.max(.65, Math.min(1.5, scale * factor)); paint(); },
    rotateBy(radians) { rotation += radians; paint(); },
    resetView() { scale = 1; rotation = 0; paint(); },
    dispose() { svg.remove(); },
  };
}

const seasons = ["spring", "summer", "autumn", "winter"];
const units = { food: "粮", wood: "木", coin: "币" };
const terrainIcons = { town: "hall", farm: "food", wood: "wood", trade: "coin", river: "river", hill: "hill" };
let map;
let mapStartup;
let forecast = null;
const councilPreview = document.createElement("p");
councilPreview.className = "council-preview minor";
el("accept").before(councilPreview);
const receipt = document.createElement("div");
receipt.className = "season-receipt";
receipt.hidden = true;
receipt.setAttribute("role", "status");
receipt.setAttribute("aria-atomic", "true");
el("forecastMsg").after(receipt);
let receiptTimer;

function drawMap() {
  map?.update(state.tiles, { season: state.season, selectedId: selected, plannedId: build });
}
function selectTile(id) {
  if (!state?.tiles.some(t => t.id === id)) return;
  selected = id;
  map?.select(id);
  renderTile();
  renderControls();
}
function tradeTrustEffect(bonus) {
  if (bonus > 0) return "经商每人多赚 1 币";
  if (bonus < 0) return "经商每人少赚 1 币";
  return "贸易收入按正常水平结算";
}
function renderState() {
  document.body.dataset.season = seasons[(state.turn - 1) % 4];
  show("season", (state.turn <= 4 ? "第一年" : "第二年") + " · " + state.season);
  show("turn", "第 " + String(state.turn).padStart(2, "0") + " / 08 季");
  show("goal", state.goal);
  show("weather", state.weather + " · 居民口粮 " + state.consumption + " 粮");
  show("built", "新建设施 " + state.built + " / 3");
  for (const [i, step] of [...el("seasonSteps").querySelectorAll("i")].entries()) {
    step.classList.toggle("complete", i < state.turn - 1 || (!playing() && i < state.turn));
    step.classList.toggle("current", i === state.turn - 1 && playing());
  }
  renderModelMode();
  show("oblig", state.obligations.map(o => "待履约 · " + o.terms).join("　"));
  el("resources").innerHTML = ["food", "wood", "coin", "population"].map(key =>
    `<div class="stat ${key}"><span class="stat-icon">${icon(key)}</span><div><small>${label[key]}</small>
    <b>${key === "population" ? state.population : state.resources[key]}</b></div></div>`).join("") +
    `<button type="button" class="stat trust" id="trustInfo" aria-haspopup="dialog" aria-label="民望 ${state.resources.trust}，查看效果">
      <span class="stat-icon">${icon("trust")}</span><span><small>民望</small><b>${state.resources.trust}</b></span>
    </button>`;
  show("trustCurrent", `当前民望 ${state.resources.trust}，${tradeTrustEffect(state.trade_trust_bonus)}。`);
  show("trustRule", `季初民望达到 ${TRADE_TRUST.bonusAt}，经商每人多赚 1 币。季初民望降到 ${TRADE_TRUST.penaltyAt} 或以下，经商每人少赚 1 币。本季履约或开仓设粥带来的民望变化，从下季起影响贸易。`);
  el("ending").innerHTML = playing() ? "" :
    `<h2>${state.status === "won" ? "河湾建镇成功" : "本局经营结束"}</h2><p>${escapeHtml(state.result)}</p>
    <div class="ending-actions"><button type="button" class="soft-button" data-ending="journal">查看纪事</button>
    <button type="button" class="soft-button" data-ending="restart">再开一局</button></div>`;
  el("ending").hidden = playing();
  el("tileSelect").replaceChildren(...state.tiles.map(t => new Option(t.name, t.id)));
  drawMap();
  renderTile();
  drawWorkers();
  renderControls();
}
function free() {
  return state.population - Object.values(workers).reduce((a, b) => a + b, 0);
}
function drawWorkers() {
  const planned = state.tiles.find(t => t.id === build);
  el("workers").innerHTML = Object.entries(jobs).map(([job, [name, resource]]) => {
    const rate = state.rates[job] + Number(planned?.kind === job);
    const trustBonus = job === "trade" ? state.trade_trust_bonus : 0;
    const trustNote = trustBonus
      ? `<small class="trust-effect ${trustBonus > 0 ? "pos" : "neg"}">含民望 ${trustBonus > 0 ? "+1" : "−1"}</small>`
      : "";
    return `<div class="worker"><span class="work-icon ${resource}">${icon(resource)}</span>
      <span class="work-name"><b>${name}</b><small>每人产 ${rate} ${units[resource]}</small>${trustNote}</span>
      <div class="stepper"><button data-job="${job}" data-change="-1" aria-label="减少${name}人手">−</button>
      <output>${workers[job]}</output><button data-job="${job}" data-change="1" aria-label="增加${name}人手">+</button></div></div>`;
  }).join("");
}
function renderTile() {
  const tile = state.tiles.find(t => t.id === selected);
  if (!tile) return;
  show("tileTitle", tile.name);
  show("tileDesc", tile.detail);
  el("tileSelect").value = tile.id;
  el("tileIcon").innerHTML = icon(terrainIcons[tile.kind]);
  let type = "未开发";
  if (tile.kind === "town") type = "聚落中心";
  else if (tile.improved) type = "已开发";
  else if (build === tile.id) type = "计划建设";
  else if (tile.buildable) type = "可建设";
  else if (tile.kind === "river") type = "天然水道";
  else if (tile.kind === "hill") type = "山地";
  show("tileType", type);
  el("buildButton").hidden = !playing() || !tile.buildable;
  show("buildButton", build === tile.id ? "撤销建设" : build ? "改建此处" : "安排建设");
}
function renderControls() {
  const locked = pending || !playing();
  show("free", "已分配 " + (state.population - free()) + " / " + state.population);
  for (const b of el("workers").querySelectorAll("button")) {
    b.disabled = locked || (b.dataset.change === "1" ? free() <= 0 : workers[b.dataset.job] <= 0);
  }
  el("advance").disabled = locked || !forecastReady;
  el("ask").disabled = locked || asking;
  el("mode").disabled = locked || asking;
  el("intent").disabled = locked;
  el("accept").disabled = locked || !offer;
  el("resetButton").disabled = pending;
  el("buildButton").disabled = locked;
  const planned = state.tiles.find(t => t.id === build);
  show("plan", [planned && (planned.name + "建设" + planned.build_name), appliedOffer && ("已采纳「" + appliedOffer.title + "」")]
    .filter(Boolean).join(" · "));
  el("withdraw").hidden = !appliedOffer;
  el("withdraw").disabled = locked;
  if (offer) show("accept", appliedOffer?.id === offer.id ? "撤回采纳" : appliedOffer ? "改采此案" : "采纳本季议案");
  const changed = offerPlan && (offerPlan.build !== build || Object.keys(jobs).some(k => offerPlan.workers[k] !== workers[k]));
  show("councilBasis", changed ? "议案基于先前安排，下方预估已按当前计划重新核算。" : "");
}
function clearForecast() {
  forecastReady = false;
  forecast = null;
  councilPreview.textContent = "";
  el("pills").replaceChildren();
  show("forecastMsg", "");
  show("tradeOutlook", "");
  list("events", []);
  el("ledger").hidden = true;
  renderControls();
}
function refreshForecast() {
  clearForecast();
  try {
    const { forecast: result } = forecastPlan(draft());
    forecastReady = true;
    forecast = result;
    show("forecastMsg", result.status === "playing" ? "" : result.result);
    const nextBonus = result.next_trade_trust_bonus;
    if (nextBonus !== null && nextBonus !== state.trade_trust_bonus) {
      show("tradeOutlook", `预计下季民望 ${result.resources.trust}，${tradeTrustEffect(nextBonus)}。`);
    }
    el("forecastMsg").className = "status";
    el("pills").innerHTML = Object.keys(state.resources).map(key => {
      const delta = result.delta[key];
      const text = delta > 0 ? "+" + delta : delta < 0 ? "−" + Math.abs(delta) : "0";
      return `<div class="pill ${key}" title="季末${label[key]} ${result.resources[key]}"><small>${label[key]}</small>
        <b class="${delta > 0 ? "pos" : delta < 0 ? "neg" : "neutral"}">${text}</b></div>`;
    }).join("");
    list("events", [...result.events, "季末库存 · " + resourceLine(result)]);
    el("ledger").hidden = false;
  } catch (error) {
    show("forecastMsg", error.message);
    el("forecastMsg").className = "status err";
  }
  renderControls();
  if (offer && el("councilDialog").open) compareOffer();
}
function resourceLine(result) {
  return ["food", "wood", "coin", "trust"].map(k => result.resources[k] + " " + (units[k] || label[k])).join("，");
}
function compareOffer() {
  const plan = draft();
  const [unsigned, signed] = [null, offer.id].map(id => {
    try {
      const result = id === plan.offer && forecast ? forecast : forecastPlan({ ...plan, offer: id }).forecast;
      return resourceLine(result);
    } catch (error) {
      return error.message;
    }
  });
  councilPreview.replaceChildren(document.createTextNode("本季末库存"), document.createElement("br"),
    document.createTextNode("不签 · " + unsigned), document.createElement("br"), document.createTextNode("签约 · " + signed));
}

el("workers").addEventListener("click", event => {
  const b = event.target.closest("button[data-job]");
  if (!b || b.disabled || !playing() || pending) return;
  workers[b.dataset.job] += Number(b.dataset.change);
  b.parentElement.querySelector("output").textContent = workers[b.dataset.job];
  refreshForecast();
});
el("tileSelect").addEventListener("change", event => selectTile(event.target.value));
el("buildButton").onclick = () => {
  if (pending || !playing()) return;
  build = build === selected ? null : selected;
  drawMap();
  renderTile();
  drawWorkers();
  refreshForecast();
};
el("accept").onclick = () => {
  if (pending || !playing() || !offer) return;
  appliedOffer = appliedOffer?.id === offer.id ? null : offer;
  refreshForecast();
};
el("withdraw").onclick = () => {
  if (pending || !playing()) return;
  appliedOffer = null;
  refreshForecast();
};
el("ask").onclick = async () => {
  if (!playing() || pending || asking) return;
  const token = ++councilSeq;
  const plan = draft();
  asking = true;
  renderControls();
  el("councilStatus").className = "notice busy";
  show("councilStatus", "代表正在商议，此时仍可回到地图调整安排。");
  try {
    const { city, options } = prepareCouncil(plan);
    const intent = el("intent").value.trim();
    let reply;
    if (el("mode").value === "model") {
      try {
        reply = await recommendModel(city, options, intent, plan.workers, plan.build);
      } catch (error) {
        reply = { ...recommendLocal(city, options, intent, plan.build), message: error.message + " 已采用本地代表。" };
      }
    } else {
      reply = recommendLocal(city, options, intent, plan.build);
    }
    if (token !== councilSeq) return;
    reply = recordOffer(plan, reply);
    offer = reply.offer;
    offerPlan = plan;
    el("proposal").hidden = false;
    const source = reply.source === "model" ? ["模型代表", reply.model].filter(Boolean).join(" · ") : "本地代表";
    show("speaker", offer.speaker + " · " + source);
    show("offerTitle", offer.title);
    show("offerReason", reply.reason);
    show("terms", offer.terms);
    el("councilStatus").className = "notice";
    show("councilStatus", reply.message || "");
    compareOffer();
  } catch (error) {
    if (token !== councilSeq) return;
    el("councilStatus").className = "notice err";
    show("councilStatus", error.message);
  } finally {
    if (token === councilSeq) {
      asking = false;
      renderControls();
    }
  }
};
function showSettlement(data) {
  const previous = state;
  loadGame(data);
  if (!playing()) return;
  const developed = new Set(previous.tiles.filter(tile => tile.improved).map(tile => tile.id));
  const site = state.tiles.find(tile => tile.improved && !developed.has(tile.id));
  const season = document.createElement("strong");
  season.textContent = "进入" + el("season").textContent;
  const outcome = document.createElement("small");
  outcome.textContent = (site ? site.name + "建成" + site.build_name + " · " : "") +
    "上季存粮 " + state.resources.food;
  receipt.hidden = false;
  receipt.replaceChildren(season, outcome);
  if (state.trade_trust_bonus !== previous.trade_trust_bonus) {
    const trade = document.createElement("small");
    trade.textContent = `民望 ${state.resources.trust} · ${tradeTrustEffect(state.trade_trust_bonus)}`;
    receipt.append(trade);
  }
  receiptTimer = setTimeout(() => { receipt.hidden = true; }, 6000);
}
el("advance").onclick = event => {
  if (event.detail > 1 || !playing() || !forecastReady || pending) return;
  const plan = draft();
  pageBusy(true);
  ++councilSeq;
  asking = false;
  show("councilStatus", "");
  try {
    showSettlement(advanceGame(plan));
  } catch (error) {
    if (error.status === 409 || error.status === 404) {
      const current = savedGame();
      if (current?.state) loadGame(current);
    }
    el("forecastMsg").className = "status err";
    show("forecastMsg", error.message);
  } finally {
    pageBusy(false);
  }
};
function renderJournal() {
  const box = el("journalContent");
  box.replaceChildren();
  if (!state.history.length) {
    const message = document.createElement("p");
    message.className = "history-empty";
    message.textContent = "结算第一季后，收支和决议将记在这里。";
    box.append(message);
    return;
  }
  const history = document.createElement("ul");
  history.className = "history";
  for (const entry of state.history) {
    const row = document.createElement("li");
    row.textContent = entry;
    history.append(row);
  }
  box.append(history);
}
function setNav(id) {
  for (const button of ["overviewButton", "councilButton", "historyButton"]) {
    el(button).classList.toggle("active", id === button);
    if (id === button) el(button).setAttribute("aria-current", "page");
    else el(button).removeAttribute("aria-current");
  }
}

let settingsSnapshot;
let settingsView = 0;
function syncModelMode(snapshot) {
  modelAvailable = snapshot.configured;
  configuredModel = snapshot.config.endpoint ? snapshot.config.model : "";
  renderModelMode();
}
function renderModelMode() {
  show("modelHint", modelAvailable ? "已配置 · " + configuredModel :
    configuredModel ? "重新输入 API 密钥以连接 " + configuredModel : "尚未配置大模型");
  el("mode").querySelector("[value=model]").disabled = !modelAvailable;
  if (!modelAvailable) el("mode").value = "local";
}
function rememberMode() {
  try { sessionStorage.setItem(representativeKey, el("mode").value); } catch {}
}
el("mode").addEventListener("change", rememberMode);

function configMessage(message, status = "") {
  el("configMessage").textContent = message;
  el("configMessage").dataset.state = status;
}
function updateKeyField() {
  const config = settingsSnapshot?.config;
  const needsKey = el("modelAuth").value !== "none";
  const canReuse = settingsSnapshot?.has_api_key && config.provider_id === el("modelPreset").value &&
    config.endpoint === el("modelEndpoint").value.trim() && config.auth_type === el("modelAuth").value;
  el("modelKeyField").hidden = !needsKey;
  el("modelKey").disabled = !needsKey;
  el("modelKey").required = needsKey && !canReuse;
  el("modelKey").placeholder = canReuse ? "留空可沿用当前页面的密钥" : "输入服务商提供的密钥";
}
function showPreset(config) {
  el("modelEndpoint").value = config.endpoint;
  el("modelEndpoint").placeholder = config.protocol === "anthropic" ? "https://…/v1/messages" : "https://…/v1/chat/completions";
  el("modelName").value = config.model;
  el("modelAuth").value = config.auth_type;
  el("modelOutput").value = config.output_mode;
  el("modelKey").value = "";
  updateKeyField();
}
function showSettings(snapshot) {
  settingsSnapshot = snapshot;
  syncModelMode(snapshot);
  el("configState").classList.toggle("configured", modelAvailable);
  show("configState", modelAvailable ? "已配置" : configuredModel && snapshot.config.endpoint ? "待输入密钥" : "待配置");
  const presets = Object.entries(snapshot.presets).map(([id, entry]) => new Option(entry.label, id));
  el("modelPreset").replaceChildren(...presets);
  el("modelPreset").value = snapshot.config.provider_id;
  showPreset(snapshot.config);
}
function openModelSettings() {
  const dialog = el("settingsDialog");
  if (dialog.open) return;
  ++settingsView;
  dialog.showModal();
  dialog.scrollTop = 0;
  show("modelUsage", selectedMode === "warehouse" ? "浏览器会把现场信息、提案和澄清答复发给指定的模型接口。接口须允许网页跨域请求。" :
    "浏览器会把游戏局势和议案发给指定的模型接口。接口须允许网页跨域请求。");
  el("configFields").disabled = true;
  el("modelKey").value = "";
  el("configState").classList.remove("configured");
  configMessage("");
  try {
    showSettings(readModelSettings());
    el("configFields").disabled = false;
  } catch (error) {
    show("configState", "读取失败");
    configMessage(error.message, "error");
  }
}
el("settingsDialog").addEventListener("close", () => {
  ++settingsView;
  el("modelKey").value = "";
  relief?.syncModel();
  warehouse?.syncModel();
  if (location.hash === "#model-settings") {
    const url = new URL(location.href);
    url.hash = selectedMode === "warehouse" ? "" : selectedMode;
    try { history.replaceState(null, "", url); } catch { /* Some browsers restrict history on file URLs. */ }
  }
});
el("modelPreset").onchange = () => {
  const id = el("modelPreset").value;
  showPreset(id === settingsSnapshot.config.provider_id ? settingsSnapshot.config : settingsSnapshot.presets[id]);
};
for (const [id, event] of [["modelEndpoint", "input"], ["modelAuth", "change"]]) {
  el(id).addEventListener(event, () => {
    el("modelKey").value = "";
    updateKeyField();
  });
}
el("modelForm").addEventListener("input", () => configMessage(""));
async function submitModelSettings(save) {
  const fields = el("configFields");
  if (fields.disabled || !el("modelForm").reportValidity()) return;
  const view = settingsView;
  const data = {
    provider_id: el("modelPreset").value, endpoint: el("modelEndpoint").value.trim(), model: el("modelName").value.trim(),
    auth_type: el("modelAuth").value, output_mode: el("modelOutput").value, api_key: el("modelKey").value
  };
  fields.disabled = true;
  configMessage(save ? "正在保存配置…" : "正在请求模型回复…");
  try {
    if (save) {
      const snapshot = saveModelSettings(data);
      showSettings(snapshot);
      warehouse?.syncModel();
      el("mode").value = "model";
      rememberMode();
      configMessage("已启用 " + configuredModel + (selectedMode === "warehouse" ? "。下次编译规则时生效。" : "。下次审议时生效。"), "ok");
    } else {
      const result = await testModelSettings(data);
      if (view === settingsView) {
        configMessage("连接成功 · " + result.model + " · " + Number(result.seconds).toFixed(2) + " 秒", "ok");
      }
    }
  } catch (error) {
    if (view === settingsView) configMessage(error.message, "error");
  } finally {
    if (view === settingsView) fields.disabled = false;
  }
}
el("modelForm").onsubmit = event => { event.preventDefault(); submitModelSettings(true); };
el("testModel").onclick = () => submitModelSettings(false);
function openPanel(id, navId) {
  if (id === "journal") {
    if (!state) return;
    renderJournal();
  }
  if (id === "councilDialog" && !state) return;
  const dialog = el(id);
  if (!dialog.open) dialog.showModal();
  setNav(navId);
  if (id === "councilDialog" && offer) compareOffer();
}
el("overviewButton").onclick = () => {
  document.querySelector("dialog[open]")?.close();
  map?.resetView();
};
el("councilButton").onclick = () => openPanel("councilDialog", "councilButton");
el("historyButton").onclick = () => openPanel("journal", "historyButton");
el("helpButton").onclick = () => openPanel("helpDialog", "overviewButton");
el("resources").addEventListener("click", event => {
  if (!event.target.closest("#trustInfo")) return;
  openPanel("helpDialog", "overviewButton");
  el("trustHeading").focus();
});
el("settingsButton").onclick = el("configFromCouncil").onclick = openModelSettings;
for (const button of document.querySelectorAll("[data-close], #closeHistory")) {
  button.onclick = () => button.closest("dialog")?.close();
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => setNav(el("councilDialog").open ? "councilButton" : "overviewButton"));
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
async function restart() {
  if (pending || (playing() && !confirm("重新从第一年初春开始经营？"))) return;
  pageBusy(true);
  try {
    loadGame(createGame(), true);
    if (map) map.resetView();
    else await (mapStartup ??= initMap());
    el("settingsDialog").close();
    if (el("councilDialog").open) el("councilDialog").close();
  } catch (error) {
    alert(error.message);
  } finally {
    pageBusy(false);
  }
}
el("resetButton").onclick = restart;
el("ending").addEventListener("click", event => {
  const action = event.target.closest("[data-ending]")?.dataset.ending;
  if (action === "journal") openPanel("journal", "historyButton");
  if (action === "restart") restart();
});
el("zoomIn").onclick = () => map?.zoomBy(1.15);
el("zoomOut").onclick = () => map?.zoomBy(1 / 1.15);
el("rotateMap").onclick = () => map?.rotateBy(Math.PI / 3);
el("resetMap").onclick = () => map?.resetView();
const compactHud = window.matchMedia("(max-width: 760px)");
const toggleControls = el("toggleControls");
function setControlsExpanded(expanded) {
  if (!expanded && el("controlContent").contains(document.activeElement)) toggleControls.focus();
  toggleControls.setAttribute("aria-expanded", String(expanded));
}
setControlsExpanded(!compactHud.matches);
compactHud.addEventListener("change", event => setControlsExpanded(!event.matches));
toggleControls.onclick = () => setControlsExpanded(toggleControls.getAttribute("aria-expanded") !== "true");

async function initMap() {
  const host = el("map");
  const frame = el("mapFrame");
  try {
    const { createRiverMap } = await import("./river-map.js");
    map = createRiverMap(host, { frame, onSelect: selectTile });
    drawMap();
    host.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      map.dispose();
      map = createFlatMap(frame, { onSelect: selectTile });
      drawMap();
    }, { capture: true, once: true });
  } catch (error) {
    console.warn("切换到二维地图", error);
    map?.dispose();
    map = createFlatMap(frame, { onSelect: selectTile });
    drawMap();
  }
}
async function start() {
  try {
    syncModelMode(readModelSettings());
    loadGame(savedGame() || createGame(), true);
    await (mapStartup ??= initMap());
  } catch (error) {
    el("loading").hidden = false;
    el("loading").className = "fatal";
    show("loading", error.message + "　请重新打开游戏。");
  }
}
window.addEventListener("storage", event => {
  if (event.key !== SAVE_KEY || !state) return;
  const latest = savedGame();
  if (latest && (latest.state.game_id !== state.game_id || latest.state.revision !== state.revision)) {
    loadGame(latest);
  }
});
let relief, warehouse, seasonsStarted = false, selectedMode;
function showMode() {
  const hash = location.hash;
  const mode = hash === "#seasons" ? "seasons" : hash === "#relief" ? "relief" :
    hash === "#model-settings" ? selectedMode ?? "warehouse" : "warehouse";
  if (mode !== selectedMode) {
    selectedMode = mode;
    document.body.dataset.mode = mode;
    el("seasonGame").hidden = mode !== "seasons";
    el("reliefGame").hidden = mode !== "relief";
    el("warehouseGame").hidden = mode !== "warehouse";
    if (mode === "warehouse") {
      warehouse ??= mountWarehouse(el("warehouseGame"), openModelSettings);
      warehouse.open();
    } else if (mode === "relief") {
      window.scrollTo(0, 0);
      relief ??= mountRelief(el("reliefGame"), openModelSettings);
      relief.open();
    } else if (!seasonsStarted) {
      seasonsStarted = true;
      void start();
    }
  }
  if (location.hash === "#model-settings") openModelSettings();
}
window.addEventListener("hashchange", showMode);
showMode();
