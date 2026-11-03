export function assertXmlText(value) {
  for (const ch of String(value)) {
    const n = ch.codePointAt(0);
    if (!(
      n === 9 ||
      n === 10 ||
      n === 13 ||
      (n >= 32 && n <= 0xd7ff) ||
      (n >= 0xe000 && n <= 0xfffd) ||
      (n >= 0x10000 && n <= 0x10ffff)
    ))
      throw Error("XML 1.0 forbidden character");
  }
  return String(value);
}
export const xml = (value) =>
  assertXmlText(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[ch],
  );
export function validateTextTree(value) {
  if (typeof value === "string") assertXmlText(value);
  else if (Array.isArray(value)) value.forEach(validateTextTree);
  else if (value && typeof value === "object")
    Object.values(value).forEach(validateTextTree);
}
