// Small interpreter for the actual arithmetic TSL graphs in material tests.
// Derivatives and shader properties are supplied by the test, not simulated.
export function evaluateShaderNode(node, { values = new Map(), derivatives = {} } = {}) {
  const evaluate = (child) => evaluateShaderNode(child, { values, derivatives });
  if (values.has(node)) return values.get(node);
  const map = (fn, ...args) => {
    const vector = args.find(Array.isArray);
    return vector ? vector.map((_, i) => fn(...args.map(a => Array.isArray(a) ? a[i] : a))) : fn(...args);
  };
  if (node.isConstNode || node.isUniformNode) return node.value?.toArray ? node.value.toArray() : node.value;
  if (node.convertTo || node.isVarNode) return evaluate(node.node);
  if (node.type === 'JoinNode') return node.nodes.flatMap(evaluate);
  if (node.isSplitNode) {
    const value = evaluate(node.node);
    const result = [...node.components].map(c => value[('xyzw'.includes(c) ? 'xyzw' : 'rgba').indexOf(c)]);
    return result.length === 1 ? result[0] : result;
  }
  if (node.isOperatorNode) {
    const operations = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b };
    if (operations[node.op]) return map(operations[node.op], evaluate(node.aNode), evaluate(node.bNode));
  }
  if (node.isMathNode) {
    if (node.method in derivatives) return derivatives[node.method];
    const a = evaluate(node.aNode);
    const b = node.bNode ? evaluate(node.bNode) : undefined;
    const c = node.cNode ? evaluate(node.cNode) : undefined;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const functions = {
      oneMinus: a => 1 - a, negate: a => -a, sin: Math.sin, pow: Math.pow,
      min: (a, b) => Math.min(a, b), max: (a, b) => Math.max(a, b), clamp,
      mix: (a, b, t) => a * (1 - t) + b * t,
      smoothstep: (lo, hi, x) => { const t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); },
    };
    if (node.method === 'dot') return a.reduce((sum, v, i) => sum + v * b[i], 0);
    if (node.method === 'length') return Math.hypot(...a);
    if (node.method === 'normalize') return a.map(value => value / Math.hypot(...a));
    if (functions[node.method]) return map(functions[node.method], a, b, c);
  }
  throw new Error(`Unsupported shader node ${node.constructor.name}:${node.method ?? node.op}`);
}
