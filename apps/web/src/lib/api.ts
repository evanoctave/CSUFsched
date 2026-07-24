import type {
  CourseWithSections,
  DepartmentSummary,
  ProfessorDetail,
  TermSummary,
} from '@csufsched/types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiResult<T> {
  data: T;
  stale: boolean;
}

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const cacheKey = `csufsched:api:${path}`;
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        message = ((await res.json()) as { message: string }).message;
      } catch {
        // body was not JSON
      }
      throw new ApiError(res.status, message);
    }
    const data = (await res.json()) as T;
    localStorage.setItem(cacheKey, JSON.stringify(data));
    return { data, stale: false };
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) throw err;
    const cached = localStorage.getItem(cacheKey);
    if (cached !== null) return { data: JSON.parse(cached) as T, stale: true };
    throw err;
  }
}

export const api = {
  terms: () => getJson<TermSummary[]>('/api/terms'),
  departments: (termId: number) =>
    getJson<DepartmentSummary[]>(`/api/terms/${termId}/departments`),
  courses: (termId: number, dept: string) =>
    getJson<CourseWithSections[]>(
      `/api/terms/${termId}/courses?dept=${encodeURIComponent(dept)}`,
    ),
  professor: (id: number) => getJson<ProfessorDetail>(`/api/professors/${id}`),
  sections: (ids: number[]) => getJson<CourseWithSections[]>(`/api/sections?ids=${ids.join(',')}`),
  meta: () => getJson<{ dataFrom: string | null }>('/api/meta'),
};
