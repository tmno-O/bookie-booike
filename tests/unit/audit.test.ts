import { expect, it } from "vitest";
import { auditQuery, verifyQuery } from "@/contracts/audit";
import { csvCell, csvRows } from "@/lib/csv";

it("bounds paging and bigint ranges without losing precision", () => {
  expect(auditQuery.safeParse({ limit: "101" }).success).toBe(false);
  expect(auditQuery.safeParse({ offset: "-1" }).success).toBe(false);
  expect(verifyQuery.parse({ from: "9007199254740993", to: "9007199254740994" }).from).toBe("9007199254740993");
  expect(verifyQuery.safeParse({ from: "3", to: "2" }).success).toBe(false);
  expect(verifyQuery.safeParse({ to: "9223372036854775808" }).success).toBe(false);
});
it("escapes CSV cells and prevents spreadsheet formula execution", () => {
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  expect(csvCell("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"');
  expect(csvCell(" @SUM(1)")).toBe('"\' @SUM(1)"');
  expect(csvRows([["seq", "phone"], [1, "***5678"]])).toBe('\uFEFF"seq","phone"\r\n"1","***5678"\r\n');
});
