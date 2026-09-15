// srv/aiCore.js — SAP AI Core (Orchestration service) client via BTP destination
'use strict';

const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// All of these are overridable by env var so the destination / deployment /
// model can change without a code change (set them in mta.yaml or `cf set-env`).
const DEST_NAME     = process.env.AICORE_DEST          || 'AICoreGenAI';
const DEPLOYMENT_ID = process.env.AICORE_DEPLOYMENT_ID || '';
const RESOURCE_GROUP= process.env.AICORE_RESOURCE_GROUP|| 'default';
// Leave AICORE_MODEL unset to have the model read off the deployment itself.
const MODEL_NAME    = process.env.AICORE_MODEL         || '';
const MAX_TOKENS    = Number(process.env.AICORE_MAX_TOKENS || 500);
const TIMEOUT_MS    = Number(process.env.AICORE_TIMEOUT_MS || 30000);
const API_VERSION   = process.env.AICORE_API_VERSION   || '2023-05-15';

// 'orchestration' → POST /completion (orchestration deployment)
// 'chat'          → POST /chat/completions (direct model deployment)
// 'auto'          → try orchestration, fall back to chat on 404, then remember
const MODE = (process.env.AICORE_MODE || 'auto').toLowerCase();
let resolvedMode = MODE === 'auto' ? null : MODE;

const SYSTEM_PROMPT = `You are a supply-chain planning analyst for an order-based planning system.
You explain, to a production planner, why a single sales order could not be delivered on its promised date.

Rules:
- Use ONLY the facts in the DELAY CONTEXT. Never invent numbers, weeks, components or resources.
- Be concrete: name the constraint, quote the shortfall, name the week.
- Structure the answer as exactly these three sections, using these literal headings:
  Root cause:
  Impact:
  Recommended action:
- Each section is 1-2 short sentences. Total under 130 words. Plain prose, no markdown, no bullet characters.
- If the context shows no capacity or component shortage, say the order was displaced by
  competition from higher-priority orders in the scheduling sequence.`;

// ─── PROMPT INPUT ─────────────────────────────────────────────────────────────
// Renders the structured delay facts the UI already computed into compact text.
function buildContext(ctx) {
  const L = [];
  L.push(`Order: ${ctx.order_number || '—'}`);
  if (ctx.customer_name) L.push(`Customer: ${ctx.customer_name}${ctx.priority ? ` (priority ${ctx.priority})` : ''}`);
  if (ctx.product_name)  L.push(`Product: ${ctx.product_name}`);
  if (ctx.quantity != null) L.push(`Quantity: ${ctx.quantity}`);
  L.push(`Promised date: ${ctx.original_date || '—'}${ctx.promise_week ? ` (week ${ctx.promise_week})` : ''}`);
  L.push(`Optimizer scheduled date: ${ctx.optimized_date || '—'}`);
  L.push(`Delay: ${ctx.delay_days != null ? `${ctx.delay_days} days` : 'unknown'}`);
  if (ctx.penalty_cost != null) L.push(`Penalty cost: ${Math.round(Number(ctx.penalty_cost))}`);

  if (ctx.already_overdue) {
    L.push(`NOTE: the promise date had already passed before this optimization run was executed` +
           `${ctx.run_date ? ` on ${ctx.run_date}` : ''}, so the order was placed in the earliest producible week.`);
  }

  if (Array.isArray(ctx.capacity_issues) && ctx.capacity_issues.length) {
    L.push('');
    L.push(`Capacity constraints in the promised week:`);
    for (const c of ctx.capacity_issues) {
      L.push(`- ${c.name}${c.code ? ` (${c.code})` : ''}: available capacity ${Math.round(Number(c.capacity))}, ` +
             `required ${Math.round(Number(c.required))}, over by ${Math.round(Number(c.over_capacity))}` +
             `${Number(c.capacity) <= 0 ? ' — hard block, zero capacity in this week' : ''}`);
    }
  }

  if (Array.isArray(ctx.component_issues) && ctx.component_issues.length) {
    L.push('');
    L.push(`Component shortages in the promised week:`);
    for (const c of ctx.component_issues) {
      L.push(`- ${c.name}${c.code ? ` (${c.code})` : ''}: available ${Math.round(Number(c.available))}, ` +
             `required ${Math.round(Number(c.required))}, short by ${Math.round(Number(c.shortage))}` +
             `${Number(c.available) <= 0 ? ' — hard block, no stock in this week' : ''}`);
    }
  }

  if (!ctx.capacity_issues?.length && !ctx.component_issues?.length && !ctx.already_overdue) {
    L.push('');
    L.push('No capacity or component shortage was found in the promised week for this order.');
  }

  return L.join('\n');
}

