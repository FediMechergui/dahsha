export function productName(value = process.env.APP_PRODUCT || 'dahsha') {
  if (!['dahsha', 'flixer'].includes(value)) throw new Error(`Unknown APP_PRODUCT: ${value}`);
  return value;
}
export const PRODUCT = productName();
