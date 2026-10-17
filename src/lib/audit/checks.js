// src/lib/audit/checks.js

/**
 * YNS Website Audit Engine
 *
 * Receives parsed website data and returns:
 * - score
 * - category scores
 * - issues
 * - passed checks
 *
 * The actual HTML fetching/parsing will be handled separately.
 */

const SEVERITY_WEIGHT = {
  critical: 10,
  warning: 5,
  suggestion: 2,
};

const CATEGORY_MAX_SCORE = {
  SEO: 100,
  Technical: 100,
  Accessibility: 100,
  Performance: 100,
  Security: 100,
};

function createIssue({
  id,
  category,
  severity,
  title,
  description,
  recommendation,
}) {
  return {
    id,
    category,
    severity,
    title,
    description,
    recommendation,
  };
}

function createPassed(id, category, title) {
  return {
    id,
    category,
    title,
  };
}

/**
 * Normalize values coming from the HTML parser.
 */
function normalizeData(data = {}) {
  return {
    url: data.url || "",
    statusCode: data.statusCode ?? null,
    responseTime: data.responseTime ?? null,
    htmlSize: data.htmlSize ?? null,

    title: data.title || "",
    metaDescription: data.metaDescription || "",
    canonical: data.canonical || "",
    robots: data.robots || "",
    lang: data.lang || "",

    h1Count: Number(data.h1Count || 0),
    headings: Array.isArray(data.headings) ? data.headings : [],

    images: Array.isArray(data.images) ? data.images : [],
    links: Array.isArray(data.links) ? data.links : [],

    scripts: Array.isArray(data.scripts) ? data.scripts : [],
    stylesheets: Array.isArray(data.stylesheets)
      ? data.stylesheets
      : [],

    viewport: Boolean(data.viewport),
    favicon: Boolean(data.favicon),

    ogTitle: data.ogTitle || "",
    ogDescription: data.ogDescription || "",
    ogImage: data.ogImage || "",

    twitterCard: data.twitterCard || "",

    structuredData: Array.isArray(data.structuredData)
      ? data.structuredData
      : [],

    sitemapExists: data.sitemapExists ?? null,
    robotsTxtExists: data.robotsTxtExists ?? null,

    https: Boolean(data.https),

    inputs: Array.isArray(data.inputs) ? data.inputs : [],
    buttons: Array.isArray(data.buttons) ? data.buttons : [],

    externalResources: Array.isArray(data.externalResources)
      ? data.externalResources
      : [],

    largeImages: Array.isArray(data.largeImages)
      ? data.largeImages
      : [],
  };
}

/**
 * Run the complete YNS audit.
 */
