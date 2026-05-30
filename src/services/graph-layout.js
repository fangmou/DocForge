// 力导向布局算法 — 轻量自实现，不引入 D3
// 输入: nodes[] + edges[]，输出: 每个节点的 {x, y} 坐标

export function forceLayout(nodes, edges, opts = {}) {
  const width = opts.width || 800;
  const height = opts.height || 600;
  const iterations = opts.iterations || 120;
  const repulsion = opts.repulsion || 800;
  const attraction = opts.attraction || 0.006;
  const damping = opts.damping || 0.85;

  if (nodes.length === 0) return new Map();

  // 初始化位置（圆形分布）
  const positions = new Map();
  const velocities = new Map();
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.35;

  for (let i = 0; i < nodes.length; i++) {
    const angle = (2 * Math.PI * i) / nodes.length;
    positions.set(nodes[i].id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
    velocities.set(nodes[i].id, { vx: 0, vy: 0 });
  }

  // 预计算邻接表
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source).add(e.target);
    if (adj.has(e.target)) adj.get(e.target).add(e.source);
  }

  // 迭代
  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;

    // 斥力（库仑力）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id);
        const b = positions.get(nodes[j].id);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = (repulsion * alpha) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        velocities.get(nodes[i].id).vx += fx;
        velocities.get(nodes[i].id).vy += fy;
        velocities.get(nodes[j].id).vx -= fx;
        velocities.get(nodes[j].id).vy -= fy;
      }
    }

    // 引力（弹簧力）
    for (const e of edges) {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const force = dist * attraction * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      velocities.get(e.source).vx += fx;
      velocities.get(e.source).vy += fy;
      velocities.get(e.target).vx -= fx;
      velocities.get(e.target).vy -= fy;
    }

    // 向心力
    for (const n of nodes) {
      const p = positions.get(n.id);
      const v = velocities.get(n.id);
      v.vx += (cx - p.x) * 0.001;
      v.vy += (cy - p.y) * 0.001;
    }

    // 应用速度
    for (const n of nodes) {
      const p = positions.get(n.id);
      const v = velocities.get(n.id);
      v.vx *= damping;
      v.vy *= damping;
      p.x += v.vx;
      p.y += v.vy;
      // 边界约束
      p.x = Math.max(30, Math.min(width - 30, p.x));
      p.y = Math.max(30, Math.min(height - 30, p.y));
    }
  }

  return positions;
}