// ─── ORCHESTRATION CALL ───────────────────────────────────────────────────────
// ─── MODEL NAME RESOLUTION ────────────────────────────────────────────────────
// The deployment ID fixes the inference URL, but the chat-completions body needs
// the configured model name itself (e.g. mistralai--mistral-small). Read it from
// the deployment's configuration once, rather than making callers hardcode it.
let resolvedModelName = null;

async function resolveModelName() {
  if (process.env.AICORE_MODEL) return process.env.AICORE_MODEL;
  if (resolvedModelName) return resolvedModelName;

  const dest    = { destinationName: DEST_NAME };
  const headers = { 'AI-Resource-Group': RESOURCE_GROUP };
  const opts    = { fetchCsrfToken: false };

  const deployment = await executeHttpRequest(
    dest, { method: 'GET', url: `/v2/lm/deployments/${DEPLOYMENT_ID}`, headers, timeout: TIMEOUT_MS }, opts
  );

  // Fast path: some deployments expose the model directly in their details.
  const direct = deployment.data?.details?.resources?.backend_details?.model?.name;
  if (direct) { resolvedModelName = direct; return resolvedModelName; }

  const configurationId = deployment.data?.configurationId;
  if (!configurationId) throw new Error('AI Core deployment has no configuration ID');

  const configuration = await executeHttpRequest(
    dest, { method: 'GET', url: `/v2/lm/configurations/${configurationId}`, headers, timeout: TIMEOUT_MS }, opts
  );

  const bindings = configuration.data?.parameterBindings || [];
  const binding  = bindings.find(b => b.key === 'modelName' || b.key === 'model');
  if (!binding?.value) throw new Error('AI Core deployment configuration has no modelName binding');

  resolvedModelName = binding.value;
  console.log(`[aiCore] resolved model "${resolvedModelName}" for deployment ${DEPLOYMENT_ID}`);
  return resolvedModelName;
}

