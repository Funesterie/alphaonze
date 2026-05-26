const TARGET_ORIGIN = "https://funesterie.me";

export default {
  fetch(request) {
    const sourceUrl = new URL(request.url);
    const targetUrl = new URL(sourceUrl.pathname, TARGET_ORIGIN);
    targetUrl.search = sourceUrl.search;

    return Response.redirect(targetUrl.toString(), 301);
  }
};
