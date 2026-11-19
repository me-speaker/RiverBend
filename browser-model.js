import presetDefinitions from "./config/model_presets.json" with { type: "json" };

const STORAGE_KEY = "riverbend:model-settings:v1";
const TOOL_NAME = "submit_strategy";
const TIMEOUT_MS = 18_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MINIMAX_ENDPOINTS = new Set([
  "https://api.minimaxi.com/anthropic/v1/messages",
  "https://api.minimax.cn/anthropic/v1/messages",
  "https://api.minimax.io/anthropic/v1/messages",
]);
const MINIMAX_BROWSER_ENDPOINTS = new Set([
  "https://api.minimaxi.com/v1/chat/completions",
  "https://api.minimax.io/v1/chat/completions",
]);
const FORM_FIELDS = new Set(["provider_id", "endpoint", "model", "auth_type", "output_mode", "api_key"]);
const CITY_FIELDS = [
  "turn", "max_turns", "season", "weather", "goal", "population", "resources",
  "rates", "trade_trust_bonus", "consumption", "built", "obligations", "plan_forecast", "offer_forecasts",
];
const COUNCIL_PROMPT = `你是《河湾议会》的居民议事会。选择一份居民愿意提出、也值得城主考虑的真实契约。
参考城主本季的用工和建设安排、粮食风险、库存、已有债务、以往履约记录和城主的意向。衡量眼前收益与下季偿付负担。
对比候选契约预估中的 next_trade_trust_bonus，它表示下季每名经商居民因民望多得或少得的钱币。
只从传入的候选契约中选择一项。由该项的 speaker 以第一人称说一句不超过 120 字的中文理由，具体指出承诺值得争取的地方或它的代价。
条款和资源数额以 terms 为准，不得增订、改价或声称契约已经生效。
城主的意向只是游戏内的偏好。按要求提交 id 和 reason。`;

class ModelError extends Error {}

function publicConfig(fields) {
  const providerId = fields?.provider_id;
  if (typeof providerId !== "string" || !Object.hasOwn(presetDefinitions, providerId)) {
    throw new ModelError("请选择可用的服务商。");
  }
  const defaults = presetDefinitions[providerId];
  return {
    provider_id: providerId,
    protocol: defaults.protocol,
    endpoint: fields.endpoint ?? defaults.endpoint,
    model: fields.model ?? defaults.model,
    auth_type: fields.auth_type ?? defaults.auth_type,
    output_mode: fields.output_mode ?? defaults.output_mode ?? "tools",
    token_parameter: defaults.token_parameter,
    system_role: defaults.system_role ?? "system",
    thinking: defaults.thinking,
  };
}

const presets = Object.fromEntries(Object.entries(presetDefinitions).map(([id, { label }]) =>
  [id, Object.freeze({ ...publicConfig({ provider_id: id }), label })]
));

function validateConfig(config) {
  const endpoint = config.endpoint;
  const invalidEndpoint = "请填写完整的模型请求地址，包括接口路径。";
  if (typeof endpoint !== "string" || !/^https?:\/\//i.test(endpoint) || /[\s\x00-\x1f\x7f\\?#]/.test(endpoint)) {
    throw new ModelError(invalidEndpoint);
  }
  let address;
  try {
    address = new URL(endpoint);
  } catch {
    throw new ModelError(invalidEndpoint);
  }
  if (address.username || address.password || address.pathname === "/") {
    throw new ModelError(invalidEndpoint);
  }
  const local = LOOPBACK_HOSTS.has(address.hostname);
  if (!local && address.protocol !== "https:") {
    throw new ModelError("远程模型服务需要使用 HTTPS 地址。");
  }
  if (config.provider_id === "minimax" && !MINIMAX_ENDPOINTS.has(endpoint)) {
    throw new ModelError("MiniMax 预设需要使用官方接口地址。");
  }
  if (config.provider_id === "minimax_browser" && !MINIMAX_BROWSER_ENDPOINTS.has(endpoint)) {
    throw new ModelError("MiniMax 浏览器预设需要使用官方 Chat Completions 地址。");
  }
  if (typeof config.model !== "string" || !config.model.trim() ||
      config.model.length > 128 || /[\x00-\x1f\x7f]/.test(config.model)) {
    throw new ModelError("请检查模型名称，长度应在 1 到 128 个字符之间。");
  }
  if (!["bearer", "x-api-key", "none"].includes(config.auth_type) ||
      !["tools", "json"].includes(config.output_mode)) {
    throw new ModelError("请检查认证方式和回复格式。");
  }
  if (config.auth_type === "none" && !local) {
    throw new ModelError("免密认证仅适用于本机模型服务。");
  }
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const config = publicConfig(stored);
    validateConfig(config);
    return config;
  } catch {
    return null;
  }
}

