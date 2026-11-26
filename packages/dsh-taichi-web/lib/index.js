import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
// src/env.ts
const TAICHI_SEARCH_PROVIDER_ID = "taichi-search";
const TAICHI_FETCH_PROVIDER_ID = "taichi-fetch";
const TAICHI_WEB_TOOLS_PREFIX = "/v1/tools";
/** Read gateway URL and access token from the Host environment. */
function resolveTaichiWebGateway(env = process.env) {
	const base = typeof env.TAICHI_GATEWAY_URL === "string" ? env.TAICHI_GATEWAY_URL.trim().replace(/\/$/u, "") : "";
	const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === "string" ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim() : "";
	if (base.length === 0 || token.length === 0) return { ok: false };
	return {
		ok: true,
		baseURL: base,
		token
	};
}
// src/transport.ts
const USER_AGENT = "dsh-taichi-web/0.1.0";
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalidResponse() {
	return new WebError("Taichi gateway returned an invalid response body", "WEB_PROVIDER_ERROR");
}
function requestAborted(signal, fallback) {
	return new WebError("Taichi web request aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
function throwIfAborted(signal) {
	if (signal?.aborted === true) throw requestAborted(signal);
}
function statusMessage(status, body) {
	let message = `Taichi gateway error (HTTP ${status})`;
	if (isRecord(body)) {
		const detail = typeof body.error === "string" ? body.error : isRecord(body.error) ? body.error.message : body.message;
		if (typeof detail === "string" && detail.length > 0) message += `: ${detail}`;
	}
	return message;
}
function mapHttpFailure(status, message) {
	if (status === 401) return new WebError(`${message}\n\nTaichi rejected the signed-in account used for this web request. Guide the user to sign in to Taichi again; the endpoint does not need changing.`, "WEB_PROVIDER_ERROR");
	if (status === 402) return new WebError(`${message}\n\nTaichi reports insufficient credits for this web request. Guide the user to check their credit balance or recharge.`, "WEB_PROVIDER_ERROR");
	return new WebError(message, "WEB_PROVIDER_ERROR");
}
async function dispatchTaichiWeb(env, path, body, decode, signal) {
	throwIfAborted(signal);
	const gateway = resolveTaichiWebGateway(env);
	if (!gateway.ok) throw new WebError("Taichi web access has no gateway URL or access token to send", "WEB_PROVIDER_CREDENTIAL_MISSING");
	return dispatchResolved(gateway, path, body, decode, signal);
}
async function dispatchResolved(gateway, path, body, decode, signal) {
	const endpoint = `${gateway.baseURL}${TAICHI_WEB_TOOLS_PREFIX}${path}`;
	throwIfAborted(signal);
	let response;
	try {
		response = await fetch(endpoint, {
			method: "POST",
			redirect: "error",
			headers: {
				authorization: `Bearer ${gateway.token}`,
				"content-type": "application/json",
				accept: "application/json",
				"user-agent": USER_AGENT
			},
			body: JSON.stringify(body),
			...signal !== void 0 ? { signal } : {}
		});
	} catch (error) {
		if (signal?.aborted === true || isAbortError(error)) throw requestAborted(signal, error);
		throw new WebError(`Taichi web request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
	}
	if (!response.ok) {
		let parsed;
		let aborted;
		try {
			parsed = await response.json();
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) aborted = requestAborted(signal, error);
		}
		if (aborted !== void 0) throw aborted;
		throw mapHttpFailure(response.status, statusMessage(response.status, parsed));
	}
	try {
		const payload = await response.json();
		throwIfAborted(signal);
		return decode(payload);
	} catch (error) {
		if (signal?.aborted === true || isAbortError(error)) throw requestAborted(signal, error);
		if (error instanceof WebError) throw error;
		throw new WebError(`Taichi gateway returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
	}
}
// src/fetch.ts
var TaichiFetchProvider = class {
	resolveEnv;
	id = TAICHI_FETCH_PROVIDER_ID;
	title = "太极";
	description = {
		en: "Uses the signed-in Taichi account credits. Cannot reach intranet or local addresses. Requires sign-in.",
		zh: "使用已登录的太极账号积分。无法访问内网和本机。需要登录。"
	};
	constructor(resolveEnv) {
		this.resolveEnv = resolveEnv;
	}
	available() {
		const env = this.resolveEnv();
		const url = typeof env.TAICHI_GATEWAY_URL === "string" ? env.TAICHI_GATEWAY_URL.trim() : "";
		const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === "string" ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim() : "";
		return url.length > 0 && token.length > 0;
	}
	async ready() {
		return this.available();
	}
	fetch(request, signal) {
		return dispatchTaichiWeb(this.resolveEnv(), "/fetch", { url: request.url }, (payload) => {
			if (!isRecord(payload) || typeof payload.content !== "string") throw invalidResponse();
			return {
				url: request.url,
				statusCode: 200,
				body: {
					kind: "text",
					content: payload.content
				},
				truncated: false
			};
		}, signal);
	}
};
// src/search.ts
const ORIGINAL_QUESTION_MAX_CHARS = 128;
function mapSearchResponse(response) {
	if (!isRecord(response) || !Array.isArray(response.results)) throw invalidResponse();
	return {
		sources: response.results.map((item) => {
			if (!isRecord(item) || typeof item.url !== "string" || item.url.length === 0 || typeof item.title !== "string" || typeof item.snippet !== "string" || item.summary !== void 0 && typeof item.summary !== "string" || item.date !== null && typeof item.date !== "string") throw invalidResponse();
			return {
				url: item.url,
				...item.title.length > 0 ? { title: item.title } : {},
				...item.snippet.length > 0 ? { snippet: item.snippet } : {},
				...typeof item.summary === "string" && item.summary.length > 0 ? { summary: item.summary } : {},
				...item.date !== null && item.date.length > 0 ? { publishedAt: item.date } : {}
			};
		}),
		truncated: false
	};
}
function boundedQuestion(question) {
	const collapsed = question?.replace(/\s+/gu, " ").trim() ?? "";
	if (collapsed.length === 0) return void 0;
	return Array.from(collapsed).slice(0, ORIGINAL_QUESTION_MAX_CHARS).join("");
}
var TaichiSearchProvider = class {
	resolveEnv;
	limits;
	id = TAICHI_SEARCH_PROVIDER_ID;
	title = "太极";
	description = {
		en: "Uses the signed-in Taichi account credits. Cannot reach intranet or local addresses. Requires sign-in.",
		zh: "使用已登录的太极账号积分。无法访问内网和本机。需要登录。"
	};
	starts = [];
	constructor(resolveEnv, limits) {
		this.resolveEnv = resolveEnv;
		this.limits = limits;
	}
	available() {
		const env = this.resolveEnv();
		const url = typeof env.TAICHI_GATEWAY_URL === "string" ? env.TAICHI_GATEWAY_URL.trim() : "";
		const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === "string" ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim() : "";
		return url.length > 0 && token.length > 0 && Number.isInteger(this.limits.count) && this.limits.count > 0 && Number.isInteger(this.limits.searchRequestsPerSecond) && this.limits.searchRequestsPerSecond > 0;
	}
	async ready() {
		return this.available();
	}
	async search(request, signal) {
		const question = boundedQuestion(this.limits.originalQuestion?.());
		await this.waitForRequestSlot(this.limits.searchRequestsPerSecond, signal);
		return dispatchTaichiWeb(this.resolveEnv(), "/search", {
			query: request.query,
			count: Math.min(this.limits.count, request.maxResults ?? this.limits.count),
			need_content: false,
			...question === void 0 ? {} : { ori_question: question }
		}, mapSearchResponse, signal);
	}
	async waitForRequestSlot(limit, signal) {
		for (;;) {
			if (signal?.aborted === true) throw requestAborted(signal);
			const now = performance.now();
			let oldest = this.starts[0];
			while (oldest !== void 0 && oldest < now - 1e3) {
				this.starts.shift();
				oldest = this.starts[0];
			}
			if (oldest === void 0 || this.starts.length < limit) {
				this.starts.push(now);
				return;
			}
			await abortableDelay(oldest + 1001 - now, signal);
		}
	}
};
function abortableDelay(ms, signal) {
	return new Promise((resolve) => {
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
// src/index.ts
const name = "dsh-taichi-web";
const inject = ["web"];
const Config = z.object({
	count: z.number().step(1).min(1).max(50).default(10).volatile(),
	searchRequestsPerSecond: z.number().step(1).min(1).default(5).volatile()
});
function apply(ctx, config) {
	const resolveEnv = () => process.env;
	ctx.web.registerSearchProvider(new TaichiSearchProvider(resolveEnv, {
		get count() {
			return config.count.get();
		},
		get searchRequestsPerSecond() {
			return config.searchRequestsPerSecond.get();
		}
	}));
	ctx.web.registerFetchProvider(new TaichiFetchProvider(resolveEnv));
}
export { Config, TAICHI_FETCH_PROVIDER_ID, TAICHI_SEARCH_PROVIDER_ID, TaichiFetchProvider, TaichiSearchProvider, apply, inject, mapSearchResponse, name, resolveTaichiWebGateway };
