// Shared execution and configuration budgets. Exceeding a budget must block a
// scan; callers must never send partially scanned text.
export const MAX_SCAN_LENGTH = 1_000_000;
export const MAX_FINDINGS = 20_000;
export const MAX_TERMS = 5_000;
export const MAX_TERM_LENGTH = 10_000;
export const MAX_SITES = 5_000;
export const MAX_LABELS_PER_ROLE = 20;
export const MAX_LABEL_LENGTH = 160;
