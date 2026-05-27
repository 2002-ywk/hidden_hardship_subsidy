type JsonObject = Record<string, unknown>;

const DEFAULT_TOKEN_URL = "https://poa.paas.jmu.edu.cn/oauth2/token";
const DEFAULT_MESSAGE_SCOPE = "messagecenter:v1:sendMessage";
const DEFAULT_MESSAGE_API_URL = "https://poa.paas.jmu.edu.cn/apis/messagecenter/v1/poaMessage/messageSend";
const DEFAULT_MESSAGE_APP_ID = "gtxkno3gadcbsracqkxihlv5jda";
const DEFAULT_MESSAGE_TYPE_CODE = "MT1686736235000";

type MessageSendType = "SMS" | "MAIL" | "WECHAT" | "DINGTALK" | "SUPERAPP" | "WEBSITE";

export interface MessageSendPayloadInput {
  sendId?: string;
  sendType?: MessageSendType[];
  messageTypeCode?: string;
  promise?: boolean;
  importantIdentity?: boolean;
  signOff?: string;
  toPersons?: string;
  toDepts?: string;
  toGroups?: string;
  toPhones?: string;
  toEmails?: string;
  data: {
    handleKey?: string;
    coverImageUrl?: string;
    signOff?: string;
    mobileUrl?: string;
    title: string;
    paramValueJson?: Record<string, unknown>;
    filesUrl?: string;
    url?: string;
  };
}

interface MessageApiConfig {
  code: string;
  path: string;
  scope: string;
  appId: string;
  messageTypeCode: string;
}

type TokenCache = {
  accessToken: string | null;
  expiresAt: number;
};

const tokenCache: TokenCache = {
  accessToken: null,
  expiresAt: 0,
};

function getCachedToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  return null;
}

function setCachedToken(accessToken: string, expiresInSeconds: number) {
  const safeExpiresIn = Number.isFinite(expiresInSeconds) && expiresInSeconds > 60 ? expiresInSeconds - 30 : 3300;
  tokenCache.accessToken = accessToken;
  tokenCache.expiresAt = Date.now() + safeExpiresIn * 1000;
}

function withOptionalStringFields<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => !(typeof fieldValue === "string" && fieldValue.trim() === ""))
  ) as T;
}

function getMessageApiConfig(): MessageApiConfig {
  return {
    code: "MSG",
    path: process.env.MESSAGE_PLATFORM_API_URL ?? DEFAULT_MESSAGE_API_URL,
    scope: process.env.MESSAGE_PLATFORM_SCOPE ?? DEFAULT_MESSAGE_SCOPE,
    appId: process.env.MESSAGE_PLATFORM_APP_ID?.trim() || DEFAULT_MESSAGE_APP_ID,
    messageTypeCode: process.env.MESSAGE_PLATFORM_DEFAULT_MESSAGE_TYPE_CODE?.trim() || DEFAULT_MESSAGE_TYPE_CODE,
  };
}

export class MessageCenterClient {
  hasConfiguredCredentials() {
    const clientId = process.env.MESSAGE_PLATFORM_CLIENT_ID?.trim() || process.env.DATA_PLATFORM_CLIENT_ID?.trim() || "";
    const clientSecret =
      process.env.MESSAGE_PLATFORM_CLIENT_SECRET?.trim() || process.env.DATA_PLATFORM_CLIENT_SECRET?.trim() || "";
    return Boolean(clientId && clientSecret);
  }

  getRuntimeConfigSummary() {
    const api = getMessageApiConfig();
    const tokenUrl = process.env.MESSAGE_PLATFORM_TOKEN_URL ?? process.env.DATA_PLATFORM_TOKEN_URL ?? DEFAULT_TOKEN_URL;
    return {
      tokenUrl,
      apiUrl: api.path,
      scope: api.scope,
      appId: api.appId,
      messageTypeCode: api.messageTypeCode,
      hasCredentials: this.hasConfiguredCredentials(),
      credentialSource: process.env.MESSAGE_PLATFORM_CLIENT_ID?.trim() ? "MESSAGE_PLATFORM_*" : "DATA_PLATFORM_*",
    };
  }