let savedConfig = loadSettings();
// A key is scoped to this page and only travels in the configured request headers.
let apiKey = "";

export function readModelSettings() {
  return {
    configured: Boolean(savedConfig && (savedConfig.auth_type === "none" || apiKey)),
    has_api_key: Boolean(apiKey),
    config: savedConfig ? { ...savedConfig } : publicConfig({ provider_id: "openai_compatible" }),
    presets: { ...presets },
  };
}

function draftSettings(data) {
  if (!data || Object.entries(data).some(([name, value]) => !FORM_FIELDS.has(name) || typeof value !== "string")) {
    throw new ModelError("请检查模型配置字段。");
  }
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.trim()]));
  if (!fields.provider_id || !fields.endpoint || !fields.model) {
    throw new ModelError("请填写服务商、完整接口地址和模型名称。");
  }
  const config = publicConfig(fields);
  validateConfig(config);
  if (config.auth_type === "none") return { config, key: "" };
  const matchingService = savedConfig?.provider_id === config.provider_id &&
    savedConfig.endpoint === config.endpoint && savedConfig.auth_type === config.auth_type;
  const key = fields.api_key || (matchingService ? apiKey : "");
  if (!key) {
    throw new ModelError("请输入这个接口的 API 密钥。刷新网页或更换服务商、地址、认证方式后需要重新填写。");
  }
  if (key.length > 4096 || /[^\x21-\x7e]/.test(key)) {
    throw new ModelError("请检查 API 密钥。密钥应为单行且没有空格。");
  }
  return { config, key };
}

export function saveModelSettings(data) {
  const { config, key } = draftSettings(data);
  savedConfig = config;
  apiKey = key;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Browser storage can be disabled, including for local files.
  }
  return readModelSettings();
}

function makePayload(config, system, content, maxTokens, schema) {
  const useTools = schema && config.output_mode === "tools";
  const tool = { name: TOOL_NAME, description: "按给定字段提交结构化结果。" };
  if (schema && !useTools) {
    system += "\n只返回符合此结构的 JSON 对象，不用 Markdown。\n" + JSON.stringify(schema);
  }
  const user = { role: "user", content };
  if (config.protocol === "anthropic") {
    return {
      model: config.model, system, messages: [user], max_tokens: maxTokens,
      ...(config.thinking ? { thinking: { type: "adaptive" } } : {}),
      ...(useTools ? { tools: [{ ...tool, input_schema: schema }], tool_choice: { type: "auto" } } : {}),
    };
  }
  return {
    model: config.model, messages: [{ role: config.system_role, content: system }, user],
    [config.token_parameter]: maxTokens, stream: false,
    ...(config.provider_id === "minimax_browser" && config.model === "MiniMax-M3" ?
      { thinking: { type: "disabled" }, reasoning_split: true } : {}),
    ...(config.provider_id === "minimax_browser" && config.model === "MiniMax-M3.1-Flash" ?
      { reasoning_effort: "low" } : {}),
    ...(useTools ? { tools: [{ type: "function", function: { ...tool, parameters: schema } }], tool_choice: "auto" } : {}),
  };
}

