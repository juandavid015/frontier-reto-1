// Everything about the agent that we may tune or that the brief could change.

export const agentConfig = {
  // One value decides the model. Haiku 5.5: same pass rate as Sonnet 5.5 on the practice cases, no false success,
  // 1/25 of the cost, 22/22 in the pointing test (NOTES.md, E4 and runs 1 and 2).
  model: 'anthropic/claude-haiku-5.5',
  openRouterUrl: 'https://openrouter.ai/api/v1/chat/completions',
  modelTimeoutMs: 60_000,
  maxOutputTokens: 1_000,
  // The brief gives 5 minutes per task. We stop earlier to report and close the connection in time.
  taskDeadlineMs: 4.5 * 60 * 1000,
  // Only a runaway guard: the deadline above is the real limit. At 30, a correct task finished on step 29 (run 1).
  maxSteps: 100,
  // Steps of history sent as text. Only the current screenshot is sent as an image, to keep cost flat.
  historySteps: 12,
  // A model reply that fails validation is retried once with the error, then the task fails.
  invalidReplyRetries: 1,
};
