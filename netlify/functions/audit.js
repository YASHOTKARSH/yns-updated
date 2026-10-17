import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";

const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MB
const REQUEST_TIMEOUT = 10000;
const MAX_REDIRECTS = 3;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return response(204, null);
  }

  if (request.method !== "POST") {
    return response(405, {
      success: false,
      error: "Method not allowed.",
    });
  }

let body;

try {
  body = await request.json();
} catch {
  return response(400, {
    success: false,
    error: "Invalid JSON request.",
  });
}

  const inputUrl = body?.url;

  if (!inputUrl || typeof inputUrl !== "string") {
    return response(400, {
      success: false,
      error: "Website URL is required.",
    });
  }

  let targetUrl;

  try {
    targetUrl = normalizeUrl(inputUrl);
  } catch (error) {
    return response(400, {
      success: false,
      error: error.message || "Invalid website URL.",
    });
  }

  try {
    await assertSafeUrl(targetUrl);

    const result = await fetchWebsite(targetUrl);

    const auditData = await buildAuditData(
      result.url,
      result.statusCode,
      result.responseTime,
      result.html,
      result.headers
    );

    const { runAudit } = await import("../../src/lib/audit/checks.js");

    const report = runAudit(auditData);

    return response(200, {
      success: true,
      report,
    });
  } catch (error) {
    console.error("Audit error:", error);

    return response(500, {
      success: false,
      error: getSafeErrorMessage(error),
    });
  }
}

/**
 * Normalize and validate submitted URL.
 */
function normalizeUrl(value) {
  let urlString = value.trim();

  if (!urlString) {
    throw new Error("Please enter a website URL.");
  }

  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }

  let url;

  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Please enter a valid website URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  if (!url.hostname) {
    throw new Error("Website hostname is missing.");
  }

  /*
   * Do not allow username/password in URLs.
   */
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }

  /*
   * Avoid scanning localhost-style hostnames.
   */
  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  ) {
    throw new Error("Local websites cannot be scanned.");
  }

  /*
   * Explicit ports are unnecessary for the public tool.
   * Allow standard HTTP/HTTPS only.
   */
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error(
      "Only standard HTTP and HTTPS ports are supported."
    );
  }

  url.hash = "";

  return url;
}

/**
 * SSRF protection.
 *
 * Resolve the hostname and reject private/internal IP ranges.
 */
async function assertSafeUrl(url) {
  const hostname = url.hostname.toLowerCase();

  /*
   * If hostname itself is an IP address,
   * validate it directly.
   */
  const ipVersion = net.isIP(hostname);

  if (ipVersion) {
    if (isPrivateIp(hostname, ipVersion)) {
      throw new Error(
        "Private or internal network addresses cannot be scanned."
      );
    }

    return;
  }

  let addresses;

  try {
    addresses = await dns.lookup(hostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new Error(
      "The website hostname could not be resolved."
    );
  }

  if (!addresses.length) {
    throw new Error(
      "The website hostname could not be resolved."
    );
  }

  for (const address of addresses) {
    if (isPrivateIp(address.address, address.family)) {
      throw new Error(
        "Private or internal network addresses cannot be scanned."
      );
    }
  }
}

/**
 * Detect private/reserved IPv4 and IPv6 addresses.
 */
function isPrivateIp(ip, family) {
  if (family === 4 || net.isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);

    if (parts.length !== 4) {
      return true;
    }

    const [a, b] = parts;

    // 10.0.0.0/8
    if (a === 10) return true;

    // 127.0.0.0/8
    if (a === 127) return true;

    // 169.254.0.0/16
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }

    // 192.168.0.0/16
    if (a === 192 && b === 168) {
      return true;
    }

    // 0.0.0.0/8
    if (a === 0) return true;

    return false;
  }

  /*
   * IPv6 private/reserved ranges.
   */
  const normalized = ip.toLowerCase();

  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }

  /*
   * IPv4-mapped IPv6 addresses.
   */
  if (normalized.includes("::ffff:")) {
    const mapped = normalized.split("::ffff:")[1];

    if (net.isIP(mapped) === 4) {
      return isPrivateIp(mapped, 4);
    }
  }

  return false;
}

/**
 * Fetch target website safely.
 */
