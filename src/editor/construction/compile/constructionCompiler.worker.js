import { compileConstructionPlan } from './compileConstructionPlan.js';

self.addEventListener('message', ({ data }) => {
  const { requestId, record, options } = data;
  try {
    self.postMessage({
      requestId,
      plan: compileConstructionPlan(record, options),
    });
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
