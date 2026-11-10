// Fake LINE accounts offered on the mock login screen. Tokens use the same
// "mock:<userId>:<displayName>" format as LINE_VERIFY_MODE=mock in src/lib/auth/line-verify.ts.
export const MOCK_LINE_ACCOUNTS = [
  { userId: "Umock0001", displayName: "เจ๊ม่อน" },
  { userId: "Umock0002", displayName: "พี่แมว" },
  { userId: "Umock0003", displayName: "น้องบี" },
] as const;

export const mockIdToken = (userId: string, displayName: string) => `mock:${userId}:${displayName}`;
export const MOCK_TOKEN = /^mock:([A-Za-z0-9_-]{1,100}):(.{1,120})$/;