async function fetchWebsite(initialUrl) {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (true) {
    await assertSafeUrl(currentUrl);

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

    const startedAt = Date.now();

    let result;

    try {
      result = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "YNS-Website-Health-Checker/1.0 (+https://ynsweb.studio)",
          Accept:
            "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(
          "The website took too long to respond."
        );
      }

      throw new Error(
        "The website could not be reached."
      );
    } finally {
      clearTimeout(timeout);
    }

    const responseTime = Date.now() - startedAt;

    /*
     * Handle redirects manually so every redirected
     * destination is checked for SSRF.
     */
    if (
      [301, 302, 303, 307, 308].includes(result.status)
    ) {
      if (redirectCount >= MAX_REDIRECTS) {
        throw new Error(
          "The website has too many redirects."
        );
      }

      const location = result.headers.get("location");

      if (!location) {
        throw new Error(
          "The website returned an invalid redirect."
        );
      }

      let redirectedUrl;

      try {
        redirectedUrl = new URL(
          location,
          currentUrl
        );
      } catch {
        throw new Error(
          "The website returned an invalid redirect URL."
        );
      }

      if (!ALLOWED_PROTOCOLS.has(redirectedUrl.protocol)) {
        throw new Error(
          "The website redirected to an unsupported protocol."
        );
      }

      redirectedUrl.hash = "";

      await assertSafeUrl(redirectedUrl);

      currentUrl = redirectedUrl;
      redirectCount += 1;

      continue;
    }

    const contentType =
      result.headers.get("content-type") || "";

    /*
     * We currently analyze HTML pages only.
     */
    if (
      !contentType.toLowerCase().includes("text/html") &&
      !contentType.toLowerCase().includes("application/xhtml+xml")
    ) {
      throw new Error(
        "The URL does not appear to contain an HTML webpage."
      );
    }

    /*
     * Protect the function from very large responses.
     */
    const contentLength = Number(
      result.headers.get("content-length") || 0
    );

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_RESPONSE_SIZE
    ) {
      throw new Error(
        "The webpage is too large to analyze."
      );
    }

    const html = await readLimitedResponse(
      result,
      MAX_RESPONSE_SIZE
    );

    return {
      url: currentUrl.href,
      statusCode: result.status,
      responseTime,
      html,
      headers: result.headers,
    };
  }
}

/**
 * Read response while enforcing maximum size.
 */
async function readLimitedResponse(
  response,
  maxBytes
) {
  if (!response.body) {
    throw new Error(
      "The website returned an empty response."
    );
  }

  const reader = response.body.getReader();

  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors.
        }

        throw new Error(
          "The webpage is too large to analyze."
        );
      }

      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors.
    }
  }

  const combined = new Uint8Array(totalBytes);

  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8").decode(combined);
}

/**
 * Parse HTML and create the structure expected
 * by src/lib/audit/checks.js
 */
