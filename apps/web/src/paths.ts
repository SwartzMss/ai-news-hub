import type { Report, Story } from "./types";
export const topicPath = (id: string) => `/topics/${id}/`;
export const topicArchivePath = (id: string) => `/topics/${id}/archive/`;
export const issuePath = (r: Report, versioned = false) =>
  `${topicArchivePath(r.topic.id)}${r.report_date}/${versioned ? `v${String(r.version).padStart(6, "0")}/` : ""}`;
export const storyPath = (s: Story) => `${topicPath(s.topic.id)}news/${s.key}/`;
