// Export generation tracks successful publication contents, not upstream freshness.
// Provider success/error dates and each title's real release dates remain untouched.
export function stampCatalogueGeneration(catalog,{previousGeneratedAt,now=Date.now()}={}){
  const dates=[catalog.generatedAt,previousGeneratedAt].map(value=>Date.parse(value||'')).filter(Number.isFinite);
  return {...catalog,generatedAt:new Date(Math.max(now,...dates.map(value=>value+1))).toISOString()};
}
