export function initialPage(search) {
  const p = new URLSearchParams(search).get("screen");
  return ["create", "restore", "backup"].includes(p) ? p : "home";
}
export function dedicatedPageUrl(page, search, extensionRoot, preview) {
  if (
    preview ||
    !["create", "restore", "backup"].includes(page) ||
    new URLSearchParams(search).get("screen") === page
  )
    return null;
  return `${extensionRoot}popup.html?screen=${page}`;
}
