import type {
  ExternalCafeteriaTransactionRecord,
  ExternalCounselorRelationRecord,
  ExternalDifficultyRecognitionRecord,
  ExternalOrgPersonRelationRecord,
  ExternalOrgPostRecord,
  ExternalOrgUnitRecord,
  ExternalStaffRecord,
  ExternalStudentRecord,
} from '@/src/types';
import { formatDateTimeInTimeZone, hourInTimeZone, monthKeyInTimeZone, parseDateTimeAssumeFixedOffset } from '@/src/server/time';

type JsonObject = Record<string, unknown>;

const DEFAULT_TOKEN_URL = 'https://poa.paas.jmu.edu.cn/oauth2/token';
const DEFAULT_TOKEN_CLIENT_ID = '7itulbjzgzvdeucxspxyabixlw';
const DEFAULT_TOKEN_CLIENT_SECRET = '1HvAHLWmX-YI2LLirTMj1cekqy8F_v235omGMLnLW0o=';
const DEFAULT_STUDENT_SCOPE = 'dataAssetsApiGongGongXueShengXinXi:v4:GGFW_XSJBXX';
const DEFAULT_STUDENT_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGongGongXueShengXinXi/v4/2d6a9c906ecf11ec055dbb406a512cf0/getData';
const DEFAULT_STUDENT_XSDQZTM = '01';
const DEFAULT_STUDENT_SCBJ = '0';
const DEFAULT_STAFF_SCOPE = 'dataAssetsApiGongGongJiaoZhiGongXinXi:v4:GGFW_JZGXX';
const DEFAULT_STAFF_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGongGongJiaoZhiGongXinXi/v4/223d2ce06ea011ec055dbb406a512cf0/getData';
const DEFAULT_COUNSELOR_RELATION_SCOPE = 'dataAssetsApiGongGongJiaoXueXinXi:v2:GGFW_FDYDB';
const DEFAULT_COUNSELOR_RELATION_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGongGongJiaoXueXinXi/v2/b8baa3b0189011ed9ecda0a104c53780/getData';
const DEFAULT_DIFFICULTY_RECOGNITION_SCOPE = 'dataAssetsApiGongGongXueShengXinXi:v4:GGFW-BKSKNRD';
const DEFAULT_DIFFICULTY_RECOGNITION_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGongGongXueShengXinXi/v4/af208d90d19b2c2723af39364d4ac47d/getData';
const DEFAULT_CAFETERIA_TRANSACTION_SCOPE = 'dataAssetsApiGeBieXiTongZhuanYong:v1:YXBZ-YKTYCXF';
const DEFAULT_CAFETERIA_TRANSACTION_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGeBieXiTongZhuanYong/v1/4b8da3eb29d07304ae96b0afd3a188ae/getData';
const DEFAULT_ORG_UNIT_SCOPE = 'dataAssetsApiGongGongZuZhiJiGouXinXi:v1:GG_ZZJGXXA';
const DEFAULT_ORG_UNIT_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGongGongZuZhiJiGouXinXi/v1/9ac555606e9c11ec055dbb406a512cf0/getData';
const DEFAULT_ORG_POST_SCOPE = 'dataAssetsApiGongGongZuZhiJiGouXinXi:v1:GGWF-YXSGWXX';
const DEFAULT_ORG_POST_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGongGongZuZhiJiGouXinXi/v1/3ee8b29055f511ee93b4a7611f913d7f/getData';
const DEFAULT_ORG_PERSON_RELATION_SCOPE = 'dataAssetsApiGongGongZuZhiJiGouXinXi:v1:GGFW-YXSRYGL';
const DEFAULT_ORG_PERSON_RELATION_API_URL =
  'https://poa.paas.jmu.edu.cn/apis/dataAssetsApiGongGongZuZhiJiGouXinXi/v1/eefb020055f511ee93b4a7611f913d7f/getData';
const DEFAULT_ORG_SCBJ = '0';
const DEFAULT_FETCH_TIMEOUT_MS = 45000;
const DEFAULT_PAGE_RETRY_TIMES = 3;
const DEFAULT_PAGE_RETRY_DELAY_MS = 1200;
const DEFAULT_CAFETERIA_TRANSACTION_PAGE_SIZE = 10000;
const DEFAULT_COUNSELOR_RELATION_PAGE_SIZE = 2000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutLabel: string) {
  const timeoutMs = Math.max(1, Number(process.env.DATA_PLATFORM_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:()]/g, '');
}

