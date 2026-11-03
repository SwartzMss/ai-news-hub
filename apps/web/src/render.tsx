import { renderToStaticMarkup } from "react-dom/server";
import { Site } from "./Site";
import type { PublicData, Page } from "./types";
export function render(data: PublicData, page: Page) {
  return renderToStaticMarkup(<Site data={data} page={page} />);
}
