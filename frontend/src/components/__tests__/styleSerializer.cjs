// Sorts inline style keys so snapshots stay stable regardless of declaration order.
module.exports = {
  test: (val) =>
    val && typeof val === "object" && val.props && val.props.style && !val.__styleSorted,
  serialize: (val, config, indentation, depth, refs, printer) => {
    const style = Object.fromEntries(Object.entries(val.props.style).sort(([a], [b]) => a.localeCompare(b)));
    return printer({ ...val, props: { ...val.props, style }, __styleSorted: true }, config, indentation, depth, refs);
  },
};
