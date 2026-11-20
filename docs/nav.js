// Shared navigation bar for every Homeward page.
// One file serves both places these pages run:
//   - the Homeward app (Render, or http://localhost:3000): Home, Decide, Recovery pulse, Resources
//   - GitHub Pages (the Product Page): Product Page, Resources, and a link to the live app
// Include it as the first thing inside <body>: <script src="nav.js"></script>
(function () {
  // The live app's address. Fill in after the first Render deploy (see AGENTS.md, Shipping).
  const APP_URL = "https://homeward-ccma.onrender.com";
  const onPages = /github\.io$/.test(location.hostname);
  const here = location.pathname.replace(/\/$/, "") || "/";

  const links = onPages
    ? [
        { href: "index.html", match: ["index.html", ""], label: "Product Page" },
        { href: "resources.html", match: ["resources.html"], label: "Recovery Resources" },
      ]
    : [
        { href: "/", match: ["/"], label: "Homeward" },
        { href: "/decide", match: ["/decide"], label: "Decide" },
        { href: "/pulse", match: ["/pulse"], label: "Recovery pulse" },
        { href: "/resources.html", match: ["/resources.html"], label: "Resources" },
      ];
  const page = onPages ? location.pathname.split("/").pop() : here;

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Homeward");
  const list = document.createElement("ul");

  for (const l of links) {
    const a = document.createElement("a");
    a.href = l.href;
    a.textContent = l.label;
    if (l.match.includes(page)) a.setAttribute("aria-current", "page");
    const li = document.createElement("li");
    li.append(a);
    list.append(li);
  }

  // On the Product Page, link to the live app once it has an address.
  if (onPages && APP_URL) {
    const app = document.createElement("a");
    app.href = APP_URL;
    app.textContent = "Open the app";
    const li = document.createElement("li");
    li.append(app);
    list.append(li);
  }

  // External link: new tab, and says it isn't affiliated with Homeward.
  const ext = document.createElement("a");
  ext.href = "https://map.palipost.com";
  ext.target = "_blank";
  ext.rel = "noopener noreferrer";
  ext.title = "Opens in a new tab. Not affiliated with Homeward.";
  ext.className = "external";
  ext.innerHTML = 'Pali Post Rebuild Map <span aria-hidden="true">↗</span>' +
    '<span class="sr-only"> (opens in a new tab; not affiliated with Homeward)</span>';
  const li = document.createElement("li");
  li.className = "external-item";
  li.append(ext);
  list.append(li);

  nav.append(list);
  document.currentScript.before(nav);

  // On narrow screens the row scrolls sideways: make sure the current page's link is visible.
  const current = list.querySelector('[aria-current="page"]');
  if (current && list.scrollWidth > list.clientWidth) {
    list.scrollLeft = current.parentElement.offsetLeft - 12;
  }
})();
