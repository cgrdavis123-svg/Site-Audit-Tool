export const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info'
};

export const SEVERITY_WEIGHT = {
  critical: 25,
  high: 12,
  medium: 6,
  low: 2,
  info: 0
};

let counter = 0;

export function issue({ category, severity, id, title, description, recommendation, url, meta = {} }) {
  counter += 1;
  return {
    key: `${category}:${id}`,
    seq: counter,
    category,
    severity,
    id,
    title,
    description,
    recommendation,
    url: url || null,
    meta
  };
}
