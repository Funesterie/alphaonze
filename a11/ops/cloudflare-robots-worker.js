const ROBOTS = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /oauth/
Disallow: /mcp
Disallow: /.well-known/mcp
Disallow: /.well-known/oauth
Disallow: /.well-known/openid-configuration
Disallow: /register
Disallow: /auth/success
Disallow: /a11/auth/success
Disallow: /k44/auth/success
Disallow: /kaen44/auth/success

Sitemap: https://funesterie.me/sitemap.xml
`;

export default {
  fetch() {
    return new Response(ROBOTS, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    });
  }
};