async function buildAuditData(
  url,
  statusCode,
  responseTime,
  html,
  headers
) {
  const $ = cheerio.load(html);

  const parsedUrl = new URL(url);

  /*
   * Basic metadata
   */
  const title = $("title").first().text().trim();

  const metaDescription =
    $('meta[name="description"]')
      .attr("content")
      ?.trim() || "";

  const canonical =
    $('link[rel="canonical"]')
      .attr("href")
      ?.trim() || "";

  const robots =
    $('meta[name="robots"]')
      .attr("content")
      ?.trim() || "";

  const lang =
    $("html").attr("lang")?.trim() || "";

  /*
   * Headings
   */
  const headings = [];

  $("h1,h2,h3,h4,h5,h6").each(
    (_, element) => {
      const tag = element.tagName?.toLowerCase();

      headings.push({
        level: Number(tag?.replace("h", "")),
        text: $(element).text().trim(),
      });
    }
  );

  const h1Count = $("h1").length;

  /*
   * Images
   */
  const images = [];

  $("img").each((_, element) => {
    const src =
      $(element).attr("src")?.trim() || "";

    const alt =
      $(element).attr("alt")?.trim() || "";

    images.push({
      src,
      alt,
      loading:
        $(element).attr("loading") || "",
      broken: false,
    });
  });

  /*
   * Links
   */
  const links = [];

  $("a").each((_, element) => {
    const href =
      $(element).attr("href")?.trim() || "";

    if (!href) return;

    let absoluteUrl = "";

    try {
      absoluteUrl = new URL(
        href,
        url
      ).href;
    } catch {
      absoluteUrl = href;
    }

    links.push({
      href: absoluteUrl,
      text: $(element).text().trim(),
      internal:
        isInternalUrl(
          absoluteUrl,
          parsedUrl.hostname
        ),
      broken: false,
    });
  });

  /*
   * Scripts
   */
  const scripts = [];

  $("script[src]").each((_, element) => {
    const src =
      $(element).attr("src")?.trim() || "";

    if (src) {
      scripts.push(src);
    }
  });

  /*
   * Stylesheets
   */
  const stylesheets = [];

  $('link[rel="stylesheet"]').each(
    (_, element) => {
      const href =
        $(element).attr("href")?.trim() || "";

      if (href) {
        stylesheets.push(href);
      }
    }
  );

  /*
   * Viewport
   */
  const viewport = Boolean(
    $('meta[name="viewport"]').attr("content")
  );

  /*
   * Favicon
   */
  const favicon = Boolean(
    $('link[rel~="icon"]').length ||
      $('link[rel="shortcut icon"]').length
  );

  /*
   * Open Graph
   */
  const ogTitle =
    $('meta[property="og:title"]')
      .attr("content")
      ?.trim() || "";

  const ogDescription =
    $('meta[property="og:description"]')
      .attr("content")
      ?.trim() || "";

  const ogImage =
    $('meta[property="og:image"]')
      .attr("content")
      ?.trim() || "";

  /*
   * Twitter Card
   */
  const twitterCard =
    $('meta[name="twitter:card"]')
      .attr("content")
      ?.trim() || "";

  /*
   * Structured data
   */
  const structuredData = [];

  $('script[type="application/ld+json"]').each(
    (_, element) => {
      const raw = $(element)
        .contents()
        .text()
        .trim();

      if (!raw) return;

      try {
        structuredData.push(JSON.parse(raw));
      } catch {
        /*
         * Invalid JSON-LD is itself useful information,
         * but the current engine only records valid
         * structured data.
         */
      }
    }
  );

  /*
   * Form inputs
   */
  const inputs = [];

  $("input,select,textarea").each(
    (_, element) => {
      const id =
        $(element).attr("id") || "";

      const name =
        $(element).attr("name") || "";

      const ariaLabel =
        $(element).attr("aria-label") || "";

      const ariaLabelledBy =
        $(element).attr("aria-labelledby") || "";

      const hasLabel =
        Boolean(
          ariaLabel ||
            ariaLabelledBy ||
            (id &&
              $(`label[for="${escapeSelector(id)}"]`)
                .length) ||
            (name &&
              $(element)
                .closest("label")
                .length)
        );

      inputs.push({
        type:
          $(element).attr("type") || "text",
        hasLabel,
      });
    }
  );

  /*
   * Buttons
   */
  const buttons = [];

  $("button,[role='button']").each(
    (_, element) => {
      const text =
        $(element).text().trim();

      const ariaLabel =
        $(element).attr("aria-label")?.trim() || "";

      const ariaLabelledBy =
        $(element)
          .attr("aria-labelledby")
          ?.trim() || "";

      const title =
        $(element).attr("title")?.trim() || "";

      const hasAccessibleName = Boolean(
        text ||
          ariaLabel ||
          ariaLabelledBy ||
          title
      );

      buttons.push({
        hasAccessibleName,
      });
    }
  );

  /*
   * External resources.
   */
  const externalResources = [];

  $("script[src],link[href],img[src],iframe[src]").each(
    (_, element) => {
      const attribute =
        element.tagName?.toLowerCase() === "link"
          ? "href"
          : "src";

      const value =
        $(element).attr(attribute)?.trim() || "";

      if (!value) return;

      try {
        const absolute = new URL(
          value,
          url
        );

        if (
          absolute.protocol === "http:" ||
          absolute.protocol === "https:"
        ) {
          externalResources.push(
            absolute.href
          );
        }
      } catch {
        // Ignore invalid resource URLs.
      }
    }
  );

  /*
   * Basic HTML size.
   */
  const htmlSize = Buffer.byteLength(
    html,
    "utf8"
  );

  /*
   * Detect obviously large images based on
   * HTML-provided attributes.
   *
   * We don't download every image in the MVP.
   */
  const largeImages = [];

  $("img").each((_, element) => {
    const width = Number(
      $(element).attr("width") || 0
    );

    const height = Number(
      $(element).attr("height") || 0
    );

    if (
      width >= 2500 ||
      height >= 2500
    ) {
      largeImages.push({
        src:
          $(element).attr("src") || "",
        width,
        height,
      });
    }
  });

  /*
   * Sitemap / robots.txt.
   *
   * These are separate HTTP requests, so failures
   * should not kill the entire audit.
   */
  const [sitemapExists, robotsTxtExists] =
    await Promise.all([
      checkResourceExists(
        new URL(
          "/sitemap.xml",
          url
        ).href
      ),
      checkResourceExists(
        new URL(
          "/robots.txt",
          url
        ).href
      ),
    ]);

  /*
   * We deliberately don't claim broken links
   * yet. Full link checking will be added in
   * the next version because it requires many
   * additional requests and rate limiting.
   */

  return {
    url,
    statusCode,
    responseTime,
    htmlSize,

    title,
    metaDescription,
    canonical,
    robots,
    lang,

    h1Count,
    headings,

    images,
    links,

    scripts,
    stylesheets,

    viewport,
    favicon,

    ogTitle,
    ogDescription,
    ogImage,

    twitterCard,

    structuredData,

    sitemapExists,
    robotsTxtExists,

    https:
      parsedUrl.protocol === "https:",

    inputs,
    buttons,

    externalResources,

    largeImages,

    headers: Object.fromEntries(headers.entries()),
  };
}