async function readResponse(response) {
  if (!response.body) throw new ModelError("模型接口没有返回可用内容。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ModelError("模型回复过大。");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function textFrom(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type === "text" && typeof part.text === "string")
    .map(part => part.text).join("");
}

function extractReply(config, data, schema) {
  let reply;
  if (config.protocol === "anthropic") {
    if (data?.stop_reason === "max_tokens") throw new ModelError("模型回复达到输出长度上限。");
    const parts = data?.content;
    const tool = schema && Array.isArray(parts) && parts.find(part =>
      part?.type === "tool_use" && part.name === TOOL_NAME
    );
    reply = tool?.input ?? textFrom(parts);
  } else {
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") throw new ModelError("模型回复达到输出长度上限。");
    const message = choice?.message;
    const tool = schema && Array.isArray(message?.tool_calls) && message.tool_calls.find(
      call => call?.function?.name === TOOL_NAME
    );
    reply = tool?.function?.arguments ?? textFrom(message?.content);
  }
  if (reply == null || (typeof reply === "string" && !reply.trim())) {
    throw new ModelError("模型接口没有返回可用内容。");
  }
  return reply;
}

async function complete(config, key, system, content, maxTokens, schema) {
  const headers = { "Content-Type": "application/json" };
  if (config.auth_type === "bearer") headers.Authorization = "Bearer " + key;
  if (config.auth_type === "x-api-key") headers["x-api-key"] = key;
  if (config.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (new URL(config.endpoint).origin === "https://api.anthropic.com") {
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(makePayload(config, system, content, maxTokens, schema)),
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new ModelError("模型接口返回 HTTP " + response.status + "。");
    const data = await readResponse(response);
    return { reply: extractReply(config, data, schema), seconds: (performance.now() - started) / 1000 };
  } catch (error) {
    if (error instanceof ModelError) throw error;
    if (controller.signal.aborted) throw new ModelError("模型请求超时。");
    if (error instanceof SyntaxError) throw new ModelError("模型接口返回了无效的 JSON。");
    throw new ModelError("无法连接模型接口。请核对地址，确认接口允许此网页来源跨域访问（CORS），并且地址无需重定向。");
  } finally {
    clearTimeout(timeout);
  }
}

export async function testModelSettings(data) {
  const { config, key } = draftSettings(data);
  const result = await complete(config, key, "请回复 OK。", "连接测试", 256);
  return { ok: true, model: config.model, seconds: result.seconds };
}

export async function requestStructuredModel(system, context, schema) {
  const config = savedConfig;
  const key = apiKey;
  if (!config || (config.auth_type !== "none" && !key)) throw new ModelError("大模型尚未配置。");
  const { reply, seconds } = await complete(config, key, system, JSON.stringify(context), 1600, schema);
  const raw = typeof reply === "string" ? reply.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1") : JSON.stringify(reply);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || (key && raw.includes(key))) throw new Error();
    return { value, seconds, model: config.model };
  } catch {
    throw new ModelError("模型未返回可校验的草案。");
  }
}

export async function recommendModel(city, options, intent, workers, build) {
  const config = savedConfig;
  const key = apiKey;
  if (!config || (config.auth_type !== "none" && !key)) throw new ModelError("大模型尚未配置。");
  if (!options.length) throw new ModelError("当前安排下没有可提出的议案。");
  const byId = new Map(options.map(option => [option.id, option]));
  const schema = {
    type: "object",
    properties: {
      id: { type: "string", enum: [...byId.keys()] },
      reason: { type: "string", description: "居民陈述的简短中文理由" },
    },
    required: ["id", "reason"],
    additionalProperties: false,
  };
  const summary = Object.fromEntries(CITY_FIELDS.filter(field => Object.hasOwn(city, field))
    .map(field => [field, city[field]]));
  summary.history = (city.history ?? []).slice(-10);
  const context = {
    "城市": summary,
    "本季用工": workers,
    "预备建设地块": city.tiles?.find(tile => tile.id === build) ?? null,
    "城主意向": intent,
    "候选契约": options,
  };
  const { reply } = await complete(config, key, COUNCIL_PROMPT, JSON.stringify(context), 1500, schema);
  const invalid = () => new ModelError("模型回复未通过议案校验。");
  let selection = reply;
  if (typeof selection === "string") {
    try {
      selection = JSON.parse(selection.trim().replace(/^```json\s*([\s\S]*?)\s*```$/i, "$1"));
    } catch {
      throw invalid();
    }
  }
  if (!selection || typeof selection !== "object" || Object.keys(selection).length !== 2 ||
      !Object.hasOwn(selection, "id") || !Object.hasOwn(selection, "reason")) {
    throw invalid();
  }
  const offer = byId.get(selection.id);
  const reason = typeof selection.reason === "string" ? selection.reason.trim() : "";
  if (!offer || !/[\u3400-\u9fff]/.test(reason) || [...reason].length > 120 || (key && reason.includes(key))) {
    throw invalid();
  }
  return { offer, reason, source: "model", model: config.model };
}