function pickString(record: JsonObject, keys: string[]) {
  const lowered = new Map<string, unknown>(
    Object.entries(record).map(([k, v]) => [normalizeKey(k), v])
  );

  for (const key of keys) {
    const value = key in record ? record[key] : lowered.get(normalizeKey(key));
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return '';
}

function pickBoolean(record: JsonObject, keys: string[]) {
  const lowered = new Map<string, unknown>(
    Object.entries(record).map(([k, v]) => [normalizeKey(k), v])
  );

  for (const key of keys) {
    const value = key in record ? record[key] : lowered.get(normalizeKey(key));
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
    }
  }
  return false;
}

function findRecordsArray(input: unknown): JsonObject[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is JsonObject => typeof item === 'object' && item !== null);
  }

  if (!input || typeof input !== 'object') {
    return [];
  }

  const data = input as JsonObject;
  const candidateKeys = ['rows', 'records', 'result', 'list', 'items', 'data'];

  for (const key of candidateKeys) {
    if (key in data) {
      const nested = findRecordsArray(data[key]);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  for (const value of Object.values(data)) {
    const nested = findRecordsArray(value);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}

function toStudents(records: JsonObject[]): ExternalStudentRecord[] {
  return records
    .map((record): ExternalStudentRecord | null => {
      const studentId = pickString(record, ['studentId', 'xh', 'XH', 'xuehao']);
      if (!studentId) return null;

      const departmentName = pickString(record, ['departmentName', 'yxsmc', 'YXSMC', 'yxmc', 'YXMC', 'college']);
      const className = pickString(record, ['className', 'bjmc', 'BJMC', 'class']);

      return {
        studentId,
        // 中台字段对照：SZBH=所在班号，RYLBM=人员类别码，SFZD=是否在读，SFZJ=是否在籍，XBM=性别码，YXSMC=院系所名称
        classCode: pickString(record, ['classCode', 'szbh', 'SZBH', 'bjdm', 'BJDM']),
        personTypeCode: pickString(record, ['personTypeCode', 'rylbm', 'RYLBM', 'xslbm', 'XSLBM']),
        isReadingCode: pickString(record, ['isReadingCode', 'sfzd', 'SFZD', 'sfzx', 'SFZX']),
        isRegisteredCode: pickString(record, ['isRegisteredCode', 'sfzj', 'SFZJ', 'sfzxbz', 'SFZXBZ']),
        genderCode: pickString(record, ['genderCode', 'xbm', 'XBM', 'xb', 'XB']),
        departmentName,
        college: departmentName,
        className,
        name: pickString(record, ['name', 'xm', 'XM']),
        specialDifficulty: pickBoolean(record, ['specialDifficulty', 'sfkn', 'SFKN']),
        status: pickString(record, ['status', 'dqztm', 'DQZTM']),
      };
    })
    .filter((item): item is ExternalStudentRecord => item !== null);
}

function toStaffs(records: JsonObject[]): ExternalStaffRecord[] {
  return records
    .map((record): ExternalStaffRecord | null => {
      const employeeNo = pickString(record, ['employeeNo', 'gh', 'GH', 'gonghao']);
      if (!employeeNo) return null;

      return {
        employeeNo,
        name: pickString(record, ['name', 'xm', 'XM']),
        genderCode: pickString(record, ['genderCode', 'xb', 'XB']),
        unitName: pickString(record, ['unitName', 'dwmc', 'DWMC']),
        staffCategoryCode: pickString(record, ['staffCategoryCode', 'jzglbm', 'JZGLBM']),
        currentStatusCode: pickString(record, ['currentStatusCode', 'dqztm', 'DQZTM']),
      };
    })
    .filter((item): item is ExternalStaffRecord => item !== null);
}

function toCounselorRelations(records: JsonObject[]): ExternalCounselorRelationRecord[] {
  return records
    .map((record): ExternalCounselorRelationRecord | null => {
      const studentId = pickString(record, ['studentId', 'xsxh', 'XSXH', 'xh', 'XH']);
      const counselorEmployeeNo = pickString(record, ['counselorEmployeeNo', 'fdygh', 'FDYGH']);
      if (!studentId) return null;

      return {
        studentId,
        counselorEmployeeNo: counselorEmployeeNo || undefined,
        counselorName: pickString(record, ['counselorName', 'fdymc', 'FDYMC']) || counselorEmployeeNo || '',
        counselorAccount: pickString(record, ['counselorAccount', 'fdyzh', 'FDYZH']) || undefined,
        college: pickString(record, ['college', 'yxmc', 'YXMC']) || undefined,
        relationType: pickString(record, ['relationType', 'relationTypeCode']) || 'student',
        effectiveFrom: pickString(record, ['effectiveFrom', 'yxkssj']) || undefined,
        effectiveTo: pickString(record, ['effectiveTo', 'yxjssj']) || undefined,
      };
    })
    .filter((item): item is ExternalCounselorRelationRecord => item !== null);
}

function toDifficultyRecognitions(records: JsonObject[]): ExternalDifficultyRecognitionRecord[] {
  return records
    .map((record): ExternalDifficultyRecognitionRecord | null => {
      const studentId = pickString(record, ['studentId', 'xh', 'XH']);
      const startAcademicYear = pickString(record, ['startAcademicYear', 'ksxn', 'KSXN']);
      const endAcademicYear = pickString(record, ['endAcademicYear', 'jsxn', 'JSXN']);
      const semester = pickString(record, ['semester', 'xq', 'XQ']);
      if (!studentId || !startAcademicYear || !endAcademicYear || !semester) return null;

      return {
        studentId,
        startAcademicYear,
        endAcademicYear,
        semester,
        difficultyLevel: pickString(record, ['difficultyLevel', 'kndj', 'KNDJ']) || undefined,
      };
    })
    .filter((item): item is ExternalDifficultyRecognitionRecord => item !== null);
}

function normalizeMonthKey(date: Date) {
  return monthKeyInTimeZone(date);
}

function parseFlexibleDateTime(input: string) {
  // Treat datetimes without timezone as China Standard Time (+08:00).
  return parseDateTimeAssumeFixedOffset(input);
}

function toCafeteriaTransactions(records: JsonObject[], targetMonth: string): ExternalCafeteriaTransactionRecord[] {
  return records
    .map((record): ExternalCafeteriaTransactionRecord | null => {
      const externalTxnId = pickString(record, ['externalTxnId', 'lsh', 'LSH']);
      const occurredAtText = pickString(record, ['occurredAt', 'jysj', 'JYSJ']);
      const amountText = pickString(record, ['amount', 'jyje', 'JYJE']);
      const cbid = pickString(record, ['cbid', 'CBID']);
      const studentNo = pickString(record, ['studentNo', 'xgh', 'XGH']);
      if (!externalTxnId || !occurredAtText || !amountText || !studentNo) return null;

      const occurredAt = parseFlexibleDateTime(occurredAtText);
      if (!occurredAt) return null;
      if (normalizeMonthKey(occurredAt) !== targetMonth) return null;

      const amount = Number(amountText);
      if (Number.isNaN(amount)) return null;
      const hour = hourInTimeZone(occurredAt);
      const mealSlot =
        cbid === '1'
          ? 'breakfast'
          : hour >= 10 && hour < 15
            ? 'lunch'
            : 'dinner';

      return {
        externalTxnId,
        studentNo,
        occurredAt: formatDateTimeInTimeZone(occurredAt),
        amount,
        cbid: cbid || '',
        mealSlot,
        location: pickString(record, ['location', 'jysbmc', 'JYSBMC']) || undefined,
      };
    })
    .filter((item): item is ExternalCafeteriaTransactionRecord => item !== null);
}

function toOrgUnits(records: JsonObject[]): ExternalOrgUnitRecord[] {
  return records.map((record) => ({
    unitCode: pickString(record, ['unitCode', 'dwh', 'DWH', 'dwdm', 'DWDM', 'zzjgdm', 'ZZJGDM', 'jgdm', 'JGDM', 'bh', 'BH', '单位号']) || undefined,
    unitName: pickString(record, ['unitName', 'dwmc', 'DWMC', 'zzjgmc', 'ZZJGMC', 'jgmc', 'JGMC', 'mc', 'MC', '单位名称']) || undefined,
    parentUnitCode: pickString(record, ['parentUnitCode', 'lsdwh', 'LSDWH', 'sjdwdm', 'SJDWDM', 'fjdwdm', 'FJDWDM', 'parentCode', 'sjjgdm', 'SJJGDM', '隶属单位号']) || undefined,
    parentUnitName: pickString(record, ['parentUnitName', 'sjdwmc', 'SJDWMC', 'fjdwmc', 'FJDWMC', 'parentName', 'sjjgmc', 'SJJGMC']) || undefined,
    levelCode: pickString(record, ['levelCode', 'dwcc', 'DWCC', 'cjdjdm', 'CJDJDM', 'jgdjdm', 'JGDJDM', 'djdm', 'DJDM', '单位层次']) || undefined,
    levelName: pickString(record, ['levelName', 'cjdjmc', 'CJDJMC', 'jgdjmc', 'JGDJMC', 'djmc', 'DJMC']) || undefined,
    status: pickString(record, ['status', 'zt', 'ZT', 'yxzt', 'YXZT', 'sfyx', 'SFYX']) || undefined,
    raw: record,
  }));
}

function toOrgPosts(records: JsonObject[]): ExternalOrgPostRecord[] {
  return records.map((record) => ({
    postCode: pickString(record, ['postCode', 'gwh', 'GWH', 'gwdm', 'GWDM', 'zwbm', 'ZWBM', 'bh', 'BH']) || undefined,
    postName: pickString(record, ['postName', 'gwmc', 'GWMC', 'zwmc', 'ZWMC', 'mc', 'MC']) || undefined,
    unitCode: pickString(record, ['unitCode', 'szbm', 'SZBM', 'dwdm', 'DWDM', 'zzjgdm', 'ZZJGDM', 'jgdm', 'JGDM']) || undefined,
    unitName: pickString(record, ['unitName', 'dwmc', 'DWMC', 'zzjgmc', 'ZZJGMC', 'jgmc', 'JGMC']) || undefined,
    status: pickString(record, ['status', 'zt', 'ZT', 'yxzt', 'YXZT', 'sfyx', 'SFYX']) || undefined,
    raw: record,
  }));
}

function toOrgPersonRelations(records: JsonObject[]): ExternalOrgPersonRelationRecord[] {
  return records.map((record) => ({
    employeeNo: pickString(record, ['employeeNo', 'gh', 'GH', 'zgh', 'ZGH', '工号']) || undefined,
    personName: pickString(record, ['personName', 'xm', 'XM', 'name', 'NAME']) || undefined,
    account: pickString(record, ['account', 'zh', 'ZH', 'zghao', 'ZGHAO', 'loginName', 'LOGINNAME']) || undefined,
    unitCode: pickString(record, ['unitCode', 'szbm', 'SZBM', 'dwdm', 'DWDM', 'zzjgdm', 'ZZJGDM', 'jgdm', 'JGDM']) || undefined,
    unitName: pickString(record, ['unitName', 'dwmc', 'DWMC', 'zzjgmc', 'ZZJGMC', 'jgmc', 'JGMC']) || undefined,
    postCode: pickString(record, ['postCode', 'gwh', 'GWH', 'gwdm', 'GWDM', 'zwbm', 'ZWBM']) || undefined,
    postName: pickString(record, ['postName', 'gwmc', 'GWMC', 'zwmc', 'ZWMC']) || undefined,
    status: pickString(record, ['status', 'zt', 'ZT', 'yxzt', 'YXZT', 'sfyx', 'SFYX']) || undefined,
    raw: record,
  }));
}

async function fetchAllPagesByScope(
  scope: string,
  apiUrl: string,
  timeoutLabel: string,
  extraParams?: Record<string, string>
): Promise<JsonObject[]> {
  const token = await new DataPlatformClient().getAccessToken(scope);
  const buildUrl = (pageIndex: number, pageSize: number) => {
    const params = new URLSearchParams();
    params.set('pageIndex', String(pageIndex));
    params.set('pageSize', String(pageSize));
    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        if (value != null && String(value).trim() !== '') {
          params.set(key, String(value));
        }
      }
    }
    return `${apiUrl}?${params.toString()}`;
  };

  const firstResponse = await fetchWithTimeout(
    buildUrl(1, 2000),
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    `${timeoutLabel} first page`
  );
  if (!firstResponse.ok) {
    throw new Error(`${timeoutLabel} first page request failed (HTTP ${firstResponse.status})`);
  }

  const firstPayload = (await firstResponse.json()) as JsonObject;
  const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
  const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
  const pageSize = Math.max(1, Number(firstData.pageSize ?? 2000));
  const records: JsonObject[] = [...findRecordsArray(firstPayload)];

  for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
    const nextResponse = await fetchWithTimeout(
      buildUrl(pageIndex, pageSize),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      `${timeoutLabel} page ${pageIndex}`
    );
    if (!nextResponse.ok) {
      throw new Error(`${timeoutLabel} page ${pageIndex} request failed (HTTP ${nextResponse.status})`);
    }
    const nextPayload = (await nextResponse.json()) as unknown;
    records.push(...findRecordsArray(nextPayload));
  }

  return records;
}

