import type { Prisma } from '@prisma/client';

export const ACTIVE_STATUS_CODES = [
  '1',
  '01',
  'Y',
  'y',
  'YES',
  'yes',
  'TRUE',
  'true',
  '是',
  '在校',
  '在读',
  '在籍',
];

// Exclude non-undergrad / non-target person types from all student-related stats & analysis.
export const EXCLUDED_PERSON_TYPE_CODES = ['41', '42', '43', '44', '45'];

export function activeStudentWhere(): Prisma.StudentWhereInput {
  return {
    AND: [
      {
        isReadingCode: {
          in: ACTIVE_STATUS_CODES,
        },
      },
      {
        isRegisteredCode: {
          in: ACTIVE_STATUS_CODES,
        },
      },
      {
        personTypeCode: {
          notIn: EXCLUDED_PERSON_TYPE_CODES,
        },
      },
    ],
  };
}