  private isBusinessSuccess(payload: unknown) {
    if (!payload || typeof payload !== "object") return true;

    const obj = payload as Record<string, unknown>;
    const code = String(obj.code ?? obj.status ?? obj.errCode ?? "").trim().toLowerCase();
    const success = obj.success;
    const ok = obj.ok;

    if (typeof success === "boolean") return success;
    if (typeof ok === "boolean") return ok;
    if (!code) return true;

    return ["0", "200", "ok", "success", "true"].includes(code);
  }

  private pickBusinessErrorMessage(payload: unknown) {
    if (!payload || typeof payload !== "object") return "";

    const obj = payload as Record<string, unknown>;
    const message = obj.message ?? obj.msg ?? obj.error_description ?? obj.error ?? obj.detail;

    return typeof message === "string" ? message : "";
  }

  async getAccessToken() {
    const cachedToken = getCachedToken();
    if (cachedToken) {
      return cachedToken;
    }

    const tokenUrl = process.env.MESSAGE_PLATFORM_TOKEN_URL ?? process.env.DATA_PLATFORM_TOKEN_URL ?? DEFAULT_TOKEN_URL;
    const clientId = process.env.MESSAGE_PLATFORM_CLIENT_ID?.trim() || process.env.DATA_PLATFORM_CLIENT_ID?.trim() || "";
    const clientSecret =
      process.env.MESSAGE_PLATFORM_CLIENT_SECRET?.trim() || process.env.DATA_PLATFORM_CLIENT_SECRET?.trim() || "";
    const api = getMessageApiConfig();

    if (!clientId || !clientSecret) {
      throw new Error("缺少消息平台凭据，请配置 MESSAGE_PLATFORM_CLIENT_ID / MESSAGE_PLATFORM_CLIENT_SECRET");
    }

    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
    body.set("scope", api.scope);

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    const text = await response.text();
    let payload: JsonObject = {};

    try {
      payload = text ? (JSON.parse(text) as JsonObject) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(`消息平台获取 token 失败（HTTP ${response.status}）：${text || "unknown error"}`);
    }

    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    const expiresInRaw = Number(payload.expires_in ?? 3600);

    if (!accessToken) {
      throw new Error("消息平台获取 token 失败：返回中缺少 access_token");
    }

    setCachedToken(accessToken, Number.isFinite(expiresInRaw) ? expiresInRaw : 3600);
    return accessToken;
  }

  buildPayload(input: MessageSendPayloadInput) {
    const api = getMessageApiConfig();
    const title = String(input?.data?.title ?? "").trim();
    if (!title) {
      throw new Error("消息发送参数缺失：data.title 为必填项");
    }

    return withOptionalStringFields({
      appId: api.appId,
      sendId: input.sendId ?? "",
      sendType: input.sendType && input.sendType.length > 0 ? input.sendType : ["WEBSITE", "SUPERAPP"],
      messageTypeCode: input.messageTypeCode ?? api.messageTypeCode,
      promise: Boolean(input.promise),
      importantIdentity: Boolean(input.importantIdentity),
      signOff: input.signOff ?? input.data.signOff ?? "",
      toPersons: input.toPersons ?? "",
      toDepts: input.toDepts ?? "",
      toGroups: input.toGroups ?? "",
      toPhones: input.toPhones ?? "",
      toEmails: input.toEmails ?? "",
      data: withOptionalStringFields({
        handleKey: input.data.handleKey ?? "",
        coverImageUrl: input.data.coverImageUrl ?? "",
        mobileUrl: input.data.mobileUrl ?? "",
        title,
        paramValueJson: input.data.paramValueJson ?? {},
        filesUrl: input.data.filesUrl ?? "",
        url: input.data.url ?? "",
      }),
    });
  }

  async sendMessage(input: MessageSendPayloadInput) {
    const token = await this.getAccessToken();
    const api = getMessageApiConfig();
    const payload = this.buildPayload(input);

    const response = await fetch(api.path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let parsed: unknown = null;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!response.ok) {
      throw new Error(`消息发送失败（HTTP ${response.status}）：${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
    }

    if (!this.isBusinessSuccess(parsed)) {
      const reason = this.pickBusinessErrorMessage(parsed) || "消息平台返回业务失败";
      throw new Error(`消息发送失败（业务失败）：${reason}；响应=${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
    }

    return {
      request: payload,
      response: parsed,
      status: response.status,
      apiCode: api.code,
      scope: api.scope,
    };
  }
}

export const messageCenterClient = new MessageCenterClient();

