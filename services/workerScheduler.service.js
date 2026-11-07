const { CronJob } = require("cron");
function startScheduler(tasks = require("../config/workerSchedule"), { startImmediately = true } = {}) {
  let stopping = false;
  const active = new Map();
  const invoke = task => {
    if (stopping || active.has(task.name)) return Promise.resolve({ skipped: true });
    const promise = Promise.resolve().then(task.run).catch(error => {
      console.error("[WORKER TASK]", task.name, error.name); return { failed: true };
    }).finally(() => active.delete(task.name));
    active.set(task.name, promise); return promise;
  };
  const jobs = tasks.map(task => new CronJob(task.cron, () => invoke(task), null, true, "UTC"));
  if (startImmediately) for (const task of tasks) invoke(task);
  return { active, get stopping() { return stopping; }, invoke,
    async stop() { stopping = true; for (const job of jobs) job.stop(); await Promise.allSettled([...active.values()]); } };
}
module.exports = { startScheduler };
