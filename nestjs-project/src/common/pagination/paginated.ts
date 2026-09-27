/** A page of a listing; `total_pages` is 0 when there are no items. */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}
