// Probe selection for runner/regressions.mjs --only: the default is the complete catalog; an explicit selection must name
// only known IDs and must not be empty, so a focused run can never pass by running nothing.
export function selectProbes(catalog, only) {
  if (only === undefined || only === null) return [...catalog];
  if (typeof only !== "string") throw new Error("--only requires a comma-separated list of probe IDs");
  const ids = only.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error("--only selected no probes");
  const unknown = ids.filter((id) => !catalog.includes(id));
  if (unknown.length) throw new Error(`--only names unknown probe IDs: ${unknown.join(", ")}`);
  return catalog.filter((id) => ids.includes(id));
}
