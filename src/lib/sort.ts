export type SortMethod = "merge" | "quick" | "heap";

export interface SortResult<T> {
  items: T[];
  comparisons: number;
  durationMs: number;
}

/** Ordena uma cópia para que cada algoritmo receba exatamente a mesma entrada. */
export function sortWith<T>(
  input: readonly T[],
  comparator: (left: T, right: T) => number,
  method: SortMethod,
): SortResult<T> {
  const items = [...input];
  let comparisons = 0;
  const compare = (left: T, right: T) => {
    comparisons++;
    return comparator(left, right);
  };

  const start = performance.now();
  switch (method) {
    case "merge":
      mergeSort(items, compare);
      break;
    case "quick":
      quickSort(items, compare);
      break;
    case "heap":
      heapSort(items, compare);
      break;
  }
  return { items, comparisons, durationMs: performance.now() - start };
}

function mergeSort<T>(
  items: T[],
  compare: (left: T, right: T) => number,
): void {
  const buffer = [...items];

  function merge(start: number, end: number): void {
    if (end - start < 2) return;
    const middle = Math.floor((start + end) / 2);
    merge(start, middle);
    merge(middle, end);

    let left = start;
    let right = middle;
    for (let position = start; position < end; position++) {
      if (
        right >= end ||
        (left < middle && compare(items[left], items[right]) <= 0)
      ) {
        buffer[position] = items[left++];
      } else {
        buffer[position] = items[right++];
      }
    }
    for (let position = start; position < end; position++)
      items[position] = buffer[position];
  }

  merge(0, items.length);
}

function quickSort<T>(
  items: T[],
  compare: (left: T, right: T) => number,
): void {
  if (items.length < 2) return;
  const stack: Array<[number, number]> = [[0, items.length - 1]];
  const swap = (left: number, right: number) => {
    [items[left], items[right]] = [items[right], items[left]];
  };

  while (stack.length) {
    const [start, end] = stack.pop()!;
    if (start >= end) continue;

    const middle = start + Math.floor((end - start) / 2);
    if (compare(items[start], items[middle]) > 0) swap(start, middle);
    if (compare(items[start], items[end]) > 0) swap(start, end);
    if (compare(items[middle], items[end]) > 0) swap(middle, end);
    const pivot = items[middle];

    let smaller = start;
    let current = start;
    let greater = end;
    while (current <= greater) {
      const order = compare(items[current], pivot);
      if (order < 0) swap(smaller++, current++);
      else if (order > 0) swap(current, greater--);
      else current++;
    }

    // Empilhar primeiro a partição maior limita o tamanho da pilha.
    const left: [number, number] = [start, smaller - 1];
    const right: [number, number] = [greater + 1, end];
    if (left[1] - left[0] > right[1] - right[0]) stack.push(left, right);
    else stack.push(right, left);
  }
}

function heapSort<T>(items: T[], compare: (left: T, right: T) => number): void {
  function siftDown(root: number, end: number): void {
    while (root * 2 + 1 <= end) {
      let child = root * 2 + 1;
      if (child + 1 <= end && compare(items[child], items[child + 1]) < 0)
        child++;
      if (compare(items[root], items[child]) >= 0) return;
      [items[root], items[child]] = [items[child], items[root]];
      root = child;
    }
  }

  for (let start = Math.floor(items.length / 2) - 1; start >= 0; start--) {
    siftDown(start, items.length - 1);
  }
  for (let end = items.length - 1; end > 0; end--) {
    [items[0], items[end]] = [items[end], items[0]];
    siftDown(0, end - 1);
  }
}