/**
 * Check whether a resource exists without following
 * untrusted redirects.
 */
async function checkResourceExists(url) {
  try {
    const parsed = new URL(url);

    await assertSafeUrl(parsed);

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 5000);

    try {
      const result = await fetch(
        parsed.href,
        {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "YNS-Website-Health-Checker/1.0",
          },
        }
      );

      if (
        result.status >= 200 &&
        result.status < 400
      ) {
        return true;
      }

      /*
       * Some servers don't support HEAD.
       * Try a very small GET.
       */
      if (result.status === 405) {
        return await checkWithGet(parsed.href);
      }

      return false;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

async function checkWithGet(url) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 5000);

  try {
    const result = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "YNS-Website-Health-Checker/1.0",
      },
    });

    return (
      result.status >= 200 &&
      result.status < 400
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Determine whether a URL belongs to the
 * scanned website.
 */
function isInternalUrl(
  value,
  hostname
) {
  try {
    const parsed = new URL(value);

    return (
      parsed.hostname === hostname ||
      parsed.hostname.endsWith(`.${hostname}`)
    );
  } catch {
    return false;
  }
}

/**
 * Minimal selector escaping for label[for="..."].
 */
function escapeSelector(value) {
  return String(value).replace(
    /["\\]/g,
    "\\$&"
  );
}

/**
 * Keep implementation details away from users.
 */
function getSafeErrorMessage(error) {
  const message =
    error?.message ||
    "Unable to analyze this website.";

  const safeMessages = [
    "Please enter a website URL.",
    "Please enter a valid website URL.",
    "Only HTTP and HTTPS URLs are supported.",
    "Website hostname is missing.",
    "URLs containing credentials are not allowed.",
    "Local websites cannot be scanned.",
    "Only standard HTTP and HTTPS ports are supported.",
    "Private or internal network addresses cannot be scanned.",
    "The website hostname could not be resolved.",
    "The website took too long to respond.",
    "The website could not be reached.",
    "The website has too many redirects.",
    "The website returned an invalid redirect.",
    "The website redirected to an unsupported protocol.",
    "The URL does not appear to contain an HTML webpage.",
    "The webpage is too large to analyze.",
    "The website returned an empty response.",
  ];

  if (safeMessages.includes(message)) {
    return message;
  }

  return "We couldn't analyze this website. Please check the URL and try again.";
}

/**
 * Standard JSON response.
 */
function response(statusCode, data) {
  return new Response(
    data === null ? "" : JSON.stringify(data),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": "https://ynsweb.studio",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    }
  );
}