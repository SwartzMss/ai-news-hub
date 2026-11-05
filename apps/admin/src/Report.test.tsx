import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Report, type ReportRecord } from "./Report";
afterEach(cleanup);
test("report distinguishes source-only facts from inference, preserves unknown dates and escapes content", () => {
  const report = {
    version: 1,
    document: {
      title: "真实日报",
      reportDate: "2026-11-03",
      channel: "opensource",
      collectedAt: "2026-11-03T00:00:00Z",
      items: [
        {
          articleId: "a",
          category: "opensource",
          importance: 4,
          factSummary: "<img src=x onerror=alert(1)>",
          analysis: "可能改善体验",
          evidenceQuote: "Publisher source evidence",
          source: {
            name: "Source",
            canonicalUrl: "javascript:alert(1)",
            publishedAt: null,
            eventAt: null,
            fetchedAt: "2026-11-03T00:00:00Z",
          },
        },
      ],
    },
  } as ReportRecord;
  render(<Report report={report} />);
  expect(screen.getByText(/待人工审核/)).toBeTruthy();
  expect(screen.getByText("分析（推断）")).toBeTruthy();
  expect(screen.getByText("来源关联：source_only · 未独立证实")).toBeTruthy();
  expect(screen.getAllByText("未知")).toHaveLength(2);
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("a")!.hasAttribute("href")).toBe(false);
});

test("Codex-reported sources are attributed to Codex without a backend fetch timestamp", () => {
  const report = {
    id: "r",
    status: "validated",
    version: 1,
    document: {
      title: "Codex 日报",
      reportDate: "2026-11-05",
      channel: "opensource",
      collectedAt: "2026-11-05T00:00:00Z",
      items: [
        {
          articleId: "a",
          category: "ai",
          importance: 3,
          factSummary: "模型摘要",
          analysis: null,
          evidenceQuote: "Codex returned quote",
          verification: "codex_reported",
          source: {
            name: "example.com",
            originalUrl: "https://example.com/article.pdf",
            canonicalUrl: "https://example.com/article.pdf",
            publishedAt: null,
            eventAt: null,
            fetchedAt: null,
          },
        },
      ],
    },
  } as ReportRecord;
  render(<Report report={report} />);
  expect(screen.getByText("来源由 Codex 提供")).toBeTruthy();
  expect(screen.getByText("Codex 提供的引文")).toBeTruthy();
  expect(screen.queryByText("首次抓取时间")).toBeNull();
  expect(screen.queryByText(/来源关联：source_only/)).toBeNull();
});
