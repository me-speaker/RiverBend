import { FAMILIES, BindingProblem, act, adopt, advance, assetText, available, compileLocally, compilePrompt,
  currentPlaces, groundProposal, newWarehouse, ruleSchema, snapshot, summary, validatePlan } from "./warehouse-engine.js";
import { readModelSettings, requestStructuredModel } from "./browser-model.js";
import { createRiverMap } from "./river-map.js";

const markup = `
<div class="warehouse-backdrop" id="warehouseMap" aria-hidden="true"></div>
<header class="warehouse-header">
  <div class="warehouse-brand"><svg class="art-icon" aria-hidden="true"><use href="#ico-brand"/></svg><h1>河湾议会</h1></div>
  <nav aria-label="试玩操作">
    <button type="button" class="soft-button" id="warehouseSettings">模型设置</button>
    <button type="button" class="soft-button" id="warehouseRestart">重开</button>
  </nav>
</header>
<section class="warehouse-world" aria-label="现场">
  <div id="warehouseFit" aria-hidden="true"></div>
  <div class="warehouse-occupancy" id="warehouseOccupancy" role="status"></div>
  <div class="warehouse-fallback" id="warehouseFallback" hidden aria-hidden="true">
    <div class="warehouse-hex"></div><div class="warehouse-house"><i></i></div>
    <span class="warehouse-figure zhang"></span><span class="warehouse-figure li"></span>
  </div>
  <div id="warehousePlaces" class="warehouse-places" aria-label="现场新地点"></div>
</section>
<div class="warehouse-hud">
 <section class="warehouse-assets" id="warehouseAssets" aria-label="现场物资"></section>
 <section class="warehouse-families" id="warehouseFamilies" aria-label="两户人家"></section>
 <section class="warehouse-composer" aria-label="今晚的过夜办法">
  <form id="warehouseForm">
   <label for="warehouseInput">今晚，两户人家怎么过夜？</label>
   <textarea id="warehouseInput" rows="2" maxlength="400" placeholder="你可以提出一个办法或定一条规则。"></textarea>
   <div class="warehouse-form-actions">
    <button type="button" class="soft-button" id="warehouseNpc">问 NPC 的办法</button>
    <select id="warehouseCompiler" aria-label="编译方式"><option value="local">本地编译</option><option value="model">大模型经理</option></select>
    <button type="submit" class="primary" id="warehouseCompile">审议办法</button>
   </div>
  </form>
  <section class="warehouse-discussion" id="warehouseDiscussion" hidden>
   <p id="warehouseQuestion" role="status"></p>
   <form id="warehouseAnswerForm">
    <label for="warehouseAnswer" class="warehouse-sr">答复经理</label>
    <input type="text" id="warehouseAnswer" maxlength="300" placeholder="补充条件或提出替代办法">
    <button type="submit" class="primary">答复经理</button>
    <button type="button" class="soft-button" id="warehouseAskNpc" hidden>请 NPC 回答</button>
   </form>
  </section>
  <div id="warehouseReview" hidden>
    <div class="warehouse-rule-label" id="warehouseRuleLabel"></div>
    <ul id="warehouseSummary"></ul>
    <div id="warehouseEdits"></div>
    <button type="button" class="primary" id="warehouseEnable">确认启用</button>
  </div>
  <p id="warehouseStatus" class="warehouse-status" role="status" hidden></p>
 </section>
 <footer class="warehouse-footer">
  <details id="warehouseLedger"><summary>查看账本</summary><ol id="warehouseEntries"></ol></details>
  <div id="warehouseResults" role="status" hidden></div>
  <button type="button" class="primary" id="warehouseAdvance">入夜</button>
 </footer>
</div>`;

const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const sourceLabels = { player: "你", npc: "NPC" };
const entries = { plan: "方案", action: "行动", phase: "时段", result: "过夜结果" };
const actors = { any: "任一家", ...FAMILIES };
const guests = { any: "任一家", actor: "建造者", other: "另一家", ...FAMILIES, worked: "已出工的家庭", unworked: "未出工的家庭" };
const npcSchema = {
  type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false,
};
const NPC = `你是小游戏中的居民 NPC。只依据 world 里的现场物资、人物、占用和阶段说话，不能执行动作、批准方案或增加物资。
没有 question 时提一句可尝试的过夜办法，要具体，也允许留待协商的选择。有 question 时直接回答这一个问题，说明你建议的选择或补充你原先的意思。玩家授权须由玩家决定。
返回 text 字段，只用一两句简短中文，不要声称现场已有实际搭建或入住。`;

