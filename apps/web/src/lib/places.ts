import 'server-only';
import { apiGet } from './api';
import type { PlaceRef } from './place-groups';
import type { Department } from './types';

/**
 * The departments and teams in the order set on Organization (owner, 19 October 2026: "sort the employees as the
 * department sorting in the organization", then "same to the payroll"), for lists grouped by department to follow it;
 * none when they can't be read, and the lists fall back to the names' order.
 */
export async function loadPlaces(): Promise<PlaceRef[]> {
  try {
    const list = await apiGet<Department[]>('/departments');
    return list.map(({ id, nameEn, parentId }) => ({ id, nameEn, parentId }));
  } catch {
    return [];
  }
}