async function summarizeDelay(ctx) {
  if (!DEPLOYMENT_ID) {
    const e = new Error('AICORE_DEPLOYMENT_ID is not set — cannot reach the AI Core deployment');
    e.statusCode = 503;
    throw e;
  }

  const context = buildContext(ctx);

  // A lookup failure here must not sink the summary — fall back to the env value.
  let modelName = MODEL_NAME;
  try {
    modelName = await resolveModelName();
  } catch (e) {
    console.warn('[aiCore] model name lookup failed, using configured value:', e.message);
  }

  // Orchestration deployment: templating + LLM modules, model named in the body.
  const orchestration = {
    url: `/v2/inference/deployments/${DEPLOYMENT_ID}/completion`,
    data: {
      orchestration_config: {
        module_configurations: {
          llm_module_config: {
            model_name: modelName,
            model_params: { max_tokens: MAX_TOKENS, temperature: 0.2 }
          },
          templating_module_config: {
            template: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user',   content: 'DELAY CONTEXT:\n{{?context}}' }
            ],
            defaults: {}
          }
        }
      },
      input_params: { context }
    },
    // { orchestration_result: { choices: [ { message: { content } } ] } }
    extract: d => d?.orchestration_result?.choices?.[0]?.message?.content,
    modelOf: d => d?.module_results?.llm?.model
  };

  // Direct model deployment: plain chat/completions.
  // api-version is an Azure OpenAI parameter — don't send it to other vendors
  // (mistralai--*, anthropic--*, …), which serve the OpenAI-compatible path bare.
  const isAzureOpenAI = /^(gpt|o[13469])/i.test(modelName || '');
  const chat = {
    url: `/v2/inference/deployments/${DEPLOYMENT_ID}/chat/completions` +
         (isAzureOpenAI ? `?api-version=${API_VERSION}` : ''),
    data: {
      // Azure OpenAI deployments ignore this; mistralai--*/anthropic--* require it.
      ...(modelName ? { model: modelName } : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `DELAY CONTEXT:\n${context}` }
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.2
    },
    // { choices: [ { message: { content } } ] }
    extract: d => d?.choices?.[0]?.message?.content,
    modelOf: d => d?.model
  };

  const variants = { orchestration, chat };

  async function attempt(name) {
    const v = variants[name];
    const response = await executeHttpRequest(
      { destinationName: DEST_NAME },
      {
        method: 'POST',
        url: v.url,
        headers: {
          'Content-Type': 'application/json',
          'AI-Resource-Group': RESOURCE_GROUP
        },
        data: v.data,
        timeout: TIMEOUT_MS
      },
      // Not an OData/OpenAPI service — send our body as-is, no CSRF pre-flight.
      { fetchCsrfToken: false }
    );

    const text = v.extract(response.data);
    if (!text) {
      const e = new Error(`AI Core (${name}) returned no completion content`);
      e.statusCode = 502;
      e.aiCoreDetail = response.data;
      throw e;
    }
    return { summary: String(text).trim(), model: v.modelOf(response.data) || modelName, mode: name };
  }

  // Try the known-good mode first; in 'auto' probe orchestration, then chat.
  const order = resolvedMode
    ? [resolvedMode]
    : ['orchestration', 'chat'];

  const failures = [];
  for (const name of order) {
    try {
      const out = await attempt(name);
      if (!resolvedMode) {
        resolvedMode = name;   // remember, so later clicks make a single call
        console.log(`[aiCore] using "${name}" endpoint for deployment ${DEPLOYMENT_ID}`);
      }
      return out;
    } catch (e) {
      const err = decorate(e, name);
      failures.push(`${name}: ${err.message}`);

      // A 404 that names the model is NOT a wrong-endpoint signal — retrying the
      // other shape would fail identically and hide the real cause. Stop here.
      if (isModelError(e)) {
        err.message = `Model "${modelName || '(empty)'}" is not available on deployment ` +
          `${DEPLOYMENT_ID} (resource group "${RESOURCE_GROUP}"). ` +
          `Unset AICORE_MODEL to read the model off the deployment, or check ` +
          `GET /api/ai/deployments for the deployed model name. Upstream: ${err.message}`;
        err.statusCode = 400;
        throw err;
      }

      // Otherwise only a 404 justifies trying the other endpoint shape.
      const status = e.response?.status;
      if (status !== 404 || resolvedMode) throw err;
    }
  }

  const e = new Error(`AI Core rejected both endpoint shapes — ${failures.join(' | ')}`);
  e.statusCode = 502;
  throw e;
}

// Distinguishes "this model isn't deployed" from "this endpoint doesn't exist".
function isModelError(e) {
  const body = e.response?.data;
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  return /model .{0,80}(does not exist|not found|not available|unknown)/i.test(text) ||
         /model_not_found|InvalidModel/i.test(text);
}

// Pull AI Core's own error body onto the Error so it reaches the logs and the UI
// instead of the bare "Request failed with status code NNN" from axios.
function decorate(e, mode) {
  const status = e.response?.status;
  const body   = e.response?.data || e.aiCoreDetail;
  const detail = body
    ? (typeof body === 'string' ? body : JSON.stringify(body))
    : '';
  e.statusCode = e.statusCode || status || 502;
  e.aiCoreDetail = body;
  e.message = `AI Core ${mode} call failed` +
    (status ? ` (HTTP ${status})` : '') +
    (detail ? `: ${detail.slice(0, 400)}` : `: ${e.message}`);
  return e;
}

module.exports = { summarizeDelay, resolveModelName, buildContext, DEST_NAME };