export function mountWarehouse(host, openSettings) {
  host.innerHTML = markup;
  const by = id => host.querySelector("#" + id);
  const compiler = by("warehouseCompiler"), modeOption = compiler.querySelector('[value="model"]');
  const input = by("warehouseInput"), answer = by("warehouseAnswer");
  let state = newWarehouse(), map, hadModel = false;
  let proposal = null, review = null, question = null, status = "", error = false, waiting = false, generation = 0;

  function renderWorld() {
    const warehouse = currentPlaces(state)[0];
    const occupant = Object.values(state.households).find(house => house.lodging === "warehouse")?.id;
    const phase = state.phase === "day" ? "白天" : state.phase === "night" ? "夜间" : "已结算";
    host.dataset.phase = state.phase;
    by("warehouseOccupancy").innerHTML = `<span>${phase} · ${occupant ? FAMILIES[occupant] + "在仓房" : "仓房空着"}</span><small>${warehouse.residents.length} / 1 户</small>`;
    by("warehouseFallback").dataset.occupant = occupant ?? "";
    by("warehousePlaces").innerHTML = currentPlaces(state).slice(1).map(place =>
      `<article class="warehouse-map-place"><strong>${safe(place.name)}</strong><small>
        ${safe(state.assets.find(asset => asset.id === place.location)?.name ?? "现场")} ·
        ${place.capacity ? (place.residents.length + " / " + place.capacity + " 户" + (place.residents.length ? " · " + place.residents.join("、") : "")) : "物件"}
       </small></article>`).join("");
    by("warehouseAssets").innerHTML = state.assets.map(asset => {
      const locked = state.places.find(place => place.id === state.locks[asset.id]);
      return `<div><strong>${safe(asset.name)}</strong><small>${safe(locked ? "已被「" + locked.name + "」占用" : assetText(asset))}</small></div>`;
    }).join("");
    map?.update([{
      id: "warehouse", q: 0, r: 0, kind: "warehouse-demo", improved: true, name: "仓房",
      occupant, worked: Object.values(state.households).filter(house => house.worked).map(house => house.id),
      createdSite: state.places.length > 1,
    }], { season: "初春" });
  }

  function renderFamilies() {
    by("warehouseFamilies").innerHTML = Object.values(state.households).map(house => {
      const { actions, right } = available(state, house.id);
      const site = state.places.find(place => place.id === house.lodging);
      const access = right ? "持有仓房资格" + (right.earnedBy !== house.id ? " · " + FAMILIES[right.earnedBy] + "转入" : "") : "";
      const blocked = actions.find(action => action.issue && (action.kind === "make" || action.kind === "stay"));
      const daytime = "剩 " + house.action + " 次行动 · " + (house.worked ? "已出工" : "未出工");
      return `<article class="warehouse-family ${house.id}" data-family-card="${house.id}" tabindex="-1">
        <div class="warehouse-family-top"><h2>${house.label}</h2><span>
         ${site ? safe("在" + site.name) : state.phase === "day" ? daytime : state.phase === "closed" ? "露宿" : "等待选择住处"}
        </span></div>
        ${access ? `<p class="warehouse-right">${safe(access)}</p>` : ""}
        <div class="warehouse-actions">${actions.map(action =>
          `<button class="${action.kind === "stay" ? "primary" : "soft-button"}" type="button" data-act="${action.kind}" data-id="${safe(action.id)}" data-family="${house.id}" aria-label="${safe(house.label + action.title)}"${action.issue ? " disabled title=\"" + safe(action.issue) + "\"" : ""}>${safe(action.title)}</button>`).join("")}</div>
        ${blocked ? `<p>${safe(blocked.issue)}</p>` : ""}
      </article>`;
    }).join("");
  }

  function renderDiscussion() {
    by("warehouseDiscussion").hidden = !question;
    if (!question) return;
    by("warehouseQuestion").textContent = "经理问" + sourceLabels[question.to] + "：" + question.text;
    by("warehouseAskNpc").hidden = question.to !== "npc" || !hasModel();
    for (const button of by("warehouseAnswerForm").querySelectorAll("button")) button.disabled = waiting;
  }

  function renderComposer() {
    const enabled = state.plan;
    by("warehouseForm").hidden = Boolean(enabled) || state.phase !== "day";
    by("warehouseReview").hidden = !enabled && !review;
    by("warehouseEnable").hidden = !review || Boolean(enabled) || state.phase !== "day";
    by("warehouseEnable").disabled = waiting;
    by("warehouseCompile").disabled = waiting;
    by("warehouseCompile").textContent = waiting ? "经理在审议…" : "审议办法";
    by("warehouseNpc").disabled = waiting || !hasModel();
    by("warehouseNpc").title = hasModel() ? "" : "先在模型设置接入大模型";
    const plan = enabled ?? review?.plan;
    if (plan) {
      by("warehouseRuleLabel").textContent = (enabled ? "已启用 · " : "核对草案 · ") + plan.title + " · " + (state.source || review.source);
      by("warehouseSummary").innerHTML = summary(state, plan).map(line => `<li>${safe(line)}</li>`).join("");
      by("warehouseEdits").innerHTML = review && !enabled ? review.plan.actions.map((action, index) =>
        `<div><span>${safe(action.name)}</span><label>谁能搭<select data-who="actor" data-index="${index}">
          ${selectOptions(actors, action.actor)}</select></label><label>谁能住<select data-who="access" data-index="${index}">
          ${selectOptions(guests, action.structure.access)}</select></label></div>`).join("") : "";
    }
    renderDiscussion();
    const feedback = by("warehouseStatus");
    const message = status || state.last;
    feedback.hidden = !message;
    feedback.dataset.level = error ? "error" : "info";
    feedback.textContent = message;
  }

  function renderLedger() {
    const discussion = (proposal?.answers ?? []).map(item =>
      `<li><strong>澄清</strong> ${safe("经理：" + item.question + " " + sourceLabels[item.from] + "：" + item.answer)}</li>`);
    by("warehouseEntries").innerHTML = [...discussion,
      ...state.ledger.map(item => `<li><strong>${entries[item.kind]}</strong> ${safe(item.line)}</li>`)].join("") ||
      "<li>还没有入账的行动。</li>";
    const results = by("warehouseResults");
    results.hidden = state.phase !== "closed";
    results.textContent = state.ledger.filter(item => item.kind === "result").map(item => item.line).join(" ");
    const advanceButton = by("warehouseAdvance");
    advanceButton.hidden = state.phase === "closed";
    advanceButton.textContent = state.phase === "day" ? "入夜" : "结算今晚";
  }

  function render() { renderWorld(); renderFamilies(); renderComposer(); renderLedger(); }
  const hasModel = () => readModelSettings().configured;

  function syncModel() {
    const configured = hasModel();
    modeOption.disabled = !configured;
    modeOption.textContent = configured ? "大模型经理" : "大模型经理（待配置）";
    if (!configured) compiler.value = "local";
    else if (!hadModel) compiler.value = "model";
    hadModel = configured;
    renderComposer();
  }

  function selectOptions(choices, chosen) {
    return Object.entries(choices).map(([id, label]) => `<option value="${id}"${id === chosen ? " selected" : ""}>${label}</option>`).join("");
  }

  function stillCurrent(ticket) { return ticket === generation && state.phase === "day" && !state.plan; }

  function setReview(raw, source) {
    review = { raw, plan: validatePlan(raw, state), source };
    question = null;
    status = ""; error = false;
  }

  async function manager(ticket) {
    if (!proposal.useModel) {
      setReview(compileLocally(proposal.text), "本地编译");
      return;
    }
    const result = await requestStructuredModel(compilePrompt, {
      text: proposal.text, from: proposal.from, answers: proposal.answers, world: snapshot(state),
    }, ruleSchema);
    if (!stillCurrent(ticket)) return;
    const raw = result.value;
    const next = raw.question;
    if (next && ["player", "npc"].includes(next.to) && typeof next.text === "string" && next.text.trim() && next.text.length <= 300) {
      question = { to: next.to, text: next.text.trim() };
      status = typeof raw.issue === "string" ? raw.issue : "";
      error = Boolean(status);
      return;
    }
    try {
      const wording = [proposal.text, ...proposal.answers.map(item => item.answer)].join("。");
      const grounded = groundProposal(raw, state, wording);
      setReview(grounded.value, result.model);
      status = grounded.repairs.join(" ");
    }
    catch (problem) {
      status = problem.message;
      error = true;
      if (problem instanceof BindingProblem) {
        const { candidates, role } = problem;
        const candidateText = candidates.length === 1 ? "要用「" + candidates[0] + "」作" + role + "吗？" :
          candidates.length ? role + "可用" + candidates.map(name => "「" + name + "」").join("或") + "，你想用哪一件？" :
          "现场没有可用的" + role + "。你愿意改用哪种过夜办法？";
        question = { to: "player", text: candidateText };
      } else if (typeof raw.issue === "string" && raw.issue.trim()) {
        question = { to: "player", text: "这项要求需要调整。你希望保留哪一部分？" };
      } else {
        question = null;
      }
    }
  }

  async function requestTurn(run) {
    const ticket = ++generation;
    waiting = true;
    review = null;
    status = ""; error = false;
    render();
    try { await run(ticket); }
    catch (problem) {
      if (stillCurrent(ticket)) { status = problem.message; error = true; }
    } finally {
      if (stillCurrent(ticket)) { waiting = false; render(); }
    }
  }

  async function listenToNpc(ticket, prompt) {
    const result = await requestStructuredModel(NPC, { ...prompt, world: snapshot(state) }, npcSchema);
    if (!stillCurrent(ticket)) return null;
    const text = result.value.text;
    if (typeof text !== "string" || !text.trim() || text.length > 300) throw new Error("NPC 没有返回可用的答复。");
    return text.trim();
  }

  input.addEventListener("input", () => {
    generation++; waiting = false; review = null; question = null; proposal = null;
    status = ""; error = false;
    renderComposer(); renderLedger();
  });

  by("warehouseForm").addEventListener("submit", event => {
    event.preventDefault();
    if (waiting || state.plan || state.phase !== "day") return;
    const text = input.value.trim();
    if (!text) { status = "先写一句过夜办法。"; error = true; renderComposer(); input.focus(); return; }
    proposal = { from: "player", text, answers: [], useModel: compiler.value === "model" };
    question = null;
    void requestTurn(manager);
  });

  by("warehouseNpc").addEventListener("click", () => {
    if (waiting || !hasModel()) return;
    proposal = null; question = null;
    void requestTurn(async ticket => {
      const text = await listenToNpc(ticket, {});
      if (!text) return;
      input.value = text;
      proposal = { from: "npc", text, answers: [], useModel: true };
      await manager(ticket);
    });
  });

  function continueProposal(byWhom, reply) {
    proposal.answers.push({ from: byWhom, question: question.text, answer: reply });
    answer.value = ""; question = null;
  }

  by("warehouseAnswerForm").addEventListener("submit", event => {
    event.preventDefault();
    if (!proposal || !question || waiting || !answer.value.trim()) return;
    continueProposal("player", answer.value.trim());
    void requestTurn(manager);
  });

  by("warehouseAskNpc").addEventListener("click", () => {
    if (!proposal || question?.to !== "npc" || waiting) return;
    void requestTurn(async ticket => {
      const text = await listenToNpc(ticket, { proposal: proposal.text, answers: proposal.answers, question: question.text });
      if (!text) return;
      continueProposal("npc", text);
      await manager(ticket);
    });
  });

  by("warehouseEdits").addEventListener("change", event => {
    const field = event.target;
    if (!review || !field.dataset.who) return;
    const amended = structuredClone(review.raw);
    const item = amended.actions[Number(field.dataset.index)];
    if (field.dataset.who === "actor") item.actor = field.value;
    else item.create.access = field.value;
    try { setReview(amended, review.source + (review.source.includes("玩家修订") ? "" : " · 玩家修订")); }
    catch (problem) { status = problem.message; error = true; }
    renderComposer();
  });

  by("warehouseEnable").addEventListener("click", () => {
    if (!review || state.plan || waiting) return;
    try {
      state = adopt(state, review.raw, review.source);
      review = null; question = null; status = ""; error = false;
    } catch (problem) { status = problem.message; error = true; }
    render();
    host.querySelector('[data-act="make"]:not(:disabled), [data-act="work"]:not(:disabled)')?.focus({ preventScroll: true });
  });

  by("warehouseFamilies").addEventListener("click", event => {
    const button = event.target.closest("button[data-act]");
    if (!button || button.disabled) return;
    const { act: command, family, id } = button.dataset;
    try {
      state = act(state, command, family, id);
      status = ""; error = false;
    } catch (problem) { status = problem.message; error = true; }
    render();
    host.querySelector(`[data-family-card="${family}"]`)?.focus({ preventScroll: true });
  });

  by("warehouseAdvance").addEventListener("click", event => {
    if (event.detail > 1 || state.phase === "closed") return;
    state = advance(state);
    generation++;
    waiting = false; review = null; question = null; status = ""; error = false;
    render();
  });

  by("warehouseSettings").addEventListener("click", openSettings);
  by("warehouseRestart").addEventListener("click", () => {
    generation++;
    waiting = false; state = newWarehouse(); proposal = null; review = null; question = null; status = ""; error = false;
    input.value = ""; answer.value = ""; by("warehouseLedger").open = false;
    render(); input.focus({ preventScroll: true });
  });

  return {
    open() {
      const hostMap = by("warehouseMap");
      if (!map && by("warehouseFallback").hidden) {
        const fallback = () => {
          map?.dispose(); map = null; by("warehouseFallback").hidden = false; renderWorld();
        };
        try {
          map = createRiverMap(hostMap, { frame: by("warehouseFit") });
          hostMap.addEventListener("webglcontextlost", fallback, { capture: true, once: true });
        } catch { fallback(); }
      }
      syncModel(); render();
    },
    syncModel,
  };
}
