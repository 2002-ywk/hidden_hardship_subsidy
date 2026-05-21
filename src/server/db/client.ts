import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { naiveUtcDateFromTimeZone } from "@/src/server/time";

const globalForEnv = globalThis as unknown as {
  __envLoaded?: boolean;
};

function ensureEnvironmentLoaded() {
  if (globalForEnv.__envLoaded) {
    return;
  }

  globalForEnv.__envLoaded = true;

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

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaExtended?: PrismaClient;
};

ensureEnvironmentLoaded();

const basePrisma = globalForPrisma.prisma ?? new PrismaClient();

const MODELS_WITH_CREATED_AT_ONLY = new Set(["CandidateHitRule", "ReviewRecord", "TagRecord", "OperationLog"]);
const MODELS_WITH_CREATED_AT_UPDATED_AT = new Set([
  "User",
  "Student",
  "UndergraduateDifficultyRecognition",
  "CounselorStudentRelation",
  "SubsidyBatch",
  "StudentMonthStat",
  "CandidateResult",
  "CandidateListSnapshot",
  "FinalSubsidyResult",
  "SystemConfig",
  "RolePermission",
  "FacultyStaff",
  "DictionaryItem",
  "DictionaryType",
  "SyncJob",
]);

function stampCreateData(model: string, data: unknown) {
  if (!data || typeof data !== "object") return;
  const now = naiveUtcDateFromTimeZone(new Date());

  const typed = data as Record<string, unknown>;
  if (MODELS_WITH_CREATED_AT_ONLY.has(model)) {
    if (!("createdAt" in typed)) {
      typed.createdAt = now;
    }
    return;
  }
  if (!MODELS_WITH_CREATED_AT_UPDATED_AT.has(model)) return;
  if (!("createdAt" in typed)) {
    typed.createdAt = now;
  }
  if (!("updatedAt" in typed) || typed.updatedAt == null) {
    typed.updatedAt = now;
  }
}

function stampUpdateData(model: string, data: unknown) {
  if (!data || typeof data !== "object") return;
  if (!MODELS_WITH_CREATED_AT_UPDATED_AT.has(model)) return;

  const now = naiveUtcDateFromTimeZone(new Date());
  const typed = data as Record<string, unknown>;
  if (!("updatedAt" in typed) || typed.updatedAt == null) {
    typed.updatedAt = now;
  }
}

export const prisma =
  globalForPrisma.prismaExtended ??
  ((() => {
    const extended = basePrisma.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            const modelName = model ?? "";
            switch (operation) {
              case "create": {
                stampCreateData(modelName, args?.data);
                break;
              }
              case "createMany": {
                const data = args?.data;
                if (Array.isArray(data)) {
                  for (const item of data) stampCreateData(modelName, item);
                } else {
                  stampCreateData(modelName, data);
                }
                break;
              }
              case "update":
              case "updateMany": {
                stampUpdateData(modelName, args?.data);
                break;
              }
              case "upsert": {
                stampCreateData(modelName, args?.create);
                stampUpdateData(modelName, args?.update);
                break;
              }
              default:
                break;
            }
            return query(args);
          },
        },
      },
    });

    // Keep app typing stable (model delegates, return types) while enabling runtime stamping.
    const typed = extended as unknown as PrismaClient;
    globalForPrisma.prismaExtended = typed;
    return typed;
  })());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
