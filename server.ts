import express from "express";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import session from "express-session";
import net from "node:net";
import { createServer as createViteServer } from "vite";
import { candidateRepository } from "./src/server/repositories/candidateRepository";
import { dataSyncRepository } from "./src/server/repositories/dataSyncRepository";
import { referenceDataRepository } from "./src/server/repositories/referenceDataRepository";
import { prisma } from "./src/server/db/client";
import type {
  AuthLoginRequest,
  AuthLoginResponse,
  AuthLogoutResponse,
  AuthMeResponse,
  BatchCreateRequest,
  DictionarySaveRequest,
  DictionaryTypeUpsertRequest,
  ReviewActionRequest,
  SyncRunRequest,
  SyncTerminateResponse,
  SystemConfigUpdateRequest,
  TagInvalidateResponse,
} from "./src/types";

function loadEnvironment() {
  const envLocalPath = path.resolve(process.cwd(), ".env.local");
  const envPath = path.resolve(process.cwd(), ".env");

  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  }

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./prisma/dev.db";
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const VITE_HMR_PORT = Number(process.env.VITE_HMR_PORT) || 24678;

  app.use(express.json());
  app.use(
    session({
      name: "hh.sid",
      secret: process.env.SESSION_SECRET || "hidden-hardship-subsidy-dev",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );
  // CafeteriaMonthlySnapshot has been deprecated and will be removed from MySQL.
  // Dashboard stats are now computed on the fly from monthly transaction tables.

  type SessionUser = {
    id: string;
    account: string;
    employeeNo: string;
    name: string;
    role: string;
    college?: string | null;
    unitCode?: string | null;
    postCode?: string | null;
    postName?: string | null;
    canFundingOfficeReview?: boolean;
    canFinalReview?: boolean;
  };

  const getSessionUser = (req: express.Request) => (req.session as unknown as { user?: SessionUser }).user;
  const setSessionUser = (req: express.Request, user: SessionUser) => {
    (req.session as unknown as { user?: SessionUser }).user = user;
  };
  const clearSessionUser = (req: express.Request) => {
    delete (req.session as unknown as { user?: SessionUser }).user;
  };
  type OAuthSession = {
    state: string;
    role?: string;
  };
  type OAuthStateCacheRecord = {
    role: string;
    expiresAt: number;
  };
  type SessionTokens = {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenType?: string;
    scope?: string;
  };
  const getOAuthSession = (req: express.Request) => (req.session as unknown as { oauth?: OAuthSession }).oauth;
  const setOAuthSession = (req: express.Request, oauth: OAuthSession) => {
    (req.session as unknown as { oauth?: OAuthSession }).oauth = oauth;
  };
  const clearOAuthSession = (req: express.Request) => {
    delete (req.session as unknown as { oauth?: OAuthSession }).oauth;
  };
  const setSessionTokens = (req: express.Request, tokens: SessionTokens) => {
    (req.session as unknown as { oauthTokens?: SessionTokens }).oauthTokens = tokens;
  };
  const clearSessionTokens = (req: express.Request) => {
    delete (req.session as unknown as { oauthTokens?: SessionTokens }).oauthTokens;
  };
  const oauthClientId = process.env.JMU_AUTH_CLIENT_ID || process.env.OAUTH_CLIENT_ID || "OAuth2";
  const oauthClientSecret = process.env.JMU_AUTH_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || "3A6Rh2bpFkfNAtJW0D6ebo";
  const oauthAuthorizeUrl =
    process.env.JMU_AUTH_AUTHORIZE_URL || process.env.OAUTH_AUTHORIZE_URL || "https://cas.paas.jmu.edu.cn/cas/oauth2.0/authorize";
  const oauthTokenUrl =
    process.env.JMU_AUTH_TOKEN_URL || process.env.OAUTH_TOKEN_URL || "https://cas.paas.jmu.edu.cn/cas/oauth2.0/accessToken";
  const oauthUserinfoUrl =
    process.env.JMU_AUTH_USERINFO_URL || process.env.OAUTH_USERINFO_URL || "https://cas.paas.jmu.edu.cn/cas/oauth2.0/profile";
  const oauthCallbackUrl =
    process.env.JMU_AUTH_REDIRECT_URI || process.env.OAUTH_CALLBACK_URL || "http://210.34.132.91:3000/api/auth/callback/jmu";
  const oauthScope = process.env.JMU_AUTH_SCOPE || process.env.OAUTH_SCOPE || "openid";
  const oauthSignoutRedirectUrl =
    process.env.JMU_AUTH_SIGNOUT_REDIRECT_URL || process.env.OAUTH_SIGNOUT_REDIRECT_URL || "http://210.34.132.91:3000/login";
  const oauthEnabled = Boolean(oauthAuthorizeUrl && oauthTokenUrl && oauthUserinfoUrl);
  const oauthStateCache = new Map<string, OAuthStateCacheRecord>();
  const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
  const oauthStateSignSecret = process.env.OAUTH_STATE_SECRET || process.env.SESSION_SECRET || "hidden-hardship-subsidy-dev";
  const pruneExpiredOAuthState = () => {
    const now = Date.now();
    for (const [key, record] of oauthStateCache.entries()) {
      if (record.expiresAt <= now) oauthStateCache.delete(key);
    }
  };
  const setCachedOAuthState = (state: string, role: string) => {
    pruneExpiredOAuthState();
    oauthStateCache.set(state, { role, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
  };
  const consumeCachedOAuthState = (state: string) => {
    const record = oauthStateCache.get(state);
    oauthStateCache.delete(state);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) return null;
    return record;
  };
  const signOAuthState = (nonce: string, issuedAt: number) =>
    crypto.createHmac("sha256", oauthStateSignSecret).update(`${nonce}.${issuedAt}`).digest("hex");
  const createSignedOAuthState = () => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const issuedAt = Date.now();
    const signature = signOAuthState(nonce, issuedAt);
    return `${nonce}.${issuedAt}.${signature}`;
  };
  const verifySignedOAuthState = (state: string) => {
    const parts = String(state ?? "").trim().split(".");
    if (parts.length !== 3) return false;
    const [nonce, issuedAtRaw, signature] = parts;
    if (!nonce || !issuedAtRaw || !signature) return false;
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt)) return false;
    if (Date.now() - issuedAt > OAUTH_STATE_TTL_MS) return false;
    const expected = signOAuthState(nonce, issuedAt);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  };
  const parseJsonSafe = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const pickFirstNonEmpty = (source: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = source[key];
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  };

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) {
      res.status(401).json({ message: "未登录" });
      return;
    }
    next();
  };
  const pickFirstByCaseInsensitiveKey = (source: Record<string, unknown>, keys: string[]) => {
    const keySet = new Set(keys.map((item) => item.toLowerCase()));
    for (const [rawKey, rawValue] of Object.entries(source)) {
      if (!keySet.has(rawKey.toLowerCase())) continue;
      if (rawValue == null) continue;
      const text = String(rawValue).trim();
      if (text) return text;
    }
    return "";
  };
  const normalizeOrgText = (value: string) =>
    String(value ?? "")
      .trim()
      .replaceAll("（", "(")
      .replaceAll("）", ")")
      .replace(/\s+/g, "");
  const isStudentAffairsOrg = (value: string) => {
    const text = normalizeOrgText(value);
    if (!text) return false;
    return (
      text.includes("学生处") ||
      text.includes("学生工作部") ||
      text.includes("学工部") ||
      text.includes("党委学生工作部(处)")
    );
  };
  const parseCsvSet = (value?: string) =>
    new Set(
      String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    );
  const roleBindingCollegeAdminUnitCodes = parseCsvSet(process.env.AUTH_COLLEGE_ADMIN_UNIT_CODES);
  const roleBindingCollegeAdminPostCodes = parseCsvSet(process.env.AUTH_COLLEGE_ADMIN_POST_CODES);
  const roleBindingCounselorUnitCodes = parseCsvSet(process.env.AUTH_COUNSELOR_UNIT_CODES);
  const roleBindingCounselorPostCodes = parseCsvSet(process.env.AUTH_COUNSELOR_POST_CODES);
  const roleBindingCounselorPostNameKeywords = String(process.env.AUTH_COUNSELOR_POST_NAME_KEYWORDS ?? "辅导员")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const roleBindingCollegeAdminPostNameKeywords = String(process.env.AUTH_COLLEGE_ADMIN_POST_NAME_KEYWORDS ?? "副书记")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const roleBindingFinalReviewerPostNameKeywords = String(process.env.AUTH_FINAL_REVIEWER_POST_NAME_KEYWORDS ?? "部长")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const requireRoles = (roles: string[]): express.RequestHandler => {
    return (req, res, next) => {
      const user = getSessionUser(req);
      if (!user) {
        res.status(401).json({ message: "未登录" });
        return;
      }
      if (!roles.includes(user.role)) {
        res.status(403).json({ message: "无权限" });
        return;
      }
      next();
    };
  };

  // Mock API is served by the same Express app to keep frontend and backend integrated.
  app.get("/api/health/db", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "db check failed";
      res.status(500).json({ ok: false, message });
    }
  });

  app.get("/api/health/time", async (req, res) => {
    try {
      const nodeNow = new Date();
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          global_tz: string;
          session_tz: string;
          now_text: string;
          utc_text: string;
        }>
      >(
        `
        SELECT
          @@global.time_zone AS global_tz,
          @@session.time_zone AS session_tz,
          DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now_text,
          DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS utc_text
        `
      );
      res.json({
        ok: true,
        node: {
          timezoneOffsetMinutes: nodeNow.getTimezoneOffset(),
          iso: nodeNow.toISOString(),
          localText: `${nodeNow.getFullYear()}-${String(nodeNow.getMonth() + 1).padStart(2, "0")}-${String(
            nodeNow.getDate()
          ).padStart(2, "0")} ${String(nodeNow.getHours()).padStart(2, "0")}:${String(nodeNow.getMinutes()).padStart(
            2,
            "0"
          )}:${String(nodeNow.getSeconds()).padStart(2, "0")}`,
        },
        mysql: rows[0] ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "time check failed";
      res.status(500).json({ ok: false, message });
    }
  });

  app.post("/api/auth/login", async (_req, res) => {
    res.status(403).json({ message: "Local login is disabled. Please use JMU OAuth2 login." });
  });

  app.get("/api/auth/login/jmu", async (req, res) => {
    if (!oauthEnabled) {
      res.status(500).json({ message: "OAuth2 not configured: missing authorize/token/userinfo endpoint(s)." });
      return;
    }
    const state = createSignedOAuthState();
    const role = typeof req.query.role === "string" ? req.query.role : "";
    setOAuthSession(req, { state, role: role || "counselor" });
    setCachedOAuthState(state, role || "counselor");

    const authorizeUrl = new URL(oauthAuthorizeUrl);
    const reauth = String(req.query.reauth ?? "").trim();
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", oauthClientId);
    authorizeUrl.searchParams.set("redirect_uri", oauthCallbackUrl);
    authorizeUrl.searchParams.set("scope", oauthScope);
    authorizeUrl.searchParams.set("state", state);
    if (reauth === "1") {
      authorizeUrl.searchParams.set("prompt", "login");
      authorizeUrl.searchParams.set("max_age", "0");
    }
    res.redirect(authorizeUrl.toString());
  });

  app.get("/api/auth/callback/jmu", async (req, res) => {
    try {
      if (!oauthEnabled) {
        res.status(500).send("OAuth2 not configured.");
        return;
      }
      const code = String(req.query.code ?? "").trim();
      const state = String(req.query.state ?? "").trim();
      const oauthSession = getOAuthSession(req);
      const cachedState = state ? consumeCachedOAuthState(state) : null;
      const signedStateValid = verifySignedOAuthState(state);
      const sessionOrCacheMatched = Boolean((oauthSession?.state && oauthSession.state === state) || cachedState);
      const stateValid = Boolean(state && (signedStateValid || sessionOrCacheMatched));
      if (!code || !stateValid) {
        res.status(400).send("Invalid OAuth callback state or code.");
        return;
      }

      const tokenBody = new URLSearchParams();
      tokenBody.set("grant_type", "authorization_code");
      tokenBody.set("code", code);
      tokenBody.set("redirect_uri", oauthCallbackUrl);
      tokenBody.set("client_id", oauthClientId);
      tokenBody.set("client_secret", oauthClientSecret);
      const tokenResponse = await fetch(oauthTokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenBody.toString(),
      });
      const tokenText = await tokenResponse.text();
      const tokenData = parseJsonSafe(tokenText) as Record<string, unknown> | null;
      if (!tokenResponse.ok || !tokenData) {
        res.status(502).send(`OAuth token exchange failed: HTTP ${tokenResponse.status}`);
        return;
      }
      const accessToken = String(tokenData.access_token ?? "").trim();
      const refreshToken = String(tokenData.refresh_token ?? "").trim() || undefined;
      const expiresIn = Number(tokenData.expires_in ?? 0);
      if (!accessToken) {
        res.status(502).send("OAuth token exchange failed: access_token missing.");
        return;
      }
      setSessionTokens(req, {
        accessToken,
        refreshToken,
        expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
        tokenType: String(tokenData.token_type ?? "").trim() || undefined,
        scope: String(tokenData.scope ?? "").trim() || undefined,
      });

      const userinfoResponse = await fetch(oauthUserinfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      const userinfoText = await userinfoResponse.text();
      const userinfo = parseJsonSafe(userinfoText) as Record<string, unknown> | null;
      if (!userinfoResponse.ok || !userinfo) {
        res.status(502).send(`OAuth userinfo failed: HTTP ${userinfoResponse.status}`);
        return;
      }

      const attributes = typeof userinfo.attributes === "object" && userinfo.attributes ? (userinfo.attributes as Record<string, unknown>) : {};
      const employeeNoFromOAuth =
        pickFirstNonEmpty(userinfo, ["employeeNo", "employee_no", "gh"]) ||
        pickFirstNonEmpty(attributes, ["gh", "employeeNo", "employee_no"]);
      const account =
        pickFirstNonEmpty(userinfo, ["username", "account", "userId", "id"]) ||
        pickFirstNonEmpty(attributes, ["accountName", "account", "userName", "userId", "id"]) ||
        employeeNoFromOAuth;
      const employeeNo = employeeNoFromOAuth || account;
      const name =
        pickFirstNonEmpty(userinfo, ["name", "realName", "displayName", "xm", "userName"]) ||
        pickFirstNonEmpty(attributes, ["name", "userName", "accountName"]) ||
        account;
      const college =
        pickFirstNonEmpty(userinfo, ["college", "unitName", "department", "departmentName"]) ||
        pickFirstNonEmpty(attributes, ["organizationName", "organizationCode", "organizationId"]) ||
        null;
      if (!account || !employeeNo) {
        res.status(502).send("OAuth userinfo missing account/employee number.");
        return;
      }

      const superAdminEmployeeNos = new Set(["202461000059", "200461000077"]);
      const fixedStudentAffairsEmployeeNos = new Set(["201761000027"]);
      const dwh =
        pickFirstByCaseInsensitiveKey(userinfo, ["DWH", "unitCode", "departmentCode"]) ||
        pickFirstByCaseInsensitiveKey(attributes, ["DWH", "unitCode", "departmentCode"]);
      const orgRelations = await prisma.$queryRawUnsafe<
        Array<{
          unitCode: string | null;
          unitName: string | null;
          postCode: string | null;
          postName: string | null;
          status: string | null;
        }>
      >(
        `
        SELECT
          opr.unitCode AS unitCode,
          opr.unitName AS unitName,
          opr.postCode AS postCode,
          COALESCE(op.postName, opr.postName) AS postName,
          opr.status AS status
        FROM org_person_relation_sync opr
        LEFT JOIN org_post_sync op ON op.postCode = opr.postCode
        WHERE opr.employeeNo = ?
        ORDER BY opr.updatedAt DESC
        `,
        employeeNo
      );
      const normalizedOrgRelations = orgRelations
        .map((item) => ({
          unitCode: String(item.unitCode ?? "").trim(),
          unitName: String(item.unitName ?? "").trim(),
          postCode: String(item.postCode ?? "").trim(),
          postName: String(item.postName ?? "").trim(),
          status: String(item.status ?? "").trim(),
        }))
        .filter((item) => item.unitCode || item.postCode || item.unitName || item.postName);
      const activeOrgRelations = normalizedOrgRelations.filter((item) => item.status === "" || item.status === "0" || item.status.toLowerCase() === "active");
      const effectiveOrgRelations = activeOrgRelations.length > 0 ? activeOrgRelations : normalizedOrgRelations;
      const orgUnitCodes = new Set(effectiveOrgRelations.map((item) => item.unitCode).filter(Boolean));
      const orgPostCodes = new Set(effectiveOrgRelations.map((item) => item.postCode).filter(Boolean));
      const orgUnitNames = effectiveOrgRelations.map((item) => item.unitName).filter(Boolean);
      const orgPostNames = effectiveOrgRelations.map((item) => item.postName).filter(Boolean);
      const primaryOrgRelation = effectiveOrgRelations[0];
      const inStudentAffairsUnit = orgUnitCodes.has("00000009") || dwh === "00000009";
      const inFundingOfficeUnit = orgUnitCodes.has("00000090") || dwh === "00000090";
      const hasCollegeAdminPostByName = orgPostNames.some((postName) =>
        roleBindingCollegeAdminPostNameKeywords.some((keyword) => keyword && postName.includes(keyword))
      );
      const hasFinalReviewerPostByName = orgPostNames.some((postName) =>
        roleBindingFinalReviewerPostNameKeywords.some((keyword) => keyword && postName.includes(keyword))
      );
      const orgMatchedCollegeAdmin =
        hasCollegeAdminPostByName ||
        [...orgUnitCodes].some((code) => roleBindingCollegeAdminUnitCodes.has(code)) ||
        [...orgPostCodes].some((code) => roleBindingCollegeAdminPostCodes.has(code));
      const orgMatchedCounselorByCode =
        [...orgUnitCodes].some((code) => roleBindingCounselorUnitCodes.has(code)) ||
        [...orgPostCodes].some((code) => roleBindingCounselorPostCodes.has(code));
      const orgMatchedCounselorByPostName = orgPostNames.some((postName) =>
        roleBindingCounselorPostNameKeywords.some((keyword) => keyword && postName.includes(keyword))
      );
      const [userByEmployeeNo, userByAccount] = await Promise.all([
        prisma.user.findUnique({
          where: { employeeNo },
          select: {
            id: true,
            account: true,
            employeeNo: true,
            role: true,
            college: true,
            status: true,
          },
        }),
        prisma.user.findUnique({
          where: { account },
          select: {
            id: true,
            account: true,
            employeeNo: true,
            role: true,
            college: true,
            status: true,
          },
        }),
      ]);
      const existingUser = userByEmployeeNo ?? userByAccount;
      const staffByEmployeeNo = await prisma.facultyStaff.findUnique({
        where: { employeeNo },
        select: { unitName: true },
      });
      const organizationText = [
        String(college ?? "").trim(),
        pickFirstByCaseInsensitiveKey(userinfo, ["unitName", "departmentName", "department"]),
        String(existingUser?.college ?? "").trim(),
        String(staffByEmployeeNo?.unitName ?? "").trim(),
        ...orgUnitNames,
      ]
        .filter(Boolean)
        .join(" ");
      const isStudentAffairsByOrg = isStudentAffairsOrg(organizationText);
      const isStudentAffairsByExactUnit =
        String(staffByEmployeeNo?.unitName ?? "").trim() === "党委学生工作部（处）";
      const isStudentAffairs =
        inStudentAffairsUnit ||
        fixedStudentAffairsEmployeeNos.has(employeeNo) ||
        isStudentAffairsByOrg ||
        isStudentAffairsByExactUnit;
      const accountOccupiedByOther = Boolean(userByAccount && existingUser && userByAccount.id !== existingUser.id);
      const safeAccount = accountOccupiedByOther ? existingUser?.account ?? account : account;
      const counselorRelationCount = existingUser
        ? await prisma.counselorStudentRelation.count({
            where: {
              counselorId: existingUser.id,
            },
          })
        : 0;
      const isCounselor = counselorRelationCount > 0;
      const isCounselorByOrgBinding = orgMatchedCounselorByCode || orgMatchedCounselorByPostName;
      const isCollegeAdminByOrgBinding = orgMatchedCollegeAdmin;
      const fallbackCanFundingOfficeReview = inFundingOfficeUnit;
      const fallbackCanFinalReview =
        fixedStudentAffairsEmployeeNos.has(employeeNo) ||
        (inStudentAffairsUnit && hasFinalReviewerPostByName);
      const configuredAuditReviewer = await referenceDataRepository.resolveAuditReviewerCapabilities(
        employeeNo,
        String(college ?? '').trim() || orgUnitNames[0] || String(existingUser?.college ?? '').trim()
      );
      const canFundingOfficeReview = configuredAuditReviewer.canFundingOfficeReview || fallbackCanFundingOfficeReview;
      const canFinalReview = configuredAuditReviewer.canFinalReview || fallbackCanFinalReview;
      const role = superAdminEmployeeNos.has(employeeNo)
        ? "admin"
        : existingUser?.role === "admin"
        ? "admin"
        : existingUser?.role === "student_affairs"
        ? "student_affairs"
        : canFinalReview
        ? "student_affairs"
        : isStudentAffairs
        ? "student_affairs"
        : configuredAuditReviewer.isCollegeReviewer || isCollegeAdminByOrgBinding
        ? "college_admin"
        : existingUser?.role === "college_admin" &&
          existingUser?.status === "active" &&
          String(existingUser.college ?? "").trim()
        ? "college_admin"
        : isCounselorByOrgBinding
        ? "counselor"
        : isCounselor
        ? "counselor"
        : "counselor";

      // Access control: only allow counselor / college admin / student affairs,
      // or teachers that already exist in User table.
      const isExistingTeacher = Boolean(existingUser);
      const isAllowedNewUser = isStudentAffairs;
      if (!isExistingTeacher && !isAllowedNewUser) {
        res.status(403).send("当前账号未开通系统权限，请联系管理员。");
        return;
      }

      const resolvedCollege =
        role === "college_admin"
          ? String(existingUser?.college ?? "").trim() || orgUnitNames[0] || college
          : college;

      const user = existingUser
        ? await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              account: safeAccount,
              employeeNo,
              name: name || account,
              role,
              college: resolvedCollege,
              status: "active",
            },
            select: {
              id: true,
              account: true,
              employeeNo: true,
              name: true,
              role: true,
              college: true,
            },
          })
        : await prisma.user.create({
            data: {
              account: safeAccount,
              employeeNo,
              name: name || account,
              role,
              college: resolvedCollege,
              status: "active",
            },
            select: {
              id: true,
              account: true,
              employeeNo: true,
              name: true,
              role: true,
              college: true,
            },
          });

      setSessionUser(req, {
        id: user.id,
        account: safeAccount,
        employeeNo: user.employeeNo ?? employeeNo,
        name: user.name,
        role: user.role,
        college: user.college,
        unitCode: primaryOrgRelation?.unitCode ?? null,
        postCode: primaryOrgRelation?.postCode ?? null,
        postName: primaryOrgRelation?.postName ?? null,
        canFundingOfficeReview,
        canFinalReview,
      });
      clearOAuthSession(req);
      res.redirect("/");
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth callback failed";
      res.status(500).send(message);
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
      res.status(401).json({ message: "not authenticated" });
      return;
    }
    void (async () => {
      try {
        const caps = await referenceDataRepository.resolveAuditReviewerCapabilities(
          String(user.employeeNo ?? "").trim(),
          String(user.college ?? "").trim() || null
        );
        const enrichedUser = {
          ...user,
          canFundingOfficeReview: Boolean(user.canFundingOfficeReview) || caps.canFundingOfficeReview,
          canFinalReview: user.canFinalReview !== false || caps.canFinalReview,
        };
        const payload: AuthMeResponse = {
          data: {
            user: enrichedUser as never,
          },
        };
        res.json(payload);
      } catch {
        const payload: AuthMeResponse = {
          data: {
            user: user as never,
          },
        };
        res.json(payload);
      }
    })();
  });

  app.post("/api/auth/logout", (req, res) => {
    clearSessionUser(req);
    clearOAuthSession(req);
    clearSessionTokens(req);
    req.session.destroy(() => {
      const payload: AuthLogoutResponse = { message: "已退出登录" };
      res.json(payload);
    });
  });

  app.get("/api/auth/signout", (req, res) => {
    clearSessionUser(req);
    clearOAuthSession(req);
    clearSessionTokens(req);
    req.session.destroy(() => {
      const signoutTarget = new URL(oauthSignoutRedirectUrl);
      signoutTarget.searchParams.set("reauth", "1");
      res.redirect(signoutTarget.toString());
    });
  });

  // Require auth for all other API routes.
  app.use("/api", (req, res, next) => {
    const fullPath = `${req.baseUrl}${req.path}`;
    const openPaths = new Set([
      "/api/health/db",
      "/api/health/time",
      "/api/login-roles",
      "/api/auth/login",
      "/api/auth/me",
      "/api/auth/logout",
      "/api/auth/login/jmu",
      "/api/auth/callback/jmu",
      "/api/auth/signout",
    ]);
    if (openPaths.has(fullPath)) {
      next();
      return;
    }
    requireAuth(req, res, next);
  });

  app.get("/api/sync/students", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    res.json(await candidateRepository.listStudents());
  });

  app.get("/api/batches", async (req, res) => {
    res.json(await referenceDataRepository.listBatches());
  });

  app.get("/api/dashboard", async (req, res) => {
    try {
      const user = getSessionUser(req);
      res.json(await referenceDataRepository.getDashboardData(user));
    } catch (error) {
      const message = error instanceof Error ? error.message : "dashboard failed";
      res.status(500).json({ message });
    }
  });

  app.get("/api/audit-tasks", async (req, res) => {
    const user = getSessionUser(req);
    res.json(await referenceDataRepository.listAuditTasks(user));
  });

  app.get("/api/subsidies", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    res.json(await referenceDataRepository.listSubsidyRecords(month));
  });

  app.get("/api/sync/jobs", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    res.json(await referenceDataRepository.listSyncJobs());
  });

  app.post("/api/sync/run", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const payload = (req.body ?? {}) as SyncRunRequest;
      const result = await dataSyncRepository.runSync(payload);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "鍚屾澶辫触";
      res.status(400).json({ message });
    }
  });

  app.post("/api/sync/jobs/:jobId/terminate", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const jobId = req.params.jobId;
      const result = await dataSyncRepository.terminateJob(jobId);
      const payload: SyncTerminateResponse = {
        message: "任务已终止",
        data: result,
      };
      res.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "缁堟浠诲姟澶辫触";
      res.status(400).json({ message });
    }
  });

  app.post("/api/sync/jobs/terminate-all", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const result = await dataSyncRepository.terminateAllRunningJobs();
      res.json({
        message: `已终止 ${result.terminated} 个运行中的同步任务。`,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "缁堟鍏ㄩ儴浠诲姟澶辫触";
      res.status(400).json({ message });
    }
  });

  app.get("/api/tags", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    res.json(await referenceDataRepository.listTagRecords());
  });

  app.get("/api/dictionaries", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    res.json({
      items: await referenceDataRepository.listDictionaryTypes(),
    });
  });

  app.post("/api/dictionaries", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    const payload = (req.body ?? {}) as DictionaryTypeUpsertRequest;
    if (!payload.dictType || !payload.label) {
      res.status(400).json({ message: "dictType and label are required" });
      return;
    }
    const data = await referenceDataRepository.upsertDictionaryType({
      dictType: payload.dictType,
      label: payload.label,
      description: payload.description ?? '',
      sortOrder: payload.sortOrder ?? 0,
      enabled: payload.enabled ?? true,
    });
    res.json({
      message: "字典类型已保存",
      data,
    });
  });

  app.get("/api/dictionaries/:dictType", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    const dictType = req.params.dictType;
    res.json(await referenceDataRepository.listDictionaryItems(dictType));
  });

  app.put("/api/dictionaries/:dictType", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    const dictType = req.params.dictType;
    const payload = (req.body ?? {}) as DictionarySaveRequest;
    if (!Array.isArray(payload.items)) {
      res.status(400).json({ message: "items is required" });
      return;
    }
    const data = await referenceDataRepository.saveDictionaryItems(dictType, payload.items);
    res.json({
      message: "字典已保存",
      data,
    });
  });

  app.delete("/api/dictionaries/:dictType", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const dictType = req.params.dictType;
      const result = await referenceDataRepository.deleteDictionaryType(dictType);
      res.json({
        message: result.removedTypes > 0 ? `已删除字典类型 ${dictType}` : `字典类型 ${dictType} 不存在`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "delete dictionary failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/roles", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    res.json(await referenceDataRepository.listRolePermissions());
  });

  app.get("/api/roles/college-admins", requireRoles(["admin", "student_affairs"]), async (_req, res) => {
    res.json(await referenceDataRepository.listCollegeAdminAssignments());
  });

  app.put("/api/roles/college-admins/:college", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const college = req.params.college;
      const payload = (req.body ?? {}) as { employeeNo?: string; name?: string; account?: string };
      await referenceDataRepository.upsertCollegeAdminAssignment(college, {
        employeeNo: String(payload.employeeNo ?? ""),
        name: String(payload.name ?? ""),
        account: typeof payload.account === "string" ? payload.account : undefined,
      });
      res.json({ message: "学院管理员授权已保存" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "save college admin assignment failed";
      res.status(400).json({ message });
    }
  });

  app.delete("/api/roles/college-admins/:userId", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      await referenceDataRepository.removeCollegeAdminAssignment(req.params.userId);
      res.json({ message: "学院管理员授权已移除" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "remove college admin assignment failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/system-roles", requireRoles(["admin", "student_affairs"]), async (_req, res) => {
    res.json(await referenceDataRepository.listSystemRoleMembers());
  });

  app.get("/api/audit-reviewers", requireRoles(["admin", "student_affairs"]), async (_req, res) => {
    res.json(await referenceDataRepository.listAuditReviewerSettings());
  });

  app.put("/api/audit-reviewers", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const operator = getSessionUser(req);
      const payload = (req.body ?? {}) as { stage?: string; employeeNo?: string; name?: string; college?: string };
      await referenceDataRepository.upsertAuditReviewer(
        {
          stage: String(payload.stage ?? ""),
          employeeNo: String(payload.employeeNo ?? ""),
          name: typeof payload.name === "string" ? payload.name : undefined,
          college: typeof payload.college === "string" ? payload.college : undefined,
        },
        { role: operator?.role }
      );
      res.json({ message: "审核人已保存" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "save audit reviewer failed";
      res.status(400).json({ message });
    }
  });

  app.delete("/api/audit-reviewers/:id", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const operator = getSessionUser(req);
      await referenceDataRepository.deleteAuditReviewer(req.params.id, { role: operator?.role });
      res.json({ message: "审核人已移除" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "delete audit reviewer failed";
      res.status(400).json({ message });
    }
  });

  app.put("/api/system-roles", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const operator = getSessionUser(req);
      const payload = (req.body ?? {}) as {
        role?: string;
        employeeNo?: string;
        name?: string;
        account?: string;
        college?: string;
      };
      await referenceDataRepository.upsertSystemRoleMember({
        role: String(payload.role ?? ""),
        employeeNo: String(payload.employeeNo ?? ""),
        name: String(payload.name ?? ""),
        account: typeof payload.account === "string" ? payload.account : undefined,
        college: typeof payload.college === "string" ? payload.college : undefined,
      }, { role: operator?.role });
      res.json({ message: "系统角色人员已保存" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "save system role member failed";
      res.status(400).json({ message });
    }
  });

  app.delete("/api/system-roles/:userId", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      await referenceDataRepository.deleteSystemRoleMember(req.params.userId);
      res.json({ message: "系统角色人员已删除" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "delete system role member failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/users/roles", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    const queryPage = typeof req.query.page === "string" ? Number(req.query.page) : 1;
    const queryPageSize = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : 20;
    const role = typeof req.query.role === "string" ? req.query.role : "";
    const unitOrCollege = typeof req.query.unitOrCollege === "string" ? req.query.unitOrCollege : "";
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
    const page = Number.isFinite(queryPage) ? Math.max(1, Math.floor(queryPage)) : 1;
    const pageSize = Number.isFinite(queryPageSize) ? Math.max(1, Math.min(200, Math.floor(queryPageSize))) : 20;
    res.json(await referenceDataRepository.listUserRoles(page, pageSize, { role, unitOrCollege, keyword }));
  });

  app.put("/api/users/:userId/role", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const operator = getSessionUser(req);
      const payload = (req.body ?? {}) as { role?: string; college?: string };
      await referenceDataRepository.updateUserRole(req.params.userId, {
        role: String(payload.role ?? ""),
        college: typeof payload.college === "string" ? payload.college : undefined,
      }, { role: operator?.role });
      res.json({ message: "用户角色已更新" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "update user role failed";
      res.status(400).json({ message });
    }
  });

  app.post("/api/users/roles", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const operator = getSessionUser(req);
      const payload = (req.body ?? {}) as { employeeNo?: string; name?: string; role?: string; college?: string };
      await referenceDataRepository.createUserRole({
        employeeNo: String(payload.employeeNo ?? ""),
        name: typeof payload.name === "string" ? payload.name : undefined,
        role: String(payload.role ?? ""),
        college: typeof payload.college === "string" ? payload.college : undefined,
      }, { role: operator?.role });
      res.json({ message: "角色用户已新增" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "create role user failed";
      res.status(400).json({ message });
    }
  });

  app.delete("/api/users/:userId", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const operator = getSessionUser(req);
      await referenceDataRepository.deleteUserRole(req.params.userId, { role: operator?.role });
      res.json({ message: "角色用户已删除" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "delete role user failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/system-config", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    res.json(await referenceDataRepository.getSystemConfig());
  });

  app.get("/api/staff/lookup", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
    res.json(await referenceDataRepository.lookupStaffByEmployeeNo(keyword));
  });

  app.post("/api/batches", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    try {
      const payload = req.body as BatchCreateRequest;

      if (!payload?.month) {
        res.status(400).json({ message: "month is required" });
        return;
      }

      const rawForce = (payload as unknown as { force?: unknown }).force;
      const allowAnyMonth =
        rawForce === true || rawForce === 1 || rawForce === "1" || String(rawForce ?? "").toLowerCase() === "true";
      const result = await referenceDataRepository.createBatch(payload.month, { allowAnyMonth });

      res.json({
        message: result.created ? `已创建 ${payload.month} 认定批次` : `${payload.month} 认定批次已存在`,
        data: result.data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "create batch failed";
      res.status(400).json({ message });
    }
  });

  app.put("/api/system-config", requireRoles(["admin", "student_affairs"]), async (req, res) => {
    const payload = req.body as SystemConfigUpdateRequest;
    const updated = await referenceDataRepository.updateSystemConfig(payload);

    res.json({
      message: "系统配置已保存",
      data: updated,
    });
  });

  app.get("/api/login-roles", async (req, res) => {
    res.json(await referenceDataRepository.listLoginRoles());
  });

  app.get("/api/candidates", async (req, res) => {
    try {
      const user = getSessionUser(req);
      const month = typeof req.query.month === "string" ? req.query.month : "2026-04";
      const queryPage = typeof req.query.page === "string" ? Number(req.query.page) : 1;
      const queryPageSize = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : 100;
      const college = typeof req.query.college === "string" ? req.query.college : "";
      const counselorEmployeeNo = typeof req.query.counselorEmployeeNo === "string" ? req.query.counselorEmployeeNo : "";
      const counselorName = typeof req.query.counselorName === "string" ? req.query.counselorName : "";
      const page = Number.isFinite(queryPage) ? Math.max(1, Math.floor(queryPage)) : 1;
      const pageSize = Number.isFinite(queryPageSize) ? Math.max(1, Math.min(500, Math.floor(queryPageSize))) : 100;
      res.json(
        await candidateRepository.getCandidateSnapshot(month, page, pageSize, user, {
          college,
          counselorEmployeeNo,
          counselorName,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "candidate list failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/candidates/search", async (req, res) => {
    try {
      const user = getSessionUser(req);
      const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
      const items = await candidateRepository.searchCandidateStudents(keyword, user);
      res.json({ items });
    } catch (error) {
      const message = error instanceof Error ? error.message : "candidate search failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/candidates/colleges", async (req, res) => {
    try {
      const user = getSessionUser(req);
      const month = typeof req.query.month === "string" ? req.query.month : "2026-04";
      const items = await candidateRepository.listCandidateColleges(month, user);
      res.json({ items });
    } catch (error) {
      const message = error instanceof Error ? error.message : "candidate college list failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/counselors/lookup", async (req, res) => {
    try {
      const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
      const items = await referenceDataRepository.lookupCounselors(keyword);
      res.json({ items });
    } catch (error) {
      const message = error instanceof Error ? error.message : "counselor lookup failed";
      res.status(400).json({ message });
    }
  });

  app.get("/api/candidates/:studentId", async (req, res) => {
    const user = getSessionUser(req);
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    if (!month) {
      res.status(400).json({ message: "month is required" });
      return;
    }
    const detail = await candidateRepository.getStudentDetail(req.params.studentId, month, user);

    if (!detail) {
      res.status(404).json({ message: "candidate not found" });
      return;
    }

    res.json({ data: detail });
  });

  app.post("/api/candidates/:studentId/review", async (req, res) => {
    try {
      const user = getSessionUser(req);
      const realtimeCaps = user
        ? await referenceDataRepository.resolveAuditReviewerCapabilities(
            String(user.employeeNo ?? "").trim(),
            String(user.college ?? "").trim() || null
          )
        : { canFundingOfficeReview: false, canFinalReview: false, isCollegeReviewer: false };
      const effectiveUser = user
        ? {
            ...user,
            canFundingOfficeReview: Boolean(user.canFundingOfficeReview) || realtimeCaps.canFundingOfficeReview,
            canFinalReview: user.canFinalReview !== false || realtimeCaps.canFinalReview,
          }
        : user;
      const payload = req.body as ReviewActionRequest;

      if (!payload?.stage || !payload?.decision) {
        res.status(400).json({ message: "stage and decision are required" });
        return;
      }
      if (!payload?.month) {
        res.status(400).json({ message: "month is required" });
        return;
      }

      const updated = await candidateRepository.applyReview(req.params.studentId, payload, effectiveUser);

      if (!updated) {
        res.status(404).json({ message: "candidate not found" });
        return;
      }

      res.json({
        message: `${updated.name} 已完成${payload.decision === "approve" ? "通过" : "驳回"}处理`,
        data: updated,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "review failed";
      res.status(400).json({ message });
    }
  });

  app.post("/api/tags/:tagId/invalidate", async (req, res) => {
    const ok = await candidateRepository.invalidateTag(req.params.tagId);

    if (!ok) {
      res.status(404).json({ message: "tag not found" });
      return;
    }

    const payload: TagInvalidateResponse = {
      message: "标签已失效",
    };

    res.json(payload);
  });

  app.get("/api/sync/transactions", (req, res) => {
    // Simulate fetching transactions for a month
    const studentIds = ["2023001", "2023002", "2023003", "2023004", "2023005"];
    const transactions = [];
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    for (const sid of studentIds) {
      // Generate some random transactions
      for (let d = 1; d <= 30; d++) {
        const date = new Date(year, month, d);
        // Breakfast
        if (Math.random() > 0.3) {
          transactions.push({
            id: `txn_${sid}_${d}_b`,
            studentId: sid,
            time: new Date(year, month, d, 7, Math.floor(Math.random() * 60)).toISOString(),
            amount: 2 + Math.random() * 5,
            location: "一食堂",
            type: "消费",
            slot: "breakfast"
          });
        }
        // Lunch
        if (Math.random() > 0.1) {
          transactions.push({
            id: `txn_${sid}_${d}_l`,
            studentId: sid,
            time: new Date(year, month, d, 12, Math.floor(Math.random() * 60)).toISOString(),
            amount: 8 + Math.random() * 15,
            location: "二食堂",
            type: "消费",
            slot: "lunch_dinner"
          });
        }
        // Dinner
        if (Math.random() > 0.2) {
          transactions.push({
            id: `txn_${sid}_${d}_d`,
            studentId: sid,
            time: new Date(year, month, d, 18, Math.floor(Math.random() * 60)).toISOString(),
            amount: 7 + Math.random() * 12,
            location: "一食堂",
            type: "消费",
            slot: "lunch_dinner"
          });
        }
      }
    }
    res.json(transactions);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { port: VITE_HMR_PORT } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on("error", (error: unknown) => {
    const err = error as { code?: string; message?: string };
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the existing process or run with PORT=<newPort>.`
      );
      console.error(`Example: PORT=3001 VITE_HMR_PORT=24679 npm run dev`);
      process.exit(1);
    }
    console.error(err?.message ?? "server error");
    process.exit(1);
  });
}

loadEnvironment();
startServer();