export class DataPlatformClient {
  async getAccessToken(scope: string) {
    const tokenUrl = process.env.DATA_PLATFORM_TOKEN_URL ?? DEFAULT_TOKEN_URL;
    const clientId = process.env.DATA_PLATFORM_CLIENT_ID ?? DEFAULT_TOKEN_CLIENT_ID;
    const clientSecret = process.env.DATA_PLATFORM_CLIENT_SECRET ?? DEFAULT_TOKEN_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('?????????DATA_PLATFORM_CLIENT_ID / DATA_PLATFORM_CLIENT_SECRET');
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('scope', scope);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      let details = '';
      try {
        const errorPayload = (await response.json()) as JsonObject;
        const code = typeof errorPayload.error === 'string' ? errorPayload.error : '';
        const desc = typeof errorPayload.error_description === 'string' ? errorPayload.error_description : '';
        if (code || desc) {
          details = `${code}${desc ? ` (${desc})` : ``}`;
        }
      } catch {
        // keep generic
      }
      const detailText = details ? `, ${details}` : '';
      throw new Error(`?????????HTTP ${response.status}, scope=${scope}${detailText}?`);
    }

    const payload = (await response.json()) as JsonObject;
    const token = typeof payload.access_token === 'string' ? payload.access_token : '';
    if (!token) {
      throw new Error(`???????? access_token?scope=${scope}?`);
    }
    return token;
  }
  async fetchStudentsByScope(incrementalCzsj?: string): Promise<ExternalStudentRecord[]> {
    const scope = process.env.DATA_PLATFORM_STUDENT_SCOPE ?? DEFAULT_STUDENT_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_STUDENT_API_URL ?? DEFAULT_STUDENT_API_URL;
    const xsdqztm = process.env.DATA_PLATFORM_STUDENT_XSDQZTM ?? DEFAULT_STUDENT_XSDQZTM;
    const scbj = process.env.DATA_PLATFORM_STUDENT_SCBJ ?? DEFAULT_STUDENT_SCBJ;
    const token = await this.getAccessToken(scope);

    const buildUrl = (pageIndex: number, pageSize: number) => {
      const params = new URLSearchParams();
      params.set('pageIndex', String(pageIndex));
      params.set('pageSize', String(pageSize));
      params.set('XSDQZTM', xsdqztm);
      params.set('SCBJ', scbj);
      if (incrementalCzsj) params.set('CZSJ', incrementalCzsj);
      return `${apiUrl}?${params.toString()}`;
    };

    const firstResponse = await fetchWithTimeout(
      buildUrl(1, 2000),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'students first page'
    );

    if (!firstResponse.ok) {
      throw new Error(`中台学生接口请求失败（HTTP ${firstResponse.status}）`);
    }

    const firstPayload = (await firstResponse.json()) as JsonObject;
    const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
    const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
    const pageSize = Math.max(1, Number(firstData.pageSize ?? 2000));

    const records: JsonObject[] = [...findRecordsArray(firstPayload)];
    for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
      const nextResponse = await fetchWithTimeout(
        buildUrl(pageIndex, pageSize),
        { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        `students page ${pageIndex}`
      );
      if (!nextResponse.ok) {
        throw new Error(`中台学生接口第 ${pageIndex} 页请求失败（HTTP ${nextResponse.status}）`);
      }
      const nextPayload = (await nextResponse.json()) as unknown;
      records.push(...findRecordsArray(nextPayload));
    }

    return toStudents(records);
  }

  async streamStudentsByScope(
    onPage: (items: ExternalStudentRecord[], pageIndex: number, totalPages: number) => Promise<void>,
    options?: { incrementalCzsj?: string }
  ): Promise<void> {
    const scope = process.env.DATA_PLATFORM_STUDENT_SCOPE ?? DEFAULT_STUDENT_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_STUDENT_API_URL ?? DEFAULT_STUDENT_API_URL;
    const xsdqztm = process.env.DATA_PLATFORM_STUDENT_XSDQZTM ?? DEFAULT_STUDENT_XSDQZTM;
    const scbj = process.env.DATA_PLATFORM_STUDENT_SCBJ ?? DEFAULT_STUDENT_SCBJ;
    const incrementalCzsj = options?.incrementalCzsj;
    const token = await this.getAccessToken(scope);

    const buildUrl = (pageIndex: number, pageSize: number) => {
      const params = new URLSearchParams();
      params.set('pageIndex', String(pageIndex));
      params.set('pageSize', String(pageSize));
      params.set('XSDQZTM', xsdqztm);
      params.set('SCBJ', scbj);
      if (incrementalCzsj) params.set('CZSJ', incrementalCzsj);
      return `${apiUrl}?${params.toString()}`;
    };

    const firstResponse = await fetchWithTimeout(
      buildUrl(1, 2000),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'students first page'
    );
    if (!firstResponse.ok) {
      throw new Error(`students first page request failed (HTTP ${firstResponse.status})`);
    }

    const firstPayload = (await firstResponse.json()) as JsonObject;
    const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
    const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
    const pageSize = Math.max(1, Number(firstData.pageSize ?? 2000));
    await onPage(toStudents(findRecordsArray(firstPayload)), 1, totalPages);

    for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
      const nextResponse = await fetchWithTimeout(
        buildUrl(pageIndex, pageSize),
        { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        `students page ${pageIndex}`
      );
      if (!nextResponse.ok) {
        throw new Error(`students page ${pageIndex} request failed (HTTP ${nextResponse.status})`);
      }
      const nextPayload = (await nextResponse.json()) as unknown;
      await onPage(toStudents(findRecordsArray(nextPayload)), pageIndex, totalPages);
    }
  }

  async fetchStaffsByScope(): Promise<ExternalStaffRecord[]> {
    const scope = process.env.DATA_PLATFORM_STAFF_SCOPE ?? DEFAULT_STAFF_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_STAFF_API_URL ?? DEFAULT_STAFF_API_URL;
    const token = await this.getAccessToken(scope);

    const buildUrl = (pageIndex: number, pageSize: number) => {
      const params = new URLSearchParams();
      params.set('pageIndex', String(pageIndex));
      params.set('pageSize', String(pageSize));
      return `${apiUrl}?${params.toString()}`;
    };

    const firstResponse = await fetchWithTimeout(
      buildUrl(1, 2000),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'staffs first page'
    );

    if (!firstResponse.ok) {
      throw new Error(`中台教职工接口请求失败（HTTP ${firstResponse.status}）`);
    }

    const firstPayload = (await firstResponse.json()) as JsonObject;
    const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
    const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
    const pageSize = Math.max(1, Number(firstData.pageSize ?? 2000));

    const records: JsonObject[] = [...findRecordsArray(firstPayload)];
    for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
      const nextResponse = await fetchWithTimeout(
        buildUrl(pageIndex, pageSize),
        { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        `staffs page ${pageIndex}`
      );
      if (!nextResponse.ok) {
        throw new Error(`中台教职工接口第 ${pageIndex} 页请求失败（HTTP ${nextResponse.status}）`);
      }
      const nextPayload = (await nextResponse.json()) as unknown;
      records.push(...findRecordsArray(nextPayload));
    }

    return toStaffs(records);
  }

  async fetchCounselorRelationsByScope(): Promise<ExternalCounselorRelationRecord[]> {
    const scope = process.env.DATA_PLATFORM_COUNSELOR_RELATION_SCOPE ?? DEFAULT_COUNSELOR_RELATION_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_COUNSELOR_RELATION_API_URL ?? DEFAULT_COUNSELOR_RELATION_API_URL;
    const token = await this.getAccessToken(scope);

    const buildUrl = (pageIndex: number, pageSize: number) => {
      const params = new URLSearchParams();
      params.set('pageIndex', String(pageIndex));
      params.set('pageSize', String(pageSize));
      return `${apiUrl}?${params.toString()}`;
    };

    const firstResponse = await fetchWithTimeout(
      buildUrl(1, 2000),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'counselor relations first page'
    );

    if (!firstResponse.ok) {
      throw new Error(`中台辅导员带班关系接口请求失败（HTTP ${firstResponse.status}）`);
    }

    const firstPayload = (await firstResponse.json()) as JsonObject;
    const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
    const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
    const pageSize = Math.max(1, Number(firstData.pageSize ?? 2000));

    const records: JsonObject[] = [...findRecordsArray(firstPayload)];
    for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
      const nextResponse = await fetchWithTimeout(
        buildUrl(pageIndex, pageSize),
        { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        `counselor relations page ${pageIndex}`
      );
      if (!nextResponse.ok) {
        throw new Error(`中台辅导员带班关系接口第 ${pageIndex} 页请求失败（HTTP ${nextResponse.status}）`);
      }
      const nextPayload = (await nextResponse.json()) as unknown;
      records.push(...findRecordsArray(nextPayload));
    }

    return toCounselorRelations(records);
  }

  async streamCounselorRelationsByScope(
    onPage: (
      items: ExternalCounselorRelationRecord[],
      pageIndex: number,
      totalPages: number
    ) => Promise<void>
  ): Promise<void> {
    const scope = process.env.DATA_PLATFORM_COUNSELOR_RELATION_SCOPE ?? DEFAULT_COUNSELOR_RELATION_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_COUNSELOR_RELATION_API_URL ?? DEFAULT_COUNSELOR_RELATION_API_URL;
    const token = await this.getAccessToken(scope);
    const pageSize = Math.max(
      1,
      Number(process.env.DATA_PLATFORM_COUNSELOR_RELATION_PAGE_SIZE ?? DEFAULT_COUNSELOR_RELATION_PAGE_SIZE)
    );
    const maxRetryTimes = Math.max(1, Number(process.env.DATA_PLATFORM_PAGE_RETRY_TIMES ?? DEFAULT_PAGE_RETRY_TIMES));
    const retryDelayMs = Math.max(
      0,
      Number(process.env.DATA_PLATFORM_PAGE_RETRY_DELAY_MS ?? DEFAULT_PAGE_RETRY_DELAY_MS)
    );

    const buildUrl = (pageIndex: number, pageSizeValue: number) => {
      const params = new URLSearchParams();
      params.set('pageIndex', String(pageIndex));
      params.set('pageSize', String(pageSizeValue));
      return `${apiUrl}?${params.toString()}`;
    };

    const firstResponse = await fetchWithTimeout(
      buildUrl(1, pageSize),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'counselor relations first page'
    );
    if (!firstResponse.ok) {
      throw new Error(`counselor relations first page request failed (HTTP ${firstResponse.status})`);
    }

    const firstPayload = (await firstResponse.json()) as JsonObject;
    const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
    const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
    const reportedPageSize = Math.max(1, Number(firstData.pageSize ?? pageSize));
    await onPage(toCounselorRelations(findRecordsArray(firstPayload)), 1, totalPages);

    for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
      let nextResponse: Response | null = null;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= maxRetryTimes; attempt += 1) {
        try {
          nextResponse = await fetchWithTimeout(
            buildUrl(pageIndex, reportedPageSize),
            { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
            `counselor relations page ${pageIndex} (attempt ${attempt}/${maxRetryTimes})`
          );
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < maxRetryTimes && retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }
      if (lastError) throw lastError;
      if (!nextResponse) {
        throw new Error(`counselor relations page ${pageIndex} request failed: no response`);
      }
      if (!nextResponse.ok) {
        throw new Error(`counselor relations page ${pageIndex} request failed (HTTP ${nextResponse.status})`);
      }
      const nextPayload = (await nextResponse.json()) as unknown;
      await onPage(toCounselorRelations(findRecordsArray(nextPayload)), pageIndex, totalPages);
    }
  }

  async fetchDifficultyRecognitionsByScope(): Promise<ExternalDifficultyRecognitionRecord[]> {
    const scope = process.env.DATA_PLATFORM_DIFFICULTY_RECOGNITION_SCOPE ?? DEFAULT_DIFFICULTY_RECOGNITION_SCOPE;
    const apiUrl =
      process.env.DATA_PLATFORM_DIFFICULTY_RECOGNITION_API_URL ?? DEFAULT_DIFFICULTY_RECOGNITION_API_URL;
    const token = await this.getAccessToken(scope);

    const buildUrl = (pageIndex: number, pageSize: number) => {
      const params = new URLSearchParams();
      params.set('pageIndex', String(pageIndex));
      params.set('pageSize', String(pageSize));
      return `${apiUrl}?${params.toString()}`;
    };

    const firstResponse = await fetchWithTimeout(
      buildUrl(1, 2000),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'difficulty recognitions first page'
    );

    if (!firstResponse.ok) {
      throw new Error(`中台困难认定接口请求失败（HTTP ${firstResponse.status}）`);
    }

    const firstPayload = (await firstResponse.json()) as JsonObject;
    const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
    const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
    const pageSize = Math.max(1, Number(firstData.pageSize ?? 2000));

    const records: JsonObject[] = [...findRecordsArray(firstPayload)];
    for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
      const nextResponse = await fetchWithTimeout(
        buildUrl(pageIndex, pageSize),
        { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        `difficulty recognitions page ${pageIndex}`
      );
      if (!nextResponse.ok) {
        throw new Error(`中台困难认定接口第 ${pageIndex} 页请求失败（HTTP ${nextResponse.status}）`);
      }
      const nextPayload = (await nextResponse.json()) as unknown;
      records.push(...findRecordsArray(nextPayload));
    }

    return toDifficultyRecognitions(records);
  }

  async fetchCafeteriaTransactionsByScope(targetMonth: string): Promise<ExternalCafeteriaTransactionRecord[]> {
    const records: ExternalCafeteriaTransactionRecord[] = [];
    await this.streamCafeteriaTransactionsByScope(
      targetMonth,
      async (items) => {
        records.push(...items);
      },
      { startPage: 1 }
    );
    return records;
  }

  async streamCafeteriaTransactionsByScope(
    targetMonth: string,
    onPage: (
      items: ExternalCafeteriaTransactionRecord[],
      pageIndex: number,
      totalPages: number
    ) => Promise<void>,
    options?: {
      startPage?: number;
    }
  ): Promise<void> {
    const scope = process.env.DATA_PLATFORM_CAFETERIA_TRANSACTION_SCOPE ?? DEFAULT_CAFETERIA_TRANSACTION_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_CAFETERIA_TRANSACTION_API_URL ?? DEFAULT_CAFETERIA_TRANSACTION_API_URL;
    const token = await this.getAccessToken(scope);
    const pageSize = Math.max(
      1,
      Number(process.env.DATA_PLATFORM_CAFETERIA_TRANSACTION_PAGE_SIZE ?? DEFAULT_CAFETERIA_TRANSACTION_PAGE_SIZE)
    );
    const maxRetryTimes = Math.max(1, Number(process.env.DATA_PLATFORM_PAGE_RETRY_TIMES ?? DEFAULT_PAGE_RETRY_TIMES));
    const retryDelayMs = Math.max(
      0,
      Number(process.env.DATA_PLATFORM_PAGE_RETRY_DELAY_MS ?? DEFAULT_PAGE_RETRY_DELAY_MS)
    );
    const startPage = Math.max(1, Math.floor(options?.startPage ?? 1));

    const buildUrl = (pageIndex: number, pageSizeValue: number) => {
      const params = new URLSearchParams();
      params.set('pageIndex', String(pageIndex));
      params.set('pageSize', String(pageSizeValue));
      // Data platform supports filtering by month via JYSJ=YYYY-MM.
      params.set('JYSJ', targetMonth);
      return `${apiUrl}?${params.toString()}`;
    };

    const firstResponse = await fetchWithTimeout(
      buildUrl(1, pageSize),
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'cafeteria transactions page 1'
    );

    if (!firstResponse.ok) {
      throw new Error(`中台食堂消费流水接口请求失败（HTTP ${firstResponse.status}）`);
    }

    const firstPayload = (await firstResponse.json()) as JsonObject;
    const firstData = (firstPayload.data as JsonObject | undefined) ?? {};
    const totalPages = Math.max(1, Number(firstData.totalPages ?? 1));
    const reportedPageSize = Math.max(1, Number(firstData.pageSize ?? pageSize));

    if (startPage <= 1) {
      await onPage(toCafeteriaTransactions(findRecordsArray(firstPayload), targetMonth), 1, totalPages);
    }

    for (let pageIndex = Math.max(2, startPage); pageIndex <= totalPages; pageIndex += 1) {
      let nextResponse: Response | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxRetryTimes; attempt += 1) {
        try {
          nextResponse = await fetchWithTimeout(
            buildUrl(pageIndex, reportedPageSize),
            { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
            `cafeteria transactions page ${pageIndex} (attempt ${attempt}/${maxRetryTimes})`
          );
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < maxRetryTimes && retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }

      if (lastError) throw lastError;
      if (!nextResponse) {
        throw new Error(`中台食堂消费流水接口第 ${pageIndex} 页请求失败：无响应`);
      }
      if (!nextResponse.ok) {
        throw new Error(`中台食堂消费流水接口第 ${pageIndex} 页请求失败（HTTP ${nextResponse.status}）`);
      }

      const nextPayload = (await nextResponse.json()) as unknown;
      await onPage(toCafeteriaTransactions(findRecordsArray(nextPayload), targetMonth), pageIndex, totalPages);
    }
  }

  async fetchOrgUnitsByScope(): Promise<ExternalOrgUnitRecord[]> {
    const scope = process.env.DATA_PLATFORM_ORG_UNIT_SCOPE ?? DEFAULT_ORG_UNIT_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_ORG_UNIT_API_URL ?? DEFAULT_ORG_UNIT_API_URL;
    const scbj = process.env.DATA_PLATFORM_ORG_SCBJ ?? DEFAULT_ORG_SCBJ;
    const records = await fetchAllPagesByScope(scope, apiUrl, 'org units', { SCBJ: scbj });
    return toOrgUnits(records);
  }

  async fetchOrgPostsByScope(): Promise<ExternalOrgPostRecord[]> {
    const scope = process.env.DATA_PLATFORM_ORG_POST_SCOPE ?? DEFAULT_ORG_POST_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_ORG_POST_API_URL ?? DEFAULT_ORG_POST_API_URL;
    const scbj = process.env.DATA_PLATFORM_ORG_SCBJ ?? DEFAULT_ORG_SCBJ;
    const records = await fetchAllPagesByScope(scope, apiUrl, 'org posts', { SCBJ: scbj });
    return toOrgPosts(records);
  }

  async fetchOrgPersonRelationsByScope(): Promise<ExternalOrgPersonRelationRecord[]> {
    const scope = process.env.DATA_PLATFORM_ORG_PERSON_RELATION_SCOPE ?? DEFAULT_ORG_PERSON_RELATION_SCOPE;
    const apiUrl = process.env.DATA_PLATFORM_ORG_PERSON_RELATION_API_URL ?? DEFAULT_ORG_PERSON_RELATION_API_URL;
    const scbj = process.env.DATA_PLATFORM_ORG_SCBJ ?? DEFAULT_ORG_SCBJ;
    const records = await fetchAllPagesByScope(scope, apiUrl, 'org person relations', { SCBJ: scbj });
    return toOrgPersonRelations(records);
  }
}

export const dataPlatformClient = new DataPlatformClient();