export function runAudit(rawData = {}) {
  const data = normalizeData(rawData);

  const issues = [];
  const passed = [];

  /*
   * ============================================================
   * SEO CHECKS
   * ============================================================
   */

  // 1. Title exists
  if (!data.title) {
    issues.push(
      createIssue({
        id: "seo-missing-title",
        category: "SEO",
        severity: "critical",
        title: "Missing page title",
        description:
          "The page does not have a title tag. Search engines use the title to understand the main topic of the page.",
        recommendation:
          "Add a unique and descriptive <title> element to the page.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-title-exists",
        "SEO",
        "Page title exists"
      )
    );
  }

  // 2. Title length
  if (data.title) {
    if (data.title.length < 30) {
      issues.push(
        createIssue({
          id: "seo-short-title",
          category: "SEO",
          severity: "warning",
          title: "Page title is short",
          description:
            "The title may not provide enough context about the page.",
          recommendation:
            "Use a clear, descriptive title that accurately represents the page content.",
        })
      );
    } else if (data.title.length > 60) {
      issues.push(
        createIssue({
          id: "seo-long-title",
          category: "SEO",
          severity: "suggestion",
          title: "Page title may be too long",
          description:
            "Long titles may be truncated in search results.",
          recommendation:
            "Consider keeping the important part of the title within approximately 50–60 characters.",
        })
      );
    } else {
      passed.push(
        createPassed(
          "seo-title-length",
          "SEO",
          "Page title length looks reasonable"
        )
      );
    }
  }

  // 3. Meta description
  if (!data.metaDescription) {
    issues.push(
      createIssue({
        id: "seo-missing-description",
        category: "SEO",
        severity: "critical",
        title: "Missing meta description",
        description:
          "The page does not contain a meta description.",
        recommendation:
          "Add a unique meta description that clearly summarizes the page.",
      })
    );
  } else if (data.metaDescription.length < 70) {
    issues.push(
      createIssue({
        id: "seo-short-description",
        category: "SEO",
        severity: "warning",
        title: "Meta description is short",
        description:
          "The meta description may not fully explain the page to search users.",
        recommendation:
          "Write a useful description that communicates the page value and primary topic.",
      })
    );
  } else if (data.metaDescription.length > 160) {
    issues.push(
      createIssue({
        id: "seo-long-description",
        category: "SEO",
        severity: "suggestion",
        title: "Meta description may be too long",
        description:
          "Long descriptions may be truncated in search results.",
        recommendation:
          "Keep the most important information near the beginning and aim for roughly 70–160 characters.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-description",
        "SEO",
        "Meta description exists"
      )
    );
  }

  // 4. H1
  if (data.h1Count === 0) {
    issues.push(
      createIssue({
        id: "seo-missing-h1",
        category: "SEO",
        severity: "warning",
        title: "Missing H1 heading",
        description:
          "The page does not appear to have a primary H1 heading.",
        recommendation:
          "Add one clear H1 heading that describes the main topic of the page.",
      })
    );
  } else if (data.h1Count > 1) {
    issues.push(
      createIssue({
        id: "seo-multiple-h1",
        category: "SEO",
        severity: "suggestion",
        title: "Multiple H1 headings found",
        description:
          "The page contains multiple H1 headings.",
        recommendation:
          "Review the heading structure and use a clear primary heading where appropriate.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-h1",
        "SEO",
        "One primary H1 heading found"
      )
    );
  }

  // 5. Canonical
  if (!data.canonical) {
    issues.push(
      createIssue({
        id: "seo-missing-canonical",
        category: "SEO",
        severity: "warning",
        title: "Canonical URL is missing",
        description:
          "The page does not specify a canonical URL.",
        recommendation:
          "Add a canonical link pointing to the preferred version of the page.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-canonical",
        "SEO",
        "Canonical URL exists"
      )
    );
  }

  // 6. Robots
  if (!data.robots) {
    passed.push(
      createPassed(
        "seo-robots-default",
        "SEO",
        "No restrictive robots meta directive detected"
      )
    );
  } else if (/noindex/i.test(data.robots)) {
    issues.push(
      createIssue({
        id: "seo-noindex",
        category: "SEO",
        severity: "critical",
        title: "Page contains a noindex directive",
        description:
          "The page appears to instruct search engines not to index it.",
        recommendation:
          "If this page should appear in search results, remove the unintended noindex directive.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-robots",
        "SEO",
        "Robots directive does not contain noindex"
      )
    );
  }

  // 7. Open Graph
  if (!data.ogTitle || !data.ogDescription) {
    issues.push(
      createIssue({
        id: "seo-open-graph",
        category: "SEO",
        severity: "suggestion",
        title: "Open Graph metadata is incomplete",
        description:
          "Important Open Graph metadata is missing.",
        recommendation:
          "Add og:title, og:description and preferably og:image for better social sharing previews.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-open-graph",
        "SEO",
        "Open Graph metadata found"
      )
    );
  }

  // 8. Structured data
  if (!data.structuredData.length) {
    issues.push(
      createIssue({
        id: "seo-structured-data",
        category: "SEO",
        severity: "suggestion",
        title: "No structured data detected",
        description:
          "No JSON-LD structured data was detected on the page.",
        recommendation:
          "Consider adding relevant Schema.org structured data where it accurately represents the page.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-structured-data",
        "SEO",
        "Structured data detected"
      )
    );
  }

  // 9. Language
  if (!data.lang) {
    issues.push(
      createIssue({
        id: "seo-missing-lang",
        category: "SEO",
        severity: "warning",
        title: "HTML language attribute is missing",
        description:
          "The HTML document does not specify a language.",
        recommendation:
          'Add a language attribute such as lang="en" to the HTML element.',
      })
    );
  } else {
    passed.push(
      createPassed(
        "seo-lang",
        "SEO",
        "HTML language attribute exists"
      )
    );
  }

  /*
   * ============================================================
   * TECHNICAL CHECKS
   * ============================================================
   */

  // 10. HTTPS
  if (!data.https) {
    issues.push(
      createIssue({
        id: "security-no-https",
        category: "Security",
        severity: "critical",
        title: "HTTPS is not enabled",
        description:
          "The audited URL is not using HTTPS.",
        recommendation:
          "Enable HTTPS and redirect HTTP traffic to the secure HTTPS version.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "security-https",
        "Security",
        "HTTPS is enabled"
      )
    );
  }

  // 11. Viewport
  if (!data.viewport) {
    issues.push(
      createIssue({
        id: "technical-viewport",
        category: "Technical",
        severity: "warning",
        title: "Viewport meta tag is missing",
        description:
          "The page does not appear to define a responsive viewport.",
        recommendation:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      })
    );
  } else {
    passed.push(
      createPassed(
        "technical-viewport",
        "Technical",
        "Responsive viewport is configured"
      )
    );
  }

  // 12. Favicon
  if (!data.favicon) {
    issues.push(
      createIssue({
        id: "technical-favicon",
        category: "Technical",
        severity: "suggestion",
        title: "Favicon is missing",
        description:
          "No favicon was detected.",
        recommendation:
          "Add a favicon so browsers can identify your website more clearly.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "technical-favicon",
        "Technical",
        "Favicon detected"
      )
    );
  }

  // 13. HTTP status
  if (data.statusCode && data.statusCode >= 400) {
    issues.push(
      createIssue({
        id: "technical-http-status",
        category: "Technical",
        severity: "critical",
        title: `Website returned HTTP ${data.statusCode}`,
        description:
          "The requested page returned an error HTTP status.",
        recommendation:
          "Check the URL, server configuration and application routing.",
      })
    );
  } else if (data.statusCode) {
    passed.push(
      createPassed(
        "technical-http-status",
        "Technical",
        `Website returned HTTP ${data.statusCode}`
      )
    );
  }

  // 14. Sitemap
  if (data.sitemapExists === false) {
    issues.push(
      createIssue({
        id: "technical-sitemap",
        category: "Technical",
        severity: "warning",
        title: "XML sitemap was not found",
        description:
          "No accessible sitemap.xml was detected.",
        recommendation:
          "Create an XML sitemap containing the important indexable URLs on your website.",
      })
    );
  } else if (data.sitemapExists === true) {
    passed.push(
      createPassed(
        "technical-sitemap",
        "Technical",
        "XML sitemap detected"
      )
    );
  }

  // 15. robots.txt
  if (data.robotsTxtExists === false) {
    issues.push(
      createIssue({
        id: "technical-robots",
        category: "Technical",
        severity: "suggestion",
        title: "robots.txt was not found",
        description:
          "No accessible robots.txt file was detected.",
        recommendation:
          "Consider adding a robots.txt file to control crawler access and reference your sitemap.",
      })
    );
  } else if (data.robotsTxtExists === true) {
    passed.push(
      createPassed(
        "technical-robots",
        "Technical",
        "robots.txt detected"
      )
    );
  }

  /*
   * ============================================================
   * IMAGE CHECKS
   * ============================================================
   */

  // 16. Image ALT
  const imagesWithoutAlt = data.images.filter(
    (image) =>
      !image.alt ||
      String(image.alt).trim().length === 0
  );

  if (imagesWithoutAlt.length > 0) {
    issues.push(
      createIssue({
        id: "accessibility-image-alt",
        category: "Accessibility",
        severity: "warning",
        title: `${imagesWithoutAlt.length} image${
          imagesWithoutAlt.length === 1 ? "" : "s"
        } missing ALT text`,
        description:
          "Some images do not have alternative text.",
        recommendation:
          "Add meaningful alt text to informative images. Use empty alt text for genuinely decorative images.",
      })
    );
  } else if (data.images.length > 0) {
    passed.push(
      createPassed(
        "accessibility-image-alt",
        "Accessibility",
        "Images contain ALT attributes"
      )
    );
  }

  // 17. Broken image sources
  const brokenImages = data.images.filter(
    (image) => image.broken === true
  );

  if (brokenImages.length > 0) {
    issues.push(
      createIssue({
        id: "technical-broken-images",
        category: "Technical",
        severity: "warning",
        title: `${brokenImages.length} broken image${
          brokenImages.length === 1 ? "" : "s"
        } detected`,
        description:
          "Some image resources could not be loaded.",
        recommendation:
          "Check the image URLs and make sure the referenced files exist and are publicly accessible.",
      })
    );
  }

  /*
   * ============================================================
   * LINK CHECKS
   * ============================================================
   */

  // 18. Broken links
  const brokenLinks = data.links.filter(
    (link) => link.broken === true
  );

  if (brokenLinks.length > 0) {
    issues.push(
      createIssue({
        id: "technical-broken-links",
        category: "Technical",
        severity: "critical",
        title: `${brokenLinks.length} broken link${
          brokenLinks.length === 1 ? "" : "s"
        } detected`,
        description:
          "Some links on the page appear to lead to unavailable resources.",
        recommendation:
          "Update, remove or redirect broken URLs and verify important internal links.",
      })
    );
  } else if (data.links.length > 0) {
    passed.push(
      createPassed(
        "technical-links",
        "Technical",
        "No broken links detected in scanned links"
      )
    );
  }

  /*
   * ============================================================
   * ACCESSIBILITY CHECKS
   * ============================================================
   */

  // 19. Inputs without labels
  const inputsWithoutLabels = data.inputs.filter(
    (input) => input.hasLabel === false
  );

  if (inputsWithoutLabels.length > 0) {
    issues.push(
      createIssue({
        id: "accessibility-input-labels",
        category: "Accessibility",
        severity: "warning",
        title: `${inputsWithoutLabels.length} form input${
          inputsWithoutLabels.length === 1 ? "" : "s"
        } may be missing labels`,
        description:
          "Some form inputs do not appear to have an associated accessible label.",
        recommendation:
          "Associate each user-facing input with a meaningful label or accessible name.",
      })
    );
  } else if (data.inputs.length > 0) {
    passed.push(
      createPassed(
        "accessibility-input-labels",
        "Accessibility",
        "Form inputs have accessible labels"
      )
    );
  }

  // 20. Buttons without accessible names
  const unnamedButtons = data.buttons.filter(
    (button) => button.hasAccessibleName === false
  );

  if (unnamedButtons.length > 0) {
    issues.push(
      createIssue({
        id: "accessibility-buttons",
        category: "Accessibility",
        severity: "warning",
        title: `${unnamedButtons.length} button${
          unnamedButtons.length === 1 ? "" : "s"
        } may lack an accessible name`,
        description:
          "Some buttons do not appear to have text or another accessible name.",
        recommendation:
          "Give every interactive button a clear accessible name.",
      })
    );
  } else if (data.buttons.length > 0) {
    passed.push(
      createPassed(
        "accessibility-buttons",
        "Accessibility",
        "Buttons have accessible names"
      )
    );
  }

  /*
   * ============================================================
   * PERFORMANCE SIGNALS
   * ============================================================
   */

  // 21. Too many scripts
  if (data.scripts.length > 20) {
    issues.push(
      createIssue({
        id: "performance-many-scripts",
        category: "Performance",
        severity: "warning",
        title: "Large number of JavaScript resources",
        description:
          `The page references ${data.scripts.length} script resources.`,
        recommendation:
          "Review unnecessary scripts, third-party libraries and duplicate JavaScript.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "performance-scripts",
        "Performance",
        "JavaScript resource count is reasonable"
      )
    );
  }

  // 22. Too many stylesheets
  if (data.stylesheets.length > 10) {
    issues.push(
      createIssue({
        id: "performance-many-stylesheets",
        category: "Performance",
        severity: "suggestion",
        title: "Large number of stylesheet resources",
        description:
          `The page references ${data.stylesheets.length} stylesheet resources.`,
        recommendation:
          "Review CSS resources and remove unnecessary stylesheets where possible.",
      })
    );
  } else {
    passed.push(
      createPassed(
        "performance-stylesheets",
        "Performance",
        "Stylesheet resource count is reasonable"
      )
    );
  }

  // 23. Large HTML document
  if (data.htmlSize && data.htmlSize > 500 * 1024) {
    issues.push(
      createIssue({
        id: "performance-large-html",
        category: "Performance",
        severity: "warning",
        title: "HTML document is large",
        description:
          "The downloaded HTML document is relatively large.",
        recommendation:
          "Reduce unnecessary HTML, embedded data and duplicated markup where possible.",
      })
    );
  }

  // 24. Large images
  if (data.largeImages.length > 0) {
    issues.push(
      createIssue({
        id: "performance-large-images",
        category: "Performance",
        severity: "warning",
        title: `${data.largeImages.length} potentially large image${
          data.largeImages.length === 1 ? "" : "s"
        } detected`,
        description:
          "Some images may have a relatively large file size.",
        recommendation:
          "Compress images and use modern formats such as WebP or AVIF where appropriate.",
      })
    );
  }

  /*
   * ============================================================
   * SECURITY
   * ============================================================
   */

  // 25. Mixed content
  const mixedContent = data.externalResources.filter(
    (resource) =>
      data.https &&
      typeof resource === "string" &&
      resource.startsWith("http://")
  );

  if (mixedContent.length > 0) {
    issues.push(
      createIssue({
        id: "security-mixed-content",
        category: "Security",
        severity: "critical",
        title: "HTTP resources detected on HTTPS page",
        description:
          "The page appears to load resources over insecure HTTP.",
        recommendation:
          "Serve all page resources over HTTPS to avoid mixed-content problems.",
      })
    );
  } else if (data.https) {
    passed.push(
      createPassed(
        "security-mixed-content",
        "Security",
        "No HTTP mixed-content resources detected"
      )
    );
  }

  return buildAuditResult(data, issues, passed);
}

/**
 * Calculate category scores and overall score.
 */
function buildAuditResult(data, issues, passed) {
  const categoryScores = {
    SEO: CATEGORY_MAX_SCORE.SEO,
    Technical: CATEGORY_MAX_SCORE.Technical,
    Accessibility: CATEGORY_MAX_SCORE.Accessibility,
    Performance: CATEGORY_MAX_SCORE.Performance,
    Security: CATEGORY_MAX_SCORE.Security,
  };

  /*
   * Deduct points according to severity.
   */
  for (const issue of issues) {
    const deduction = SEVERITY_WEIGHT[issue.severity] || 2;

    if (categoryScores[issue.category] !== undefined) {
      categoryScores[issue.category] = Math.max(
        0,
        categoryScores[issue.category] - deduction
      );
    }
  }

  const categoryValues = Object.values(categoryScores);

  const overallScore = Math.round(
    categoryValues.reduce((sum, score) => sum + score, 0) /
      categoryValues.length
  );

  const criticalCount = issues.filter(
    (issue) => issue.severity === "critical"
  ).length;

  const warningCount = issues.filter(
    (issue) => issue.severity === "warning"
  ).length;

  const suggestionCount = issues.filter(
    (issue) => issue.severity === "suggestion"
  ).length;

  return {
    url: data.url,

    score: overallScore,

    categories: {
      seo: categoryScores.SEO,
      technical: categoryScores.Technical,
      accessibility: categoryScores.Accessibility,
      performance: categoryScores.Performance,
      security: categoryScores.Security,
    },

    summary: {
      totalIssues: issues.length,
      critical: criticalCount,
      warnings: warningCount,
      suggestions: suggestionCount,
      passed: passed.length,
    },

    issues,
    passed,

    generatedAt: new Date().toISOString(),
  };
}

/**
 * Optional helper for the report UI.
 */
export function getScoreLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Needs Improvement";
  if (score >= 40) return "Poor";

  return "Critical";
}

/**
 * Optional helper for sorting issues.
 */
export function sortIssues(issues = []) {
  const order = {
    critical: 1,
    warning: 2,
    suggestion: 3,
  };

  return [...issues].sort(
    (a, b) =>
      (order[a.severity] || 99) -
      (order[b.severity] || 99)
  );
}